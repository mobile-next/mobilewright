// Runtime-agnostic contracts that the conformance specs are written against.
// Both mobilewright's and Playwright's page/locator/expect satisfy these
// structurally, so a single spec body runs unchanged under either runner. The
// per-runtime wrappers cast their concrete page/expect to these at the boundary.

export interface TimeoutOptions {
  timeout?: number;
}

export interface NameOptions {
  name?: string | RegExp;
  exact?: boolean;
}

export interface TextOptions {
  exact?: boolean;
}

export interface ConformanceLocator {
  locator(selector: string): ConformanceLocator;
  getByRole(role: string, opts?: NameOptions): ConformanceLocator;
  getByText(text: string | RegExp, opts?: TextOptions): ConformanceLocator;
  first(): ConformanceLocator;
  last(): ConformanceLocator;
  nth(index: number): ConformanceLocator;
  count(): Promise<number>;
  click(opts?: TimeoutOptions): Promise<void>;
  fill(value: string, opts?: TimeoutOptions): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
  focus(): Promise<void>;
  hover(): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
}

export interface ConformancePage {
  goto(url: string): Promise<unknown>;
  waitForLoadState(state?: 'load' | 'domcontentloaded'): Promise<void>;
  locator(selector: string): ConformanceLocator;
  getByRole(role: string, opts?: NameOptions): ConformanceLocator;
  getByText(text: string | RegExp, opts?: TextOptions): ConformanceLocator;
  getByLabel(text: string | RegExp, opts?: TextOptions): ConformanceLocator;
  getByPlaceholder(text: string | RegExp, opts?: TextOptions): ConformanceLocator;
  getByTestId(testId: string): ConformanceLocator;
  getByAltText(text: string | RegExp): ConformanceLocator;
  getByTitle(text: string | RegExp): ConformanceLocator;
}

// The subset of expect matchers the conformance specs exercise. Locator/page
// matchers are async; value matchers are sync — matching both runtimes.
export interface ConformanceMatchers {
  not: ConformanceMatchers;

  toBeVisible(opts?: TimeoutOptions): Promise<void>;
  toBeHidden(opts?: TimeoutOptions): Promise<void>;
  toBeEnabled(opts?: TimeoutOptions): Promise<void>;
  toBeDisabled(opts?: TimeoutOptions): Promise<void>;
  toBeEditable(opts?: TimeoutOptions): Promise<void>;
  toBeChecked(opts?: TimeoutOptions): Promise<void>;
  toBeAttached(opts?: TimeoutOptions): Promise<void>;
  toBeEmpty(opts?: TimeoutOptions): Promise<void>;
  toBeFocused(opts?: TimeoutOptions): Promise<void>;
  toBeInViewport(opts?: TimeoutOptions): Promise<void>;

  toHaveText(expected: string | RegExp, opts?: TimeoutOptions): Promise<void>;
  toContainText(expected: string | RegExp, opts?: TimeoutOptions): Promise<void>;
  toHaveValue(expected: string | RegExp, opts?: TimeoutOptions): Promise<void>;
  toHaveCount(expected: number, opts?: TimeoutOptions): Promise<void>;
  toHaveAttribute(name: string, expected: string | RegExp, opts?: TimeoutOptions): Promise<void>;
  toHaveClass(expected: string | RegExp, opts?: TimeoutOptions): Promise<void>;
  toContainClass(expected: string | RegExp, opts?: TimeoutOptions): Promise<void>;
  toHaveCSS(name: string, expected: string | RegExp, opts?: TimeoutOptions): Promise<void>;
  toHaveId(expected: string | RegExp, opts?: TimeoutOptions): Promise<void>;
  toHaveJSProperty(name: string, value: unknown, opts?: TimeoutOptions): Promise<void>;
  toHaveURL(expected: string | RegExp, opts?: TimeoutOptions): Promise<void>;
  toHaveTitle(expected: string | RegExp, opts?: TimeoutOptions): Promise<void>;

  toBeGreaterThan(expected: number): void;
}

export type ConformanceExpect = (actual: unknown) => ConformanceMatchers;

export type ConformanceSpec = (
  page: ConformancePage,
  expect: ConformanceExpect,
) => Promise<void>;
