import { createHmac, timingSafeEqual } from 'node:crypto';
import { TEACHERS } from './_hours-data.js';

const COOKIE = '__Host-engo_staff';
const SESSION_SECONDS = 14 * 24 * 60 * 60;
const CODE_INTERVAL = 10 * 60 * 1000;

const signingKey = () => {
  const value = process.env.ENGO_STAFF_SECRET;
  return /^[a-f0-9]{64}$/i.test(value || '') ? Buffer.from(value, 'hex') : null;
};

function sign(key, message) {
  return createHmac('sha256', key).update(message).digest('hex');
}

function equal(a, b) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a, 'ascii'), Buffer.from(b, 'ascii'));
}

export function getStaff(req) {
  const key = signingKey();
  const value = req.headers.cookie?.match(/(?:^|;\s*)__Host-engo_staff=([a-z]+\.\d+\.[a-f0-9]{64})(?:;|$)/)?.[1];
  if (!key || !value) return null;
  const [id, expires, signature] = value.split('.');
  if (Number(expires) <= Math.floor(Date.now() / 1000)) return null;
  if (!equal(signature, sign(key, `session:${id}:${expires}`))) return null;
  return TEACHERS.find(teacher => teacher.key === id) || null;
}

export function sameOriginJson(req) {
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return false;
  const protocol = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
  return req.headers.origin === `${protocol}://${req.headers.host}`;
}

export function internalHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

function setCookie(res, value, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

function codeFor(key, id, slot) {
  return sign(key, `login:${id}:${slot}`).slice(0, 20).toUpperCase();
}

export async function staffAction(req, res) {
  if (!sameOriginJson(req)) return res.status(403).json({ error: '请从英歌宝工作台登录。' });
  const { action, email, code } = req.body || {};
  if (action === 'logout') {
    setCookie(res, '', 0);
    return res.json({ ok: true });
  }

  const key = signingKey();
  if (!key) return res.status(503).json({ error: '登录服务暂不可用，请稍后再试。' });
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: '请填写有效的教师邮箱。' });
  }

  const address = email.trim().toLowerCase();
  const teacher = TEACHERS.find(item => item.email.toLowerCase() === address);
  const slot = Math.floor(Date.now() / CODE_INTERVAL);
  if (action === 'send') {
    if (teacher) {
      try {
        await sendCode(teacher, codeFor(key, teacher.key, slot), slot);
      } catch (error) {
        console.error('[staff login]', error.message);
        return res.status(503).json({ error: '验证码暂时发不出，请稍后重试。' });
      }
    }
    return res.json({ ok: true });
  }

  if (action !== 'login') return res.status(400).json({ error: '未知的登录操作。' });
  const input = typeof code === 'string' && code.length <= 40
    ? code.replace(/[\s-]/g, '').toUpperCase()
    : '';
  const validCode = /^[A-F0-9]{20}$/.test(input) && teacher &&
    [slot, slot - 1].some(period => equal(input, codeFor(key, teacher.key, period)));
  if (!validCode) return res.status(401).json({ error: '邮箱或验证码有误，或验证码已过期。' });

  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const signature = sign(key, `session:${teacher.key}:${expires}`);
  setCookie(res, `${teacher.key}.${expires}.${signature}`, SESSION_SECONDS);
  return res.json({ ok: true, name: teacher.label });
}

async function sendCode(teacher, code, slot) {
  const { RESEND_API_KEY, MAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !MAIL_FROM) throw new Error('Missing email configuration');
  const from = MAIL_FROM.match(/<([^>]+)>/)?.[1] || MAIL_FROM;
  const formatted = code.match(/.{4}/g).join('-');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `engobaby-staff-login/${teacher.key}/${slot}/${code.slice(0, 4)}`,
    },
    body: JSON.stringify({
      from: `英歌宝 Engo Baby <${from}>`,
      to: [teacher.email],
      subject: '英歌宝工作台登录验证码',
      text: `${teacher.label}，你的英歌宝工作台验证码是 ${formatted}。\n请在 10 分钟内回到工作台输入验证码。\n如果你没有发起登录，可以忽略这封邮件。`,
    }),
    signal: AbortSignal.timeout(8500),
  });
  if (!response.ok) {
    const info = await response.json().catch(() => ({}));
    if (response.status === 409 && info.name === 'concurrent_idempotent_requests') return;
    throw new Error(`Resend HTTP ${response.status}`);
  }
}
