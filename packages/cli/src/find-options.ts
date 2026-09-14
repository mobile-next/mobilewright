import type { LocatorStrategy, Role } from '@mobilewright/core';
import { ROLE_TYPE_MAP } from '@mobilewright/core';

export interface FindOptions {
  text?: string;
  role?: string;
  name?: string;
  testId?: string;
  label?: string;
  placeholder?: string;
  type?: string;
  exact?: boolean;
  hasText?: string;
  hasNotText?: string;
  nth?: string;
  first?: boolean;
  last?: boolean;
}

function textMatcher(value: string): string | RegExp {
  const match = value.match(/^\/(.*)\/([a-z]*)$/);
  return match ? new RegExp(match[1], match[2]) : value;
}

/** Translate CLI flags into the same LocatorStrategy the core query engine runs. */
export function buildStrategy(opts: FindOptions): LocatorStrategy {
  const bases: LocatorStrategy[] = [];
  if (opts.text !== undefined) { bases.push({ kind: 'text', value: textMatcher(opts.text), exact: opts.exact }); }
  if (opts.label !== undefined) { bases.push({ kind: 'label', value: opts.label, exact: opts.exact }); }
  if (opts.placeholder !== undefined) { bases.push({ kind: 'placeholder', value: opts.placeholder, exact: opts.exact }); }
  if (opts.testId !== undefined) { bases.push({ kind: 'testId', value: opts.testId }); }
  if (opts.type !== undefined) { bases.push({ kind: 'type', value: opts.type }); }
  if (opts.role !== undefined) {
    if (!(opts.role in ROLE_TYPE_MAP)) {
      throw new Error(`unknown role "${opts.role}", expected one of: ${Object.keys(ROLE_TYPE_MAP).join(', ')}`);
    }
    bases.push({ kind: 'role', value: opts.role as Role, name: opts.name === undefined ? undefined : textMatcher(opts.name) });
  }
  if (bases.length === 0) {
    throw new Error('specify at least one of --text, --role, --test-id, --label, --placeholder, --type');
  }

  let strategy = bases.reduce((left, right) => ({ kind: 'and', left, right }));

  if (opts.hasText !== undefined || opts.hasNotText !== undefined) {
    strategy = {
      kind: 'filter',
      parent: strategy,
      hasText: opts.hasText === undefined ? undefined : textMatcher(opts.hasText),
      hasNotText: opts.hasNotText === undefined ? undefined : textMatcher(opts.hasNotText),
    };
  }
  if (opts.first) { strategy = { kind: 'nth', parent: strategy, index: 0 }; }
  if (opts.last) { strategy = { kind: 'nth', parent: strategy, index: -1 }; }
  if (opts.nth !== undefined) {
    const index = Number(opts.nth);
    if (!Number.isInteger(index)) {
      throw new Error(`--nth must be an integer, got: ${opts.nth}`);
    }
    strategy = { kind: 'nth', parent: strategy, index };
  }
  return strategy;
}
