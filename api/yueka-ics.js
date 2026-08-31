/**
 * 月卡预约 —— 生成 ICS 日历文件（支持一次导出多场）
 *   单场：GET /api/yueka-ics?k=口令&date=2026-09-14&slot=eve
 *   多场：GET /api/yueka-ics?k=口令&ev=20260914-eve,20260915-pm,20260921-am
 * 返回 text/calendar；每个事件带开课前 1 小时提醒。
 * 时间用 UTC 表示（北京时间 −8h），避免 VTIMEZONE 兼容性问题。
 */

import { SLOTS, SCHEDULE } from './_yueka-data.js';

const MONTH = '2026-09';
const TIMES = {
  am:  { h1: 10, m1: 30, h2: 11, m2: 30 },
  pm:  { h1: 15, m1: 0,  h2: 16, m2: 0  },
  eve: { h1: 20, m1: 30, h2: 21, m2: 30 },
};

export default function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  if (q.k !== process.env.YUEKA_CODE) return res.status(403).send('forbidden');

  // 组装要导出的 (date, slot) 列表
  let wants = [];
  if (q.ev) {
    wants = String(q.ev).split(',').slice(0, 40).map((x) => {
      const [d8, slot] = x.trim().split('-');
      return d8 && d8.length === 8
        ? { date: `${d8.slice(0,4)}-${d8.slice(4,6)}-${d8.slice(6,8)}`, slot } : null;
    }).filter(Boolean);
  } else if (q.date && q.slot) {
    wants = [{ date: q.date, slot: q.slot }];
  }

  const events = [];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z');
  for (const w of wants) {
    const day = SCHEDULE[MONTH].days.find((d) => d.date === w.date && !d.break);
    const t = TIMES[w.slot];
    if (!day || !t || !day.slots.includes(w.slot)) continue;
    const utc = (h, m) => new Date(Date.parse(day.date + 'T00:00:00Z') + ((h - 8) * 60 + m) * 60000)
      .toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z');
    events.push([
      'BEGIN:VEVENT',
      `UID:yueka-${day.date}-${w.slot}@engobaby.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utc(t.h1, t.m1)}`,
      `DTEND:${utc(t.h2, t.m2)}`,
      `SUMMARY:英歌派英语 · ${day.en}（${SLOTS[w.slot].name}）`,
      `DESCRIPTION:${(day.cn || '')}\\n成人英语主题月卡 · 每节 60 分钟\\n有事请提前微信 engo2026 说一声`,
      'LOCATION:普宁市万泰新天地时代中心 D 栋',
      'BEGIN:VALARM','TRIGGER:-PT1H','ACTION:DISPLAY',
      `DESCRIPTION:1 小时后上课：${day.en}`,'END:VALARM',
      'END:VEVENT',
    ].join('\r\n'));
  }
  if (!events.length) return res.status(400).send('bad date/slot');

  const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Engo Pro//Yueka//CN',
    'CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:英歌派月卡',
    ...events,'END:VCALENDAR'].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="engo-yueka-${events.length > 1 ? 'all' : 'class'}.ics"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(ics);
}
