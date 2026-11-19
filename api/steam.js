import { randomUUID } from 'node:crypto';
import { BlobPreconditionFailedError, get, head, put } from '@vercel/blob';
import { getStaff, internalHeaders, sameOriginJson } from './_staff-auth.js';

const path = process.env.VERCEL_ENV === 'preview' ? 'steam/v1/preview.json' : 'steam/v1/board.json';
const readOptions = { access: 'private', useCache: false };
const writeOptions = {
  access: 'private',
  contentType: 'application/json; charset=utf-8',
  addRandomSuffix: false,
  cacheControlMaxAge: 60,
};
const levels = [1, 2, 3];
const priorities = ['基础优先', '基础后拓展', '可后置'];
const normal = value => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const isFlag = value => value === 0 || value === 1;

export default async function handler(req, res) {
  internalHeaders(res);
  const teacher = getStaff(req);
  if (!teacher) return res.status(401).json({ error: '请重新登录英歌宝工作台。' });

  const action = req.query?.action;
  try {
    if (action === 'board' && req.method === 'GET') {
      const state = await get(path, { ...readOptions, ifNoneMatch: req.headers['if-none-match'] });
      if (!state) return unavailable(res);
      res.setHeader('ETag', state.blob.etag);
      if (state.statusCode === 304) return res.status(304).end();
      const board = await new Response(state.stream).json();
      return res.json({ ...board, events: board.events.slice(0, 60), viewer: teacher.label });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', action === 'board' ? 'GET' : 'POST');
      return res.status(405).json({ error: '请求方式不正确。' });
    }
    if (!sameOriginJson(req)) return res.status(403).json({ error: '请从课程记录页面操作。' });
    const body = req.body;
    if (action === 'initialize') {
      if (teacher.key !== 'devin') return res.status(403).json({ error: '只有管理员可以导入课程。' });
      return await initialize(body, res);
    }
    if (!body || typeof body !== 'object' || JSON.stringify(body).length > 5000) {
      return res.status(400).json({ error: '内容过长或格式不正确。' });
    }
    if (action === 'progress') return await update(res, board => saveProgress(board, body, teacher.label));
    if (action === 'courses') return await update(res, board => addCourse(board, body, teacher.label));
    return res.status(404).json({ error: '没有这个操作。' });
  } catch (error) {
    console.error('[steam]', error.name);
    return res.status(503).json({ error: '共享记录暂时无法访问，请稍后重试。' });
  }
}

function unavailable(res) {
  return res.status(503).json({ error: 'STEAM 课程记录正在准备中，请稍后重试。' });
}

async function initialize(board, res) {
  if (!isSnapshot(board)) return res.status(400).json({ error: '课程快照格式不正确。' });
  const existing = await get(path, readOptions);
  if (existing) {
    await existing.stream?.cancel();
    return res.status(409).json({ error: '共享记录已初始化。' });
  }
  await put(path, JSON.stringify(board), { ...writeOptions, allowOverwrite: false });
  return res.status(201).json({
    ok: true,
    revision: board.revision,
    courses: board.courses.length,
    progress: board.progress.length,
    completed: board.progress.filter(row => row.done).length,
    events: board.events.length,
  });
}

function isSnapshot(board) {
  if (!Number.isSafeInteger(board?.revision) || board.revision < 0 ||
      !Array.isArray(board.courses) || !board.courses.length || board.courses.length > 500 ||
      !Array.isArray(board.progress) || board.progress.length !== board.courses.length * levels.length ||
      !Array.isArray(board.events) || !Array.isArray(board.sources) ||
      !Array.isArray(board.categories) || !board.categories.every(value => typeof value === 'string') ||
      !board.levelBands || !levels.every(level => typeof board.levelBands[level] === 'string')) return false;

  const courses = new Set();
  for (const course of board.courses) {
    if (typeof course?.id !== 'string' || courses.has(course.id) ||
        typeof course.title !== 'string' || typeof course.category !== 'string' ||
        !course.details || typeof course.details !== 'object') return false;
    courses.add(course.id);
  }
  const rows = new Set();
  for (const row of board.progress) {
    if (!courses.has(row?.course_id) || !levels.includes(row.level) ||
        !isFlag(row.done) || !isFlag(row.selected) ||
        !Number.isSafeInteger(row.version) || row.version < 0 ||
        !['completed_on', 'words', 'sentences', 'note', 'updated_by', 'updated_at']
          .every(field => typeof row[field] === 'string')) return false;
    const key = `${row.course_id}/${row.level}`;
    if (rows.has(key)) return false;
    rows.add(key);
  }
  return true;
}

async function update(res, apply) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await get(path, { ...readOptions, headers: { 'Accept-Encoding': 'identity' } });
    if (!state) return unavailable(res);
    const board = await new Response(state.stream).json();
    const result = apply(board);
    if (result.error) return res.status(result.status).json({ error: result.error });

    // Use the storage API's version for writes. The delivery CDN may return a weak ETag.
    const metadata = await head(path);
    if (!metadata.etag || metadata.etag !== state.blob.etag.replace(/^W\//, '')) continue;
    board.revision++;
    try {
      await put(path, JSON.stringify(board), {
        ...writeOptions, allowOverwrite: true, ifMatch: metadata.etag,
      });
      return res.status(result.status).json({ ok: true, ...result.data });
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError)) throw error;
    }
  }
  return res.status(409).json({ error: '伙伴正在更新课程，请刷新后重试。' });
}

function saveProgress(board, body, actor) {
  const { courseId, level, version, done, selected } = body;
  if (typeof courseId !== 'string' || !levels.includes(level) || typeof done !== 'boolean' ||
      (selected !== undefined && typeof selected !== 'boolean') ||
      !Number.isSafeInteger(version) || version < 0) {
    return { status: 400, error: '进度参数不正确。' };
  }

  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (done && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
    return { status: 400, error: '请选择有效的上课日期。' };
  }
  const row = board.progress.find(item => item.course_id === courseId && item.level === level);
  if (!row) return { status: 404, error: '没有找到这门课程。' };
  if (row.version !== version) return { status: 409, error: '伙伴刚修改了这一格，请核对最新记录后再保存。' };

  const nextSelected = selected === undefined ? row.selected : Number(selected);
  let action = '补充教学内容';
  if (row.done !== Number(done)) action = done ? '标记已上' : '取消勾选';
  else if (row.selected !== nextSelected) action = nextSelected ? '选入备课' : '取消备课选择';

  const at = new Date().toISOString();
  Object.assign(row, {
    done: Number(done), selected: nextSelected, completed_on: done ? date : '',
    words: clean(body.words, 600), sentences: clean(body.sentences, 1200), note: clean(body.note, 300),
    updated_by: actor, updated_at: at, version: version + 1,
  });
  const detail = JSON.stringify({
    date: row.completed_on, selected: row.selected, words: row.words, sentences: row.sentences, note: row.note,
  });
  board.events.unshift({ id: randomUUID(), course_id: courseId, level, action, actor, at, detail });
  return { status: 200, data: { progress: row } };
}

function addCourse(board, body, actor) {
  const title = clean(body.title, 40);
  const category = clean(body.category, 30);
  const priority = clean(body.priority, 20);
  const normalized = normal(title);
  if (title.length < 2 || !normalized || !board.categories.includes(category) ||
      category === '已保留课程' || !priorities.includes(priority)) {
    return { status: 400, error: '请填写主题名称并选择知识领域和建议安排。' };
  }
  if (board.courses.some(course => normal(course.title) === normalized || course.normalized === normalized)) {
    return { status: 409, error: '清单里已有同名主题，请先搜索现有课程。' };
  }
  if (board.courses.length >= 500) return { status: 400, error: '课程池已达 500 项，请先整理已有主题。' };

  const id = 'C-' + randomUUID(), at = new Date().toISOString();
  board.courses.push({
    id, title, normalized, category, priority, origin: '伙伴补充',
    objective: clean(body.objective, 180), activity: clean(body.activity, 500),
    details: { sources: [], terms: [], focus: [] },
    sort_order: 1000 + board.courses.length, created_by: actor, created_at: at,
  });
  board.progress.push(...levels.map(level => ({
    course_id: id, level, done: 0, selected: 0, completed_on: '', words: '', sentences: '',
    note: '', updated_by: '', updated_at: '', version: 0,
  })));
  board.events.unshift({
    id: randomUUID(), course_id: id, level: null, action: '补充主题', actor, at,
    detail: JSON.stringify({ title }),
  });
  return { status: 201, data: { id } };
}
