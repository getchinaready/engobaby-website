/**
 * 月卡课表数据 + 预约规则
 * ---------------------------------------------------------------
 * 每月换课表：复制一份 SCHEDULE['2026-09'] 改成新月份即可，
 * 其余代码不用动。数据来源＝《ENGO_2026年9月正式课表_日历横版.png》。
 */

export const SLOTS = {
  am:  { key: 'am',  name: '早班', time: '10:30–11:30' },
  pm:  { key: 'pm',  name: '午班', time: '15:00–16:00' },
  eve: { key: 'eve', name: '晚班', time: '20:30–21:30' },   // 周二 / 周三 / 周四
  eve40: { key: 'eve40', name: '晚班', time: '20:40–21:40' }, // 周一 / 周六 / 周日
};

// 学员预约时可选的状态 —— 想换措辞/选项，改这里就行
export const STATUSES = [
  { key: 'speak',  label: '想多说',   emoji: '🗣️', hint: '今天想多开口' },
  { key: 'listen', label: '想多听',   emoji: '👂', hint: '先听别人说，慢慢跟上' },
  { key: 'sound',  label: '想练发音', emoji: '🎯', hint: '希望老师多纠我的音' },
  { key: 'chill',  label: '随便聊聊', emoji: '☕', hint: '轻松来一场' },
];

/** 心情标签 —— 约课时可选，老师和同学都能看到（想改文案/emoji 只改这里） */
export const MOODS = [
  { key: 'great',    label: '状态超好', emoji: '🤩' },
  { key: 'happy',    label: '心情不错', emoji: '😄' },
  { key: 'chill',    label: '平平淡淡', emoji: '😌' },
  { key: 'tired',    label: '有点累',   emoji: '😪' },
  { key: 'stressed', label: '压力山大', emoji: '🫠' },
];

export const SCHEDULE = {
  '2026-10': {
    label: '2026 年 10 月',
    note: '10/1–10/6 国庆休课，10/7 晚恢复上课。全月 25 个开课日：10/7–10/12 计入 9 月月卡（补足 9 月顺延的课次），10/13 起计入 10 月新月卡。同一天两个时段内容完全相同，任选一场参加。',
    // 默认口径：不设豁免，全月统一「提前 3 天」，新月份照抄 graceDates: [] 即可。
    // 2026-10-07 临时开口子：本周（10/7–10/11）不限提前天数，10/12 起恢复正常。用完清空。
    graceDates: ['2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11'],
    days: [
      { date:'2026-10-01', break:true, en:'National Day Holiday', cn:'国庆休课' },
      { date:'2026-10-02', break:true, en:'National Day Holiday', cn:'国庆休课' },
      { date:'2026-10-03', break:true, en:'National Day Holiday', cn:'国庆休课' },
      { date:'2026-10-04', break:true, en:'National Day Holiday', cn:'国庆休课' },
      { date:'2026-10-05', break:true, en:'National Day Holiday', cn:'国庆休课' },
      { date:'2026-10-06', break:true, en:'National Day Holiday', cn:'国庆休课' },

      { date:'2026-10-07', slots:['eve'],               tag:'9 月卡', en:'Back to Everyday Life',                       cn:'假期结束，回到日常' },
      { date:'2026-10-08', slots:['am','eve'],          tag:'9 月卡', en:'What Kind of Person Are You, Really?',        cn:'你到底是什么性格？' },
      { date:'2026-10-09', slots:['am','pm'],           tag:'9 月卡', en:'Money Habits',                                cn:'你是存钱派还是花钱派？' },
      { date:'2026-10-10', slots:['eve40'],             tag:'9 月卡', en:'The Art of Saying No',                        cn:'如何体面地拒绝' },
      { date:'2026-10-11', slots:['eve40'],             tag:'9 月卡', en:'City Life or Small-Town Life?',               cn:'大城市还是小城镇？' },
      { date:'2026-10-12', slots:['pm','eve40'],        tag:'9 月卡', en:'Guilty Pleasures & Bad Habits',               cn:'那些戒不掉的小习惯' },

      { date:'2026-10-13', slots:['pm','eve'],          en:'Little Things That Make Your Day',            cn:'让一天变好的小事' },
      { date:'2026-10-14', slots:['am','pm'],           en:"What's in Your Bag?",                         cn:'你的包里藏着什么生活？' },
      { date:'2026-10-15', slots:['am','eve'],          en:'Are You a Good Neighbour?',                   cn:'你是个好邻居吗？' },
      { date:'2026-10-16', slots:['am','pm'],           en:'Cooking at Home or Eating Out?',              cn:'自己做饭还是出去吃？' },
      { date:'2026-10-17', slots:['eve40'],             en:'Your Dream Café',                             cn:'开一家你喜欢的咖啡馆' },
      { date:'2026-10-18', slots:['eve40'],             en:'What Does a Good Life Look Like?',            cn:'怎样才算过得好？' },
      { date:'2026-10-19', slots:['pm','eve40'],        en:'Something You Learned the Hard Way',          cn:'吃过亏才懂的事' },
      { date:'2026-10-20', slots:['pm','eve'],          en:'Messages, Calls or Face-to-Face?',            cn:'发消息、打电话，还是见面聊？' },
      { date:'2026-10-21', slots:['am','pm'],           en:'Your Ideal Home Setup',                       cn:'怎样的家才住得舒服？' },
      { date:'2026-10-22', slots:['am','eve'],          en:'Asking for Help',                             cn:'为什么开口求助这么难？' },
      { date:'2026-10-23', slots:['am','pm'],           en:'Learning Something New as an Adult',          cn:'成年人学新东西' },
      { date:'2026-10-24', slots:['eve40'],             en:"The Best Recommendation You've Received",     cn:'别人推荐过的好东西' },
      { date:'2026-10-25', slots:['eve40'],             en:'If You Could Swap Lives for a Day',           cn:'如果能交换一天人生' },
      { date:'2026-10-26', slots:['pm','eve40'],        en:"What Does 'Being Polite' Mean?",              cn:'礼貌到底是什么？' },
      { date:'2026-10-27', slots:['pm','eve'],          en:'Good Service, Bad Service',                   cn:'什么服务让你想再来？' },
      { date:'2026-10-28', slots:['am','pm'],           en:'Keeping or Letting Go',                       cn:'留着，还是清掉？' },
      { date:'2026-10-29', slots:['am','eve'],          en:'Luck, Effort or Connections?',                cn:'努力、运气，还是人脉？' },
      { date:'2026-10-30', slots:['am','pm'],           en:'Hosting a Get-Together',                      cn:'怎样招待朋友才不累？' },
      { date:'2026-10-31', slots:['eve40'],             en:'If You Could Travel Through Time',            cn:'如果可以穿越时间？' },
    ],
    // 本月没有顺延主题
    pending: [],
  },

  '2026-09': {
    label: '2026 年 9 月',
    note: '每天一个独立主题，缺一次不影响下一次。同一天两个时段内容完全相同，任选一场参加。',
    // 本周期不卡「提前 3 天」的日期（开月第一周）
    graceDates: ['2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05','2026-09-06'],
    days: [
      { date:'2026-09-01', slots:['pm','eve'],  en:'Looking Back & Moving Forward', cn:'回顾过去，计划未来' },
      { date:'2026-09-02', slots:['am','eve'],  en:'Morning Person or Night Owl?',  cn:'早起派还是夜猫子？' },
      { date:'2026-09-03', slots:['pm','eve'],  en:'Small Talk That Actually Goes Somewhere', cn:'不尴尬的 Small Talk' },
      { date:'2026-09-04', slots:['am','pm'],   en:'The Perfect Weekend',           cn:'你心里的完美周末' },
      { date:'2026-09-05', slots:['eve'],       en:'Comfort Food & Food Memories',  cn:'治愈食物与味觉记忆' },
      { date:'2026-09-06', slots:['eve'],       en:'Would You Rather…?',            cn:'生活选择题' },

      { date:'2026-09-07', break:true, en:'Studio Break', cn:'工作室假期' },
      { date:'2026-09-08', break:true, en:'Studio Break', cn:'工作室假期' },
      { date:'2026-09-09', break:true, en:'Studio Break', cn:'工作室假期' },
      { date:'2026-09-10', break:true, en:'Studio Break', cn:'工作室假期' },
      { date:'2026-09-11', break:true, en:'Studio Break', cn:'工作室假期' },
      { date:'2026-09-12', break:true, en:'Studio Break', cn:'工作室假期' },
      { date:'2026-09-13', break:true, en:'Studio Break', cn:'工作室假期' },

      { date:'2026-09-14', slots:['am','eve'],  en:'First Impressions',             cn:'第一印象可靠吗？' },
      { date:'2026-09-15', slots:['pm','eve'],  en:"A Meal You'll Never Forget",    cn:'一顿忘不了的饭' },
      { date:'2026-09-16', slots:['am','pm'],   en:'Busy, Productive, or Just Tired?', cn:'忙、有效率，还是只是累？' },
      { date:'2026-09-17', slots:['pm','eve'],  en:'Phone Addiction & Screen Time', cn:'我们是不是太离不开手机？' },
      { date:'2026-09-18', slots:['am','eve'],  en:'Travel Problems',               cn:'旅行出状况了怎么办？' },
      { date:'2026-09-19', slots:['eve'],       en:'Red Flags & Green Flags',       cn:'人际关系中的红绿灯' },
      { date:'2026-09-20', slots:['eve'],       en:'Worth It or Waste of Money?',   cn:'到底值不值？' },

      { date:'2026-09-21', slots:['am','eve'],  en:'Making Friends as an Adult',    cn:'成年人交朋友为什么更难？' },
      { date:'2026-09-22', slots:['pm','eve'],  en:'What Makes a Place Feel Like Home?', cn:'哪里才算「家」？' },
      { date:'2026-09-23', slots:['am','pm'],   en:'Stress & How We Really Relax',  cn:'压力来了，你真的会休息吗？' },
      { date:'2026-09-24', slots:['pm','eve'],  en:'Mid-Autumn Talk',               cn:'中秋、家庭与节日记忆' },

      { date:'2026-09-25', break:true, en:'Mid-Autumn Holiday', cn:'中秋假期' },
      { date:'2026-09-26', break:true, en:'Mid-Autumn Holiday', cn:'中秋假期' },
      { date:'2026-09-27', break:true, en:'Mid-Autumn Holiday', cn:'中秋假期' },

      { date:'2026-09-28', slots:['am','eve'],  en:'How Was Your Holiday?',         cn:'把假期故事讲得更好' },
      { date:'2026-09-29', slots:['pm','eve'],  en:'Your Perfect 7-Day Trip',       cn:'设计你的完美七天旅行' },
      // 2026-09-30 的课已取消，主题移到下面 pending 里等重排
    ],
    // 顺延补足的主题（日期待定，暂不进预约系统）
    pending: [
      { en:'What Are You Looking Forward To?',     cn:'接下来你最期待什么？' },
      { en:'What Kind of Person Are You, Really?', cn:'你到底是什么性格？' },
      { en:'Money Habits',                         cn:'你是存钱派还是花钱派？' },
      { en:'The Art of Saying No',                 cn:'如何体面地拒绝' },
      { en:'Travel Style',                         cn:'计划控还是说走就走？' },
      { en:'Guilty Pleasures & Bad Habits',        cn:'那些戒不掉的小习惯' },
    ],
  },
};

/** 提前几个自然日才能约（开月第一周除外） */
export const LEAD_DAYS = 3;

/** 北京时间的今天，YYYY-MM-DD */
export function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 某一天现在能不能约。
 * 规则：graceDates 里的日期随时可约（含当天）；
 *       其余日期必须「提前 LEAD_DAYS 个自然日」——
 *       例：9/14 的课，9/11 当天仍可约，9/12 起关闭。
 */
export function bookingState(dateStr, month) {
  const today = todayCN();
  if (dateStr < today) return { open: false, reason: 'past',   text: '已结束' };

  const cfg = SCHEDULE[month];
  if (cfg && cfg.graceDates && cfg.graceDates.includes(dateStr)) {
    return { open: true, reason: 'grace', text: '不限提前天数，随时可约' };
  }

  const diff = Math.round((Date.parse(dateStr) - Date.parse(today)) / 86400000);
  if (diff < LEAD_DAYS) {
    return { open: false, reason: 'closed', text: `需提前 ${LEAD_DAYS} 天预约，已截止` };
  }
  return { open: true, reason: 'open', text: `还剩 ${diff} 天` };
}
