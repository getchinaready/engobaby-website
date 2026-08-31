/**
 * 月卡预约 —— 每日教师摘要邮件
 * ---------------------------------------------------------------
 * 由 Vercel Cron 每天 00:00 UTC（北京 08:00）调一次 GET /api/yueka-digest。
 * 每次运行检查两类日子并发邮件到 MAIL_TO（三位老师）：
 *
 *   ① 报名截止：日期 = 今天+2 的课
 *      （规则是提前 3 天可约：D-3 当天还能约，D-2 起关闭。
 *        所以今天早上，「今天+2」那天的课刚刚停止报名）
 *      首周不限的日期没有截止点，跳过这封。
 *   ② 明日开课：日期 = 今天+1 的课（无论首周与否都发）
 *
 * 防重复：每发一封就在 Blob 写一个标记 yueka-digest-log/<date>-<type>，
 * 已有标记就跳过 —— cron 重跑或有人手动触发都不会发两遍。
 * 手动补发：加 ?force=1（需带 ?k=口令）。
 *
 * 鉴权：设置了 CRON_SECRET 时要求 Authorization: Bearer 匹配；
 * 也接受 ?k=YUEKA_CODE（方便老师手动触发）。都没有则拒绝。
 */

import { put, list } from '@vercel/blob';
import { SLOTS, STATUSES, SCHEDULE, todayCN } from './_yueka-data.js';
import { listBookings } from './yueka.js';

const MONTH = '2026-09';

export default async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const okCron = process.env.CRON_SECRET &&
    req.headers?.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const okKey = process.env.YUEKA_CODE && q.k === process.env.YUEKA_CODE;
  // 未配 CRON_SECRET 时放行无头 GET（Vercel Cron 默认无鉴权）；有防重标记兜底
  const okOpen = !process.env.CRON_SECRET && !q.k;
  if (!okCron && !okKey && !okOpen) return res.status(403).json({ ok: false });

  try {
    const cfg = SCHEDULE[MONTH];
    const today = todayCN();
    const plus = (n) => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);

    const jobs = [];
    const deadlineDate = plus(2), tomorrowDate = plus(1);

    const dDay = cfg.days.find((d) => d.date === deadlineDate && !d.break);
    if (dDay && !(cfg.graceDates || []).includes(deadlineDate)) {
      jobs.push({ type: 'deadline', day: dDay });
    }
    const tDay = cfg.days.find((d) => d.date === tomorrowDate && !d.break);
    if (tDay) jobs.push({ type: 'tomorrow', day: tDay });

    if (!jobs.length) return res.status(200).json({ ok: true, sent: [], note: '今天没有需要发的摘要' });

    const bookings = await listBookings();
    const sent = [], skipped = [];

    for (const job of jobs) {
      const marker = `yueka-digest-log/${job.day.date}-${job.type}.json`;
      if (!q.force) {
        const r = await list({ prefix: marker, limit: 1 });
        if (r.blobs.length) { skipped.push(marker); continue; }
      }
      await sendDigest(job, bookings.filter((b) => b.date === job.day.date));
      await put(marker, JSON.stringify({ at: new Date().toISOString() }), {
        access: 'private', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0,
      });
      sent.push(`${job.day.date} ${job.type}`);
    }
    return res.status(200).json({ ok: true, sent, skipped });
  } catch (e) {
    console.error('[yueka-digest]', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

const esc = (v) => String(v ?? '').replace(/[&<>"]/g,
  (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

async function sendDigest(job, dayBookings) {
  const { RESEND_API_KEY, MAIL_TO, MAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !MAIL_TO) throw new Error('RESEND_API_KEY / MAIL_TO 未配置');

  const d = job.day;
  const WD = ['周日','周一','周二','周三','周四','周五','周六'];
  const wd = WD[new Date(d.date + 'T00:00:00Z').getUTCDay()];  // 按日历日期本身算，与服务器时区无关
  const mmdd = d.date.slice(5).replace('-', '/');
  const isDeadline = job.type === 'deadline';

  const title = isDeadline
    ? `【报名截止】${mmdd}（${wd}）${d.en} · 共 ${dayBookings.length} 人`
    : `【明日开课】${mmdd}（${wd}）${d.en} · 共 ${dayBookings.length} 人`;

  const slotBlocks = (d.slots || []).map((s) => {
    const listB = dayBookings.filter((b) => b.slot === s);
    const rows = listB.length
      ? listB.map((b) => {
          const st = STATUSES.find((x) => x.key === b.status);
          return `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #EDF1F5;font-size:14px;font-weight:700;color:#2B3A4A">${esc(b.name)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #EDF1F5;font-size:13px;color:#5A6B7B">${st ? st.emoji + ' ' + esc(st.label) : '—'}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #EDF1F5;font-size:12px;color:#96A5B3">${esc(b.code)}</td>
          </tr>`; }).join('')
      : `<tr><td colspan="3" style="padding:10px 12px;font-size:13px;color:#96A5B3">暂时没有人预约</td></tr>`;
    return `
      <div style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:800;color:#16456F;margin-bottom:7px">
          ${esc(SLOTS[s].name)} ${esc(SLOTS[s].time)} · ${listB.length} 人</div>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #EDF1F5;border-radius:8px;overflow:hidden">
          <tr style="background:#F7F9FB">
            <th align="left" style="padding:7px 12px;font-size:12px;color:#7A8B9A">姓名</th>
            <th align="left" style="padding:7px 12px;font-size:12px;color:#7A8B9A">今天想练</th>
            <th align="left" style="padding:7px 12px;font-size:12px;color:#7A8B9A">代号</th>
          </tr>${rows}</table>
      </div>`;
  }).join('');

  const note = isDeadline
    ? '这一天的报名已于今天 0 点截止，以上就是最终名单（老师手动补报除外）。'
    : '明天就开课啦，记得按名单准备 Topic Card。首周不限预约的日子，明早开课前仍可能有人加入。';

  const html = `
<div style="background:#F0F4F8;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(31,111,176,.10)">
    <div style="background:${isDeadline ? '#C4820A' : '#16456F'};color:#fff;padding:20px 24px">
      <div style="font-size:12px;letter-spacing:.14em;opacity:.85;margin-bottom:4px">
        ${isDeadline ? 'BOOKING CLOSED · 报名截止' : 'CLASS TOMORROW · 明日开课'}</div>
      <div style="font-size:19px;font-weight:800">${mmdd}（${wd}）${esc(d.en)}</div>
      <div style="font-size:13px;opacity:.85;margin-top:3px">${esc(d.cn || '')} · 共 ${dayBookings.length} 人预约</div>
    </div>
    <div style="padding:22px 24px">${slotBlocks}
      <p style="font-size:12px;color:#7A8B9A;line-height:1.7;margin:6px 0 0">${note}</p>
    </div>
    <div style="background:#F7F9FB;padding:12px 24px;font-size:12px;color:#96A5B3;text-align:center">
      月卡预约系统自动发送 · www.engobaby.com/yueka</div>
  </div>
</div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: MAIL_FROM || 'onboarding@resend.dev',
      to: MAIL_TO.split(',').map((x) => x.trim()).filter(Boolean),
      subject: title, html,
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}
