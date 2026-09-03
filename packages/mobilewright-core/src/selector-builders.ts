// Selector-string builders vendored from playwright-core@1.62.1's
// packages/isomorphic/{locatorUtils,stringUtils}.ts. Playwright doesn't publish
// these — they're internal helpers with no require/import path reachable from
// outside its own bundle (see playwright-engine.ts's header comment for why we
// need them at all). Unlike the InjectedScript engine source, these are small
// and semantically stable: Playwright's own public parseSelector/asLocator
// APIs already depend on this `internal:xxx=...` wire format staying
// parseable, so Playwright itself has a strong incentive not to break it.
// If a future Playwright version does change the format, playwright-engine.test.ts's
// exact-match assertions will fail loudly — re-copy the functions from the new
// version's lib/coreBundle.js (search for the `packages/isomorphic/locatorUtils.ts`
// and `packages/isomorphic/stringUtils.ts` module-boundary comments) when that happens.
// Playwright is Apache-2.0 (see NOTICE).

function escapeRegexForSelector(re: RegExp): string {
  if (re.unicode || re.unicodeSets) return String(re);
  return String(re).replace(/(^|[^\\])(\\\\)*(["'`])/g, '$1$2\\$3').replace(/>>/g, '\\>\\>');
}

function escapeForTextSelector(text: string | RegExp, exact: boolean): string {
  if (typeof text !== 'string') return escapeRegexForSelector(text);
  return `${JSON.stringify(text)}${exact ? 's' : 'i'}`;
}

function escapeForAttributeSelector(value: string | RegExp, exact: boolean): string {
  if (typeof value !== 'string') return escapeRegexForSelector(value);
  return `"${value.replace(/\\/g, '\\\\').replace(/["]/g, '\\"')}"${exact ? 's' : 'i'}`;
}

function encodeTestIdAttributeName(testIdAttributeName: string): string {
  return testIdAttributeName.includes(',') ? JSON.stringify(testIdAttributeName) : testIdAttributeName;
}

function getByAttributeTextSelector(
  attrName: string,
  text: string | RegExp,
  options?: { exact?: boolean },
): string {
  return `internal:attr=[${attrName}=${escapeForAttributeSelector(text, options?.exact ?? false)}]`;
}

export function getByTestIdSelector(testIdAttributeName: string, testId: string | RegExp): string {
  return `internal:testid=[${encodeTestIdAttributeName(testIdAttributeName)}=${escapeForAttributeSelector(testId, true)}]`;
}

export function getByLabelSelector(text: string | RegExp, options?: { exact?: boolean }): string {
  return 'internal:label=' + escapeForTextSelector(text, !!options?.exact);
}

export function getByAltTextSelector(text: string | RegExp, options?: { exact?: boolean }): string {
  return getByAttributeTextSelector('alt', text, options);
}

export function getByTitleSelector(text: string | RegExp, options?: { exact?: boolean }): string {
  return getByAttributeTextSelector('title', text, options);
}

export function getByPlaceholderSelector(text: string | RegExp, options?: { exact?: boolean }): string {
  return getByAttributeTextSelector('placeholder', text, options);
}

export function getByTextSelector(text: string | RegExp, options?: { exact?: boolean }): string {
  return 'internal:text=' + escapeForTextSelector(text, !!options?.exact);
}

export interface GetByRoleOptions {
  checked?: boolean;
  disabled?: boolean;
  selected?: boolean;
  expanded?: boolean;
  includeHidden?: boolean;
  level?: number;
  name?: string | RegExp;
  description?: string | RegExp;
  pressed?: boolean;
  exact?: boolean;
}

export function getByRoleSelector(role: string, options: GetByRoleOptions = {}): string {
  const props: [string, string][] = [];
  if (options.checked !== undefined) props.push(['checked', String(options.checked)]);
  if (options.disabled !== undefined) props.push(['disabled', String(options.disabled)]);
  if (options.selected !== undefined) props.push(['selected', String(options.selected)]);
  if (options.expanded !== undefined) props.push(['expanded', String(options.expanded)]);
  if (options.includeHidden !== undefined) props.push(['include-hidden', String(options.includeHidden)]);
  if (options.level !== undefined) props.push(['level', String(options.level)]);
  if (options.name !== undefined) props.push(['name', escapeForAttributeSelector(options.name, !!options.exact)]);
  if (options.description !== undefined) {
    props.push(['description', escapeForAttributeSelector(options.description, !!options.exact)]);
  }
  if (options.pressed !== undefined) props.push(['pressed', String(options.pressed)]);
  return `internal:role=${role}${props.map(([n, v]) => `[${n}=${v}]`).join('')}`;
}
