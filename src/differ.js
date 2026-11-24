/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
import { truncate } from './util.js';

const MAX_ENTRIES = 1000;
const MAX_CELLS = 4000000;

const round = (n) => Math.round(n * 100) / 100;

function lcsOps(x, y, ops) {
  const n = x.length;
  const m = y.length;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = x[i] === y[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      ops.push({ op: '-', text: x[i++] });
    } else {
      ops.push({ op: '+', text: y[j++] });
    }
  }
  while (i < n) ops.push({ op: '-', text: x[i++] });
  while (j < m) ops.push({ op: '+', text: y[j++] });
}

function setOps(x, y, ops) {
  const xs = new Set(x);
  const ys = new Set(y);
  for (const l of x) if (!ys.has(l)) ops.push({ op: '-', text: l });
  for (const l of y) if (!xs.has(l)) ops.push({ op: '+', text: l });
}

export function diffLines(a, b) {
  const x = a ? a.split('\n') : [];
  const y = b ? b.split('\n') : [];
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let ex = x.length;
  let ey = y.length;
  while (ex > s && ey > s && x[ex - 1] === y[ey - 1]) {
    ex--;
    ey--;
  }
  const mx = x.slice(s, ex);
  const my = y.slice(s, ey);
  const ops = [];
  if ((mx.length + 1) * (my.length + 1) <= MAX_CELLS) lcsOps(mx, my, ops);
  else setOps(mx, my, ops);
  let added = 0;
  for (const o of ops) if (o.op === '+') added++;
  const removed = ops.length - added;
  const percent = round((Math.max(added, removed) / Math.max(x.length, y.length, 1)) * 100);
  return {
    kind: 'text',
    added,
    removed,
    changed: 0,
    percent: Math.min(100, percent),
    entries: ops.slice(0, MAX_ENTRIES),
    truncated: ops.length > MAX_ENTRIES
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const short = (v) => truncate(JSON.stringify(v) ?? 'undefined', 160);

function leaves(v) {
  if (Array.isArray(v)) {
    let n = 0;
    for (const x of v) n += leaves(x);
    return n || 1;
  }
  if (isObj(v)) {
    let n = 0;
    for (const k of Object.keys(v)) n += leaves(v[k]);
    return n || 1;
  }
  return 1;
}

export function diffJson(a, b) {
  let x;
  let y;
  try {
    x = JSON.parse(a);
    y = JSON.parse(b);
  } catch {
    return diffLines(a, b);
  }
  const entries = [];
  const c = { added: 0, removed: 0, changed: 0 };
  const push = (op, text, key) => {
    c[key]++;
    if (entries.length < MAX_ENTRIES) entries.push({ op, text });
  };
  const walk = (p, u, v) => {
    if (u === v) return;
    if (Array.isArray(u) && Array.isArray(v)) {
      const n = Math.max(u.length, v.length);
      for (let i = 0; i < n; i++) {
        const q = `${p}[${i}]`;
        if (i >= u.length) push('+', `${q}: ${short(v[i])}`, 'added');
        else if (i >= v.length) push('-', `${q}: ${short(u[i])}`, 'removed');
        else walk(q, u[i], v[i]);
      }
      return;
    }
    if (isObj(u) && isObj(v)) {
      const keys = new Set([...Object.keys(u), ...Object.keys(v)]);
      for (const k of keys) {
        const q = /^[A-Za-z_]\w*$/.test(k) ? `${p}.${k}` : `${p}[${JSON.stringify(k)}]`;
        const hu = Object.hasOwn(u, k);
        const hv = Object.hasOwn(v, k);
        if (!hu) push('+', `${q}: ${short(v[k])}`, 'added');
        else if (!hv) push('-', `${q}: ${short(u[k])}`, 'removed');
        else walk(q, u[k], v[k]);
      }
      return;
    }
    push('~', `${p}: ${short(u)} → ${short(v)}`, 'changed');
  };
  walk('$', x, y);
  const total = c.added + c.removed + c.changed;
  const percent = round((total / Math.max(leaves(x), leaves(y), 1)) * 100);
  return { kind: 'json', ...c, percent: Math.min(100, percent), entries, truncated: total > entries.length };
}

export function computeDiff(prevContent, nextContent, prevKind, nextKind) {
  if (prevKind === 'json' && nextKind === 'json') return diffJson(prevContent, nextContent);
  return diffLines(prevContent, nextContent);
}
