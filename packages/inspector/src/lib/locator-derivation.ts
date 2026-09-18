// Derives the best mobilewright locator for every node in a ViewNode tree.
// Priority: Test ID > Role > Label > Text. Mirrors @mobilewright/core query-engine.ts,
// and reuses its ROLE_TYPE_MAP so role derivation cannot drift from role matching.

import type { ViewNode } from '@mobilewright/protocol';
import { ROLE_TYPE_MAP, bareTypeName } from '@mobilewright/core';

// core declares ROLE_TYPE_MAP `as const`, so each value is a readonly tuple of
// string literals. Widen to plain strings once, here, so membership can be tested
// against an arbitrary node type.
const ROLE_TYPES: [string, readonly string[]][] = Object.entries(ROLE_TYPE_MAP);

// Types that ROLE_TYPE_MAP matches on purpose but that must not be *suggested*:
// iOS reports generic containers as "other", so deriving getByRole('listitem')
// from one would hand the user a locator matching much of the tree.
const TYPES_TOO_GENERIC_TO_SUGGEST = new Set(['other']);

/** Discriminated union of the four locator strategies mobilewright supports. */
export type Locator =
  | { kind: 'testId'; value: string }
  | { kind: 'role';   value: string; name: string | undefined }
  | { kind: 'label';  value: string }
  | { kind: 'text';   value: string };

interface ElementEntry {
  node: ViewNode;
  locator: Locator | null;
  locators: Locator[];
}

/** Map node.type to a mobilewright role string. Returns null for unmapped types. */
function deriveRole(node: ViewNode): string | null {
  // Same normalization core applies before matching: strips the Android package
  // path ("android.widget.EditText") and the iOS "XCUIElementType" prefix.
  const type = bareTypeName(node.type ?? '');

  if (type === 'reactviewgroup') {
    const isClickable = node.raw?.['clickable'] === 'true' || node.raw?.['accessible'] === 'true';
    return isClickable ? 'button' : null;
  }

  if (TYPES_TOO_GENERIC_TO_SUGGEST.has(type)) {
    return null;
  }

  for (const [role, types] of ROLE_TYPES) {
    if (types.includes(type)) {
      return role;
    }
  }
  return null;
}

/**
 * Derive all matching mobilewright locators for a single ViewNode.
 * Returns array ordered by priority: testId > role > label > text.
 * Empty array when no supported locator field is present.
 */
export function deriveLocators(node: ViewNode): Locator[] {
  const locators: Locator[] = [];

  const testId = node.identifier || node.resourceId;
  if (testId) locators.push({ kind: 'testId', value: testId });

  const role = deriveRole(node);
  if (role) {
    const name = node.label || node.text || undefined;
    locators.push({ kind: 'role', value: role, name });
  }

  if (node.label) locators.push({ kind: 'label', value: node.label });

  const text = node.text ?? (node.value != null ? String(node.value) : undefined);
  if (text) locators.push({ kind: 'text', value: text });

  return locators;
}

/** Keep single-locator derive for backward compat — returns highest priority match or null. */
export function deriveLocator(node: ViewNode): Locator | null {
  return deriveLocators(node)[0] ?? null;
}

type RoleLocator = Extract<Locator, { kind: 'role' }>;

function roleKey(role: RoleLocator): string {
  return `${role.value}:${role.name ?? ''}`;
}

function roleLocatorOf(locators: Locator[]): RoleLocator | undefined {
  return locators.find((l): l is RoleLocator => l.kind === 'role');
}

/**
 * When several elements share a test ID, getByTestId cannot tell them apart.
 * If every element of such a group has a role locator that matches nothing else
 * in the tree, promote role to the primary locator for the whole group.
 */
function preferUniqueRolesOverDuplicateTestIds(entries: ElementEntry[]): ElementEntry[] {
  const testIdCounts = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  const groupCanUseRoles = new Map<string, boolean>();

  for (const { locator, locators } of entries) {
    if (locator?.kind === 'testId') {
      testIdCounts.set(locator.value, (testIdCounts.get(locator.value) ?? 0) + 1);
    }
    const role = roleLocatorOf(locators);
    if (role) {
      roleCounts.set(roleKey(role), (roleCounts.get(roleKey(role)) ?? 0) + 1);
    }
  }

  for (const { locator, locators } of entries) {
    if (locator?.kind !== 'testId') {
      continue;
    }
    const role = roleLocatorOf(locators);
    const hasUniqueRole = role !== undefined && roleCounts.get(roleKey(role)) === 1;
    groupCanUseRoles.set(locator.value, (groupCanUseRoles.get(locator.value) ?? true) && hasUniqueRole);
  }

  return entries.map(entry => {
    const { locator, locators } = entry;
    const role = roleLocatorOf(locators);
    const isDuplicateTestId = locator?.kind === 'testId' && (testIdCounts.get(locator.value) ?? 0) > 1;
    if (!isDuplicateTestId || !role || !groupCanUseRoles.get(locator.value)) {
      return entry;
    }
    return { ...entry, locator: role, locators: [role, ...locators.filter(l => l !== role)] };
  });
}

/**
 * Flatten a ViewNode tree depth-first and annotate each node with its locators.
 * Nodes with no locatable field are included with locators: [].
 */
export function deriveElementList(roots: ViewNode[]): ElementEntry[] {
  const result: ElementEntry[] = [];

  function walk(nodes: ViewNode[]): void {
    for (const node of nodes) {
      const nodeLocators = deriveLocators(node);
      result.push({ node, locator: nodeLocators[0] ?? null, locators: nodeLocators });
      if (node.children?.length) walk(node.children);
    }
  }

  walk(roots);
  return preferUniqueRolesOverDuplicateTestIds(result);
}
