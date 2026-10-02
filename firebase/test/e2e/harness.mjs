// e2e harness: static server + Chromium with Firebase SDK routed to local emulator-wired bundles
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
// SORA3A_ROOT: المجلد الذي يحتوي المستودعات الثلاثة (sora3a-admin, sora3a-rest2, sora3a-captain)
const ROOT = process.env.SORA3A_ROOT || path.resolve(HERE, '../../../..');
export const ROOTS = Object.fromEntries(['sora3a-captain', 'sora3a-rest2', 'sora3a-admin'].map((r) => [r, path.join(ROOT, r)]));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml' };

export function serve(port = 5050) {
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const [, repo, ...rest] = u.pathname.split('/');
    const root = ROOTS[repo];
    if (!root) { res.writeHead(404); return res.end(); }
    let p = path.join(root, rest.join('/') || 'index.html');
    try { const b = await readFile(p); res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(b); }
    catch { res.writeHead(404); res.end('nf'); }
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

export async function env() {
  return initializeTestEnvironment({ projectId: 'sora3a-system', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(path.join(HERE, '../../firestore.rules'), 'utf8') } });
}

export async function signUp(email, password) {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const j = await r.json(); if (!j.localId) throw new Error(JSON.stringify(j)); return j.localId;
}
export async function clearAuth() { await fetch('http://127.0.0.1:9099/emulator/v1/projects/sora3a-system/accounts', { method: 'DELETE' }); }

export async function browser() {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  return b;
}
export async function page(b, { notif = false, w = 400, h = 860 } = {}) {
  const ctx = await b.newContext({ serviceWorkers: 'block', locale: 'ar-IQ', viewport: { width: w, height: h } });
  if (notif) await ctx.addInitScript(() => {
    const N = function () {}; N.permission = 'granted'; N.requestPermission = async () => 'granted';
    Object.defineProperty(window, 'Notification', { value: N, configurable: true });
  });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.7\.1\/firebase-(app|auth|firestore|messaging)\.js/, async (route) => {
    const m = route.request().url().match(/firebase-(\w+)\.js/)[1];
    route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(path.join(HERE, 'sdk', `firebase-${m}.js`), 'utf8') });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|tile\.openstreetmap|unpkg\.com|cdnjs|jsdelivr/, (r) => r.fulfill({ status: 200, body: '' }));
  await ctx.addInitScript(() => {
    const fakeReg = { scope: location.origin + '/x/', showNotification: (t, o) => { (window.__notes ||= []).push([t, o]); return Promise.resolve(); }, pushManager: {} };
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.resolve(fakeReg);
      navigator.serviceWorker.getRegistration = () => Promise.resolve(fakeReg);
      Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(fakeReg) });
    }
  });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push('console: ' + m.text()); });
  p.on('dialog', (d) => d.accept());
  return p;
}
