/**
 * 课时记录 —— 配置与规则
 * ---------------------------------------------------------------
 * 三位老师按周登记自己的总课时数，学期末按课时数分成。
 *
 * 【要改什么，只改这个文件】
 *   · 换人 / 改显示名 → TEACHERS
 *   · 延长学期        → TERM_END
 *   · 改锁定宽限期    → EDIT_DAYS
 */

/** 三位老师。key 只用小写字母，存进路径里；label 是界面上显示的名字。 */
export const TEACHERS = [
  { key: 'mj',    label: 'MJ',    color: '#EF5A5A' },
  { key: 'lili',  label: 'Lili',  color: '#7CB24E' },
  { key: 'devin', label: 'Devin', color: '#3E92DE' },
];

/** 学期范围：从 9/14 那一周（周一）开始，到 1/31 那一周结束，共 20 周 */
export const TERM_START = '2026-09-14';   // 必须是周一
export const TERM_END   = '2027-01-31';

/** 确认之后还能改几天；超过就锁死 */
export const EDIT_DAYS = 7;

const DAY = 86400000;

/** 北京时间的今天 */
export function todayCN() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

const parse = (d) => Date.parse(d + 'T00:00:00Z');
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

/** 生成整个学期的周列表（每周一开始） */
export function weeks() {
  const out = [];
  const end = parse(TERM_END);
  for (let t = parse(TERM_START); t <= end; t += 7 * DAY) {
    const start = fmt(t);
    const stop = fmt(t + 6 * DAY);
    out.push({
      week: start,
      start,
      end: stop,
      label: `${start.slice(5).replace('-', '/')} – ${stop.slice(5).replace('-', '/')}`,
      month: start.slice(0, 7),
    });
  }
  return out;
}

/**
 * 一条记录现在能不能改。
 *   · 还没确认           → 随时能改
 *   · 确认后 EDIT_DAYS 天内 → 还能改（改动不会重置倒计时）
 *   · 超过                → 锁死
 */
export function editState(confirmedAt, nowMs) {
  const now = nowMs || Date.now();
  if (!confirmedAt) return { locked: false, confirmed: false, daysLeft: null };
  const deadline = confirmedAt + EDIT_DAYS * DAY;
  const left = Math.ceil((deadline - now) / DAY);
  return { locked: now > deadline, confirmed: true, daysLeft: left > 0 ? left : 0 };
}

/** 这一周是否已经开始（没开始的周不给填） */
export function weekStarted(week, today) {
  return week <= (today || todayCN());
}
