import type { ViewNode } from '@mobilewright/protocol';
import { parseXmlHierarchy } from './shared.js';

/**
 * Parses Android UIAutomator XML hierarchy into ViewNode[].
 *
 * UIAutomator XML looks like:
 * <hierarchy rotation="0">
 *   <node index="0" text="" resource-id="" class="android.widget.FrameLayout"
 *     package="com.example" content-desc="" checkable="false" checked="false"
 *     clickable="false" enabled="true" focusable="false" focused="false"
 *     scrollable="false" long-clickable="false" password="false"
 *     selected="false" visible-to-user="true"
 *     bounds="[0,0][1080,1920]">
 *     <node ... />
 *   </node>
 * </hierarchy>
 *
 * Key differences from iOS:
 * - All elements are <node> tags; the type is in the "class" attribute
 * - bounds format is "[left,top][right,bottom]"
 * - content-desc is the accessibility label
 * - resource-id is the identifier
 */
export function parseAndroidHierarchy(xml: string): ViewNode[] {
  return parseXmlHierarchy(xml, 'hierarchy', androidNodeFromAttrs);
}

function androidNodeFromAttrs(
  _tagName: string,
  attrs: Map<string, string>,
): ViewNode {
  // Shorten class name: "android.widget.Button" -> "Button"
  const fullClass = attrs.get('class') || 'View';
  const type = fullClass.includes('.')
    ? fullClass.split('.').pop()!
    : fullClass;

  // resource-id often looks like "com.example:id/login_button"
  // Extract just the id part after "/"
  const rawResourceId = attrs.get('resource-id') || '';
  const identifier = rawResourceId.includes('/')
    ? rawResourceId.split('/').pop()
    : rawResourceId || undefined;

  const contentDesc = attrs.get('content-desc') || '';
  const text = attrs.get('text') || '';

  const raw: Record<string, unknown> = {};
  for (const [k, v] of attrs) {
    raw[k] = v;
  }

  return {
    type,
    label: contentDesc || undefined,
    identifier: identifier || undefined,
    value: undefined,
    text: text || undefined,
    placeholder: attrs.get('hint') || undefined,
    isVisible: attrs.get('visible-to-user') !== 'false',
    isEnabled: attrs.get('enabled') === 'true',
    isSelected: attrs.get('selected') === 'true' ? true : undefined,
    isFocused: attrs.get('focused') === 'true' ? true : undefined,
    bounds: parseBounds(attrs.get('bounds') || ''),
    children: [],
    raw,
  };
}

/**
 * Parse Android bounds format "[left,top][right,bottom]" -> {x, y, width, height}
 */
function parseBounds(boundsStr: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const match = boundsStr.match(
    /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/,
  );
  if (!match) return { x: 0, y: 0, width: 0, height: 0 };

  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
