/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
import { expandEnv } from './util.js';

function decoderFor(contentType) {
  const m = /charset=["']?([\w-]+)/i.exec(contentType);
  try {
    return new TextDecoder(m ? m[1] : 'utf-8');
  } catch {
    return new TextDecoder('utf-8');
  }
}

export async function fetchTarget(t, cfg, st) {
  const headers = { 'user-agent': cfg.userAgent, accept: '*/*' };
  for (const [k, v] of Object.entries(t.headers)) headers[k.toLowerCase()] = expandEnv(String(v));
  if (t.conditional && t.method === 'GET') {
    if (st.etag) headers['if-none-match'] = st.etag;
    if (st.lastModified) headers['if-modified-since'] = st.lastModified;
  }
  const started = Date.now();
  const res = await fetch(expandEnv(t.url), {
    method: t.method,
    headers,
    body: t.method === 'POST' && t.body != null ? expandEnv(t.body) : undefined,
    redirect: 'follow',
    signal: AbortSignal.timeout(t.timeoutSec * 1000)
  });
  const info = {
    status: res.status,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    contentType: res.headers.get('content-type') || ''
  };
  if (res.status === 304) {
    await res.body?.cancel().catch(() => {});
    return { ...info, notModified: true, ms: Date.now() - started };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${res.status}`);
  }
  const chunks = [];
  let total = 0;
  let truncated = false;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > t.maxBytes) {
        const keep = t.maxBytes - total;
        if (keep > 0) chunks.push(value.subarray(0, keep));
        total = t.maxBytes;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  }
  const body = decoderFor(info.contentType).decode(Buffer.concat(chunks, total));
  return { ...info, body, truncated, ms: Date.now() - started };
}
