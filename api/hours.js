/**
 * 课时记录 —— 接口
 * ---------------------------------------------------------------
 *   GET  /api/hours?k=CODE                    → 周列表 + 全部记录
 *   POST {k, teacher, week, hours}            → 保存（不确认）
 *   POST {k, teacher, week, hours, confirm:1} → 保存并确认（开始 7 天倒计时）
 *
 * 【锁定规则，服务端强制】
 *   没确认 → 随时能改；确认后 7 天内 → 还能改，且不重置倒计时；超过 → 拒绝写入。
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
    if (isGet) return res.status(200).json(await readAll());
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed' }); }
    return await save(body, res);
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

async function readAll() {
  const recs = await readRecords();
  const today = todayCN();
  const now = Date.now();
  const ws = weeks().map((w) => {
    const cells = {};
    let total = 0;
    for (const t of TEACHERS) {
      const r = recs[`${w.week}|${t.key}`];
      const st = editState(r?.confirmedAt || 0, now);
      cells[t.key] = {
        hours: r ? r.hours : null,
        confirmed: st.confirmed,
        locked: st.locked,
        daysLeft: st.daysLeft,
        confirmedAt: r?.confirmedAt || 0,
      };
      if (r) total += r.hours;
    }
    const allConfirmed = TEACHERS.every((t) => cells[t.key].confirmed);
    return { ...w, cells, total: Math.round(total * 100) / 100,
             started: weekStarted(w.week, today), allConfirmed,
             current: w.week <= today && today <= w.end };
  });

  const totals = {};
  let grand = 0;
  for (const t of TEACHERS) {
    const sum = ws.reduce((a, w) => a + (w.cells[t.key].hours || 0), 0);
    totals[t.key] = Math.round(sum * 100) / 100;
    grand += sum;
  }

  return { ok: true, today, teachers: TEACHERS, editDays: EDIT_DAYS,
           termStart: TERM_START, termEnd: TERM_END,
           weeks: ws, totals, grandTotal: Math.round(grand * 100) / 100 };
}

async function save(body, res) {
  const teacher = String(body.teacher || '').trim().toLowerCase();
  if (!TEACHERS.some((t) => t.key === teacher))
    return res.status(400).json({ ok: false, error: '请先在右上角选择你是谁' });

  const week = String(body.week || '').trim();
  const all = weeks();
  const w = all.find((x) => x.week === week);
  if (!w) return res.status(400).json({ ok: false, error: '这一周不在本学期范围内' });

  const today = todayCN();
  if (!weekStarted(week, today))
    return res.status(400).json({ ok: false, error: '这一周还没开始，等开课了再填' });

  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours < 0 || hours > 200)
    return res.status(400).json({ ok: false, error: '课时请填 0–200 之间的小时数' });

  // 先看旧记录：确认过且超期 → 拒绝
  const prefix = `${PREFIX}${compact(week)}${SEP}${teacher}${SEP}`;
  const old = await list({ prefix, limit: 100 });
  let confirmedAt = 0;
  if (old.blobs.length) {
    const file = old.blobs[0].pathname.slice(PREFIX.length).replace(/\.json$/, '');
    confirmedAt = Number(file.split(SEP)[3]) || 0;
    const st = editState(confirmedAt, Date.now());
    if (st.locked)
      return res.status(403).json({ ok: false, error: `这一周已确认超过 ${EDIT_DAYS} 天，已锁定。需要改动请联系 Devin。` });
  }

  // 确认时间只认第一次，改动不重置倒计时
  if (body.confirm && !confirmedAt) confirmedAt = Date.now();

  if (old.blobs.length) await del(old.blobs.map((b) => b.url));

  const clean = Math.round(hours * 100) / 100;
  await put(`${prefix}${clean}${SEP}${confirmedAt}.json`,
    JSON.stringify({ teacher, week, hours: clean, confirmedAt, at: new Date().toISOString() }), {
      access: 'private', contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0,
    });

  const st = editState(confirmedAt, Date.now());
  return res.status(200).json({ ok: true, saved: { week, teacher, hours: clean, ...st } });
}
