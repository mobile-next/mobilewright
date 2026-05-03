import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

const API_KEY = 'phc_tRCQcTgqMzKfs6WVQcuuH8MQgKdEXrVR8yLPRoM7TFyv';
const POSTHOG_URL = 'https://us.i.posthog.com/i/v0/e/';
const CONFIG_PATH = path.join(os.homedir(), '.config', 'mobilenext', 'mobilewright', 'config.json');

function getTelemetryId(): string | null {
  if (process.env.MOBILEWRIGHT_DISABLE_TELEMETRY) {
    return null;
  }

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const config = JSON.parse(raw) as { telemetryId?: string };
      if (config.telemetryId) {
        return config.telemetryId;
      }
    }

    const telemetryId = crypto.randomUUID();
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ telemetryId }, null, 2), 'utf8');
    return telemetryId;
  } catch {
    return null;
  }
}

export function telemetry(event: string, properties: Record<string, string> = {}): void {
  const distinct_id = getTelemetryId();
  if (!distinct_id) {
    return;
  }

  fetch(POSTHOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: API_KEY,
      event,
      distinct_id,
      properties: {
        Platform: os.platform(),
        Product: 'mobilewright',
        Version: _pkg.version,
        ...properties,
      },
    }),
  }).catch(() => {});
}
