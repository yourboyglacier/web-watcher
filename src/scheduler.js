/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
import { computeDiff } from './differ.js';
import { fetchTarget } from './fetcher.js';
import { normalize } from './normalize.js';
import { errMsg, iso, maskUrl, sha256 } from './util.js';

export function isMeaningful(diff, t) {
  if (diff.added + diff.removed + diff.changed < t.minChangedLines) return false;
  if (diff.percent < t.minChangePercent) return false;
  if (t.alertRe) return diff.entries.some((e) => t.alertRe.test(e.text));
  return true;
}

export function describeTarget(t, store, sched = null) {
  const st = store.target(t.id);
  let status = 'pending';
  if (sched?.running.has(t.id)) status = 'running';
  else if (!t.enabled) status = 'disabled';
  else if (st.lastCheck) status = st.fails > 0 ? 'error' : 'ok';
  const next = sched?.nextAt.get(t.id);
  return {
    id: t.id,
    name: t.name,
    url: maskUrl(t.url),
    type: t.type,
    enabled: t.enabled,
    intervalSec: t.intervalSec,
    status,
    lastCheck: st.lastCheck || null,
    lastOk: st.lastOk || null,
    lastChange: st.lastChange || null,
    lastAlert: st.lastAlert || null,
    lastError: st.lastError || null,
    lastErrorAt: st.lastErrorAt || null,
    lastHttp: st.lastStatus ?? null,
    lastMs: st.lastMs ?? null,
    fails: st.fails || 0,
    changeCount: st.changeCount || 0,
    lastDiff: st.lastDiff || null,
    snapshots: store.count(t.id),
    nextRunAt: next ? iso(next) : null
  };
}

export class Scheduler {
  constructor(ctx, store, notifier, log) {
    this.ctx = ctx;
    this.store = store;
    this.notifier = notifier;
    this.log = log;
    this.timers = new Map();
    this.running = new Map();
    this.nextAt = new Map();
    this.sigs = new Map();
    this.queue = [];
    this.active = 0;
    this.stopped = false;
  }

  target(id) {
    return this.ctx.cfg.targets.find((t) => t.id === id);
  }

  start() {
    this.stopped = false;
    let i = 0;
    for (const t of this.ctx.cfg.targets) {
      this.sigs.set(t.id, t.sig);
      if (t.enabled) this.schedule(t.id, this.initialDelay(t, i++));
    }
  }

  initialDelay(t, index) {
    const st = this.store.target(t.id);
    const due = st.lastCheck ? Date.parse(st.lastCheck) + t.intervalSec * 1000 - Date.now() : 0;
    return Math.max(0, due) + index * 400 + Math.floor(Math.random() * 500);
  }

  schedule(id, delayMs) {
    clearTimeout(this.timers.get(id));
    this.nextAt.set(id, Date.now() + delayMs);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.trigger(id).catch(() => {});
      }, delayMs)
    );
  }

  trigger(id) {
    const t = this.target(id);
    if (!t) return Promise.reject(new Error(`unknown target "${id}"`));
    if (this.running.has(id)) return this.running.get(id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.nextAt.delete(id);
    const p = this.enqueue(() => this.execute(id)).finally(() => {
      this.running.delete(id);
      this.afterRun(id);
    });
    this.running.set(id, p);
    return p;
  }

  afterRun(id) {
    if (this.stopped || this.timers.has(id)) return;
    const t = this.target(id);
    if (!t || !t.enabled) return;
    const fails = this.store.target(id).fails || 0;
    const base = t.intervalSec;
    const sec = fails > 0 ? Math.min(base * 2 ** (Math.min(fails, 6) - 1), Math.max(base, 3600)) : base;
    this.schedule(id, sec * 1000);
  }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (this.active < this.ctx.cfg.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      job
        .fn()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  async recovered(t, st, patch) {
    if (!st.alertedDown) return;
    const n = await this.notifier.send('recovery', t, { summary: `${t.name} is responding again.` });
    patch.alertedDown = false;
    this.log.info(`recovered${n ? ', alert sent' : ''}`, t.id);
  }

  async execute(id) {
    const t = this.target(id);
    const st = this.store.target(id);
    const started = Date.now();
    try {
      const res = await fetchTarget(t, this.ctx.cfg, st);
      const patch = {
        lastCheck: iso(),
        lastOk: iso(),
        lastMs: res.ms,
        lastStatus: res.status,
        lastError: null,
        fails: 0,
        etag: res.etag || (res.notModified ? st.etag || null : null),
        lastModified: res.lastModified || (res.notModified ? st.lastModified || null : null)
      };
      if (res.notModified) {
        this.log.debug(`not modified (${res.ms}ms)`, id);
        await this.recovered(t, st, patch);
        this.store.patch(id, patch);
        return { ok: true, changed: false };
      }
      const norm = normalize(res.body, res.contentType, t);
      const hash = sha256(norm.canonical);
      const prev = this.store.latest(id);
      const meta = {
        hash,
        kind: norm.kind,
        bytes: Buffer.byteLength(norm.canonical),
        lines: norm.canonical ? norm.canonical.split('\n').length : 0,
        truncated: res.truncated
      };
      let result = { ok: true, changed: false };
      if (!prev) {
        this.store.save(id, meta, norm.canonical);
        patch.baselineAt = iso();
        this.log.info(`baseline stored (${meta.bytes} bytes, ${res.ms}ms)`, id);
      } else if (prev.meta.hash === hash) {
        this.log.debug(`unchanged (${res.ms}ms)`, id);
      } else {
        const diff = computeDiff(prev.content, norm.canonical, prev.meta.kind, norm.kind);
        this.store.save(id, meta, norm.canonical);
        this.store.prune(id, t.keepSnapshots);
        const meaningful = isMeaningful(diff, t);
        const summary = `+${diff.added} -${diff.removed} ~${diff.changed} (${diff.percent}%)`;
        patch.lastChange = iso();
        patch.changeCount = (st.changeCount || 0) + 1;
        patch.lastDiff = { added: diff.added, removed: diff.removed, changed: diff.changed, percent: diff.percent, meaningful };
        result = { ok: true, changed: true, meaningful, summary };
        if (!meaningful) {
          this.log.info(`minor change ignored ${summary}`, id);
        } else if (t.cooldownSec && st.lastAlert && Date.now() - Date.parse(st.lastAlert) < t.cooldownSec * 1000) {
          this.log.info(`change detected ${summary}, alert suppressed by cooldown`, id);
        } else {
          this.log.info(`change detected ${summary}`, id);
          const n = await this.notifier.send('change', t, { diff, summary });
          if (n > 0) patch.lastAlert = iso();
        }
      }
      await this.recovered(t, st, patch);
      this.store.patch(id, patch);
      return result;
    } catch (e) {
      const msg = errMsg(e);
      const fails = (st.fails || 0) + 1;
      const patch = { lastCheck: iso(), lastError: msg, lastErrorAt: iso(), lastMs: Date.now() - started, fails };
      this.log.warn(`check failed (${fails}x): ${msg}`, id);
      if (fails >= t.failureThreshold && !st.alertedDown) {
        const n = await this.notifier.send('failure', t, { error: msg, fails });
        if (n > 0) patch.alertedDown = true;
      }
      this.store.patch(id, patch);
      return { ok: false, error: msg };
    }
  }

  reload() {
    const next = new Map(this.ctx.cfg.targets.map((t) => [t.id, t]));
    for (const id of [...this.timers.keys()]) {
      const t = next.get(id);
      if (!t || !t.enabled) {
        clearTimeout(this.timers.get(id));
        this.timers.delete(id);
        this.nextAt.delete(id);
      }
    }
    let i = 0;
    for (const t of next.values()) {
      const old = this.sigs.get(t.id);
      this.sigs.set(t.id, t.sig);
      if (old === t.sig) continue;
      if (old !== undefined) this.store.patch(t.id, { etag: null, lastModified: null });
      if (t.enabled && !this.running.has(t.id)) this.schedule(t.id, 300 + i++ * 400);
    }
    for (const id of [...this.sigs.keys()]) {
      if (!next.has(id)) {
        this.sigs.delete(id);
        this.nextAt.delete(id);
      }
    }
  }

  async stop() {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    let guard;
    await Promise.race([
      Promise.allSettled([...this.running.values()]),
      new Promise((resolve) => {
        guard = setTimeout(resolve, 10000);
      })
    ]);
    clearTimeout(guard);
  }
}
