/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ID_RE, expandEnv, writeAtomic } from './util.js';

export const DEFAULTS = Object.freeze({
  intervalSec: 300,
  timeoutSec: 20,
  keepSnapshots: 25,
  failureThreshold: 3,
  maxBytes: 2000000,
  cooldownSec: 0,
  minChangePercent: 0,
  minChangedLines: 1
});

const TYPES = ['auto', 'json', 'html', 'text'];
const HOOK_TYPES = ['discord', 'slack', 'generic'];
const EVENTS = ['change', 'failure', 'recovery'];

export function defaultRaw() {
  return {
    dataDir: './data',
    concurrency: 2,
    userAgent: 'web-watcher/1.0',
    server: { enabled: true, host: '127.0.0.1', port: 8787, token: '' },
    defaults: { ...DEFAULTS },
    webhooks: [{ name: 'discord', type: 'discord', urlEnv: 'DISCORD_WEBHOOK_URL', username: 'Web Watcher' }],
    targets: []
  };
}

export function readRaw(path) {
  if (!existsSync(path)) throw new Error(`config not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`invalid JSON in ${path}: ${e.message}`);
  }
}

export function writeRaw(path, raw) {
  writeAtomic(path, `${JSON.stringify(raw, null, 2)}\n`);
}

function num(value, def, min, max, label) {
  if (value === undefined || value === null || value === '') return def;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be a number between ${min} and ${max}`);
  return n;
}

function compile(src, flags, label) {
  try {
    return new RegExp(src, flags);
  } catch (e) {
    throw new Error(`${label}: invalid regex "${src}" (${e.message})`);
  }
}

function withG(flags) {
  const f = flags || 'g';
  return f.includes('g') ? f : `${f}g`;
}

function normalizeTarget(t, i, d, hookNames) {
  const label = `targets[${i}]`;
  if (!t || typeof t !== 'object') throw new Error(`${label} must be an object`);
  if (!ID_RE.test(String(t.id || ''))) throw new Error(`${label}.id invalid (letters, digits, _ and -, max 64 chars)`);
  const L = `target "${t.id}"`;
  let u;
  try {
    u = new URL(expandEnv(String(t.url || '')));
  } catch {
    throw new Error(`${L}: invalid url`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`${L}: url must be http or https`);
  const type = t.type || 'auto';
  if (!TYPES.includes(type)) throw new Error(`${L}: type must be one of ${TYPES.join(', ')}`);
  const method = String(t.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new Error(`${L}: method must be GET or POST`);
  if (t.notify !== undefined) {
    if (!Array.isArray(t.notify)) throw new Error(`${L}: notify must be an array of webhook names`);
    for (const n of t.notify) if (!hookNames.has(n)) throw new Error(`${L}: unknown webhook "${n}" in notify`);
  }
  const body = t.body == null ? null : typeof t.body === 'string' ? t.body : JSON.stringify(t.body);
  return {
    id: t.id,
    name: t.name || t.id,
    url: String(t.url),
    enabled: t.enabled !== false,
    type,
    method,
    headers: t.headers && typeof t.headers === 'object' ? t.headers : {},
    body,
    intervalSec: num(t.intervalSec ?? d.intervalSec, 300, 10, 604800, `${L}.intervalSec`),
    timeoutSec: num(t.timeoutSec ?? d.timeoutSec, 20, 1, 300, `${L}.timeoutSec`),
    keepSnapshots: num(t.keepSnapshots ?? d.keepSnapshots, 25, 1, 500, `${L}.keepSnapshots`),
    failureThreshold: num(t.failureThreshold ?? d.failureThreshold, 3, 1, 1000, `${L}.failureThreshold`),
    maxBytes: num(t.maxBytes ?? d.maxBytes, 2000000, 1024, 50000000, `${L}.maxBytes`),
    cooldownSec: num(t.cooldownSec ?? d.cooldownSec, 0, 0, 604800, `${L}.cooldownSec`),
    minChangePercent: num(t.minChangePercent ?? d.minChangePercent, 0, 0, 100, `${L}.minChangePercent`),
    minChangedLines: num(t.minChangedLines ?? d.minChangedLines, 1, 1, 1000000, `${L}.minChangedLines`),
    path: t.path ? String(t.path) : '',
    ignoreKeys: Array.isArray(t.ignoreKeys) ? t.ignoreKeys.map(String) : [],
    raw: t.raw === true,
    sortLines: t.sortLines === true,
    allowEmpty: t.allowEmpty === true,
    conditional: t.conditional !== false,
    patternRe: t.pattern ? compile(String(t.pattern), withG(t.patternFlags), `${L}.pattern`) : null,
    ignoreRes: (Array.isArray(t.ignore) ? t.ignore : []).map((s) => compile(String(s), 'g', `${L}.ignore`)),
    alertRe: t.alertPattern ? compile(String(t.alertPattern), 'i', `${L}.alertPattern`) : null,
    notify: t.notify || null,
    sig: JSON.stringify(t)
  };
}

export function normalizeConfig(raw, configPath) {
  if (!raw || typeof raw !== 'object') throw new Error('config must be a JSON object');
  const base = dirname(resolve(configPath));
  const d = { ...DEFAULTS, ...(raw.defaults || {}) };
  const s = raw.server || {};
  const hooksRaw = Array.isArray(raw.webhooks) ? raw.webhooks : [];
  const webhooks = hooksRaw.map((w, i) => {
    const name = String(w.name || `webhook${i + 1}`);
    const type = w.type || 'generic';
    if (!HOOK_TYPES.includes(type)) throw new Error(`webhook "${name}": type must be one of ${HOOK_TYPES.join(', ')}`);
    const url = expandEnv(String(w.url || '')) || (w.urlEnv ? process.env[w.urlEnv] || '' : '');
    if (url && !/^https?:\/\//i.test(url)) throw new Error(`webhook "${name}": url must be http or https`);
    const events = Array.isArray(w.events) ? w.events : EVENTS;
    for (const ev of events) if (!EVENTS.includes(ev)) throw new Error(`webhook "${name}": unknown event "${ev}"`);
    return {
      name,
      type,
      url,
      username: String(w.username || 'Web Watcher'),
      avatarUrl: String(w.avatarUrl || ''),
      mention: String(w.mention || ''),
      events
    };
  });
  const hookNames = new Set(webhooks.map((w) => w.name));
  if (!Array.isArray(raw.targets)) throw new Error('targets must be an array');
  const seen = new Set();
  const targets = raw.targets.map((t, i) => {
    const nt = normalizeTarget(t, i, d, hookNames);
    if (seen.has(nt.id)) throw new Error(`duplicate target id "${nt.id}"`);
    seen.add(nt.id);
    return nt;
  });
  return {
    path: resolve(configPath),
    dataDir: process.env.WATCHER_DATA ? resolve(process.env.WATCHER_DATA) : resolve(base, raw.dataDir || './data'),
    concurrency: num(raw.concurrency, 2, 1, 8, 'concurrency'),
    userAgent: String(raw.userAgent || 'web-watcher/1.0'),
    server: {
      enabled: s.enabled !== false,
      host: String(process.env.WATCHER_HOST || s.host || '127.0.0.1'),
      port: num(process.env.WATCHER_PORT ?? s.port, 8787, 1, 65535, 'server.port'),
      token: String(process.env.WATCHER_TOKEN || s.token || '')
    },
    webhooks,
    targets
  };
}
