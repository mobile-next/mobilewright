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
 * Derive the best mobilewright locator for a single ViewNode.
 * Returns null when no supported locator field is present.
 */
export function deriveLocator(node: ViewNode): Locator | null {
  const testId = node.identifier || node.resourceId;
  if (testId) return { kind: 'testId', value: testId };

  const role = deriveRole(node);
  if (role) {
    const name = node.label || node.text || undefined;
    return { kind: 'role', value: role, name };
  }

  if (node.label) return { kind: 'label', value: node.label };

  const text = node.text ?? (node.value != null ? String(node.value) : undefined);
  if (text) return { kind: 'text', value: text };

  return null;
}

/**
 * Flatten a ViewNode tree depth-first and annotate each node with its best locator.
 * Nodes with no locatable field are included with locator: null.
 */
export function deriveElementList(
  roots: ViewNode[],
): Array<{ node: ViewNode; locator: Locator | null }> {
  const result: Array<{ node: ViewNode; locator: Locator | null }> = [];

  /** Depth-first recursive walk, pushing each visited node to result. */
  function walk(nodes: ViewNode[]): void {
    for (const node of nodes) {
      result.push({ node, locator: deriveLocator(node) });
      if (node.children?.length) walk(node.children);
    }
  }

  walk(roots);
  return result;
}
