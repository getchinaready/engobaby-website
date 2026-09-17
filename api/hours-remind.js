/**
 * 课时催填提醒 —— 每天跑一次的定时任务
 * ---------------------------------------------------------------
 * 一周结束后的第 1 天（周一）和第 6 天（周六），
 * 给「这一周还没填」的老师单独发一封提醒邮件。第 7 天是最后一天，不再打扰。
 *
 * 例：9/14–9/20 这一周 → 9/21 发第一次，9/26 发第二次，9/27 截止，9/28 零点锁。
 *
 * 触发：Vercel Cron（每天 10:00 北京时间）。
 * 手动：/api/hours-remind?k=YUEKA_CODE           看今天会发给谁（不真发）用 &dry=1
 */

import { put, list } from '@vercel/blob';
import { TEACHERS, REMIND_DAYS, EDIT_DAYS, weeks, todayCN, lockAt } from './_hours-data.js';

const DAY = 86400000;
const LOG = 'hours-remind-log/';
const compact = (d) => d.replace(/-/g, '');

export default async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const okCron = process.env.CRON_SECRET &&
    req.headers?.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const okKey = process.env.YUEKA_CODE && q.k === process.env.YUEKA_CODE;
  const okOpen = !process.env.CRON_SECRET && !q.k;
  if (!okCron && !okKey && !okOpen) return res.status(403).json({ ok: false });

  try {
    const today = todayCN();
    const todayMs = Date.parse(today + 'T00:00:00Z');

    // 今天正好是哪一周的「结束后第 N 天」？
    const jobs = [];
    for (const w of weeks()) {
      const endMs = Date.parse(w.end + 'T00:00:00Z');
      const nth = Math.round((todayMs - endMs) / DAY);
      if (REMIND_DAYS.includes(nth)) jobs.push({ week: w, nth });
    }
    if (!jobs.length)
      return res.status(200).json({ ok: true, today, sent: [], note: '今天不是催填的日子' });

    // 谁填了
    const filled = new Set();
    let cursor;
    do {
      const r = await list({ prefix: 'hours/', cursor, limit: 1000 });
      for (const b of r.blobs) {
        const [d, teacher] = b.pathname.slice(6).replace(/\.json$/, '').split('~');
        if (d && teacher) filled.add(`${d}|${teacher}`);
      }
      cursor = r.cursor;
    } while (cursor);

    const sent = [], skipped = [];
    for (const job of jobs) {
      const missing = TEACHERS.filter((t) => !filled.has(`${compact(job.week.week)}|${t.key}`));
      for (const t of missing) {
        const marker = `${LOG}${job.week.week}-d${job.nth}-${t.key}.json`;
        if (!q.force) {
          const seen = await list({ prefix: marker, limit: 1 });
          if (seen.blobs.length) { skipped.push(marker); continue; }
        }
        if (q.dry) { sent.push(`[试运行] ${job.week.label} → ${t.label}`); continue; }
        await sendRemind(t, job);
        await put(marker, JSON.stringify({ at: new Date().toISOString() }), {
          access: 'private', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0,
        });
        sent.push(`${job.week.label} → ${t.label}`);
      }
    }
    return res.status(200).json({ ok: true, today, sent, skipped });
  } catch (e) {
    console.error('[hours-remind]', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

const esc = (v) => String(v ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sendRemind(teacher, job) {
  const { RESEND_API_KEY, MAIL_FROM, YUEKA_CODE, SITE_URL } = process.env;
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY 未配置');
  if (!teacher.email) throw new Error(`${teacher.label} 没有配置邮箱`);

  const w = job.week;
  const lastDay = new Date(lockAt(w.end) + 8 * 3600000 - DAY).toISOString().slice(0, 10);
  const daysLeft = EDIT_DAYS - job.nth + 1;
  const base = SITE_URL || 'https://www.engobaby.com';
  const link = `${base}/yueka-teacher${YUEKA_CODE ? '?k=' + YUEKA_CODE : ''}`;
  const urgent = job.nth >= 6;

  const title = urgent
    ? `【最后提醒】${w.label} 的课时还没填 · ${lastDay.slice(5).replace('-', '/')} 截止`
    : `【课时提醒】${w.label} 这一周的课时该填啦`;

  const html = `
<div style="background:#F0F4F8;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(31,111,176,.10)">
    <div style="background:${urgent ? '#C0392B' : '#16456F'};color:#fff;padding:20px 24px">
      <div style="font-size:12px;letter-spacing:.14em;opacity:.85;margin-bottom:4px">
        ${urgent ? 'LAST CALL · 最后提醒' : 'REMINDER · 课时提醒'}</div>
      <div style="font-size:19px;font-weight:800">Hi ${esc(teacher.label)}，${esc(w.label)} 还没填</div>
    </div>
    <div style="padding:22px 24px">
      <p style="font-size:14px;color:#2B3A4A;line-height:1.9;margin:0 0 14px">
        <b>${esc(w.start)} – ${esc(w.end)}</b> 这一周的课时还是空的。<br>
        可以填到 <b style="color:${urgent ? '#C0392B' : '#C4820A'}">${esc(lastDay)}</b> 为止${daysLeft > 1 ? `（还剩 ${daysLeft} 天）` : '（就是今天之后最后一天了）'}，之后自动锁定。
      </p>
      <p style="font-size:13px;color:#5A6B7B;line-height:1.8;margin:0 0 20px">
        这一周没上课的话，填 <b>0</b> 就行 —— 填了系统才知道你不是忘了。<br>
        单位是小时，最小 0.25：45 分钟的课记 <b>0.75</b>。
      </p>
      <a href="${esc(link)}" style="display:inline-block;background:linear-gradient(135deg,#F4A81B,#E09400);color:#fff;text-decoration:none;border-radius:12px;padding:13px 26px;font-size:15px;font-weight:800">
        去填课时 →</a>
    </div>
    <div style="background:#F7F9FB;padding:12px 24px;font-size:12px;color:#96A5B3;text-align:center">
      英歌派 Engo Pro · 课时记录系统自动发送</div>
  </div>
</div>`;

  const from = `英歌派 Engo Pro <${(MAIL_FROM || '').match(/<([^>]+)>/)?.[1] || MAIL_FROM || 'onboarding@resend.dev'}>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [teacher.email], subject: title, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}
