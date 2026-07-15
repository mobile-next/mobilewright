import createDebug from 'debug';
import type { AppInfo, ViewNode } from '@mobilewright/protocol';
import type { RestClient, CheckWebDriverAgentStatusResponse } from './rest-client.js';
import { DEFAULT_WDA_BUNDLE_ID } from './rest-client.js';

const debug = createDebug('mw:driver-saucelabs:wda');

const WDA_POLL_INTERVAL_MS = 2_000;
const WDA_READY_TIMEOUT_MS = 120_000;

interface WdaSessionResponse {
  sessionId?: string;
  value?: { sessionId?: string };
}

interface WdaSourceResponse {
  value?: string;
}

interface WdaActiveAppResponse {
  value?: {
    bundleId?: string;
    name?: string;
  };
}

interface WdaAppsListResponse {
  value?: Array<{ bundleId?: string; name?: string }>;
}

function parseXmlViewNode(xml: string): ViewNode[] {
  // Minimal XML attribute parser — avoids a heavyweight XML dependency.
  const root: ViewNode[] = [];
  const stack: ViewNode[][] = [root];

  const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9_]*)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(xml)) !== null) {
    const [, closing, tag, attrsRaw] = match;

    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const attrs = parseAttrs(attrsRaw);
    const isSelfClosing = attrsRaw.trimEnd().endsWith('/');

    const x = Number(attrs['x'] ?? 0);
    const y = Number(attrs['y'] ?? 0);
    const w = Number(attrs['width'] ?? attrs['bounds_width'] ?? 0);
    const h = Number(attrs['height'] ?? attrs['bounds_height'] ?? 0);

    const node: ViewNode = {
      type: tag,
      label: attrs['label'] || attrs['name'] || undefined,
      identifier: attrs['name'] || undefined,
      value: attrs['value'] || undefined,
      text: attrs['label'] || undefined,
      placeholder: attrs['placeholderValue'] || undefined,
      isVisible: attrs['visible'] !== 'false',
      isEnabled: attrs['enabled'] !== 'false',
      bounds: { x, y, width: w, height: h },
      children: [],
      raw: { ...attrs },
    };

    const parent = stack[stack.length - 1];
    parent.push(node);

    if (!isSelfClosing) {
      stack.push(node.children);
    }
  }

  return root;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w[\w-]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

/** Manages the WebDriverAgent session on an iOS device, providing view hierarchy, app control, and button press capabilities. */
export class WdaClient {
  private wdaSessionId: string | null = null;
  private wdaHost: string | null = null;
  private wdaPort: number | null = null;
  private initialised = false;

  constructor(
    private readonly rest: RestClient,
    private readonly sessionId: string,
    private readonly wdaBundleId?: string,
    private readonly wdaStorageRef?: string,
  ) {}

  /** Installs and starts WDA if not already running, polls until it is RUNNING, then opens a WebDriver session — retrying the session until WDA accepts connections. */
  private async ensureInitialised(): Promise<void> {
    if (this.initialised) return;

    // A prior WdaClient attached to the same Sauce Labs session (e.g. an earlier test
    // reusing this session via the device pool) may have already launched WDA. The
    // runner process outlives that client's own close() — which only tears down its
    // WebDriver session, not the process — so re-launching here would 409 ("WDARunner
    // already started"). Check current status first and skip launching if it's already up.
    const existingStatus = await this.rest.checkWebDriverAgentStatus(this.sessionId).catch(() => undefined);
    if (existingStatus?.state === 'RUNNING' && existingStatus.devicePort) {
      debug('WDA already running on port %d, skipping launch', existingStatus.devicePort);
      this.wdaHost = 'localhost';
      this.wdaPort = existingStatus.devicePort;
    } else {
      debug('launching WDA wdaBundleId=%s wdaStorageRef=%s', this.wdaBundleId, this.wdaStorageRef);
      if (this.wdaStorageRef) {
        await this.rest.installApp(this.sessionId, this.wdaStorageRef, { launchAfterInstall: true });
        await this.rest.launchWebDriverAgent(this.sessionId, {
          bundleId: this.wdaBundleId ?? DEFAULT_WDA_BUNDLE_ID,
        });
      } else {
        await this.rest.launchWebDriverAgent(this.sessionId, { bundleId: this.wdaBundleId });
      }

      const deadline = Date.now() + WDA_READY_TIMEOUT_MS;
      let lastStatus: CheckWebDriverAgentStatusResponse | undefined;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, WDA_POLL_INTERVAL_MS));
        lastStatus = await this.rest.checkWebDriverAgentStatus(this.sessionId);
        debug('WDA status: %j', lastStatus);
        if (lastStatus.state === 'RUNNING' && lastStatus.devicePort) {
          this.wdaHost = 'localhost';
          this.wdaPort = lastStatus.devicePort;
          break;
        }
      }

      if (!this.wdaHost || !this.wdaPort) {
        throw new Error(`Timed out waiting for WDA to become RUNNING (last status: ${JSON.stringify(lastStatus)})`);
      }
    }

    const deadline = Date.now() + WDA_READY_TIMEOUT_MS;

    // WDA may not yet accept connections immediately after reaching RUNNING.
    // Retry POST /session until it succeeds or the deadline is hit.
    let resp: WdaSessionResponse | undefined;
    let lastError: Error | undefined;
    while (Date.now() < deadline) {
      try {
        resp = await this.proxy<WdaSessionResponse>('POST', '/session', { capabilities: {} });
        break;
      } catch (err) {
        lastError = err as Error;
        debug('WDA session attempt failed: %s', lastError.message);
        await new Promise((r) => setTimeout(r, WDA_POLL_INTERVAL_MS));
      }
    }

    if (!resp) {
      throw new Error(`Timed out waiting for WDA to accept connections: ${lastError?.message}`);
    }

    const wdaSessionId = resp.sessionId ?? resp.value?.sessionId;
    if (!wdaSessionId) throw new Error(`WDA session response missing sessionId: ${JSON.stringify(resp)}`);
    this.wdaSessionId = wdaSessionId;
    this.initialised = true;
    debug('WDA session created: %s', wdaSessionId);
    return;
  }

  /** Deletes the WDA WebDriver session, freeing resources on the device. */
  async close(): Promise<void> {
    if (!this.initialised || !this.wdaSessionId) return;
    try {
      await this.proxy('DELETE', `/session/${this.wdaSessionId}`, undefined);
    } catch (err) {
      debug('WDA session close error: %s', (err as Error).message);
    }
    this.wdaSessionId = null;
    this.initialised = false;
  }

  /** Returns the iOS view hierarchy as a tree of ViewNodes parsed from WDA's XML page source. */
  async getSource(): Promise<ViewNode[]> {
    await this.ensureInitialised();
    const resp = await this.proxy<WdaSourceResponse>('GET', `/session/${this.wdaSessionId}/source`, undefined);
    const xml = resp?.value ?? '';
    return parseXmlViewNode(xml);
  }

  /** Returns the bundle ID and name of the app currently in the foreground. */
  async getActiveAppInfo(): Promise<AppInfo> {
    await this.ensureInitialised();
    const resp = await this.proxy<WdaActiveAppResponse>('GET', `/session/${this.wdaSessionId}/wda/activeAppInfo`, undefined);
    return {
      bundleId: resp?.value?.bundleId ?? '',
      name: resp?.value?.name,
    };
  }

  /** Returns the list of apps currently running on the device according to WDA. */
  async listApps(): Promise<AppInfo[]> {
    await this.ensureInitialised();
    const resp = await this.proxy<WdaAppsListResponse>('GET', `/session/${this.wdaSessionId}/wda/apps/list`, undefined);
    const apps = resp?.value ?? [];
    return apps.map((a) => ({ bundleId: a.bundleId ?? '', name: a.name }));
  }

  /** Force-terminates a running app by its bundle ID. */
  async terminateApp(bundleId: string): Promise<void> {
    await this.ensureInitialised();
    await this.proxy('POST', `/session/${this.wdaSessionId}/wda/apps/terminate`, { bundleId });
  }

  /** Sends a hardware button press (e.g. volumeUp, volumeDown, power) through WDA. */
  async pressButton(name: string): Promise<void> {
    await this.ensureInitialised();
    await this.proxy('POST', `/session/${this.wdaSessionId}/wda/pressButton`, { name });
  }

  /** Sets the text value of a UI element by its WDA element ID. */
  async setValue(elementId: string, text: string): Promise<void> {
    await this.ensureInitialised();
    await this.proxy('POST', `/session/${this.wdaSessionId}/element/${elementId}/value`, { value: [text] });
  }

  private proxy<T = unknown>(method: string, wdaPath: string, body: unknown): Promise<T> {
    return this.rest.wdaRequest<T>(
      this.sessionId,
      method,
      this.wdaHost!,
      this.wdaPort!,
      wdaPath,
      body,
    );
  }
}
