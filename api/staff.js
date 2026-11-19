import { readFile } from 'node:fs/promises';
import { getStaff, internalHeaders, staffAction } from './_staff-auth.js';

const homePage = new URL('./_staff-pages/staff.html', import.meta.url);
const bookingPage = new URL('./_staff-pages/booking.html', import.meta.url);
const privatePages = new Map([
  ['steam', new URL('./_staff-pages/steam.html', import.meta.url)],
  ['hours', new URL('./_staff-pages/hours.html', import.meta.url)],
]);

export default async function handler(req, res) {
  internalHeaders(res);
  if (req.method === 'POST' && !req.query?.view) return staffAction(req, res);
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD, POST');
    return res.status(405).json({ error: '请求方式不正确。' });
  }

  const view = req.query?.view;
  if (view === 'booking' && process.env.ENGO_YUEKA_OPEN !== '1') return redirect(res, '/staff');
  if (view === 'legacy-hours') return redirect(res, '/hours');

  const teacher = getStaff(req);
  if (!view) return res.json({ name: teacher?.label || null });
  const page = view === 'home' ? homePage : view === 'booking' ? bookingPage : privatePages.get(view);
  if (!page) return res.status(404).end();
  if (privatePages.has(view) && !teacher) return redirect(res, `/staff?next=${view}`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return res.send(await readFile(page, 'utf8'));
}

function redirect(res, path) {
  res.setHeader('Location', path);
  return res.status(303).end();
}
