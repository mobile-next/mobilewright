import type { Bounds, ViewNode } from '@mobilewright/protocol';

export type LocatorStrategy =
  | { kind: 'root' }
  | { kind: 'label'; value: string; exact?: boolean }
  | { kind: 'testId'; value: string }
  | { kind: 'text'; value: string | RegExp; exact?: boolean }
  | { kind: 'type'; value: string }
  | { kind: 'role'; value: string; name?: string | RegExp }
  | { kind: 'placeholder'; value: string; exact?: boolean }
  | { kind: 'chain'; parent: LocatorStrategy; child: LocatorStrategy }
  | { kind: 'nth'; parent: LocatorStrategy; index: number };

/**
 * Query all ViewNodes in a tree that match a locator strategy.
 * Returns matching nodes in document order.
 */
export function queryAll(
  roots: ViewNode[],
  strategy: LocatorStrategy,
): ViewNode[] {
  if (strategy.kind === 'nth') {
    const all = queryAll(roots, strategy.parent);
    const index = strategy.index < 0 ? all.length + strategy.index : strategy.index;
    const node = all[index];
    return node ? [node] : [];
  }

  if (strategy.kind === 'chain') {
    // Root parent means "search the whole tree" — skip chaining
    if (strategy.parent.kind === 'root') {
      return queryAll(roots, strategy.child);
    }
    const parents = queryAll(roots, strategy.parent);
    const results: ViewNode[] = [];
    for (const parent of parents) {
      // Try tree-based first (works when hierarchy has real children)
      const treeResults = queryAll(parent.children, strategy.child);
      if (treeResults.length > 0) {
        results.push(...treeResults);
        continue;
      }
      // Bounds fallback: find nodes contained within parent's bounds (flat lists)
      const contained = flattenNodes(roots).filter(
        (n) => n !== parent && isContainedWithin(n.bounds, parent.bounds),
      );
      results.push(...queryAll(contained, strategy.child));
    }
    return results;
  }

  const results: ViewNode[] = [];
  walkTree(roots, (node) => {
    if (matchesStrategy(node, strategy)) {
      results.push(node);
    }
  });
  return results;
}

function walkTree(
  nodes: ViewNode[],
  visitor: (node: ViewNode) => void,
): void {
  for (const node of nodes) {
    visitor(node);
    walkTree(node.children, visitor);
  }
}

function matchesStrategy(
  node: ViewNode,
  strategy: LocatorStrategy,
): boolean {
  switch (strategy.kind) {
    case 'root':
      return true;

    case 'label':
      if (!node.label) return false;
      return strategy.exact === false
        ? node.label.toLowerCase().includes(strategy.value.toLowerCase())
        : node.label === strategy.value;

    case 'testId':
      if (node.identifier === strategy.value) return true;
      if (node.resourceId && node.resourceId === strategy.value) return true;
      return false;

    case 'text': {
      const nodeText = node.text ?? node.label ?? node.value ?? '';
      if (strategy.value instanceof RegExp) {
        return strategy.value.test(nodeText);
      }
      return strategy.exact === false
        ? nodeText.toLowerCase().includes(strategy.value.toLowerCase())
        : nodeText === strategy.value;
    }

    case 'type':
      return (
        node.type.toLowerCase() === strategy.value.toLowerCase()
      );

    case 'role':
      if (!matchesRole(node, strategy.value)) return false;
      if (strategy.name !== undefined) {
        const nodeLabel = node.label ?? node.text ?? '';
        if (strategy.name instanceof RegExp) {
          return strategy.name.test(nodeLabel);
        }
        return nodeLabel === strategy.name;
      }
      return true;

    case 'placeholder':
      if (!node.placeholder) return false;
      return strategy.exact === false
        ? node.placeholder.toLowerCase().includes(strategy.value.toLowerCase())
        : node.placeholder === strategy.value;

    case 'chain':
      // Handled above in queryAll
      return false;
  }
}

const ROLE_TYPE_MAP: Record<string, string[]> = {
  button: ['button', 'imagebutton'],
  textfield: ['textfield', 'securetextfield', 'edittext', 'searchfield', 'reactedittext'],
  text: ['statictext', 'textview', 'text', 'reacttextview'],
  image: ['image', 'imageview', 'reactimageview'],
  switch: ['switch', 'toggle'],
  checkbox: ['checkbox'],
  slider: ['slider', 'seekbar'],
  list: ['table', 'collectionview', 'listview', 'recyclerview', 'scrollview', 'reactscrollview'],
  listitem: ['cell', 'linearlayout', 'relativelayout', 'other'],
  tab: ['tab', 'tabbar'],
  link: ['link'],
  header: ['navigationbar', 'toolbar', 'header'],
};

function matchesRole(node: ViewNode, role: string): boolean {
  const normalizedType = node.type.toLowerCase();
  const roleTypes = ROLE_TYPE_MAP[role.toLowerCase()];

  // React Native's ReactViewGroup is used for everything — only treat it as a
  // button when the element is explicitly marked clickable or accessible.
  if (normalizedType === 'reactviewgroup') {
    if (role.toLowerCase() === 'button') {
      return node.raw?.['clickable'] === 'true' || node.raw?.['accessible'] === 'true';
    }
    return false;
  }

  if (roleTypes) {
    return roleTypes.includes(normalizedType);
  }
  // Fallback: direct type match
  return normalizedType === role.toLowerCase();
}

/** Flatten a ViewNode tree into a single array. */
function flattenNodes(roots: ViewNode[]): ViewNode[] {
  const result: ViewNode[] = [];
  walkTree(roots, (node) => result.push(node));
  return result;
}

/** Check if inner bounds are fully contained within outer bounds. */
function isContainedWithin(inner: Bounds, outer: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
