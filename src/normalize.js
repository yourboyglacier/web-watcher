/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const code = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return NAMED[g.toLowerCase()] ?? m;
  });
}

function htmlToText(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|pre|blockquote|dd|dt)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped);
}

function pick(value, path) {
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = value;
  for (const k of tokens) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function strip(value, keys) {
  if (Array.isArray(value)) return value.map((v) => strip(v, keys));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) if (!keys.has(k)) out[k] = strip(value[k], keys);
    return out;
  }
  return value;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

export function detectKind(t, contentType, body) {
  if (t.type !== 'auto') return t.type;
  if (/json/i.test(contentType)) return 'json';
  const head = body.trimStart();
  if (head[0] === '{' || head[0] === '[') {
    try {
      JSON.parse(body);
      return 'json';
    } catch {
      return 'text';
    }
  }
  if (/<(!doctype html|html|head|body)\b/i.test(head.slice(0, 2000))) return 'html';
  return 'text';
}

export function normalize(body, contentType, t) {
  const kind = detectKind(t, contentType, body);
  if (kind === 'json') {
    let v;
    try {
      v = JSON.parse(body);
    } catch (e) {
      throw new Error(`invalid JSON: ${e.message}`);
    }
    if (t.path) {
      v = pick(v, t.path);
      if (v === undefined) throw new Error(`path "${t.path}" not found`);
    }
    if (t.ignoreKeys.length) v = strip(v, new Set(t.ignoreKeys));
    return { kind, canonical: JSON.stringify(sortKeys(v), null, 2) };
  }
  let text = body;
  if (kind === 'html' && !t.raw) text = htmlToText(text);
  for (const re of t.ignoreRes) text = text.replace(re, '');
  if (t.patternRe) {
    const found = [];
    for (const m of text.matchAll(t.patternRe)) found.push(m.length > 1 ? (m[1] ?? '') : m[0]);
    if (!found.length && !t.allowEmpty) throw new Error('pattern matched nothing');
    text = found.join('\n');
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter(Boolean);
  if (t.sortLines) lines.sort();
  const canonical = lines.join('\n');
  if (!canonical && !t.allowEmpty) throw new Error('empty content after normalization');
  return { kind: kind === 'html' ? 'html' : 'text', canonical };
}
