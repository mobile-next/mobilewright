// Derives the best mobilewright locator for every node in a ViewNode tree.
// Priority: Test ID > Role > Label > Text. Mirrors @mobilewright/core query-engine.ts.
// If mobilewright changes matching rules, update ROLE_TYPE_MAP below to stay in sync.

import type { ViewNode } from '@mobilewright/protocol';

/** Maps mobilewright role names to the node type strings that resolve to each role. */
const ROLE_TYPE_MAP: Record<string, string[]> = {
  button:   ['button', 'imagebutton'],
  textfield: ['textfield', 'securetextfield', 'edittext', 'searchfield', 'reactedittext'],
  text:     ['statictext', 'textview', 'text', 'reacttextview'],
  image:    ['image', 'imageview', 'reactimageview'],
  switch:   ['switch', 'toggle'],
  checkbox: ['checkbox'],
  slider:   ['slider', 'seekbar'],
  list:     ['table', 'collectionview', 'listview', 'recyclerview', 'scrollview', 'reactscrollview'],
  listitem: ['cell', 'linearlayout', 'relativelayout'],
  tab:      ['tab', 'tabbar'],
  link:     ['link'],
  header:   ['navigationbar', 'toolbar', 'header'],
};

/** Discriminated union of the four locator strategies mobilewright supports. */
export type Locator =
  | { kind: 'testId'; value: string }
  | { kind: 'role';   value: string; name: string | undefined }
  | { kind: 'label';  value: string }
  | { kind: 'text';   value: string };

/** Map node.type to a mobilewright role string. Returns null for unmapped types. */
function deriveRole(node: ViewNode): string | null {
  const type = (node.type ?? '').toLowerCase();

  if (type === 'reactviewgroup') {
    const isClickable = node.raw?.['clickable'] === 'true' || node.raw?.['accessible'] === 'true';
    return isClickable ? 'button' : null;
  }

  for (const [role, types] of Object.entries(ROLE_TYPE_MAP)) {
    if (types.includes(type)) return role;
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

/**
 * Flatten a ViewNode tree depth-first and annotate each node with its locators.
 * Nodes with no locatable field are included with locators: [].
 */
export function deriveElementList(
  roots: ViewNode[],
): Array<{ node: ViewNode; locator: Locator | null; locators: Locator[] }> {
  const result: Array<{ node: ViewNode; locator: Locator | null; locators: Locator[] }> = [];

  function walk(nodes: ViewNode[]): void {
    for (const node of nodes) {
      const nodeLocators = deriveLocators(node);
      result.push({ node, locator: nodeLocators[0] ?? null, locators: nodeLocators });
      if (node.children?.length) walk(node.children);
    }
  }

  walk(roots);
  return result;
}
