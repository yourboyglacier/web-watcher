/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
import { errMsg, maskUrl, sleep, truncate } from './util.js';

const COLORS = { change: 0xf0a020, failure: 0xe5484d, recovery: 0x30a46c, test: 0x5865f2 };
const TITLES = {
  change: (t) => `Change detected: ${t.name}`,
  failure: (t) => `Target failing: ${t.name}`,
  recovery: (t) => `Recovered: ${t.name}`,
  test: (t) => `Test notification: ${t.name}`
};

function diffBlock(entries, budget) {
  const lines = [];
  let used = 0;
  for (const e of entries || []) {
    const line = `${e.op} ${truncate(String(e.text).replace(/```/g, "'''"), 200)}`;
    if (used + line.length + 1 > budget) {
      lines.push(`… ${entries.length - lines.length} more`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length ? `\`\`\`diff\n${lines.join('\n')}\n\`\`\`` : '';
}

function stats(diff) {
  return `+${diff.added} -${diff.removed} ~${diff.changed} (${diff.percent}%)`;
}

export class Notifier {
  constructor(ctx, log) {
    this.ctx = ctx;
    this.log = log;
  }

  hooksFor(event, target) {
    let list = this.ctx.cfg.webhooks.filter((w) => w.url && w.events.includes(event));
    if (target?.notify) list = list.filter((w) => target.notify.includes(w.name));
    return list;
  }

  async send(event, target, data = {}) {
    const hooks = this.hooksFor(event, target);
    if (!hooks.length) {
      this.log.debug(`no webhook configured for "${event}"`, target?.id);
      return 0;
    }
    let ok = 0;
    for (const w of hooks) if (await this.deliver(w, this.build(w, event, target, data), target?.id)) ok++;
    return ok;
  }

  async sendTest(name) {
    const hooks = this.ctx.cfg.webhooks.filter((w) => w.url && (!name || w.name === name));
    const target = { id: 'test', name: 'web-watcher', url: 'https://example.com/' };
    const data = { summary: 'Webhook connectivity test.' };
    const results = [];
    for (const w of hooks) results.push({ name: w.name, ok: await this.deliver(w, this.build(w, 'test', target, data), 'test') });
    return results;
  }

  build(w, event, target, data) {
    const title = TITLES[event](target);
    const url = maskUrl(target.url);
    const diff = data.diff;
    if (w.type === 'discord') {
      const embed = {
        title: truncate(title, 250),
        url,
        color: COLORS[event],
        timestamp: new Date().toISOString(),
        footer: { text: `web-watcher • ${target.id}` },
        fields: []
      };
      if (event === 'change' && diff) {
        embed.description = diffBlock(diff.entries, 3500);
        embed.fields.push({ name: 'Summary', value: stats(diff), inline: true }, { name: 'Type', value: diff.kind, inline: true });
      } else if (event === 'failure') {
        embed.description = truncate(data.error || 'unknown error', 1500);
        embed.fields.push({ name: 'Consecutive failures', value: String(data.fails ?? '?'), inline: true });
      } else if (data.summary) {
        embed.description = truncate(data.summary, 1500);
      }
      const body = {
        username: w.username,
        embeds: [embed],
        allowed_mentions: { parse: w.mention ? ['users', 'roles', 'everyone'] : [] }
      };
      if (w.avatarUrl) body.avatar_url = w.avatarUrl;
      if (w.mention && event !== 'recovery' && event !== 'test') body.content = truncate(w.mention, 200);
      return body;
    }
    if (w.type === 'slack') {
      const parts = [`*${title}*`, url];
      if (event === 'change' && diff) parts.push(stats(diff), diffBlock(diff.entries, 2800));
      else if (event === 'failure') parts.push(truncate(data.error || 'unknown error', 500), `failures: ${data.fails ?? '?'}`);
      else if (data.summary) parts.push(truncate(data.summary, 500));
      return { text: parts.filter(Boolean).join('\n'), username: w.username };
    }
    return {
      event,
      id: target.id,
      name: target.name,
      url,
      ts: new Date().toISOString(),
      summary: data.summary || title,
      stats: diff ? { kind: diff.kind, added: diff.added, removed: diff.removed, changed: diff.changed, percent: diff.percent } : undefined,
      changes: diff ? diff.entries.slice(0, 100) : undefined,
      error: data.error,
      failures: data.fails
    };
  }

  async deliver(w, body, id) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(w.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000)
        });
        if (res.ok) {
          await res.body?.cancel().catch(() => {});
          this.log.info(`webhook "${w.name}" delivered`, id);
          return true;
        }
        const text = await res.text().catch(() => '');
        if (res.status === 429) {
          let wait = Number(res.headers.get('retry-after')) || 2;
          try {
            const j = JSON.parse(text);
            if (j.retry_after) wait = Number(j.retry_after);
          } catch {
            wait = Math.max(wait, 2);
          }
          await sleep(Math.min(wait * 1000, 30000));
          continue;
        }
        if (res.status >= 500) {
          await sleep(1000 * attempt);
          continue;
        }
        this.log.error(`webhook "${w.name}" rejected: HTTP ${res.status} ${truncate(text, 200)}`, id);
        return false;
      } catch (e) {
        if (attempt === 3) {
          this.log.error(`webhook "${w.name}" failed: ${errMsg(e)}`, id);
          return false;
        }
        await sleep(1000 * attempt);
      }
    }
    this.log.error(`webhook "${w.name}" failed after retries`, id);
    return false;
  }
}
