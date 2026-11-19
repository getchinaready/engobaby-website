/**
 * 课时记录 —— 接口
 * ---------------------------------------------------------------
 *   GET  /api/hours                          → 周列表与课时汇总
 *   POST {teacher, week, hours, confirm}    → 保存已登录老师的记录
 *   Devin 可切换管理员模式，代填或修改已锁定的周。
 *
 * 【锁定规则，服务端强制】
 *   每一周在「周日结束后再过 7 天」的那天 24:00 锁死，三个人同一个期限。
 *   例：9/14–9/20 这一周，改到 9/27 当天为止。「确认」只是定稿标记，不影响期限。
 *
 * 【存储】Vercel Blob（私有），信息全部编码在路径里，一次 list() 读完整个学期：
 *   hours/<yyyymmdd>~<teacher>~<hours>~<confirmedMs>.json
 *   新记录写入成功后清理同一人同一周的旧记录。
 */

import { put, list, del } from '@vercel/blob';
import { TEACHERS, TERM_START, TERM_END, EDIT_DAYS,
         todayCN, weeks, editState, weekStarted } from './_hours-data.js';
import { getStaff, internalHeaders, sameOriginJson } from './_staff-auth.js';

const PREFIX = 'hours/';
const SEP = '~';
const compact = (d) => d.replace(/-/g, '');
const expand  = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

export default async function handler(req, res) {
  internalHeaders(res);
  const teacher = getStaff(req);
  if (!teacher) return res.status(401).json({ ok: false, error: '请登录英歌宝工作台。' });
  const isGet = req.method === 'GET';
  if (!isGet && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: '请求方式不正确。' });
  }
  const body = req.body;
  const isAdmin = teacher.key === 'devin' &&
    (isGet ? req.query?.manage === '1' : body?.manage === true);

  try {
    if (isGet) return res.status(200).json({ ...await readAll(isAdmin), viewer: teacher.key });
    if (!sameOriginJson(req) || process.env.VERCEL_ENV === 'preview') {
      return res.status(403).json({ ok: false, error: '请在正式工作台登记课时。' });
    }
    if (!body || (!isAdmin && body.teacher !== teacher.key)) {
      return res.status(403).json({ ok: false, error: '请登记自己这一行的课时。' });
    }
    return await save(body, res, isAdmin);
  } catch (e) {
    console.error('[hours]', e.name);
    return res.status(500).json({ ok: false, error: '课时账本暂时无法访问，请稍后再试。' });
  }
}

/** 读全部记录：一次 list()，内容都在路径里 */
async function readRecords() {
  const out = {};
  let cursor;
  do {
    const r = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const b of r.blobs) {
      const file = b.pathname.slice(PREFIX.length).replace(/\.json$/, '');
      const [d, teacher, hours, conf, writtenAt] = file.split(SEP);
      if (!d || !teacher) continue;
      const key = `${expand(d)}|${teacher}`;
      const at = Number(writtenAt) || new Date(b.uploadedAt).getTime();
      const prior = out[key];
      const confirmedAt = Math.min(Number(conf) || Infinity, prior?.confirmedAt || Infinity);
      if (prior?.at >= at) {
        prior.confirmedAt = Number.isFinite(confirmedAt) ? confirmedAt : 0;
        continue;
      }
      out[key] = {
        week: expand(d), teacher,
        hours: Number(hours) || 0,
        confirmedAt: Number.isFinite(confirmedAt) ? confirmedAt : 0,
        at,
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
    if (isAdmin) st.locked = false;
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

  const hours = body.hours;
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
  const confirmations = old.blobs.map(({ pathname }) =>
    Number(pathname.replace(/\.json$/, '').split(SEP)[3]) || 0).filter(Boolean);
  const now = Date.now();
  const confirmedAt = confirmations.length ? Math.min(...confirmations) : (body.confirm ? now : 0);
  const clean = Math.round(hours * 4) / 4;   // 落到 0.25 的格子上
  const pathname = `${prefix}${clean}${SEP}${confirmedAt}${SEP}${now}.json`;
  await put(pathname,
    JSON.stringify({ teacher, week, hours: clean, confirmedAt, at: new Date(now).toISOString() }), {
      access: 'private', contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
    });
  const stale = old.blobs.filter(b => b.pathname !== pathname).map(b => b.url);
  if (stale.length) await del(stale).catch(e => console.error('[hours cleanup]', e.name));

  return res.status(200).json({ ok: true, admin: !!isAdmin,
    saved: { week, teacher, hours: clean, confirmed: !!confirmedAt, ...editState(w.end, Date.now()) } });
}
