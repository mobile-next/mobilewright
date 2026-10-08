import type { Bounds, ViewNode } from '@mobilewright/protocol';

export type LocatorStrategy =
  | { kind: 'root' }
  | { kind: 'label'; value: string; exact?: boolean }
  | { kind: 'testId'; value: string }
  | { kind: 'text'; value: string | RegExp; exact?: boolean }
  | { kind: 'type'; value: string }
  | { kind: 'role'; value: string; name?: string | RegExp }
  | { kind: 'placeholder'; value: string; exact?: boolean }
  | { kind: 'webview'; testId?: string }
  | { kind: 'chain'; parent: LocatorStrategy; child: LocatorStrategy }
  | { kind: 'nth'; parent: LocatorStrategy; index: number }
  | {
    kind: 'filter';
    parent: LocatorStrategy;
    hasText?: string | RegExp;
    hasNotText?: string | RegExp;
    has?: LocatorStrategy;
    hasNot?: LocatorStrategy;
  }
  | { kind: 'and'; left: LocatorStrategy; right: LocatorStrategy }
  | { kind: 'or'; left: LocatorStrategy; right: LocatorStrategy };

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

  if (strategy.kind === 'and') {
    const right = new Set(queryAll(roots, strategy.right));
    return queryAll(roots, strategy.left).filter((node) => right.has(node));
  }

  if (strategy.kind === 'or') {
    const matched = new Set([
      ...queryAll(roots, strategy.left),
      ...queryAll(roots, strategy.right),
    ]);
    // Return in document order, with duplicates removed
    return flattenNodes(roots).filter((node) => matched.has(node));
  }

  if (strategy.kind === 'filter') {
    const candidates = queryAll(roots, strategy.parent);
    return candidates.filter((node) => matchesFilter(node, roots, strategy));
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

export const WEBVIEW_TYPES = new Set([
  'WKWebView',
  'WebView', // mobilecli iOS dump strips the XCUIElementType prefix
  'XCUIElementTypeWebView',
  'android.webkit.WebView',
  'RCTWebView',
  'RNCWebView',
]);

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
      if (node.key === strategy.value) {
        return true;
      }
      if (node.identifier === strategy.value) {
        return true;
      }
      if (node.resourceId && node.resourceId === strategy.value) {
        return true;
      }
      // Android reports "<package>:id/<name>"; let getByTestId('<name>') match it.
      if (node.identifier?.endsWith(`:id/${strategy.value}`)) {
        return true;
      }
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
        // Accessible-name order (label before text) is intentionally the reverse of
        // the `text` locator above: an explicit label/accessibilityLabel outranks
        // displayed text, mirroring ARIA accessible-name computation.
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

    case 'webview':
      if (!WEBVIEW_TYPES.has(node.type)) {
        return false;
      }
      if (strategy.testId !== undefined) {
        return node.identifier === strategy.testId || node.resourceId === strategy.testId;
      }
      return true;

    case 'chain':
    case 'filter':
    case 'and':
    case 'or':
      // Handled above in queryAll
      return false;

    default:
      throw new Error(`Unknown strategy kind: ${(strategy as any).kind}`);
  }
}

export const ROLE_TYPE_MAP = {
  button: ['button', 'imagebutton', 'floatingactionbutton', 'materialbutton', 'appcompatbutton'],
  textfield: ['textfield', 'securetextfield', 'searchfield', 'edittext', 'appcompatedittext', 'textinputedittext', 'reactedittext'],
  text: ['statictext', 'textview', 'appcompattextview', 'materialtextview', 'text', 'reacttextview'],
  image: ['image', 'imageview', 'appcompatimageview', 'shapeableimageview', 'reactimageview'],
  switch: ['switch', 'toggle', 'togglebutton'],
  checkbox: ['checkbox'],
  radio: ['radio', 'radiobutton', 'appcompatradiobutton'],
  slider: ['slider', 'seekbar'],
  progressbar: ['progressindicator', 'activityindicator', 'progressbar'],
  alert: ['alert', 'sheet'],
  combobox: ['picker', 'pickerwheel', 'spinner', 'appcompatspinner'],
  list: ['table', 'collectionview', 'listview', 'recyclerview', 'scrollview', 'reactscrollview'],
  listitem: ['cell', 'linearlayout', 'relativelayout', 'other'],
  tab: ['tab', 'tabbar'],
  link: ['link'],
  header: ['navigationbar', 'toolbar', 'header'],
} as const satisfies Record<string, readonly string[]>;

/**
 * Semantic UI roles understood by mobilewright. Inspired by ARIA but adapted
 * for native iOS / Android / RN widget vocabularies — not a 1:1 subset of W3C
 * ARIA (e.g. mobilewright uses `textfield`, not ARIA's `textbox`).
 */
export type Role = keyof typeof ROLE_TYPE_MAP;

/**
 * Reduce a raw native type to the bare name ROLE_TYPE_MAP is keyed on, so a single
 * getByRole works across platforms. mobilecli reports types verbatim: Android keeps
 * the full package path ("android.widget.EditText") and iOS may keep the
 * "XCUIElementType" prefix ("XCUIElementTypeTextField"). getByType still matches the
 * raw type — only role resolution normalizes.
 */
export function bareTypeName(type: string): string {
  const lower = type.toLowerCase();
  const afterPackage = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : lower;
  return afterPackage.startsWith('xcuielementtype')
    ? afterPackage.slice('xcuielementtype'.length)
    : afterPackage;
}

export function matchesRole(node: ViewNode, role: string): boolean {
  const normalizedType = bareTypeName(node.type);
  // ROLE_TYPE_MAP is `as const`, so its keys are a closed union; widen for the
  // arbitrary caller-supplied role, and keep `| undefined` explicit because
  // noUncheckedIndexedAccess is off.
  const roleTypes: readonly string[] | undefined = (ROLE_TYPE_MAP as Record<string, readonly string[]>)[role.toLowerCase()];

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

type FilterStrategy = Extract<LocatorStrategy, { kind: 'filter' }>;

/** Decide whether a candidate node passes a filter strategy's conditions. */
function matchesFilter(
  node: ViewNode,
  roots: ViewNode[],
  strategy: FilterStrategy,
): boolean {
  if (strategy.hasText !== undefined && !subtreeContainsText(node, roots, strategy.hasText)) {
    return false;
  }
  if (strategy.hasNotText !== undefined && subtreeContainsText(node, roots, strategy.hasNotText)) {
    return false;
  }
  if (strategy.has !== undefined && !subtreeContainsMatch(node, roots, strategy.has)) {
    return false;
  }
  if (strategy.hasNot !== undefined && subtreeContainsMatch(node, roots, strategy.hasNot)) {
    return false;
  }
  return true;
}

/** The nodes that count as "inside" a candidate: tree descendants, or — for flat
 *  hierarchies with no children — nodes contained within the candidate's bounds. */
function descendantsOf(node: ViewNode, roots: ViewNode[]): ViewNode[] {
  if (node.children.length > 0) {
    return flattenNodes(node.children);
  }
  return flattenNodes(roots).filter(
    (n) => n !== node && isContainedWithin(n.bounds, node.bounds),
  );
}

/** True if the candidate or any of its descendants contains the given text. */
function subtreeContainsText(
  node: ViewNode,
  roots: ViewNode[],
  value: string | RegExp,
): boolean {
  const candidates = [node, ...descendantsOf(node, roots)];
  return candidates.some((n) => {
    const text = n.text ?? n.label ?? n.value ?? '';
    if (value instanceof RegExp) {
      return value.test(text);
    }
    return text.toLowerCase().includes(value.toLowerCase());
  });
}

/** True if a descendant of the candidate matches the inner strategy. Mirrors the
 *  chain query's tree-first, bounds-fallback resolution. */
function subtreeContainsMatch(
  node: ViewNode,
  roots: ViewNode[],
  childStrategy: LocatorStrategy,
): boolean {
  const treeResults = queryAll(node.children, childStrategy);
  if (treeResults.length > 0) {
    return true;
  }
  const contained = flattenNodes(roots).filter(
    (n) => n !== node && isContainedWithin(n.bounds, node.bounds),
  );
  return queryAll(contained, childStrategy).length > 0;
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

function describeValue(value: string | RegExp): string {
  if (value instanceof RegExp) {
    return String(value);
  }
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
  return `'${escaped}'`;
}

function describeExact(exact: boolean | undefined): string {
  return exact ? ', { exact: true }' : '';
}

/** Render a strategy the way a test would write it, e.g. getByRole('button', { name: 'Save' }). */
export function describeStrategy(strategy: LocatorStrategy): string {
  switch (strategy.kind) {
    case 'root': return 'screen';
    case 'label': return `getByLabel(${describeValue(strategy.value)}${describeExact(strategy.exact)})`;
    case 'testId': return `getByTestId(${describeValue(strategy.value)})`;
    case 'text': return `getByText(${describeValue(strategy.value)}${describeExact(strategy.exact)})`;
    case 'type': return `getByType(${describeValue(strategy.value)})`;
    case 'placeholder': return `getByPlaceholder(${describeValue(strategy.value)}${describeExact(strategy.exact)})`;
    case 'webview': return strategy.testId === undefined ? 'getByWebView()' : `getByWebView({ testId: ${describeValue(strategy.testId)} })`;
    case 'role': {
      const name = strategy.name === undefined ? '' : `, { name: ${describeValue(strategy.name)} }`;
      return `getByRole(${describeValue(strategy.value)}${name})`;
    }
    case 'chain':
      return strategy.parent.kind === 'root'
        ? describeStrategy(strategy.child)
        : `${describeStrategy(strategy.parent)}.${describeStrategy(strategy.child)}`;
    case 'nth':
      if (strategy.index === 0) return `${describeStrategy(strategy.parent)}.first()`;
      if (strategy.index === -1) return `${describeStrategy(strategy.parent)}.last()`;
      return `${describeStrategy(strategy.parent)}.nth(${strategy.index})`;
    case 'filter': {
      const parts: string[] = [];
      if (strategy.hasText !== undefined) parts.push(`hasText: ${describeValue(strategy.hasText)}`);
      if (strategy.hasNotText !== undefined) parts.push(`hasNotText: ${describeValue(strategy.hasNotText)}`);
      if (strategy.has !== undefined) parts.push(`has: ${describeStrategy(strategy.has)}`);
      if (strategy.hasNot !== undefined) parts.push(`hasNot: ${describeStrategy(strategy.hasNot)}`);
      return `${describeStrategy(strategy.parent)}.filter({ ${parts.join(', ')} })`;
    }
    case 'and': return `${describeStrategy(strategy.left)}.and(${describeStrategy(strategy.right)})`;
    case 'or': return `${describeStrategy(strategy.left)}.or(${describeStrategy(strategy.right)})`;
  }
}

/** Short description of a node for error messages: type, visible text and test id. */
export function describeNode(node: ViewNode): string {
  const text = node.label ?? node.text ?? node.value ?? '';
  const id = node.identifier ?? node.resourceId ?? node.key;
  return `${node.type} ${JSON.stringify(text)}${id ? ` [${id}]` : ''}`;
}

/**
 * Collapse matches that sit on one ancestor chain into their outermost node:
 * an iOS Button and the StaticText inside it carry the same label and are one
 * element reported at two levels. `matches` is in document order, so an
 * ancestor always precedes its descendants.
 */
export function collapseAncestorChains(matches: ViewNode[]): ViewNode[] {
  const kept: ViewNode[] = [];
  for (const node of matches) {
    const insideKept = kept.some((outer) => flattenNodes(outer.children).includes(node));
    if (!insideKept) {
      kept.push(node);
    }
  }
  return kept;
}
