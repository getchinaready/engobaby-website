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

/**
 * 三位老师。key 只用小写字母（会进存储路径）；label 是界面显示名；email 用来发催填提醒。
 * ⚠️ email 是按现有三个教师邮箱推断的对应关系，Devin 请核对一遍再用：
 *    xmj17778194023@gmail.com → MJ / llw97@foxmail.com → Lili / yuxinzhe1019@163.com → Devin
 */
export const TEACHERS = [
  { key: 'mj',    label: 'MJ',    color: '#EF5A5A', email: 'xmj17778194023@gmail.com' },
  { key: 'lili',  label: 'Lili',  color: '#7CB24E', email: 'llw97@foxmail.com' },
  { key: 'devin', label: 'Devin', color: '#3E92DE', email: 'yuxinzhe1019@163.com' },
];

/** 催填提醒：这一周结束后的第几天发（第 7 天是最后一天，不再打扰） */
export const REMIND_DAYS = [1, 6];

/** 学期范围：从 9/14 那一周（周一）开始，到 1/31 那一周结束，共 20 周 */
export const TERM_START = '2026-09-14';   // 必须是周一
export const TERM_END   = '2027-01-31';

/** 一周结束之后，还能再改几天；超过就锁死 */
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
 * 这一周什么时候锁。
 * 截止 = 周日结束后再过 EDIT_DAYS 天，到那天的北京时间 24:00。
 * 例：9/14–9/20 这一周，改到 9/27 当天为止，9/28 零点锁死。
 * 跟谁什么时候点的「确认」无关 —— 三个人是同一个期限。
 */
export function lockAt(weekEnd) {
  return parse(weekEnd) + (EDIT_DAYS + 1) * DAY - 8 * 3600000;
}

/** 这一周现在能不能改 */
export function editState(weekEnd, nowMs) {
  const now = nowMs || Date.now();
  const deadline = lockAt(weekEnd);
  const left = Math.ceil((deadline - now) / DAY);
  return {
    locked: now > deadline,
    daysLeft: left > 0 ? left : 0,
    lockDate: fmt(deadline + 8 * 3600000 - DAY),   // 最后一个可改的日子
  };
}

/** 这一周是否已经开始（没开始的周不给填） */
export function weekStarted(week, today) {
  return week <= (today || todayCN());
}
