/**
 * 成人英语主题月卡 —— 预约接口
 * ---------------------------------------------------------------
 * 【身份 = 会员代号】
 * 第一次来：输入英文名 → 系统发代号 engo-lily（重名则 engo-lily2/3…）。
 * 之后：手机自动记住；换设备输代号即可回到自己的界面。
 * 大小写、空格、连字符都不敏感：ENGO-LILY / engolily / Lily 都认。
 * 代号可被猜到（熟人社区，机构已确认接受）；误操作可由教师后台恢复。
 *
 * 接口：
 *   GET  /api/yueka?k=CODE&me=engo-lily        → 课表 + 全部预约（带 mine 标记）
 *   POST {k, action:'enter', name:'Lily'}      → 智能入口：
 *         · 输入匹配已有代号 → 直接登录 {code,name}
 *         · 输入匹配已有名字 → 返回 {candidates,suggest} 让前端确认「是不是你」
 *           （再带 confirmNew:true 调一次 → 用 suggest 建新代号）
 *         · 全新名字 → 创建代号
 *   POST {k, code, name, date, slot, status}   → 预约 / 更新
 *   POST {k, code, date, slot, action:'cancel'}→ 取消（只能删自己代号下的）
 *
 * 【存储】全部在 Vercel Blob（私有）：
 *   会员：yueka-members/<code>~<b64姓名>.json      —— 一次 list() 读全体
 *   预约：yueka/2026-09/<yyyymmdd>~<slot>~<code>~<b64姓名>~<b64状态>.json
 *   信息编码在路径里：读整月一次 list()；不同人不同路径，无并发覆盖。
 */

import { put, list, del } from '@vercel/blob';
import { SLOTS, STATUSES, SCHEDULE, LEAD_DAYS, todayCN, bookingState } from './_yueka-data.js';

const MONTH = '2026-09';
const SEP = '~';

const b64e = (s) => Buffer.from(String(s), 'utf-8').toString('base64url');
const b64d = (s) => { try { return Buffer.from(String(s), 'base64url').toString('utf-8'); } catch { return ''; } };
const compact = (d) => d.replace(/-/g, '');
const expand  = (d) => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;

/** 归一化：小写 + 只留字母数字。用于所有比较，所以大小写/空格/连字符都无所谓 */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default async function handler(req, res) {
  const codeEnv = process.env.YUEKA_CODE;
  if (!codeEnv) return res.status(500).json({ ok: false, error: '服务端未配置 YUEKA_CODE' });

  const isGet = req.method === 'GET';
  const q = isGet ? (req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams)) : null;
  const body = isGet ? null : (typeof req.body === 'string' ? safeParse(req.body) : req.body);

  if ((isGet ? q?.k : body?.k) !== codeEnv) return res.status(403).json({ ok: false, error: 'bad-code' });

  try {
    if (isGet) return res.status(200).json(await readAll(norm(q?.me)));
    if (req.method !== 'POST') { res.setHeader('Allow','GET, POST');
      return res.status(405).json({ ok:false, error:'Method not allowed' }); }
    if (body?.action === 'enter') return await enter(body, res);
    return await bookOrCancel(body, res);
  } catch (e) {
    console.error('[yueka]', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ---------- 会员 ----------
async function listMembers() {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: 'yueka-members/', cursor, limit: 1000 });
    for (const b of r.blobs) {
      const file = b.pathname.split('/').pop().replace(/\.json$/, '');
      const [code, n] = file.split(SEP);
      if (code) out.push({ code, name: b64d(n) });
    }
    cursor = r.cursor;
  } while (cursor);
  return out;
}

async function enter(body, res) {
  const raw = String(body.name || '').trim().slice(0, 30);
  if (!raw) return res.status(400).json({ ok: false, error: '请输入英文名或代号' });

  const members = await listMembers();
  const input = norm(raw);
  const letters = raw.toLowerCase().replace(/[^a-z]/g, '');

  // ① 明确输入代号（engo 开头）→ 只按代号找
  if (input.startsWith('engo')) {
    const hit = members.find((m) => norm(m.code) === input);
    if (hit) return res.status(200).json({ ok: true, mode: 'login', code: hit.code, name: hit.name });
    return res.status(404).json({ ok: false, error: 'not-found',
      message: '没找到这个代号，检查一下拼写？或者直接输英文名重新注册。' });
  }

  // ② 带数字的简写（如 lily2）→ 唯一对应 engo-lily2，直接登录
  if (/\d/.test(input)) {
    const hit = members.find((m) => norm(m.code) === 'engo' + input);
    if (hit) return res.status(200).json({ ok: true, mode: 'login', code: hit.code, name: hit.name });
  }

  // ③ 当作名字：必须是英文名（至少 2 个字母）
  if (letters.length < 2) {
    return res.status(400).json({ ok: false, error: 'need-english',
      message: '请用英文名注册（例：Lily / Kevin），中文名不方便生成代号～' });
  }

  // 同名的既有会员（engo-lily / engo-lily2 …）
  let max = 0;
  const same = [];
  for (const m of members) {
    const mm = norm(m.code).match(/^engo([a-z]+?)(\d*)$/);
    if (mm && mm[1] === letters) {
      same.push(m);
      max = Math.max(max, mm[2] ? parseInt(mm[2], 10) : 1);
    }
  }
  const nextCode = max === 0 ? `engo-${letters}` : `engo-${letters}${max + 1}`;

  // ④ 重名且没确认 → 让前端问「是不是你本人」。
  //    不能直接登进去：否则第二个 Lily 输名字会进第一个 Lily 的账号。
  if (same.length && !body.confirmNew) {
    return res.status(200).json({ ok: true, mode: 'conflict',
      candidates: same.map((m) => ({ code: m.code, name: m.name })),
      suggest: nextCode });
  }

  // ⑤ 创建
  await put(`yueka-members/${nextCode}${SEP}${b64e(raw)}.json`,
    JSON.stringify({ code: nextCode, name: raw, at: new Date().toISOString() }), {
      access: 'private', contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0,
    });
  return res.status(200).json({ ok: true, mode: 'created', code: nextCode, name: raw });
}

// ---------- 课表 + 预约 ----------
async function readAll(meNorm) {
  const cfg = SCHEDULE[MONTH];
  const raw = await listBookings();
  const bookings = raw.map(({ code, _path, ...rest }) =>
    ({ ...rest, mine: !!meNorm && norm(code) === meNorm }));

  const days = cfg.days.map((d) => ({
    ...d,
    state: d.break ? { open: false, reason: 'break', text: '休课' } : bookingState(d.date, MONTH),
  }));

  return { ok: true, month: MONTH, label: cfg.label, note: cfg.note,
    today: todayCN(), leadDays: LEAD_DAYS,
    slots: SLOTS, statuses: STATUSES, pending: cfg.pending, days, bookings };
}

export async function listBookings() {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: `yueka/${MONTH}/`, cursor, limit: 1000 });
    for (const b of r.blobs) {
      const file = b.pathname.split('/').pop().replace(/\.json$/, '');
      const [d, slot, code, n, st] = file.split(SEP);
      if (!d || !slot || !code) continue;
      out.push({ date: expand(d), slot, code, name: b64d(n), status: b64d(st || ''),
                 at: b.uploadedAt, _path: b.pathname });
    }
    cursor = r.cursor;
  } while (cursor);
  return out.sort((a, b) =>
    a.date === b.date ? a.at.localeCompare(b.at) : a.date.localeCompare(b.date));
}

async function bookOrCancel(body, res) {
  const code = String(body.code || '').trim().toLowerCase().slice(0, 40);
  if (!norm(code)) return res.status(400).json({ ok: false, error: '请先登录（输入名字或代号）' });

  const date = String(body.date || '').trim();
  const slot = String(body.slot || '').trim();
  const day = SCHEDULE[MONTH].days.find((d) => d.date === date);
  if (!day || day.break) return res.status(400).json({ ok: false, error: '这一天没有课' });
  if (!day.slots.includes(slot)) return res.status(400).json({ ok: false, error: '这个时段当天不开课' });

  const prefix = `yueka/${MONTH}/${compact(date)}${SEP}${slot}${SEP}${code}${SEP}`;

  if (body.action === 'cancel') {
    const r = await list({ prefix, limit: 100 });
    if (r.blobs.length) await del(r.blobs.map((b) => b.url));
    return res.status(200).json({ ok: true, cancelled: r.blobs.length });
  }

  const name = String(body.name || '').trim().slice(0, 30);
  if (!name) return res.status(400).json({ ok: false, error: '缺少名字，请重新登录' });

  const state = bookingState(date, MONTH);
  if (!state.open) return res.status(400).json({ ok: false, error: state.text });

  const status = String(body.status || '').trim().slice(0, 16);

  const old = await list({ prefix, limit: 100 });
  if (old.blobs.length) await del(old.blobs.map((b) => b.url));

  await put(`${prefix}${b64e(name)}${SEP}${b64e(status)}.json`,
    JSON.stringify({ code, name, date, slot, status, at: new Date().toISOString() }), {
      access: 'private', contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0,
    });
  return res.status(200).json({ ok: true, booked: { date, slot, name, status } });
}
