#!/usr/bin/env node
/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultRaw, normalizeConfig, readRaw, writeRaw } from './config.js';
import { createWatcherServer } from './server.js';
import { Notifier } from './notifier.js';
import { Scheduler, describeTarget } from './scheduler.js';
import { Store } from './store.js';
import { createLogger } from './logger.js';
import { ID_RE, ago, errMsg } from './util.js';

const VALUE_FLAGS = new Set(['config', 'port', 'host', 'interval', 'type', 'name', 'path', 'pattern']);

const HELP = `web-watcher - autonomous web/API change watcher

Usage: node src/index.js <command> [options]

Commands:
  start                       run scheduler and dashboard (default)
  once [id...]                check targets once and exit (exit code 1 on failure)
  list                        show targets and their state
  status                      list plus recent log lines
  add <id> <url>              add a target to the config
  remove <id> [--purge]       remove a target (and its data with --purge)
  test-webhook [name]         send a test notification
  help                        show this text

Options:
  --config <file>             config path (default ./config.json, env WATCHER_CONFIG)
  --no-ui                     start without the dashboard
  --port <n> --host <addr>    override dashboard bind
  add: --interval <sec> --type <auto|json|html|text> --name <text> --path <json.path> --pattern <regex>

Environment: WATCHER_DATA, WATCHER_PORT, WATCHER_HOST, WATCHER_TOKEN, WATCHER_LOG_LEVEL, DISCORD_WEBHOOK_URL
`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') {
      flags.help = true;
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const k = a.slice(2);
        const next = argv[i + 1];
        if (VALUE_FLAGS.has(k) && next !== undefined && !next.startsWith('--')) {
          flags[k] = next;
          i++;
        } else {
          flags[k] = true;
        }
      }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

const { pos, flags } = parseArgs(process.argv.slice(2));
const cmd = flags.help ? 'help' : pos.shift() || 'start';
const configPath = resolve(String(flags.config || process.env.WATCHER_CONFIG || 'config.json'));

function applyOverrides(cfg) {
  if (flags['no-ui']) cfg.server.enabled = false;
  if (flags.port !== undefined) {
    const p = Number(flags.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('--port must be 1-65535');
    cfg.server.port = p;
  }
  if (typeof flags.host === 'string') cfg.server.host = flags.host;
}

function bootstrap() {
  const cfg = normalizeConfig(readRaw(configPath), configPath);
  applyOverrides(cfg);
  const ctx = { cfg };
  const store = new Store(cfg.dataDir);
  const log = createLogger(store);
  const notifier = new Notifier(ctx, log);
  const scheduler = new Scheduler(ctx, store, notifier, log);
  return { ctx, store, log, notifier, scheduler };
}

function table(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  return rows.map((r) => r.map((cell, c) => String(cell).padEnd(widths[c])).join('  ').trimEnd()).join('\n');
}

function printTargets({ ctx, store }) {
  if (!ctx.cfg.targets.length) {
    console.log('No targets configured.');
    return;
  }
  const rows = [['ID', 'STATE', 'EVERY', 'CHECKED', 'CHANGED', 'SNAPS', 'URL']];
  for (const t of ctx.cfg.targets) {
    const d = describeTarget(t, store);
    rows.push([d.id, d.status, `${d.intervalSec}s`, ago(d.lastCheck), ago(d.lastChange), d.snapshots, d.url]);
  }
  console.log(table(rows));
  for (const t of ctx.cfg.targets) {
    const d = describeTarget(t, store);
    if (d.lastError) console.log(`! ${d.id}: ${d.lastError} (${d.fails}x, ${ago(d.lastErrorAt)})`);
  }
}

async function cmdStart() {
  const app = bootstrap();
  const { ctx, store, log, scheduler } = app;
  const startedAt = Date.now();
  scheduler.start();
  log.info(`watching ${ctx.cfg.targets.filter((t) => t.enabled).length} target(s), data in ${ctx.cfg.dataDir}`);
  let server = null;
  if (ctx.cfg.server.enabled) {
    server = createWatcherServer(ctx, store, scheduler, log, startedAt);
    server.on('error', (e) => {
      log.error(`dashboard failed to start: ${e.message}`);
      process.exit(1);
    });
    server.listen(ctx.cfg.server.port, ctx.cfg.server.host, () => {
      const auth = ctx.cfg.server.token ? ' (token required)' : '';
      log.info(`dashboard http://${ctx.cfg.server.host}:${ctx.cfg.server.port}/${auth}`);
    });
  }
  let lastMtime = statSync(configPath).mtimeMs;
  const poll = setInterval(() => {
    try {
      const m = statSync(configPath).mtimeMs;
      if (m === lastMtime) return;
      lastMtime = m;
      const next = normalizeConfig(readRaw(configPath), configPath);
      next.server = ctx.cfg.server;
      next.dataDir = ctx.cfg.dataDir;
      ctx.cfg = next;
      scheduler.reload();
      log.info(`config reloaded (${next.targets.length} targets)`);
    } catch (e) {
      log.error(`config reload failed, keeping previous config: ${errMsg(e)}`);
    }
  }, 5000);
  let closing = false;
  const shutdown = async (sig) => {
    if (closing) return;
    closing = true;
    log.info(`${sig} received, shutting down`);
    clearInterval(poll);
    if (server) {
      server.close();
      server.closeAllConnections?.();
    }
    await scheduler.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (e) => log.error(`unhandled rejection: ${errMsg(e)}`));
}

async function cmdOnce() {
  const { ctx, scheduler } = bootstrap();
  scheduler.stopped = true;
  const wanted = pos.length ? pos : ctx.cfg.targets.filter((t) => t.enabled).map((t) => t.id);
  for (const id of wanted) if (!scheduler.target(id)) throw new Error(`unknown target "${id}"`);
  if (!wanted.length) {
    console.log('No enabled targets.');
    return;
  }
  const results = await Promise.all(wanted.map((id) => scheduler.trigger(id).then((r) => [id, r])));
  let failed = 0;
  for (const [id, r] of results) {
    if (!r.ok) failed++;
    const text = !r.ok ? `FAILED ${r.error}` : r.changed ? `CHANGED ${r.summary}${r.meaningful ? '' : ' (below threshold)'}` : 'ok';
    console.log(`${id}: ${text}`);
  }
  process.exitCode = failed ? 1 : 0;
}

async function cmdStatus() {
  const app = bootstrap();
  printTargets(app);
  const logs = app.store.readLogs({ limit: 10, level: 'info' }).reverse();
  if (logs.length) console.log('\nRecent log:');
  for (const e of logs) console.log(`${e.ts} ${e.level.toUpperCase().padEnd(5)} ${e.target ? `[${e.target}] ` : ''}${e.msg}`);
}

function cmdAdd() {
  const [id, url] = pos;
  if (!id || !url) throw new Error('usage: add <id> <url> [--interval sec] [--type t] [--name n] [--path p] [--pattern re]');
  if (!ID_RE.test(id)) throw new Error('id may contain letters, digits, _ and - (max 64 chars)');
  const raw = existsSync(configPath) ? readRaw(configPath) : defaultRaw();
  raw.targets = Array.isArray(raw.targets) ? raw.targets : [];
  if (raw.targets.some((t) => t.id === id)) throw new Error(`target "${id}" already exists`);
  const t = { id, url };
  if (flags.name) t.name = String(flags.name);
  if (flags.interval) t.intervalSec = Number(flags.interval);
  if (flags.type) t.type = String(flags.type);
  if (flags.path) t.path = String(flags.path);
  if (flags.pattern) t.pattern = String(flags.pattern);
  raw.targets.push(t);
  normalizeConfig(raw, configPath);
  writeRaw(configPath, raw);
  console.log(`added "${id}" to ${configPath}`);
}

function cmdRemove() {
  const [id] = pos;
  if (!id) throw new Error('usage: remove <id> [--purge]');
  const raw = readRaw(configPath);
  const before = (raw.targets || []).length;
  raw.targets = (raw.targets || []).filter((t) => t.id !== id);
  if (raw.targets.length === before) throw new Error(`target "${id}" not found`);
  writeRaw(configPath, raw);
  if (flags.purge) new Store(normalizeConfig(raw, configPath).dataDir).purge(id);
  console.log(`removed "${id}"${flags.purge ? ' and its data' : ''}`);
}

async function cmdTestWebhook() {
  const { notifier, ctx } = bootstrap();
  if (!ctx.cfg.webhooks.some((w) => w.url)) throw new Error('no webhook with a url (set DISCORD_WEBHOOK_URL or webhooks[].url)');
  const results = await notifier.sendTest(pos[0]);
  if (!results.length) throw new Error(`no webhook named "${pos[0]}" with a url`);
  for (const r of results) console.log(`${r.name}: ${r.ok ? 'delivered' : 'FAILED'}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

try {
  if (cmd === 'help') console.log(HELP);
  else if (cmd === 'start') await cmdStart();
  else if (cmd === 'once') await cmdOnce();
  else if (cmd === 'list') printTargets(bootstrap());
  else if (cmd === 'status') await cmdStatus();
  else if (cmd === 'add') cmdAdd();
  else if (cmd === 'remove') cmdRemove();
  else if (cmd === 'test-webhook') await cmdTestWebhook();
  else throw new Error(`unknown command "${cmd}". Run: node src/index.js help`);
} catch (e) {
  console.error(`error: ${errMsg(e)}`);
  process.exit(1);
}
