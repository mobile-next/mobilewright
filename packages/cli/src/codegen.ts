import type { ViewNode } from '@mobilewright/protocol';
import type { LocatorStrategy } from '@mobilewright/core';
import { ROLE_TYPE_MAP, bareTypeName } from '@mobilewright/core';

const ROLES_WITH_NAME = new Set(['button', 'textfield', 'switch', 'checkbox', 'radio', 'slider', 'tab', 'link']);

function q(value: string | RegExp): string {
  return value instanceof RegExp ? value.toString() : `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

function roleOf(node: ViewNode): string | undefined {
  const bare = bareTypeName(node.type);
  for (const [role, types] of Object.entries(ROLE_TYPE_MAP)) {
    if ((types as readonly string[]).includes(bare)) {
      return role;
    }
  }
  return undefined;
}

/**
 * The locator a test would use for this node, most specific first.
 * ponytail: uniqueness is not checked; the agent sees the snapshot and can refine.
 */
export function locatorForNode(node: ViewNode): string {
  if (node.identifier) { return `screen.getByTestId(${q(node.identifier)})`; }
  const role = roleOf(node);
  if (role && ROLES_WITH_NAME.has(role) && node.label) { return `screen.getByRole(${q(role)}, { name: ${q(node.label)} })`; }
  if (node.label) { return `screen.getByLabel(${q(node.label)})`; }
  if (node.text) { return `screen.getByText(${q(node.text)})`; }
  if (node.placeholder) { return `screen.getByPlaceholder(${q(node.placeholder)})`; }
  return `screen.getByType(${q(node.type)})`;
}

function exactArg(exact: boolean | undefined): string {
  return exact ? ', { exact: true }' : '';
}

/** Render a LocatorStrategy (from find/expect flags) as chained test code. */
export function locatorForStrategy(strategy: LocatorStrategy): string {
  switch (strategy.kind) {
    case 'root': return 'screen';
    case 'text': return `screen.getByText(${q(strategy.value)}${exactArg(strategy.exact)})`;
    case 'label': return `screen.getByLabel(${q(strategy.value)}${exactArg(strategy.exact)})`;
    case 'placeholder': return `screen.getByPlaceholder(${q(strategy.value)}${exactArg(strategy.exact)})`;
    case 'testId': return `screen.getByTestId(${q(strategy.value)})`;
    case 'type': return `screen.getByType(${q(strategy.value)})`;
    case 'role': return strategy.name === undefined
      ? `screen.getByRole(${q(strategy.value)})`
      : `screen.getByRole(${q(strategy.value)}, { name: ${q(strategy.name)} })`;
    case 'and': return `${locatorForStrategy(strategy.left)}.and(${locatorForStrategy(strategy.right)})`;
    case 'or': return `${locatorForStrategy(strategy.left)}.or(${locatorForStrategy(strategy.right)})`;
    case 'nth': {
      const parent = locatorForStrategy(strategy.parent);
      if (strategy.index === 0) { return `${parent}.first()`; }
      if (strategy.index === -1) { return `${parent}.last()`; }
      return `${parent}.nth(${strategy.index})`;
    }
    case 'filter': {
      const parts: string[] = [];
      if (strategy.hasText !== undefined) { parts.push(`hasText: ${q(strategy.hasText)}`); }
      if (strategy.hasNotText !== undefined) { parts.push(`hasNotText: ${q(strategy.hasNotText)}`); }
      return `${locatorForStrategy(strategy.parent)}.filter({ ${parts.join(', ')} })`;
    }
    default: return 'screen';
  }
}

export function quote(value: string): string {
  return q(value);
}
