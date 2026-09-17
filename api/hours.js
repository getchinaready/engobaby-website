/**
 * 课时记录 —— 接口
 * ---------------------------------------------------------------
 *   GET  /api/hours?k=CODE[&admin=TOKEN]      → 周列表 + 全部记录（带 admin 则解锁全部）
 *   POST {k, teacher, week, hours}            → 保存（不确认）
 *   POST {k, teacher, week, hours, confirm:1} → 保存并确认（确认只是定稿标记）
 *   以上 POST 带 {admin:'<HOURS_ADMIN>'} 可以改已锁定的周 —— 给 Devin 留的后门。
 *
 * 【锁定规则，服务端强制】
 *   每一周在「周日结束后再过 7 天」的那天 24:00 锁死，三个人同一个期限。
 *   例：9/14–9/20 这一周，改到 9/27 当天为止。「确认」只是定稿标记，不影响期限。
 *
 * 【存储】Vercel Blob（私有），信息全部编码在路径里，一次 list() 读完整个学期：
 *   hours/<yyyymmdd>~<teacher>~<hours>~<confirmedMs>.json
 *   同一人同一周只会有一条：写之前先删掉旧的。
 */

import { put, list, del } from '@vercel/blob';
import { TEACHERS, TERM_START, TERM_END, EDIT_DAYS,
         todayCN, weeks, editState, weekStarted } from './_hours-data.js';

const PREFIX = 'hours/';
const SEP = '~';
const compact = (d) => d.replace(/-/g, '');
const expand  = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

export default async function handler(req, res) {
  const codeEnv = process.env.YUEKA_CODE;
  if (!codeEnv) return res.status(500).json({ ok: false, error: '服务端未配置 YUEKA_CODE' });

  const isGet = req.method === 'GET';
  const q = isGet ? (req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams)) : null;
  const body = isGet ? null : (typeof req.body === 'string' ? safeParse(req.body) : req.body);

  if ((isGet ? q?.k : body?.k) !== codeEnv) return res.status(403).json({ ok: false, error: 'bad-code' });

  try {
    const adminEnv = process.env.HOURS_ADMIN;
    const isAdmin = !!adminEnv && (isGet ? q?.admin : body?.admin) === adminEnv;
    if (isGet) return res.status(200).json(await readAll(isAdmin));
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed' }); }
    return await save(body, res, isAdmin);
  } catch (e) {
    console.error('[hours]', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

/** 读全部记录：一次 list()，内容都在路径里 */
async function readRecords() {
  const out = {};
  let cursor;
  do {
    const r = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const b of r.blobs) {
      const file = b.pathname.slice(PREFIX.length).replace(/\.json$/, '');
      const [d, teacher, hours, conf] = file.split(SEP);
      if (!d || !teacher) continue;
      out[`${expand(d)}|${teacher}`] = {
        week: expand(d), teacher,
        hours: Number(hours) || 0,
        confirmedAt: Number(conf) || 0,
        at: new Date(b.uploadedAt).toISOString(),
      };
    }
    cursor = r.cursor;
  } while (cursor);
  return out;
}

async function readAll(isAdmin) {
  const recs = await readRecords();
  const today = todayCN();
  const now = Date.now();
  const ws = weeks().map((w) => {
    const st = editState(w.end, now);          // 锁定只跟这一周的日期有关
    if (isAdmin) st.locked = false;            // 后门：管理员看到的所有周都可改
    const cells = {};
    let total = 0;
    for (const t of TEACHERS) {
      const r = recs[`${w.week}|${t.key}`];
      cells[t.key] = {
        hours: r ? r.hours : null,
        confirmed: !!(r && r.confirmedAt),
        confirmedAt: r?.confirmedAt || 0,
      };
      if (r) total += r.hours;
    }
    const allConfirmed = TEACHERS.every((t) => cells[t.key].confirmed);
    return { ...w, cells, total: Math.round(total * 100) / 100,
             started: weekStarted(w.week, today), allConfirmed,
             locked: st.locked, daysLeft: st.daysLeft, lockDate: st.lockDate,
             current: w.week <= today && today <= w.end };
  });

  const totals = {};
  let grand = 0;
  for (const t of TEACHERS) {
    const sum = ws.reduce((a, w) => a + (w.cells[t.key].hours || 0), 0);
    totals[t.key] = Math.round(sum * 100) / 100;
    grand += sum;
  }

  return { ok: true, today, teachers: TEACHERS.map(({ email, ...t }) => t), editDays: EDIT_DAYS,
           termStart: TERM_START, termEnd: TERM_END, admin: !!isAdmin,
           weeks: ws, totals, grandTotal: Math.round(grand * 100) / 100 };
}

async function save(body, res, isAdmin) {
  const teacher = String(body.teacher || '').trim().toLowerCase();
  if (!TEACHERS.some((t) => t.key === teacher))
    return res.status(400).json({ ok: false, error: '请先在右上角选择你是谁' });

  const week = String(body.week || '').trim();
  const all = weeks();
  const w = all.find((x) => x.week === week);
  if (!w) return res.status(400).json({ ok: false, error: '这一周不在本学期范围内' });

  const today = todayCN();
  if (!isAdmin && !weekStarted(week, today))
    return res.status(400).json({ ok: false, error: '这一周还没开始，等开课了再填' });

  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours < 0 || hours > 200)
    return res.status(400).json({ ok: false, error: '课时请填 0–200 之间的小时数' });
  // 最小单位 0.25 小时（15 分钟）：45 分钟的课 = 0.75
  if (Math.abs(hours * 4 - Math.round(hours * 4)) > 1e-9)
    return res.status(400).json({ ok: false,
      error: '课时请按 0.25 小时（15 分钟）为单位，比如 0.75 = 45 分钟、1.5 = 90 分钟' });

  // 过了这一周的可改期限 → 拒绝（管理员后门除外）
  const st = editState(w.end, Date.now());
  if (st.locked && !isAdmin)
    return res.status(403).json({ ok: false,
      error: `这一周可以修改到 ${w.end.slice(5).replace('-', '/')} 之后的 ${EDIT_DAYS} 天为止，现在已经锁定了。` });

  const prefix = `${PREFIX}${compact(week)}${SEP}${teacher}${SEP}`;
  const old = await list({ prefix, limit: 100 });
  let confirmedAt = 0;
  if (old.blobs.length) {
    const file = old.blobs[0].pathname.slice(PREFIX.length).replace(/\.json$/, '');
    confirmedAt = Number(file.split(SEP)[3]) || 0;
  }
  // 确认只是定稿标记，第一次点了就记下来
  if (body.confirm && !confirmedAt) confirmedAt = Date.now();

  if (old.blobs.length) await del(old.blobs.map((b) => b.url));

  const clean = Math.round(hours * 4) / 4;   // 落到 0.25 的格子上
  await put(`${prefix}${clean}${SEP}${confirmedAt}.json`,
    JSON.stringify({ teacher, week, hours: clean, confirmedAt, at: new Date().toISOString() }), {
      access: 'private', contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0,
    });

  return res.status(200).json({ ok: true, admin: !!isAdmin,
    saved: { week, teacher, hours: clean, confirmed: !!confirmedAt, ...editState(w.end, Date.now()) } });
}
