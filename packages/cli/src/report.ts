import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const WORKSPACE_DIR = '.mobilewright-cli';

export interface Report {
  /** Mobilewright test code equivalent to what just ran. */
  code?: string;
  /** Free-form result text (find matches, saved paths, ...). */
  result?: string;
  deviceId?: string;
  app?: string;
  snapshotPath?: string;
  /** Inline snapshot text (the `snapshot` command prints it instead of linking a file). */
  snapshotText?: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Write a snapshot into the workspace dir and return its path relative to cwd. */
export function writeSnapshotFile(text: string): string {
  const dir = join(process.cwd(), WORKSPACE_DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `screen-${timestamp()}.yml`);
  writeFileSync(path, text + '\n');
  return relative(process.cwd(), path);
}

export function videoPath(): string {
  return join(WORKSPACE_DIR, `video-${timestamp()}.mp4`);
}

/** Playwright-CLI-style sections: code, result, device, snapshot. */
export function formatReport(report: Report): string {
  const sections: string[] = [];
  if (report.code) {
    sections.push('### Ran Mobilewright code', '```js', report.code, '```');
  }
  if (report.result) {
    sections.push('### Result', report.result);
  }
  if (report.deviceId) {
    sections.push('### Device', `- Device ID: ${report.deviceId}`, `- App: ${report.app ?? 'unknown'}`);
  }
  if (report.snapshotText !== undefined) {
    sections.push('### Snapshot', '```yaml', report.snapshotText, '```');
  } else if (report.snapshotPath) {
    sections.push('### Snapshot', `- [Snapshot](${report.snapshotPath})`);
  }
  return sections.join('\n');
}
