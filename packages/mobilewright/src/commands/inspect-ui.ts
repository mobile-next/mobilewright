/**
 * mobilewright inspect --ui
 *
 * Serves an interactive browser UI that renders the live accessibility tree
 * from a connected device. Supports manual refresh and auto-refresh with a
 * configurable interval. Clicking a node shows its properties and ready-to-use
 * locator suggestions with a one-click copy button.
 *
 * Usage: npx mobilewright inspect --ui
 */
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { platform as osPlatform } from 'node:os';
import { MobilecliDriver, DEFAULT_URL } from '@mobilewright/driver-mobilecli';
import type { MobilewrightConfig } from '../config.js';
import { ensureMobilecliReachable } from '../server.js';
import { loadConfig } from '../config.js';

const PORT = 9325;

export interface InspectUIOptions {
  device?: string;
  url?: string;
}

// ─── Device resolution ────────────────────────────────────────────────────────

async function resolveDeviceId(
  explicit: string | undefined,
  driver: MobilecliDriver,
  config: MobilewrightConfig,
): Promise<string> {
  if (explicit) return explicit;
  if (config.deviceId) return config.deviceId;

  const devices = await driver.listDevices();
  const online = devices.filter(d => d.state === 'online');

  if (online.length === 0) {
    console.error("No online devices found. Specify one with --device <id>, or try 'mobilewright doctor'.");
    process.exit(1);
  }

  if (config.deviceName) {
    const pattern = config.deviceName instanceof RegExp
      ? config.deviceName
      : new RegExp(config.deviceName);
    const matched = online.filter(d => pattern.test(d.name));
    if (matched.length > 0) return matched[0].id;
  }

  if (online.length > 1) {
    console.error('Multiple devices found. Specify one with --device <id>:');
    for (const d of online) console.error(`  ${d.id}  ${d.name}`);
    process.exit(1);
  }

  return online[0].id;
}

// ─── Persistent device connection ────────────────────────────────────────────

function makeConnection(url: string, platform: 'ios' | 'android', deviceId: string) {
  let driver: MobilecliDriver | null = null;
  let connected = false;

  async function ensureConnected(): Promise<void> {
    if (!connected) {
      driver = new MobilecliDriver({ url });
      await driver.connect({ platform, deviceId, url });
      connected = true;
    }
  }

  async function getTree() {
    try {
      await ensureConnected();
      return await driver!.getViewHierarchy();
    } catch {
      connected = false;
      await ensureConnected();
      return await driver!.getViewHierarchy();
    }
  }

  async function disconnect(): Promise<void> {
    if (driver && connected) {
      await driver.disconnect().catch(() => {});
      connected = false;
    }
  }

  return { getTree, disconnect };
}

// ─── Browser open ─────────────────────────────────────────────────────────────

function openBrowser(url: string): void {
  const cmd = osPlatform() === 'win32' ? `start ${url}`
    : osPlatform() === 'darwin'        ? `open ${url}`
    : `xdg-open ${url}`;
  exec(cmd);
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>mobilewright inspect</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
      font-size: 13px;
      background: #1e1e2e;
      color: #cdd6f4;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: #181825;
      border-bottom: 1px solid #313244;
      flex-shrink: 0;
    }

    .brand { font-weight: 600; color: #cba6f7; letter-spacing: 0.02em; }

    .controls { display: flex; align-items: center; gap: 12px; }

    .controls label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      color: #a6adc8;
      user-select: none;
    }

    select, button {
      background: #313244;
      color: #cdd6f4;
      border: 1px solid #45475a;
      border-radius: 4px;
      padding: 4px 10px;
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
    }

    button:hover, select:hover { background: #45475a; }
    button:active { background: #585b70; }

    #status { font-size: 11px; color: #585b70; min-width: 160px; text-align: right; }

    main { display: flex; flex: 1; overflow: hidden; }

    #tree-panel {
      width: 55%;
      overflow-y: auto;
      border-right: 1px solid #313244;
      padding: 8px 0;
    }

    #detail-panel { flex: 1; overflow-y: auto; padding: 16px; }

    .node {
      display: flex;
      align-items: baseline;
      padding: 3px 0;
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      border-radius: 3px;
    }

    .node:hover  { background: #2a2a3d; }
    .node.active { background: #45475a; }

    .arrow { display: inline-block; width: 16px; flex-shrink: 0; color: #585b70; text-align: center; }
    .arrow.open { color: #a6adc8; }

    .type { color: #89b4fa; }
    .lbl  { color: #a6e3a1; }
    .txt  { color: #f9e2af; }
    .ph   { color: #585b70; }
    .sep  { color: #45475a; margin: 0 5px; }
    .vis  { color: #a6e3a1; font-size: 11px; }
    .hid  { color: #585b70; font-size: 11px; }

    .empty { color: #585b70; text-align: center; margin-top: 60px; line-height: 1.8; }

    .detail-type {
      font-size: 15px;
      font-weight: 600;
      color: #89b4fa;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid #313244;
    }

    table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
    td { padding: 4px 0; vertical-align: top; }
    td:first-child { color: #a6adc8; width: 110px; padding-right: 12px; white-space: nowrap; }

    .section-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #45475a;
      margin: 4px 0 8px;
    }

    .loc-row {
      display: flex;
      align-items: center;
      background: #181825;
      border: 1px solid #313244;
      border-radius: 4px;
      padding: 7px 10px;
      margin-bottom: 6px;
      gap: 10px;
    }

    .loc-code { color: #cba6f7; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .copy-btn { flex-shrink: 0; padding: 3px 10px; font-size: 11px; }
    .copy-btn.ok { color: #a6e3a1; border-color: #a6e3a1; }
  </style>
</head>
<body>
  <header>
    <span class="brand">mobilewright inspect</span>
    <div class="controls">
      <label><input type="checkbox" id="autoToggle"> Auto-refresh</label>
      <select id="intervalSel">
        <option value="1000">1s</option>
        <option value="2000" selected>2s</option>
        <option value="5000">5s</option>
        <option value="10000">10s</option>
      </select>
      <button id="refreshBtn">Refresh</button>
      <span id="status"></span>
    </div>
  </header>
  <main>
    <div id="tree-panel"></div>
    <div id="detail-panel"><p class="empty">Click a node to inspect it</p></div>
  </main>
<script>
  let tree = [], selectedPath = null;
  const expanded = new Set();

  async function fetchTree() {
    setStatus('Refreshing…');
    try {
      const res = await fetch('/api/tree');
      if (!res.ok) throw new Error(res.statusText);
      tree = await res.json();
      renderTree();
      setStatus('Updated ' + new Date().toLocaleTimeString());
    } catch (e) { setStatus('Error: ' + e.message); }
  }

  function setStatus(msg) { document.getElementById('status').textContent = msg; }

  let timer = null;
  document.getElementById('autoToggle').addEventListener('change', e => e.target.checked ? startAuto() : stopAuto());
  document.getElementById('intervalSel').addEventListener('change', () => {
    if (document.getElementById('autoToggle').checked) { stopAuto(); startAuto(); }
  });
  document.getElementById('refreshBtn').addEventListener('click', fetchTree);
  function startAuto() { timer = setInterval(fetchTree, Number(document.getElementById('intervalSel').value)); }
  function stopAuto()  { clearInterval(timer); timer = null; }

  function renderTree() {
    const panel = document.getElementById('tree-panel');
    const frag = document.createDocumentFragment();
    renderNodes(tree, frag, [], 0);
    panel.replaceChildren(frag);
    if (selectedPath) {
      const el = panel.querySelector('[data-path="' + CSS.escape(selectedPath) + '"]');
      if (el) el.classList.add('active');
    }
  }

  function renderNodes(nodes, parent, pathParts, depth) {
    nodes.forEach((node, i) => {
      const path = [...pathParts, i].join('.');
      const hasKids = node.children && node.children.length > 0;
      const isOpen  = expanded.has(path);

      const row = document.createElement('div');
      row.className = 'node';
      row.dataset.path = path;
      row.style.paddingLeft = (depth * 16 + 8) + 'px';

      const arrow = document.createElement('span');
      arrow.className = 'arrow' + (isOpen ? ' open' : '');
      arrow.textContent = hasKids ? (isOpen ? '▾' : '▸') : ' ';
      row.appendChild(arrow);

      const typeEl = document.createElement('span');
      typeEl.className = 'type';
      typeEl.textContent = node.type;
      row.appendChild(typeEl);

      const addProp = (cls, text) => { row.appendChild(sep()); const s = document.createElement('span'); s.className = cls; s.textContent = text; row.appendChild(s); };
      if (node.label)                            addProp('lbl', 'label="' + node.label + '"');
      if (node.text && node.text !== node.label) addProp('txt', '"' + node.text + '"');
      if (node.placeholder)                      addProp('ph',  'placeholder="' + node.placeholder + '"');

      row.appendChild(sep());
      const visEl = document.createElement('span');
      visEl.className = node.isVisible ? 'vis' : 'hid';
      visEl.textContent = node.isVisible ? 'visible' : 'hidden';
      row.appendChild(visEl);

      row.addEventListener('click', e => {
        if (e.target === arrow && hasKids) { isOpen ? expanded.delete(path) : expanded.add(path); renderTree(); return; }
        selectedPath = path;
        document.querySelectorAll('.node.active').forEach(n => n.classList.remove('active'));
        row.classList.add('active');
        renderDetail(node);
      });

      parent.appendChild(row);
      if (hasKids && isOpen) renderNodes(node.children, parent, [...pathParts, i], depth + 1);
    });
  }

  function sep() { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '\xb7'; return s; }

  function renderDetail(node) {
    const panel = document.getElementById('detail-panel');
    panel.innerHTML = '';

    const h = document.createElement('div'); h.className = 'detail-type'; h.textContent = node.type; panel.appendChild(h);

    const props = [
      node.label       && ['label',       node.label],
      node.text        && ['text',         node.text],
      node.placeholder && ['placeholder', node.placeholder],
      node.identifier  && ['identifier',  node.identifier],
      node.resourceId  && ['resourceId',  node.resourceId],
      ['visible', node.isVisible ? 'true' : 'false'],
      ['enabled', node.isEnabled ? 'true' : 'false'],
      node.isChecked !== undefined && ['checked', String(node.isChecked)],
      node.bounds && ['bounds', 'x:' + node.bounds.x + ' y:' + node.bounds.y + ' ' + node.bounds.width + '\xd7' + node.bounds.height],
    ].filter(Boolean);

    const table = document.createElement('table');
    props.forEach(([k, v]) => { const tr = table.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; });
    panel.appendChild(table);

    const locators = suggestLocators(node);
    if (locators.length) {
      const lbl = document.createElement('div'); lbl.className = 'section-label'; lbl.textContent = 'Locators'; panel.appendChild(lbl);
      locators.forEach(code => {
        const row = document.createElement('div'); row.className = 'loc-row';
        const codeEl = document.createElement('span'); codeEl.className = 'loc-code'; codeEl.textContent = code;
        const btn = document.createElement('button'); btn.className = 'copy-btn'; btn.textContent = 'Copy';
        btn.addEventListener('click', () => navigator.clipboard.writeText(code).then(() => {
          btn.textContent = 'Copied!'; btn.classList.add('ok');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 1500);
        }));
        row.appendChild(codeEl); row.appendChild(btn); panel.appendChild(row);
      });
    }
  }

  function suggestLocators(node) {
    const out = [];
    if (node.label)       out.push('screen.getByLabel(' + JSON.stringify(node.label) + ')');
    if (node.text)        out.push('screen.getByText(' + JSON.stringify(node.text) + ')');
    if (node.placeholder) out.push('screen.getByPlaceholder(' + JSON.stringify(node.placeholder) + ')');
    if (node.identifier)  out.push('screen.getByTestId(' + JSON.stringify(node.identifier) + ')');
    if (node.resourceId)  out.push('screen.getByTestId(' + JSON.stringify(node.resourceId) + ')');
    out.push('screen.getByType(' + JSON.stringify(node.type) + ')');
    return out;
  }

  fetchTree();
</script>
</body>
</html>`;

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runInspectUI(opts: InspectUIOptions): Promise<void> {
  const config = await loadConfig();
  const url = opts.url ?? DEFAULT_URL;
  const platform = (config.platform ?? 'android') as 'ios' | 'android';

  const { serverProcess } = await ensureMobilecliReachable(url, { autoStart: true });

  const driver = new MobilecliDriver({ url });
  const deviceId = await resolveDeviceId(opts.device, driver, config);
  const conn = makeConnection(url, platform, deviceId);

  const httpServer = createServer(async (req, res) => {
    if (req.url === '/api/tree') {
      try {
        const tree = await conn.getTree();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tree));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
    }
  });

  httpServer.listen(PORT, () => {
    const inspectUrl = `http://localhost:${PORT}`;
    console.log(`\nInspector running at ${inspectUrl}\n`);
    console.log('Press Ctrl+C to stop.\n');
    openBrowser(inspectUrl);
  });

  process.on('SIGINT', async () => {
    httpServer.close();
    await conn.disconnect();
    if (serverProcess) await serverProcess.kill();
    process.exit(0);
  });
}
