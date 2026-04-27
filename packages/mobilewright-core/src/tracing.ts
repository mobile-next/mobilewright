import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import yazl from 'yazl';
import type { MobilewrightDriver } from '@mobilewright/protocol';

// ─── Playwright-compatible trace event types ────────────────────

interface ContextOptionsEvent {
  version: number;
  type: 'context-options';
  origin: 'testRunner';
  browserName: string;
  platform: string;
  wallTime: number;
  monotonicTime: number;
  options: Record<string, unknown>;
  sdkLanguage: string;
  title?: string;
}

interface BeforeActionEvent {
  type: 'before';
  callId: string;
  startTime: number;
  class: string;
  method: string;
  params: Record<string, unknown>;
  stepId?: string;
  parentId?: string;
  stack?: StackFrame[];
}

interface AfterActionEvent {
  type: 'after';
  callId: string;
  endTime: number;
  error?: { message: string; stack?: string };
  attachments?: TraceAttachment[];
}

interface ScreencastFrameEvent {
  type: 'screencast-frame';
  pageId: string;
  sha1: string;
  width: number;
  height: number;
  timestamp: number;
  frameSwapWallTime?: number;
}

interface ErrorEvent {
  type: 'error';
  message: string;
  stack?: StackFrame[];
}

interface StackFrame {
  file: string;
  line: number;
  column: number;
  function: string;
}

interface TraceAttachment {
  name: string;
  contentType: string;
  sha1?: string;
  base64?: string;
}

type TraceEvent =
  | ContextOptionsEvent
  | BeforeActionEvent
  | AfterActionEvent
  | ScreencastFrameEvent
  | ErrorEvent;

// ─── Tracer ─────────────────────────────────────────────────────

export class Tracer {
  private events: TraceEvent[] = [];
  private resources: Map<string, Buffer> = new Map();
  private callCounter = 0;
  private startMonotonic: number;
  private driver: MobilewrightDriver | null = null;

  constructor() {
    this.startMonotonic = Date.now();

    this.events.push({
      version: 8,
      type: 'context-options',
      origin: 'testRunner',
      browserName: '',
      platform: process.platform,
      wallTime: Date.now(),
      monotonicTime: 0,
      options: {},
      sdkLanguage: 'javascript',
    });
  }

  setDriver(driver: MobilewrightDriver): void {
    this.driver = driver;
  }

  private monotonicTime(): number {
    return Date.now() - this.startMonotonic;
  }

  private nextCallId(): string {
    return `call@${++this.callCounter}`;
  }

  private sha1(data: Buffer): string {
    return createHash('sha1').update(data).digest('hex');
  }

  private addResource(data: Buffer): string {
    const hash = this.sha1(data);
    if (!this.resources.has(hash)) {
      this.resources.set(hash, data);
    }
    return hash;
  }

  private async captureScreenshot(): Promise<{ sha1: string; width: number; height: number } | null> {
    if (!this.driver) {
      return null;
    }

    try {
      const screenshot = await this.driver.screenshot();
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(screenshot).metadata();
      const sha1 = this.addResource(screenshot);

      return {
        sha1,
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
      };
    } catch {
      return null;
    }
  }

  private captureStack(): StackFrame[] {
    const err = new Error();
    const rawStack = err.stack?.split('\n').slice(3) ?? [];
    const frames: StackFrame[] = [];

    for (const line of rawStack) {
      const match = line.match(/at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?/);
      if (match) {
        frames.push({
          function: match[1] ?? '<anonymous>',
          file: match[2],
          line: parseInt(match[3], 10),
          column: parseInt(match[4], 10),
        });
      }
    }

    return frames;
  }

  async wrapAction<T>(
    className: string,
    method: string,
    params: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const callId = this.nextCallId();
    const stack = this.captureStack();

    // Before screenshot
    const beforeScreenshot = await this.captureScreenshot();
    if (beforeScreenshot) {
      this.events.push({
        type: 'screencast-frame',
        pageId: 'device@1',
        sha1: beforeScreenshot.sha1,
        width: beforeScreenshot.width,
        height: beforeScreenshot.height,
        timestamp: this.monotonicTime(),
        frameSwapWallTime: Date.now(),
      });
    }

    // Before event
    this.events.push({
      type: 'before',
      callId,
      startTime: this.monotonicTime(),
      class: className,
      method,
      params,
      stack,
    });

    try {
      const result = await fn();

      // After screenshot
      const afterScreenshot = await this.captureScreenshot();
      if (afterScreenshot) {
        this.events.push({
          type: 'screencast-frame',
          pageId: 'device@1',
          sha1: afterScreenshot.sha1,
          width: afterScreenshot.width,
          height: afterScreenshot.height,
          timestamp: this.monotonicTime(),
          frameSwapWallTime: Date.now(),
        });
      }

      // After event
      this.events.push({
        type: 'after',
        callId,
        endTime: this.monotonicTime(),
      });

      return result;
    } catch (error) {
      // After screenshot on failure
      const errorScreenshot = await this.captureScreenshot();
      if (errorScreenshot) {
        this.events.push({
          type: 'screencast-frame',
          pageId: 'device@1',
          sha1: errorScreenshot.sha1,
          width: errorScreenshot.width,
          height: errorScreenshot.height,
          timestamp: this.monotonicTime(),
          frameSwapWallTime: Date.now(),
        });
      }

      const err = error instanceof Error ? error : new Error(String(error));

      this.events.push({
        type: 'after',
        callId,
        endTime: this.monotonicTime(),
        error: {
          message: err.message,
          stack: err.stack,
        },
      });

      throw error;
    }
  }

  async save(outputPath: string): Promise<void> {
    await mkdir(dirname(outputPath), { recursive: true });

    const zipFile = new yazl.ZipFile();

    // Add trace events as NDJSON
    const traceContent = this.events.map(e => JSON.stringify(e)).join('\n');
    zipFile.addBuffer(Buffer.from(traceContent), 'trace.trace');

    // Add empty network trace
    zipFile.addBuffer(Buffer.from(''), 'trace.network');

    // Add screenshot resources
    for (const [sha1, data] of this.resources) {
      zipFile.addBuffer(data, `resources/${sha1}`);
    }

    // Write ZIP to disk
    await new Promise<void>((resolve, reject) => {
      zipFile.end(undefined, () => {
        const stream = createWriteStream(outputPath);
        zipFile.outputStream.pipe(stream);
        stream.on('close', resolve);
        stream.on('error', reject);
      });
    });
  }
}
