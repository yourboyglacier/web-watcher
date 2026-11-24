/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ID_RE, ensureDir, readJson, writeAtomic } from './util.js';

export const SNAP_RE = /^\d{13}\.snap$/;
export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_LOG_BYTES = 1000000;
const META_BYTES = 2048;

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.stateFile = join(dir, 'state.json');
    this.logFile = join(dir, 'logs.jsonl');
    this.snapDir = join(dir, 'snapshots');
    ensureDir(this.snapDir);
    const state = readJson(this.stateFile, null);
    this.state = state && typeof state === 'object' && state.targets ? state : { targets: {} };
    this.logBytes = existsSync(this.logFile) ? statSync(this.logFile).size : 0;
  }

  target(id) {
    return this.state.targets[id] || {};
  }

  patch(id, p) {
    this.state.targets[id] = { ...this.state.targets[id], ...p };
    writeAtomic(this.stateFile, JSON.stringify(this.state));
  }

  dirFor(id) {
    if (!ID_RE.test(id)) throw new Error('invalid target id');
    return join(this.snapDir, id);
  }

  names(id) {
    const dir = this.dirFor(id);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((n) => SNAP_RE.test(n)).sort().reverse();
  }

  count(id) {
    return this.names(id).length;
  }

  save(id, meta, content) {
    const dir = this.dirFor(id);
    ensureDir(dir);
    let ts = Date.now();
    while (existsSync(join(dir, `${ts}.snap`))) ts++;
    const name = `${ts}.snap`;
    const m = { ...meta, ts };
    writeAtomic(join(dir, name), `${JSON.stringify(m)}\n${content}`);
    return { name, meta: m };
  }

  readMeta(id, name) {
    const fd = openSync(join(this.dirFor(id), name), 'r');
    try {
      const buf = Buffer.alloc(META_BYTES);
      const n = readSync(fd, buf, 0, META_BYTES, 0);
      const head = buf.subarray(0, n).toString('utf8');
      const nl = head.indexOf('\n');
      return JSON.parse(nl === -1 ? head : head.slice(0, nl));
    } finally {
      closeSync(fd);
    }
  }

  list(id) {
    const out = [];
    for (const name of this.names(id)) {
      try {
        out.push({ name, ...this.readMeta(id, name) });
      } catch {
        continue;
      }
    }
    return out;
  }

  get(id, name) {
    if (!SNAP_RE.test(name)) return null;
    const file = join(this.dirFor(id), name);
    if (!existsSync(file)) return null;
    const text = readFileSync(file, 'utf8');
    const nl = text.indexOf('\n');
    return { name, meta: JSON.parse(text.slice(0, nl)), content: text.slice(nl + 1) };
  }

  latest(id) {
    for (const name of this.names(id)) {
      try {
        const s = this.get(id, name);
        if (s) return s;
      } catch {
        continue;
      }
    }
    return null;
  }

  prune(id, keep) {
    const dir = this.dirFor(id);
    for (const name of this.names(id).slice(keep)) rmSync(join(dir, name), { force: true });
  }

  purge(id) {
    rmSync(this.dirFor(id), { recursive: true, force: true });
    delete this.state.targets[id];
    writeAtomic(this.stateFile, JSON.stringify(this.state));
  }

  appendLog(entry) {
    const line = `${JSON.stringify(entry)}\n`;
    appendFileSync(this.logFile, line);
    this.logBytes += Buffer.byteLength(line);
    if (this.logBytes > MAX_LOG_BYTES) this.rotateLogs();
  }

  rotateLogs() {
    const lines = readFileSync(this.logFile, 'utf8').split('\n').filter(Boolean);
    const kept = `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`;
    writeAtomic(this.logFile, kept);
    this.logBytes = Buffer.byteLength(kept);
  }

  readLogs({ limit = 200, level = 'info', target = '' } = {}) {
    if (!existsSync(this.logFile)) return [];
    const min = LEVELS[level] ?? LEVELS.info;
    const lines = readFileSync(this.logFile, 'utf8').split('\n');
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (!lines[i]) continue;
      try {
        const e = JSON.parse(lines[i]);
        if ((LEVELS[e.level] ?? 0) < min) continue;
        if (target && e.target !== target) continue;
        out.push(e);
      } catch {
        continue;
      }
    }
    return out;
  }
}
