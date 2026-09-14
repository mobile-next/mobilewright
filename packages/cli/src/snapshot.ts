import type { Bounds, ViewNode } from '@mobilewright/protocol';
import { ROLE_TYPE_MAP, bareTypeName } from '@mobilewright/core';

export interface SnapshotLine {
  ref: string;
  depth: number;
  role: string;
  name?: string;
  attrs: string[];
}

export interface SnapshotResult {
  lines: SnapshotLine[];
  /** Every node in document order, keyed by ref — including nodes not printed. */
  refs: Record<string, Bounds>;
  /** Node identity for each ref, so `find` can map query matches back to refs. */
  nodes: Map<ViewNode, string>;
}

const INTERACTIVE_ROLES = new Set(['button', 'textfield', 'switch', 'checkbox', 'radio', 'slider', 'tab', 'link']);

function roleOf(node: ViewNode): string {
  const bare = bareTypeName(node.type);
  for (const [role, types] of Object.entries(ROLE_TYPE_MAP)) {
    if ((types as readonly string[]).includes(bare)) {
      return role;
    }
  }
  return bare || 'other';
}

function nameOf(node: ViewNode): string | undefined {
  return node.label || node.text || node.value || undefined;
}

function attrsOf(node: ViewNode): string[] {
  const attrs: string[] = [];
  if (node.identifier) { attrs.push(`testid=${JSON.stringify(node.identifier)}`); }
  if (node.placeholder) { attrs.push(`placeholder=${JSON.stringify(node.placeholder)}`); }
  if (node.value && node.value !== nameOf(node)) { attrs.push(`value=${JSON.stringify(node.value)}`); }
  if (!node.isVisible) { attrs.push('hidden'); }
  if (!node.isEnabled) { attrs.push('disabled'); }
  if (node.isChecked) { attrs.push('checked'); }
  if (node.isSelected) { attrs.push('selected'); }
  if (node.isFocused) { attrs.push('focused'); }
  return attrs;
}

/** A node earns a line when it carries text or is something the user can act on. */
function isInteresting(node: ViewNode, role: string): boolean {
  return Boolean(nameOf(node) || node.identifier || node.placeholder) || INTERACTIVE_ROLES.has(role);
}

/**
 * Flatten a view hierarchy into Playwright-style snapshot lines.
 * Refs are assigned to every node in document order (e1, e2, ...) so a later
 * `find` on the same tree yields refs that agree with the printed snapshot.
 */
export function renderSnapshot(roots: ViewNode[]): SnapshotResult {
  const lines: SnapshotLine[] = [];
  const refs: Record<string, Bounds> = {};
  const nodes = new Map<ViewNode, string>();
  let counter = 0;

  function visit(node: ViewNode, depth: number): void {
    counter += 1;
    const ref = `e${counter}`;
    refs[ref] = node.bounds;
    nodes.set(node, ref);
    const printed = isInteresting(node, roleOf(node));
    if (printed) {
      lines.push(lineFor(node, ref, depth));
    }
    for (const child of node.children) {
      visit(child, printed ? depth + 1 : depth);
    }
  }

  for (const root of roots) {
    visit(root, 0);
  }
  return { lines, refs, nodes };
}

/** The snapshot line for any node, printed or not — `find` uses it for bare containers. */
export function lineFor(node: ViewNode, ref: string, depth = 0): SnapshotLine {
  return { ref, depth, role: roleOf(node), name: nameOf(node), attrs: attrsOf(node) };
}

export function formatLine(line: SnapshotLine): string {
  const name = line.name === undefined ? '' : ` ${JSON.stringify(line.name)}`;
  const attrs = line.attrs.map((a) => ` [${a}]`).join('');
  return `${'  '.repeat(line.depth)}- ${line.role}${name} [ref=${line.ref}]${attrs}`;
}

export function formatSnapshot(lines: SnapshotLine[]): string {
  return lines.map(formatLine).join('\n');
}
