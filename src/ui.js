/*
 * Copyright 2026 https://discord.gg/9prHNq3een
 * Do not claim this as your own property of watchme_134 ©
 * Discord server: LunarStudios https://discord.gg/9prHNq3een
 */
const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Web Watcher</title>
<style nonce="__NONCE__">
:root{--bg:#0f1115;--panel:#181b22;--line:#272b35;--fg:#e6e8ee;--mute:#8b93a7;--ok:#30a46c;--err:#e5484d;--warn:#f0a020;--run:#4c8dff;--add:#1c3a2a;--del:#43202a;--chg:#3b3320}
@media (prefers-color-scheme:light){:root{--bg:#f5f6f8;--panel:#fff;--line:#dfe2e8;--fg:#1b1e25;--mute:#667085;--add:#dff5e8;--del:#fde3e6;--chg:#fff0cf}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:2}
h1{font-size:16px;margin:0}
nav{display:flex;gap:6px}
nav a{padding:5px 12px;border-radius:6px;color:var(--mute);text-decoration:none}
nav a.on{background:var(--bg);color:var(--fg)}
#meta{margin-left:auto;color:var(--mute);font-size:12px}
main{max-width:1000px;margin:0 auto;padding:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.grow{flex:1;min-width:0}
.name{font-weight:600;font-size:15px}
.url{color:var(--mute);font-size:12px;overflow-wrap:anywhere}
.muted{color:var(--mute)}
.small{font-size:12px}
.badge{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:600;color:#fff;background:var(--mute)}
.badge.ok{background:var(--ok)}.badge.error{background:var(--err)}.badge.running{background:var(--run)}.badge.pending{background:var(--warn)}
button,select{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:5px 10px;font:inherit;cursor:pointer}
button:hover{border-color:var(--mute)}
button.pri{background:var(--run);border-color:var(--run);color:#fff}
.stats{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:12px;color:var(--mute)}
.stats b{color:var(--fg);font-weight:600}
.err{color:var(--err);font-size:12px;margin-top:6px;overflow-wrap:anywhere}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace}
.diff div{padding:1px 8px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace}
.diff .add{background:var(--add)}.diff .del{background:var(--del)}.diff .chg{background:var(--chg)}
.log{display:flex;gap:8px;padding:3px 0;border-bottom:1px solid var(--line);font:12px/1.5 ui-monospace,Menlo,Consolas,monospace}
.log .t{color:var(--mute);white-space:nowrap}
.log .l{width:44px;flex:none;font-weight:700}
.log .l.warn{color:var(--warn)}.log .l.error{color:var(--err)}.log .l.info{color:var(--run)}
.log .m{overflow-wrap:anywhere}
.tools{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center}
</style>
</head>
<body>
<header><h1>Web Watcher</h1><nav id="nav"></nav><span id="meta"></span></header>
<main id="app"></main>
<script nonce="__NONCE__">
(function () {
  var token = new URLSearchParams(location.search).get('token') || '';
  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var meta = document.getElementById('meta');
  var timer = null;
  var logState = { level: 'info', target: '' };

  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function api(path, method) {
    var headers = { 'x-watcher': '1' };
    if (token) headers.authorization = 'Bearer ' + token;
    return fetch(path, { method: method || 'GET', headers: headers, cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function ago(s) {
    if (!s) return '-';
    var d = Math.max(0, Math.round((Date.now() - Date.parse(s)) / 1000));
    if (d < 60) return d + 's ago';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  }
  function dur(sec) {
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.round(sec / 60) + 'm';
    if (sec < 86400) return (sec / 3600).toFixed(1) + 'h';
    return (sec / 86400).toFixed(1) + 'd';
  }
  function until(s) {
    if (!s) return '-';
    var d = Math.round((Date.parse(s) - Date.now()) / 1000);
    return d <= 0 ? 'now' : 'in ' + dur(d);
  }
  function fail(e) {
    app.replaceChildren(h('div', { class: 'card err' }, 'Request failed: ' + e.message + (e.message === 'HTTP 401' ? ' (add ?token=YOUR_TOKEN to the URL)' : '')));
  }
  function nav_(hash) {
    nav.replaceChildren(
      h('a', { href: '#/', class: hash === '#/' || hash.indexOf('#/t/') === 0 ? 'on' : '' }, 'Targets'),
      h('a', { href: '#/logs', class: hash === '#/logs' ? 'on' : '' }, 'Logs')
    );
  }
  function setMeta(s) {
    meta.textContent = 'up ' + dur(s.uptimeSec) + ' · ' + s.rssMB + ' MB · node ' + s.node;
  }

  function targetCard(t, detail) {
    var diff = t.lastDiff;
    return h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { class: 'name' }, t.name, ' ', h('span', { class: 'badge ' + t.status }, t.status)),
          h('div', { class: 'url' }, t.url)
        ),
        detail ? null : h('button', { onclick: function () { location.hash = '#/t/' + t.id; } }, 'Details'),
        h('button', { class: 'pri', onclick: function (ev) {
          ev.target.disabled = true;
          api('/api/targets/' + t.id + '/check', 'POST').then(function () {
            setTimeout(route, 2500);
          }).catch(fail);
        } }, 'Check now')
      ),
      h('div', { class: 'stats' },
        h('span', null, 'every ', h('b', null, dur(t.intervalSec))),
        h('span', null, 'checked ', h('b', null, ago(t.lastCheck))),
        h('span', null, 'next ', h('b', null, until(t.nextRunAt))),
        h('span', null, 'changed ', h('b', null, ago(t.lastChange))),
        h('span', null, 'changes ', h('b', null, t.changeCount)),
        h('span', null, 'snapshots ', h('b', null, t.snapshots)),
        t.lastMs != null ? h('span', null, 'last ', h('b', null, t.lastMs + 'ms')) : null,
        diff ? h('span', null, 'last diff ', h('b', null, '+' + diff.added + ' -' + diff.removed + ' ~' + diff.changed)) : null
      ),
      t.lastError ? h('div', { class: 'err' }, 'Error (' + t.fails + 'x, ' + ago(t.lastErrorAt) + '): ' + t.lastError) : null
    );
  }

  function viewTargets() {
    var list = h('div');
    app.replaceChildren(list);
    function load() {
      api('/api/status').then(function (s) {
        setMeta(s);
        var ok = s.targets.filter(function (t) { return t.status === 'ok'; }).length;
        var bad = s.targets.filter(function (t) { return t.status === 'error'; }).length;
        list.replaceChildren(
          h('p', { class: 'muted' }, s.targets.length + ' targets · ' + ok + ' ok · ' + bad + ' failing'),
          s.targets.length ? s.targets.map(function (t) { return targetCard(t, false); }) : h('div', { class: 'card muted' }, 'No targets configured. Edit config.json or run: node src/index.js add <id> <url>')
        );
      }).catch(fail);
    }
    load();
    timer = setInterval(load, 5000);
  }

  function renderDiff(box, r) {
    var d = r.diff;
    var head = h('p', { class: 'muted small' }, d.kind + ' diff · +' + d.added + ' -' + d.removed + ' ~' + d.changed + ' · ' + d.percent + '%' + (d.truncated ? ' · truncated' : ''));
    var body = h('div', { class: 'diff' });
    if (!d.entries.length) body.append(h('p', { class: 'muted' }, 'No differences.'));
    d.entries.forEach(function (e) {
      body.append(h('div', { class: e.op === '+' ? 'add' : e.op === '-' ? 'del' : 'chg' }, e.op + ' ' + e.text));
    });
    box.replaceChildren(head, body);
  }

  function viewTarget(id) {
    Promise.all([api('/api/status'), api('/api/targets/' + id + '/snapshots')]).then(function (r) {
      setMeta(r[0]);
      var t = r[0].targets.filter(function (x) { return x.id === id; })[0];
      var snaps = r[1].snapshots;
      if (!t) { app.replaceChildren(h('div', { class: 'card err' }, 'Unknown target: ' + id)); return; }
      var label = function (s) { return new Date(s.ts).toLocaleString() + ' · ' + s.hash.slice(0, 8) + ' · ' + s.bytes + ' B'; };
      var mk = function (sel) {
        var el = h('select');
        snaps.forEach(function (s, i) { el.append(h('option', { value: s.name, selected: i === sel ? 'selected' : false }, label(s))); });
        return el;
      };
      var to = mk(0);
      var from = mk(Math.min(1, snaps.length - 1));
      var out = h('div', { class: 'card' });
      function showDiff() {
        if (snaps.length < 2) { out.replaceChildren(h('p', { class: 'muted' }, 'Need at least two snapshots to diff.')); return; }
        api('/api/targets/' + id + '/diff?from=' + encodeURIComponent(from.value) + '&to=' + encodeURIComponent(to.value)).then(function (res) { renderDiff(out, res); }).catch(fail);
      }
      function showContent(sel) {
        api('/api/targets/' + id + '/snapshots/' + encodeURIComponent(sel.value)).then(function (res) {
          out.replaceChildren(h('p', { class: 'muted small' }, 'Snapshot ' + new Date(res.meta.ts).toLocaleString() + ' · ' + res.meta.kind), h('pre', null, res.content.slice(0, 200000)));
        }).catch(fail);
      }
      app.replaceChildren(
        h('p', null, h('a', { href: '#/' }, '← All targets')),
        targetCard(t, true),
        h('div', { class: 'card' },
          h('div', { class: 'tools' }, h('span', { class: 'muted' }, 'From'), from, h('span', { class: 'muted' }, 'To'), to),
          h('div', { class: 'tools' },
            h('button', { class: 'pri', onclick: showDiff }, 'Show diff'),
            h('button', { onclick: function () { showContent(to); } }, 'View "To" content'),
            h('button', { onclick: route }, 'Refresh')
          )
        ),
        out
      );
      showDiff();
    }).catch(fail);
  }

  function viewLogs() {
    var list = h('div', { class: 'card' });
    var lvl = h('select');
    ['debug', 'info', 'warn', 'error'].forEach(function (l) { lvl.append(h('option', { value: l, selected: l === logState.level ? 'selected' : false }, l + '+')); });
    var tgt = h('select', null, h('option', { value: '' }, 'all targets'));
    app.replaceChildren(h('div', { class: 'tools' }, lvl, tgt), list);
    api('/api/status').then(function (s) {
      setMeta(s);
      s.targets.forEach(function (t) { tgt.append(h('option', { value: t.id, selected: t.id === logState.target ? 'selected' : false }, t.name)); });
    }).catch(function () {});
    function load() {
      logState.level = lvl.value;
      logState.target = tgt.value;
      api('/api/logs?limit=300&level=' + encodeURIComponent(lvl.value) + '&target=' + encodeURIComponent(tgt.value)).then(function (r) {
        if (!r.logs.length) { list.replaceChildren(h('span', { class: 'muted' }, 'No log entries.')); return; }
        list.replaceChildren(r.logs.map(function (e) {
          return h('div', { class: 'log' },
            h('span', { class: 't' }, new Date(e.ts).toLocaleTimeString()),
            h('span', { class: 'l ' + e.level }, e.level.toUpperCase()),
            h('span', { class: 'm' }, (e.target ? '[' + e.target + '] ' : '') + e.msg)
          );
        }));
      }).catch(fail);
    }
    lvl.addEventListener('change', load);
    tgt.addEventListener('change', load);
    load();
    timer = setInterval(load, 5000);
  }

  function route() {
    clearInterval(timer);
    var hash = location.hash || '#/';
    nav_(hash);
    var m = /^#\/t\/([A-Za-z0-9_-]+)$/.exec(hash);
    if (hash === '#/logs') viewLogs();
    else if (m) viewTarget(m[1]);
    else viewTargets();
  }
  window.addEventListener('hashchange', route);
  route();
})();
</script>
</body>
</html>`;

export function renderPage(nonce) {
  return PAGE.replaceAll('__NONCE__', nonce);
}
