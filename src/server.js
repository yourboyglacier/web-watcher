/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
import http from 'node:http';
import { computeDiff } from './differ.js';
import { describeTarget } from './scheduler.js';
import { SNAP_RE } from './store.js';
import { ID_RE, iso, nonce, safeEqual } from './util.js';
import { renderPage } from './ui.js';

const LEVEL_NAMES = ['debug', 'info', 'warn', 'error'];

export function createWatcherServer(ctx, store, scheduler, log, startedAt) {
  const base = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY'
  };

  const send = (res, status, body, type, extra = {}) => {
    res.writeHead(status, { ...base, 'content-type': type, ...extra });
    res.end(body);
  };
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');

  function bearer(req) {
    const a = req.headers.authorization || '';
    return a.startsWith('Bearer ') ? a.slice(7) : '';
  }

  function status() {
    return {
      startedAt: iso(startedAt),
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
      node: process.versions.node,
      targets: ctx.cfg.targets.map((t) => describeTarget(t, store, scheduler))
    };
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    const method = req.method;
    if (path === '/api/health' && (method === 'GET' || method === 'HEAD')) return json(res, 200, { ok: true });
    const token = ctx.cfg.server.token;
    if (token) {
      const given = bearer(req) || url.searchParams.get('token') || '';
      if (!safeEqual(given, token)) {
        return send(res, 401, 'Unauthorized: provide the token as ?token=... or an Authorization: Bearer header.\n', 'text/plain; charset=utf-8');
      }
    }
    if (method === 'POST') {
      const m = /^\/api\/targets\/([^/]+)\/check$/.exec(path);
      if (!m) return json(res, 404, { error: 'not found' });
      if (req.headers['x-watcher'] !== '1') return json(res, 403, { error: 'missing x-watcher header' });
      const id = decodeURIComponent(m[1]);
      if (!ID_RE.test(id) || !scheduler.target(id)) return json(res, 404, { error: 'unknown target' });
      scheduler.trigger(id).catch(() => {});
      return json(res, 202, { queued: true });
    }
    if (method !== 'GET' && method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    if (path === '/') {
      const n = nonce();
      const csp = `default-src 'none'; script-src 'nonce-${n}'; style-src 'nonce-${n}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
      return send(res, 200, renderPage(n), 'text/html; charset=utf-8', { 'content-security-policy': csp });
    }
    if (path === '/api/status') return json(res, 200, status());
    if (path === '/api/logs') {
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 200));
      const level = LEVEL_NAMES.includes(url.searchParams.get('level')) ? url.searchParams.get('level') : 'info';
      const target = url.searchParams.get('target') || '';
      if (target && !ID_RE.test(target)) return json(res, 400, { error: 'invalid target' });
      return json(res, 200, { logs: store.readLogs({ limit, level, target }) });
    }
    let m = /^\/api\/targets\/([^/]+)\/snapshots$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!ID_RE.test(id)) return json(res, 400, { error: 'invalid target' });
      return json(res, 200, { snapshots: store.list(id) });
    }
    m = /^\/api\/targets\/([^/]+)\/snapshots\/([^/]+)$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const name = decodeURIComponent(m[2]);
      if (!ID_RE.test(id) || !SNAP_RE.test(name)) return json(res, 400, { error: 'invalid id or snapshot name' });
      const snap = store.get(id, name);
      return snap ? json(res, 200, snap) : json(res, 404, { error: 'snapshot not found' });
    }
    m = /^\/api\/targets\/([^/]+)\/diff$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const a = url.searchParams.get('from') || '';
      const b = url.searchParams.get('to') || '';
      if (!ID_RE.test(id) || !SNAP_RE.test(a) || !SNAP_RE.test(b)) return json(res, 400, { error: 'invalid id or snapshot name' });
      const from = store.get(id, a);
      const to = store.get(id, b);
      if (!from || !to) return json(res, 404, { error: 'snapshot not found' });
      return json(res, 200, { from: from.meta, to: to.meta, diff: computeDiff(from.content, to.content, from.meta.kind, to.meta.kind) });
    }
    return json(res, 404, { error: 'not found' });
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      log.error(`http ${req.method} ${req.url?.split('?')[0]}: ${e.message}`);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
}
