import type { ViewNode } from '@mobilewright/protocol';

/**
 * Walk XML as a sequence of open/close/self-closing tags, calling
 * `createNode` for each non-wrapper element. Handles wrapper elements
 * (like AppiumAUT, hierarchy) by promoting their children.
 */
export function parseXmlHierarchy(
  xml: string,
  wrapperTag: string,
  createNode: (tagName: string, attrs: Map<string, string>) => ViewNode,
): ViewNode[] {
  const nodes: ViewNode[] = [];
  const stack: ViewNode[] = [];

  const tagRegex =
    /<(\/?)(\w+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(xml)) !== null) {
    const [, isClose, tagName, attrString, isSelfClose] = match;

    if (isClose) {
      const node = stack.pop();
      if (node) {
        const parent = stack[stack.length - 1];
        if (parent) {
          parent.children.push(node);
        } else {
          nodes.push(node);
        }
      }
      continue;
    }

    // Skip wrapper elements
    if (tagName === wrapperTag) {
      if (!isSelfClose) {
        stack.push({
          type: '__wrapper__',
          isVisible: true,
          isEnabled: true,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          children: [],
        });
      }
      continue;
    }

    const attrs = parseAttributes(attrString);
    const node = createNode(tagName, attrs);

    if (isSelfClose) {
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(node);
      } else {
        nodes.push(node);
      }
    } else {
      stack.push(node);
    }
  }

  // Drain any remaining stack (shouldn't happen with valid XML)
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === '__wrapper__') {
      nodes.push(...node.children);
    } else {
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(node);
      } else {
        nodes.push(node);
      }
    }
  }

  return unwrapWrappers(nodes);
}

export function parseAttributes(attrString: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrRegex = /([\w:-]+)="([^"]*)"/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRegex.exec(attrString)) !== null) {
    attrs.set(attrMatch[1], attrMatch[2]);
  }
  return attrs;
}

function unwrapWrappers(nodes: ViewNode[]): ViewNode[] {
  const result: ViewNode[] = [];
  for (const node of nodes) {
    if (node.type === '__wrapper__') {
      result.push(...unwrapWrappers(node.children));
    } else {
      node.children = unwrapWrappers(node.children);
      result.push(node);
    }
  }
  return result;
}
