import createDebug from 'debug';
import WebSocket from 'ws';

const debug = createDebug('mw:driver-saucelabs:companion');

const WS_CLOSE_NORMAL = 1000;

type OrientationFinishHandler = (orientation: 'PORTRAIT' | 'LANDSCAPE') => void;

/** WebSocket connection to the Sauce Labs events channel, used to receive device lifecycle events such as orientation changes. */
export class CompanionSocket {
  private ws: WebSocket | null = null;
  private readonly authHeader: string;
  private orientationHandler: OrientationFinishHandler | null = null;

  constructor(
    private readonly url: string,
    username: string,
    accessKey: string,
  ) {
    this.authHeader = `Basic ${Buffer.from(`${username}:${accessKey}`).toString('base64')}`;
  }

  /** Opens the WebSocket and begins listening for device events. */
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, {
        headers: { Authorization: this.authHeader },
      });

      ws.on('open', () => {
        debug('companion socket connected');
        this.ws = ws;
        resolve();
      });

      ws.on('error', (err) => {
        debug('companion socket error: %s', err.message);
        if (!this.ws) {
          reject(new Error(`Companion socket failed to connect: ${err.message}`));
        }
      });

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data.toString());
      });

      ws.on('close', (code: number) => {
        debug('companion socket closed (code=%d)', code);
        this.ws = null;
      });
    });
  }

  /** Registers a callback that fires each time the device completes an orientation change. */
  onOrientationFinish(handler: OrientationFinishHandler): void {
    this.orientationHandler = handler;
  }

  /** Closes the WebSocket cleanly, preventing any further event delivery. */
  disconnect(): Promise<void> {
    const ws = this.ws;
    if (!ws) return Promise.resolve();
    this.ws = null;
    return new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close(WS_CLOSE_NORMAL);
    });
  }

  /** Parses an incoming JSON event and dispatches it to the appropriate handler. */
  private handleMessage(raw: string): void {
    let msg: { type?: string; value?: { orientation?: string } };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }

    debug('companion event %s', msg.type);

    if (msg.type === 'device.orientation.finish' && msg.value?.orientation) {
      const orientation = msg.value.orientation.toUpperCase() as 'PORTRAIT' | 'LANDSCAPE';
      this.orientationHandler?.(orientation);
    }
  }
}
