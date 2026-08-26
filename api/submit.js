/**
 * 英歌宝 / 英歌派 — 试听预约接收端
 * -----------------------------------------------------------
 * 收到一条预约后做三件事：
 *   1. 追加到云端 CSV（Vercel Blob），历史记录永久累积
 *   2. 发邮件通知老师，正文=本次预约详情，附件=截至此刻的全量 CSV
 *   3. 任何一步失败都不吞掉数据 —— 邮件里会带上原始 JSON 兜底
 *
 * 邮件有两条通道，按这个顺序自动选：
 *   ① RESEND_API_KEY 存在  → 走 Resend API（推荐，零依赖，纯 fetch）
 *   ② 否则看 SMTP_* 变量   → 走 SMTP（备用，比如以后想换 163）
 * 两个都没配就报错，不会静默丢数据。
 *
 * 环境变量（Vercel → Settings → Environment Variables）：
 *
 *   【Resend 通道】
 *   RESEND_API_KEY   Resend 后台生成的 API Key（以 re_ 开头）
 *   MAIL_FROM        发件人，必须是已在 Resend 验证过的域名下的地址
 *                    例：英歌宝预约 <noreply@engobaby.com>
 *   MAIL_TO          收件人，多个用英文逗号隔开
 *
 *   【SMTP 备用通道，可以不配】
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
 *
 *   【存储，自动注入不用管】
 *   BLOB_READ_WRITE_TOKEN   建好 Blob store 后 Vercel 自动写入
 *
 * 存储用的是 Vercel Blob 的【私有】store —— CSV 里有家长手机号，
 * 私有 store 的文件必须带 token 才能读，公网拿到 URL 也打不开。
 */

import { put, get } from '@vercel/blob';

// ---------- 表单字段定义（顺序即 CSV 列顺序） ----------
const FIELDS = {
  baby: [
    ['submittedAt',   '提交时间'],
    ['childName',     '宝贝小名'],
    ['hasEnName',     '有无英文名'],
    ['enName',        '英文名'],
    ['gender',        '性别'],
    ['birth',         '出生年月'],
    ['relation',      '家长称呼'],
    ['relationOther', '其他称呼'],
    ['wechat',        '微信号'],
    ['phone',         '手机号'],
    ['experience',    '英语启蒙经历'],
    ['expDetail',     '英语接触详情'],
    ['character',     '性格特点'],
    ['interest',      '兴趣爱好'],
    ['prefDate',      '期望试听日期'],
  ],
  pro: [
    ['submittedAt', '提交时间'],
    ['studentName', '称呼'],
    ['wechat',      '微信号'],
    ['phone',       '手机号'],
    ['level',       '英语水平'],
    ['goal',        '学习目标'],
    ['goalOther',   '其他目标'],
    ['dayPref',     '方便的日子'],
    ['timePref',    '方便的时段'],
    ['prefDate',    '期望试听日期'],
  ],
};


const BRAND = {
  baby: { name: '英歌宝 Engo Baby', color: '#3090D8', file: 'bookings-baby.csv', who: '宝贝' },
  pro:  { name: '英歌派 Engo Pro',  color: '#16456F', file: 'bookings-pro.csv',  who: '学员' },
};

// ---------- 工具 ----------
const csvCell = (v) => {
  const s = String(v ?? '').replace(/\r?\n/g, ' ');
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const esc = (v) => String(v ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const nowCN = () =>
  new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

// ---------- 主处理 ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const data = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  if (!data) return res.status(400).json({ ok: false, error: 'Bad payload' });

  // 蜜罐：机器人会填这个隐藏字段。假装成功，不打扰对方，也不进数据。
  if (data._hp) return res.status(200).json({ ok: true });

  const type = data.formType === 'pro' ? 'pro' : 'baby';
  const spec = FIELDS[type];
  const brand = BRAND[type];

  // 最低限度校验（前端已校验过，这里防绕过）
  const nameKey = type === 'pro' ? 'studentName' : 'childName';
  const name = String(data[nameKey] || '').trim().slice(0, 40);
  const wechat = String(data.wechat || '').trim().slice(0, 60);
  const phone = String(data.phone || '').trim().replace(/[\s-]/g, '');
  // 微信号必填（老师主要靠微信联系）；手机号选填，但填了就要格式正确
  if (!name) return res.status(400).json({ ok: false, error: '请填写称呼' });
  if (!wechat) return res.status(400).json({ ok: false, error: '请填写微信号' });
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ ok: false, error: '手机号格式不正确' });
  }

  const row = { submittedAt: nowCN() };
  for (const [key] of spec) {
    if (key === 'submittedAt') continue;
    row[key] = String(data[key] ?? '').trim().slice(0, 600);
  }
  row.wechat = wechat;
  row.phone = phone;

  // ---- 1. 追加到云端 CSV ----
  let csvText = null;
  let total = null;
  let storeErr = null;
  try {
    // 先落单条备份（最重要，绝不能丢），再更新汇总 CSV
    await backupOne(type, row);
    const r = await appendToCsv(brand.file, spec, row);
    csvText = r.csv;
    total = r.total;
  } catch (e) {
    storeErr = e.message || String(e);
    console.error('[blob] 存档失败:', storeErr);
  }

  // ---- 2. 发邮件 ----
  try {
    await sendMail({ brand, spec, row, csvText, total, storeErr, raw: data });
  } catch (e) {
    console.error('[mail] 发信失败:', e.message);
    // 存档成功但邮件失败 → 数据没丢，仍然告诉用户成功
    if (csvText) return res.status(200).json({ ok: true, warn: 'mail-failed' });
    // 两个都失败 → 必须让用户知道，好让他们改加微信
    return res.status(500).json({ ok: false, error: '提交未能送达，请加微信 engo2026' });
  }

  return res.status(200).json({ ok: true });
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ---------- Blob: 读旧 CSV → append → 写回 ----------
// ⚠️ 并发说明：两人在同一秒提交，可能同时读到旧 CSV 再各自写回，后者覆盖前者。
// 以你们的量级（每天几条）几乎不会发生，但为了绝对不丢数据，
// 每条记录额外单独存一份 JSON —— 即使汇总 CSV 掉了一行，原始记录也永远还在。
async function backupOne(type, row) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await put(`submissions/${type}-${stamp}-${row.phone}.json`,
    JSON.stringify(row, null, 2), {
      access: 'private',
      contentType: 'application/json; charset=utf-8',
      addRandomSuffix: true,
    });
}

async function appendToCsv(filename, spec, row) {
  const header = spec.map(([, label]) => label).join(',');
  let body = '';

  // 私有 blob 不能直接 fetch URL，必须用 get() 带上 token。
  // useCache:false —— 刚写完马上要读，必须拿最新版本，不能吃 CDN 缓存。
  const prev = await get(filename, { access: 'private', useCache: false });
  if (prev && prev.statusCode === 200 && prev.stream) {
    const txt = await new Response(prev.stream).text();
    // 去掉 BOM 和表头，只留数据行
    const lines = txt.replace(/^﻿/, '').split('\n');
    body = lines.slice(1).filter((l) => l.trim()).join('\n');
  }

  const newLine = spec.map(([key]) => csvCell(row[key])).join(',');
  body = body ? body + '\n' + newLine : newLine;

  // ﻿ = BOM，Excel 打开中文才不乱码
  const csv = '﻿' + header + '\n' + body + '\n';

  await put(filename, csv, {
    access: 'private',
    contentType: 'text/csv; charset=utf-8',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });

  return { csv, total: body.split('\n').filter((l) => l.trim()).length };
}

// ---------- 邮件 ----------
async function sendMail({ brand, spec, row, csvText, total, storeErr, raw }) {
  const { RESEND_API_KEY, MAIL_TO, MAIL_FROM, SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;

  const to = (MAIL_TO || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!to.length) throw new Error('MAIL_TO 未配置');

  const subject = `【${brand.name}】新预约：${row[spec[1][0]]}　微信 ${row.wechat}`;
  const html = renderEmail({ brand, spec, row, total, storeErr, raw });
  const attachment = csvText
    ? { filename: brand.file, content: Buffer.from(csvText, 'utf-8') }
    : null;

  if (RESEND_API_KEY) {
    return sendViaResend({ RESEND_API_KEY, MAIL_FROM, to, subject, html, attachment });
  }
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    return sendViaSmtp({ to, subject, html, attachment, brand });
  }
  throw new Error('没有可用的发信通道：RESEND_API_KEY 和 SMTP_* 都没配');
}

// --- 通道 ①：Resend REST API（纯 fetch，不需要任何依赖） ---
async function sendViaResend({ RESEND_API_KEY, MAIL_FROM, to, subject, html, attachment }) {
  const body = {
    from: MAIL_FROM || 'onboarding@resend.dev',
    to,
    subject,
    html,
  };
  if (attachment) {
    body.attachments = [{
      filename: attachment.filename,
      content: attachment.content.toString('base64'),
    }];
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Resend ${r.status}: ${txt.slice(0, 300)}`);
  }
}

// --- 通道 ②：SMTP 备用（用到才加载 nodemailer） ---
async function sendViaSmtp({ to, subject, html, attachment, brand }) {
  const { default: nodemailer } = await import('nodemailer');
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  const port = Number(SMTP_PORT || 465);

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: MAIL_FROM || `"${brand.name} 预约通知" <${SMTP_USER}>`,
    to: to.join(', '),
    replyTo: SMTP_USER,
    subject,
    html,
    attachments: attachment
      ? [{ filename: attachment.filename, content: attachment.content, contentType: 'text/csv; charset=utf-8' }]
      : [],
  });
}

// ---------- 邮件正文 ----------
function renderEmail({ brand, spec, row, total, storeErr, raw }) {
  const rows = spec
    .filter(([key]) => String(row[key] || '').trim() !== '')
    .map(([key, label]) => `
      <tr>
        <td style="padding:9px 14px;background:#F7F9FB;border-bottom:1px solid #EDF1F5;
                   font-size:13px;color:#7A8B9A;white-space:nowrap;vertical-align:top">${esc(label)}</td>
        <td style="padding:9px 14px;border-bottom:1px solid #EDF1F5;font-size:14px;
                   color:#2B3A4A;line-height:1.6">${esc(row[key])}</td>
      </tr>`).join('');

  const warn = storeErr ? `
    <div style="background:#FDF3E3;border-left:3px solid #F4A81B;padding:12px 16px;
                margin:0 0 18px;font-size:13px;color:#8A6420;line-height:1.6">
      ⚠️ 本条已成功送达邮件，但<b>云端存档写入失败</b>（${esc(storeErr)}），
      所以这封邮件<b>没有附件</b>。数据没丢——下方原始记录里有完整内容，请手工补录。
    </div>` : '';

  const rawBlock = storeErr ? `
    <div style="margin-top:20px;padding:14px;background:#F7F9FB;border-radius:8px">
      <div style="font-size:12px;color:#7A8B9A;margin-bottom:6px">原始记录（兜底用）</div>
      <pre style="margin:0;font-size:12px;color:#2B3A4A;white-space:pre-wrap;word-break:break-all">${esc(JSON.stringify(raw, null, 2))}</pre>
    </div>` : '';

  const countLine = total
    ? `这是第 <b>${total}</b> 条预约记录。附件 <b>${brand.file}</b> 是<b>截至此刻的全部记录</b>，Excel 可直接打开。`
    : '';

  return `
<div style="background:#F0F4F8;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;
              box-shadow:0 4px 18px rgba(31,111,176,.10)">
    <div style="background:${brand.color};color:#fff;padding:22px 24px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.82;margin-bottom:5px">
        NEW TRIAL BOOKING
      </div>
      <div style="font-size:20px;font-weight:700">🎉 ${esc(brand.name)} 收到一条新预约</div>
    </div>

    <div style="padding:24px">
      ${warn}
      <div style="font-size:15px;color:#2B3A4A;margin-bottom:18px;line-height:1.7">
        <b style="font-size:17px">${esc(row[spec[1][0]])}</b>
        　·　微信 <b>${esc(row.wechat)}</b>
        ${row.phone ? `　·　<a href="tel:${esc(row.phone)}" style="color:${brand.color};text-decoration:none">${esc(row.phone)}</a>` : ''}
      </div>

      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;
             border:1px solid #EDF1F5;border-radius:8px;overflow:hidden">${rows}</table>

      <p style="font-size:13px;color:#7A8B9A;margin:18px 0 0;line-height:1.7">
        ${countLine}
      </p>
      ${rawBlock}
    </div>

    <div style="background:#F7F9FB;padding:14px 24px;font-size:12px;color:#96A5B3;text-align:center">
      本邮件由 www.engobaby.com 预约表单自动发送　·　请尽快联系家长确认时间
    </div>
  </div>
</div>`;
}
