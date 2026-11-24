/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

export const nonce = () => randomBytes(16).toString('base64url');

export function truncate(value, max) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function writeAtomic(file, data) {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function errMsg(e) {
  if (!e) return 'unknown error';
  if (e.name === 'TimeoutError') return 'timeout';
  const c = e.cause;
  const extra = c && (c.code || c.message) ? ` (${c.code || c.message})` : '';
  return `${e.message || String(e)}${extra}`;
}

export function expandEnv(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => process.env[k] ?? '');
}

export const iso = (ms = Date.now()) => new Date(ms).toISOString();

export function maskUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return String(raw).split('?')[0];
  }
}

export function ago(isoStr) {
  if (!isoStr) return '-';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(isoStr)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
