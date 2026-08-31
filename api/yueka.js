/**
 * 成人英语主题月卡 —— 预约接口
 * ---------------------------------------------------------------
 * GET  /api/yueka?k=CODE&u=UID           → 课表 + 本月全部预约
 * POST /api/yueka {k,u,name,date,slot,status}          → 预约 / 改状态
 * POST /api/yueka {k,u,date,slot,action:'cancel'}      → 取消
 *
 * 【身份怎么认】
 * 没有账号系统。首次打开页面时前端生成一个随机 uid 存在 localStorage，
 * 每条预约都绑定这个 uid。取消时服务端只删 uid 对得上的那条 ——
 * 所以别人的预约你看得见，但改不了、删不了。
 * GET 不会把别人的 uid 吐给前端（只返回 mine: true/false），
 * 否则拿到 uid 就能删别人的预约。
 *
 * 【一天可以约两场】
 * 同一天早/午/晚是不同的记录，想两场都来是允许的（内容相同，前端会提示）。
 * 唯一键 = uid + 日期 + 时段。
 *
 * 环境变量：
 *   YUEKA_CODE              专属链接口令
 *   BLOB_READ_WRITE_TOKEN   Vercel 自动注入
 *
 * 【存储】
 * 每条预约 = 一个独立 blob，信息编码在路径里：
 *   yueka/2026-09/20260914~eve~<uid>~<b64姓名>~<b64状态>.json
 * 读整月一次 list() 就够（不用逐个下载内容）；
 * 不同人写不同路径，同时提交不会互相覆盖。
 */

import { put, list, del } from '@vercel/blob';
import { SLOTS, STATUSES, SCHEDULE, LEAD_DAYS, todayCN, bookingState } from './_yueka-data.js';

const MONTH = '2026-09';
const SEP = '~';

const b64e = (s) => Buffer.from(String(s), 'utf-8').toString('base64url');
const b64d = (s) => { try { return Buffer.from(String(s), 'base64url').toString('utf-8'); } catch { return ''; } };
const compact = (d) => d.replace(/-/g, '');
const expand  = (d) => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
const cleanUid = (u) => String(u || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);

export default async function handler(req, res) {
  const code = process.env.YUEKA_CODE;
  if (!code) return res.status(500).json({ ok: false, error: '服务端未配置 YUEKA_CODE' });

  const isGet = req.method === 'GET';
  const q = isGet ? (req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams)) : null;
  const body = isGet ? null : (typeof req.body === 'string' ? safeParse(req.body) : req.body);

  const given = isGet ? q?.k : body?.k;
  if (given !== code) return res.status(403).json({ ok: false, error: 'bad-code' });

  try {
    if (isGet) return res.status(200).json(await readAll(cleanUid(q?.u)));
    if (req.method === 'POST') return await handlePost(body, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('[yueka]', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ---------- 读整月 ----------
async function readAll(myUid) {
  const cfg = SCHEDULE[MONTH];
  const raw = await listBookings();

  // 只告诉前端「这条是不是你的」，绝不外泄别人的 uid
  const bookings = raw.map(({ uid, _path, ...rest }) => ({ ...rest, mine: !!myUid && uid === myUid }));

  const days = cfg.days.map((d) => ({
    ...d,
    state: d.break ? { open: false, reason: 'break', text: '休课' } : bookingState(d.date, MONTH),
  }));

  return {
    ok: true, month: MONTH, label: cfg.label, note: cfg.note,
    today: todayCN(), leadDays: LEAD_DAYS,
    slots: SLOTS, statuses: STATUSES, pending: cfg.pending,
    days, bookings,
  };
}

async function listBookings() {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: `yueka/${MONTH}/`, cursor, limit: 1000 });
    for (const b of r.blobs) {
      const file = b.pathname.split('/').pop().replace(/\.json$/, '');
      const [d, slot, uid, n, st] = file.split(SEP);
      if (!d || !slot || !uid) continue;
      out.push({
        date: expand(d), slot, uid,
        name: b64d(n), status: b64d(st || ''),
        at: b.uploadedAt, _path: b.pathname,
      });
    }
    cursor = r.cursor;
  } while (cursor);

  return out.sort((a, b) =>
    a.date === b.date ? a.at.localeCompare(b.at) : a.date.localeCompare(b.date));
}

// ---------- 预约 / 取消 ----------
async function handlePost(body, res) {
  if (!body) return res.status(400).json({ ok: false, error: '请求格式错误' });

  const uid = cleanUid(body.u);
  if (!uid) return res.status(400).json({ ok: false, error: '身份标识缺失，请刷新页面重试' });

  const date = String(body.date || '').trim();
  const slot = String(body.slot || '').trim();

  const day = SCHEDULE[MONTH].days.find((d) => d.date === date);
  if (!day || day.break) return res.status(400).json({ ok: false, error: '这一天没有课' });
  if (!day.slots.includes(slot)) return res.status(400).json({ ok: false, error: '这个时段当天不开课' });

  const prefix = `yueka/${MONTH}/${compact(date)}${SEP}${slot}${SEP}${uid}${SEP}`;

  // 取消：只删 uid 对得上的记录 —— 删不了别人的
  if (body.action === 'cancel') {
    const r = await list({ prefix, limit: 100 });
    if (r.blobs.length) await del(r.blobs.map((b) => b.url));
    return res.status(200).json({ ok: true, cancelled: r.blobs.length });
  }

  const name = String(body.name || '').trim().slice(0, 24);
  if (!name) return res.status(400).json({ ok: false, error: '请填写你的名字' });

  const state = bookingState(date, MONTH);
  if (!state.open) return res.status(400).json({ ok: false, error: state.text });

  const status = String(body.status || '').trim().slice(0, 16);

  // 同一 uid+日期+时段 先清旧（改名/改状态时不留重复）
  const old = await list({ prefix, limit: 100 });
  if (old.blobs.length) await del(old.blobs.map((b) => b.url));

  const path = `${prefix}${b64e(name)}${SEP}${b64e(status)}.json`;
  await put(path, JSON.stringify({ name, date, slot, status, at: new Date().toISOString() }), {
    access: 'private',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });

  return res.status(200).json({ ok: true, booked: { date, slot, name, status } });
}
