/**
 * mobilewright inspect
 *
 * Dumps the live accessibility tree from a connected device to the terminal.
 * Useful for figuring out which locator to use when writing tests — run it
 * with the app open on the screen you want to inspect.
 *
 * Pass --json to get raw ViewNode[] JSON suitable for piping to jq or saving
 * to a file for diffing between two app states.
 */
import { execSync } from 'node:child_process';
import { MobilecliDriver, DEFAULT_URL } from '@mobilewright/driver-mobilecli';
import type { ViewNode } from '@mobilewright/protocol';
import { ensureMobilecliReachable } from '../server.js';
import { loadConfig } from '../config.js';

// ─── Animation helpers ────────────────────────────────────────────────────────

const ANIMATION_SCALES = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'] as const;

function setAnimations(deviceId: string, value: 0 | 1): void {
  for (const scale of ANIMATION_SCALES) {
    execSync(`adb -s ${deviceId} shell settings put global ${scale} ${value}`);
  }
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
} as const;

// ─── Tree renderer ────────────────────────────────────────────────────────────

function renderNode(node: ViewNode, prefix: string, isLast: boolean): void {
  const connector   = isLast ? '└── ' : '├── ';
  const childPrefix = prefix + (isLast ? '    ' : '│   ');

  let line = `${C.gray}${prefix}${connector}${C.reset}`;
  line += `${C.cyan}${node.type}${C.reset}`;

  if (node.label)                            line += `  ${C.white}label=${JSON.stringify(node.label)}${C.reset}`;
  if (node.text && node.text !== node.label) line += `  ${C.white}"${node.text}"${C.reset}`;
  if (node.placeholder)                      line += `  ${C.dim}placeholder=${JSON.stringify(node.placeholder)}${C.reset}`;
  if (node.identifier)                       line += `  ${C.dim}id=${JSON.stringify(node.identifier)}${C.reset}`;

  line += node.isVisible
    ? `  ${C.green}[visible]${C.reset}`
    : `  ${C.gray}[hidden]${C.reset}`;

  process.stdout.write(line + '\n');

  const children = node.children ?? [];
  for (let i = 0; i < children.length; i++) {
    renderNode(children[i], childPrefix, i === children.length - 1);
  }
}

function renderTree(nodes: ViewNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    renderNode(nodes[i], '', i === nodes.length - 1);
  }
}

function countNodes(nodes: ViewNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countNodes(n.children ?? []), 0);
}

// ─── Device resolution ────────────────────────────────────────────────────────

async function resolveDeviceId(explicit: string | undefined, driver: MobilecliDriver): Promise<string> {
  if (explicit) return explicit;

  const config = await loadConfig();
  if (config.deviceId) return config.deviceId;

  const devices = await driver.listDevices();
  const online = devices.filter(d => d.state === 'online');

  if (online.length === 0) {
    console.error('No online devices found. Specify one with --device <id>, or try \'mobilewright doctor\'.');
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export interface InspectOptions {
  device?: string;
  url?: string;
  json?: boolean;
  disableAnimations?: boolean;
}

export async function runInspect(opts: InspectOptions): Promise<void> {
  const config = await loadConfig();
  const url = opts.url ?? DEFAULT_URL;
  const platform = config.platform ?? 'android';

  const { serverProcess } = await ensureMobilecliReachable(url, { autoStart: true });
  try {
    const driver = new MobilecliDriver({ url });
    const deviceId = await resolveDeviceId(opts.device, driver);

    if (opts.disableAnimations) {
      setAnimations(deviceId, 0);
    }

    await driver.connect({ platform, deviceId, url });
    let tree: Awaited<ReturnType<typeof driver.getViewHierarchy>>;
    try {
      tree = await driver.getViewHierarchy();
    } finally {
      await driver.disconnect();
      if (opts.disableAnimations) {
        setAnimations(deviceId, 1);
      }
    }

    if (opts.json) {
      console.log(JSON.stringify(tree, null, 2));
      return;
    }

    const total = countNodes(tree);
    const label = config.deviceName?.toString().replace(/^\/|\/$/g, '') ?? deviceId;
    console.log(`\n${C.bold}${label}${C.reset}  ${C.dim}${total} nodes${C.reset}\n`);
    renderTree(tree);
    console.log();
  } finally {
    if (serverProcess) await serverProcess.kill();
  }
}
