import type { WebViewSession } from '@mobilewright/protocol';

export type WebLocatorStrategy =
  | { kind: 'css'; selector: string }
  | { kind: 'role'; role: string; name?: string | RegExp }
  | { kind: 'text'; text: string | RegExp; exact?: boolean }
  | { kind: 'label'; label: string | RegExp; exact?: boolean }
  | { kind: 'placeholder'; text: string | RegExp; exact?: boolean }
  | { kind: 'testId'; testId: string }
  | { kind: 'altText'; text: string | RegExp }
  | { kind: 'title'; text: string | RegExp }
  | { kind: 'nth'; parent: WebLocatorStrategy; index: number };

export class WebLocator {
  constructor(
    protected readonly session: WebViewSession,
    protected readonly strategy: WebLocatorStrategy,
  ) {}

  // ─── Chaining ────────────────────────────────────────────────

  locator(selector: string): WebLocator {
    return new WebLocator(this.session, { kind: 'css', selector });
  }

  getByRole(role: string, opts?: { name?: string | RegExp }): WebLocator {
    return new WebLocator(this.session, { kind: 'role', role, name: opts?.name });
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return new WebLocator(this.session, { kind: 'text', text, exact: opts?.exact });
  }

  getByLabel(label: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return new WebLocator(this.session, { kind: 'label', label, exact: opts?.exact });
  }

  getByPlaceholder(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return new WebLocator(this.session, { kind: 'placeholder', text, exact: opts?.exact });
  }

  getByTestId(testId: string): WebLocator {
    return new WebLocator(this.session, { kind: 'testId', testId });
  }

  getByAltText(text: string | RegExp): WebLocator {
    return new WebLocator(this.session, { kind: 'altText', text });
  }

  getByTitle(text: string | RegExp): WebLocator {
    return new WebLocator(this.session, { kind: 'title', text });
  }

  // ─── Collection ──────────────────────────────────────────────

  first(): WebLocator {
    return this.nth(0);
  }

  last(): WebLocator {
    return this.nth(-1);
  }

  nth(index: number): WebLocator {
    return new WebLocator(this.session, { kind: 'nth', parent: this.strategy, index });
  }

  // ─── Actions and queries (step 5) ────────────────────────────
}
