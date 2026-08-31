/**
 * 成人英语主题月卡 —— 预约接口
 * ---------------------------------------------------------------
 * GET  /api/yueka?k=CODE            → 课表 + 本月全部预约
 * POST /api/yueka  {k,date,slot,name,status}  → 预约（同一天重复约会覆盖）
 * POST /api/yueka  {k,date,name,action:'cancel'} → 取消
 *
 * 环境变量：
 *   YUEKA_CODE              专属链接口令。学员拿到的链接形如
 *                           https://www.engobaby.com/yueka?k=<这个值>
 *   BLOB_READ_WRITE_TOKEN   Vercel 自动注入
 *
 * 存储设计（重要）：
 *   每一条预约 = 一个独立的 blob，全部信息编码在【路径】里：
 *     yueka/2026-09/20260914~eve~<b64 姓名>~<b64 状态>.json
 *   这样做的原因：
 *   1. 读整月只要一次 list()，不用逐个下载文件内容 —— 快
 *   2. 不同人写不同路径，同时提交不会互相覆盖 —— 没有并发丢数据的问题
 *   3. 同一个人同一天只保留一条（先删旧再写新），
 *      因为同一天两个时段内容相同，约两场没有意义还占位置
 */

import { put, list, del } from '@vercel/blob';
import { SLOTS, STATUSES, SCHEDULE, LEAD_DAYS, todayCN, bookingState } from './_yueka-data.js';

const MONTH = '2026-09';          // 当前开放预约的月份
const SEP = '~';

const b64e = (s) => Buffer.from(String(s), 'utf-8').toString('base64url');
const b64d = (s) => { try { return Buffer.from(String(s), 'base64url').toString('utf-8'); } catch { return ''; } };
const compact = (d) => d.replace(/-/g, '');            // 2026-09-14 → 20260914
const expand  = (d) => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;

export default async function handler(req, res) {
  const code = process.env.YUEKA_CODE;
  const given = req.method === 'GET'
    ? (req.query?.k || new URL(req.url, 'http://x').searchParams.get('k'))
    : (typeof req.body === 'string' ? safeParse(req.body)?.k : req.body?.k);

  if (!code) return res.status(500).json({ ok: false, error: '服务端未配置 YUEKA_CODE' });
  if (given !== code) return res.status(403).json({ ok: false, error: 'bad-code' });

  try {
    if (req.method === 'GET')  return res.status(200).json(await readAll());
    if (req.method === 'POST') return await handlePost(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('[yueka]', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ---------- 读取整月 ----------
async function readAll() {
  const cfg = SCHEDULE[MONTH];
  const bookings = await listBookings();

  // 每天带上「现在还能不能约」，前端不用自己算日期
  const days = cfg.days.map((d) => ({
    ...d,
    state: d.break ? { open: false, reason: 'break', text: '休课' } : bookingState(d.date, MONTH),
  }));

  return {
    ok: true,
    month: MONTH,
    label: cfg.label,
    note: cfg.note,
    today: todayCN(),
    leadDays: LEAD_DAYS,
    slots: SLOTS,
    statuses: STATUSES,
    pending: cfg.pending,
    days,
    bookings,
  };
}

async function listBookings() {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: `yueka/${MONTH}/`, cursor, limit: 1000 });
    for (const b of r.blobs) {
      const file = b.pathname.split('/').pop().replace(/\.json$/, '');
      const [d, slot, n, st] = file.split(SEP);
      if (!d || !slot) continue;
      out.push({
        date: expand(d),
        slot,
        name: b64d(n),
        status: b64d(st || ''),
        at: b.uploadedAt,
        _path: b.pathname,
      });
    }
    cursor = r.cursor;
  } while (cursor);

  // 同一人同一天若因极端并发留下多条，保留最新的那条
  const best = new Map();
  for (const b of out) {
    const k = b.date + '|' + b.name;
    const prev = best.get(k);
    if (!prev || new Date(b.at) > new Date(prev.at)) best.set(k, b);
  }
  return [...best.values()].sort((a, b) =>
    a.date === b.date ? a.at.localeCompare(b.at) : a.date.localeCompare(b.date));
}

// ---------- 预约 / 取消 ----------
async function handlePost(req, res) {
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  if (!body) return res.status(400).json({ ok: false, error: '请求格式错误' });

  const name = String(body.name || '').trim().slice(0, 24);
  const date = String(body.date || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: '请填写你的名字' });

  const day = SCHEDULE[MONTH].days.find((d) => d.date === date);
  if (!day || day.break) return res.status(400).json({ ok: false, error: '这一天没有课' });

  // 无论预约还是取消，都先清掉这个人这天的旧记录
  const removed = await removeBooking(date, name);

  if (body.action === 'cancel') {
    return res.status(200).json({ ok: true, cancelled: removed });
  }

  const state = bookingState(date, MONTH);
  if (!state.open) return res.status(400).json({ ok: false, error: state.text });

  const slot = String(body.slot || '').trim();
  if (!day.slots.includes(slot)) return res.status(400).json({ ok: false, error: '这个时段当天不开课' });

  const status = String(body.status || '').trim().slice(0, 16);

  const path = `yueka/${MONTH}/${compact(date)}${SEP}${slot}${SEP}${b64e(name)}${SEP}${b64e(status)}.json`;
  await put(path, JSON.stringify({ name, date, slot, status, at: new Date().toISOString() }), {
    access: 'private',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });

  return res.status(200).json({ ok: true, booked: { date, slot, name, status } });
}

/** 删掉某人某天的全部记录（换时段、取消都用它） */
async function removeBooking(date, name) {
  const prefix = `yueka/${MONTH}/${compact(date)}${SEP}`;
  const tag = SEP + b64e(name) + SEP;
  const r = await list({ prefix, limit: 1000 });
  const hits = r.blobs.filter((b) => b.pathname.includes(tag));
  if (hits.length) await del(hits.map((b) => b.url));
  return hits.length;
}
