import createDebug from 'debug';
import WebSocket from 'ws';

const debug = createDebug('mw:driver-saucelabs:io');

const WS_CLOSE_NORMAL = 1000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1_000;

export interface TouchPoint {
  x: number;
  y: number;
  index: number;
}

/** WebSocket connection to the Sauce Labs device I/O channel for sending touch and keyboard events and receiving MJPEG screen frames. */
export class DeviceControlSocket {
  private ws: WebSocket | null = null;
  private readonly authHeader: string;
  private capturing = false;
  private capturedFrames: { frame: Buffer; ts: number }[] = [];
  private captureEndTs = 0;
  private reconnectAttempts = 0;
  private closed = false;

  constructor(
    private readonly url: string,
    username: string,
    accessKey: string,
  ) {
    this.authHeader = `Basic ${Buffer.from(`${username}:${accessKey}`).toString('base64')}`;
  }

  /** Opens the WebSocket and resets reconnect state; auto-reconnects on unexpected disconnects. */
  async connect(): Promise<void> {
    this.closed = false;
    this.reconnectAttempts = 0;
    await this.openSocket();
  }

  /** Creates the underlying WebSocket, wires up event handlers, and resolves once the connection is open. */
  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, {
        headers: { Authorization: this.authHeader },
      });

      ws.on('open', () => {
        debug('device control socket connected');
        this.ws = ws;
        this.reconnectAttempts = 0;
        resolve();
      });

      ws.on('error', (err) => {
        debug('device control socket error: %s', err.message);
        if (!this.ws) {
          reject(new Error(`Device control socket failed to connect: ${err.message}`));
        }
      });

      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) {
          const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          if (this.capturing) {
            this.capturedFrames.push({ frame, ts: Date.now() });
          }
          // Always ack to keep the frame stream flowing
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('n/');
          }
        }
      });

      ws.on('close', (code: number) => {
        debug('device control socket closed (code=%d)', code);
        this.ws = null;
        if (!this.closed && code !== WS_CLOSE_NORMAL) {
          this.scheduleReconnect();
        }
      });
    });
  }

  /** Schedules a reconnect attempt with exponential backoff, up to MAX_RECONNECT_ATTEMPTS tries. */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      debug('device control socket: max reconnect attempts reached');
      return;
    }
    const delay = RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    debug('device control socket: reconnecting in %dms (attempt %d)', delay, this.reconnectAttempts);
    setTimeout(() => {
      if (!this.closed) {
        this.openSocket().catch((err) => {
          debug('reconnect failed: %s', err.message);
          this.scheduleReconnect();
        });
      }
    }, delay);
  }

  /** Closes the WebSocket with a normal close code so reconnect logic does not trigger. */
  disconnect(): Promise<void> {
    this.closed = true;
    const ws = this.ws;
    if (!ws) return Promise.resolve();
    this.ws = null;
    return new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close(WS_CLOSE_NORMAL);
    });
  }

  // ─── Touch ────────────────────────────────────────────────────────────────

  /** Sends a multi-touch action (down/move/up) with one or more contact points to the device. */
  sendTouch(
    action: 'd' | 'm' | 'u',
    points: TouchPoint[],
    canvasW: number,
    canvasH: number,
    orientation: 0 | 1,
  ): void {
    const touchCount = points.length;
    const parts: string[] = [`mt/${action}`, String(canvasW), String(canvasH), String(orientation), String(touchCount)];
    for (const p of points) {
      parts.push(String(p.index), String(Math.round(p.x)), String(Math.round(p.y)));
    }
    this.send(parts.join(' '));
  }

  /** Sends a keyboard event for the given key name through the device I/O channel. */
  sendKey(key: string): void {
    this.send(`tt/${key}`);
  }

  // ─── Recording ────────────────────────────────────────────────────────────

  /** Starts buffering incoming MJPEG frames for later video encoding. */
  startFrameCapture(): void {
    this.capturedFrames = [];
    this.captureEndTs = 0;
    this.capturing = true;
    debug('frame capture started');
  }

  /** Stops buffering frames and returns the captured set, clearing the internal buffer. */
  stopFrameCapture(): { frame: Buffer; ts: number }[] {
    this.capturing = false;
    this.captureEndTs = Date.now();
    const frames = this.capturedFrames;
    this.capturedFrames = [];
    debug('frame capture stopped, %d frames captured', frames.length);
    return frames;
  }

  /** Returns the wall-clock timestamp (ms) recorded when frame capture was stopped, used to compute video duration. */
  getCaptureEndTs(): number {
    return this.captureEndTs;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private send(msg: string): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Device control socket is not connected');
    }
    debug('send %s', msg);
    ws.send(msg);
  }
}
