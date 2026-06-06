// Builds the calling convention for Playwright's injected expect() matcher.
// Verified against playwright-core@1.58.2: injected.expect(element, params,
// elements) returns { matches, received, missingReceived }; pass = matches !== isNot.

export interface ExpectedTextValue {
  string?: string;
  regexSource?: string;
  regexFlags?: string;
  matchSubstring?: boolean;
  ignoreCase?: boolean;
  normalizeWhiteSpace?: boolean;
}

export interface FrameExpectParams {
  expression: string;
  expressionArg?: unknown;
  expectedText?: ExpectedTextValue[];
  expectedNumber?: number;
  expectedValue?: unknown;
  isNot: boolean;
  timeout: number;
}

export interface ExpectResult {
  matches: boolean;
  received?: unknown;
  missingReceived?: boolean;
}

// Build an ExpectedTextValue from a string or RegExp, plus optional match flags.
export function textValue(
  value: string | RegExp,
  flags: { normalizeWhiteSpace?: boolean; matchSubstring?: boolean; ignoreCase?: boolean } = {},
): ExpectedTextValue {
  if (value instanceof RegExp) {
    return { regexSource: value.source, regexFlags: value.flags, ...flags };
  }
  return { string: value, ...flags };
}

// A single self-contained evaluate: resolve the selector, run the injected
// matcher, return its serializable verdict. No JSHandles needed.
export function buildExpectEvaluate(selector: string, params: FrameExpectParams): string {
  const sel = JSON.stringify(selector);
  const opts = JSON.stringify(params);
  return `(async () => {
    const is = window.__mwInjected;
    const elements = is.querySelectorAll(is.parseSelector(${sel}), document);
    const r = await is.expect(elements[0], ${opts}, elements);
    return { matches: r.matches, received: r.received, missingReceived: r.missingReceived };
  })()`;
}
