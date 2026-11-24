# web-watcher

Zero-dependency Node.js web/API change watcher. Polls URLs on a schedule, diffs against stored snapshots, fires webhooks (Discord, Slack, generic JSON) on meaningful changes, and serves a local dashboard over native `http`. File-based storage, roughly 60-70 MB RSS on Node 22 (mostly the Node runtime itself).

Requires Node >= 18.17. No `npm install` needed.

## Layout

```
web-watcher/
├── package.json
├── config.json
├── README.md
├── deploy/web-watcher.service
└── src/
    ├── index.js       CLI + start/shutdown + config hot-reload
    ├── config.js      load, validate, normalize
    ├── scheduler.js   per-target timers, concurrency, backoff, check pipeline
    ├── fetcher.js     fetch with timeout, size cap, ETag/Last-Modified
    ├── normalize.js   JSON path/ignoreKeys, HTML to text, regex extract
    ├── differ.js      line diff (LCS) and structural JSON diff
    ├── notifier.js    Discord / Slack / generic webhooks with retry
    ├── store.js       state.json, snapshots, rotating JSONL log
    ├── logger.js
    ├── server.js      dashboard + JSON API
    └── ui.js          single-page dashboard
```

## Setup

```bash
cd web-watcher
node -v
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/ID/TOKEN"
node src/index.js test-webhook
node src/index.js once
npm start
```

Dashboard: http://127.0.0.1:8787/

## Termux

```bash
pkg update && pkg install nodejs-lts tmux
termux-wake-lock
tmux new -s watcher
cd web-watcher && npm start
```

Detach with `Ctrl-b d`.

## VPS (systemd)

```bash
sudo useradd -r -s /usr/sbin/nologin watcher
sudo cp -r web-watcher /opt/web-watcher
sudo mkdir -p /opt/web-watcher/data
sudo chown -R watcher /opt/web-watcher/data /opt/web-watcher/config.json
echo 'DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/ID/TOKEN' | sudo tee /opt/web-watcher/.env
sudo chmod 600 /opt/web-watcher/.env
sudo cp /opt/web-watcher/deploy/web-watcher.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now web-watcher
journalctl -u web-watcher -f
```

To expose the dashboard, set `server.host` to `0.0.0.0` and always set `server.token` (or `WATCHER_TOKEN`); open `/?token=YOUR_TOKEN`. Prefer an SSH tunnel or reverse proxy with TLS.

## CLI

```
node src/index.js start [--no-ui] [--port N] [--host ADDR]
node src/index.js once [id...]
node src/index.js list
node src/index.js status
node src/index.js add <id> <url> [--interval 300] [--type json] [--path a.b[0]] [--pattern REGEX] [--name TEXT]
node src/index.js remove <id> [--purge]
node src/index.js test-webhook [name]
```

`start` hot-reloads `config.json` every 5 seconds (server host/port/token need a restart). Use the dashboard's "Check now" instead of `once` while the daemon runs.

## Config reference

Top level: `dataDir`, `concurrency` (1-8), `userAgent`, `server {enabled, host, port, token}`, `defaults`, `webhooks[]`, `targets[]`.

Webhook: `name`, `type` (`discord` | `slack` | `generic`), `url` or `urlEnv`, `username`, `avatarUrl`, `mention` (Discord, e.g. `<@&ROLE_ID>`), `events` (`change`, `failure`, `recovery`).

Target:

| Key | Default | Meaning |
|---|---|---|
| `id`, `name`, `url` | required / id / required | `${ENV_VAR}` is expanded in url, headers, body |
| `enabled` | true | |
| `type` | `auto` | `json`, `html`, `text` |
| `method`, `headers`, `body` | GET | POST body may be a string or object |
| `intervalSec` | 300 | 10 to 604800 |
| `timeoutSec` | 20 | |
| `maxBytes` | 2000000 | response cap |
| `path` | | JSON extraction, e.g. `data.items[0]` |
| `ignoreKeys` | [] | JSON keys removed at any depth (timestamps, counters) |
| `raw` | false | html: skip tag stripping |
| `ignore` | [] | regex strings removed before diffing |
| `pattern`, `patternFlags` | | regex extraction; capture group 1 if present |
| `sortLines`, `allowEmpty` | false | |
| `minChangedLines` | 1 | below this, change is stored but not alerted |
| `minChangePercent` | 0 | same, as percent of content |
| `alertPattern` | | regex; alert only if a changed line matches |
| `cooldownSec` | 0 | minimum gap between change alerts |
| `failureThreshold` | 3 | consecutive failures before a failure alert |
| `keepSnapshots` | 25 | retention |
| `notify` | all | restrict to webhook names |
| `conditional` | true | send If-None-Match / If-Modified-Since |

Failed checks back off exponentially (capped at 1 hour or the interval). A recovery alert is sent after a failure alert once the target succeeds again.

## Data

```
data/state.json            per-target status
data/logs.jsonl            rotating log (1 MB cap)
data/snapshots/<id>/*.snap first line JSON meta, rest is normalized content
```

## Contributing

Issues and pull requests are welcome. Keep it dependency-free and low-footprint. Questions and support: LunarStudios Discord, https://discord.gg/9prHNq3een

## License

MIT, see `LICENSE`. Keep the copyright notice and the file headers when you fork or redistribute.

## API

`GET /api/health`, `/api/status`, `/api/logs?limit=&level=&target=`, `/api/targets/:id/snapshots`, `/api/targets/:id/snapshots/:name`, `/api/targets/:id/diff?from=&to=`, `POST /api/targets/:id/check` (requires header `x-watcher: 1`). With a token set, send `Authorization: Bearer TOKEN` or `?token=`.
