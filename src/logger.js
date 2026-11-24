/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
import { LEVELS } from './store.js';
import { truncate } from './util.js';

export function createLogger(store, consoleLevel = process.env.WATCHER_LOG_LEVEL || 'info') {
  const min = LEVELS[consoleLevel] ?? LEVELS.info;

  function write(level, message, target) {
    const msg = truncate(String(message).replace(/\s+/g, ' ').trim(), 500);
    const ts = new Date().toISOString();
    if (LEVELS[level] >= min) {
      const line = `${ts} ${level.toUpperCase().padEnd(5)} ${target ? `[${target}] ` : ''}${msg}`;
      if (LEVELS[level] >= LEVELS.warn) console.error(line);
      else console.log(line);
    }
    if (store && LEVELS[level] >= LEVELS.info) {
      try {
        store.appendLog({ ts, level, target: target || null, msg });
      } catch {
        return;
      }
    }
  }

  return {
    debug: (m, t) => write('debug', m, t),
    info: (m, t) => write('info', m, t),
    warn: (m, t) => write('warn', m, t),
    error: (m, t) => write('error', m, t)
  };
}
