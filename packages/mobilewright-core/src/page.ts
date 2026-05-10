import type { WebViewSession } from '@mobilewright/protocol';

export class Page {
  constructor(readonly session: WebViewSession) {}

  async close(): Promise<void> {
    await this.session.close();
  }
}
