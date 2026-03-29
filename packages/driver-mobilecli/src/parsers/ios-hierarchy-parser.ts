import type { ViewNode } from '@mobilewright/protocol';
import { parseXmlHierarchy } from './shared.js';

/**
 * Parses iOS WDA (WebDriverAgent) XML hierarchy into ViewNode[].
 *
 * WDA XML looks like:
 * <AppiumAUT>
 *   <XCUIElementTypeApplication type="XCUIElementTypeApplication"
 *     name="MyApp" label="MyApp" enabled="true" visible="true"
 *     accessible="false" x="0" y="0" width="390" height="844">
 *     <XCUIElementTypeWindow ...>
 *       <XCUIElementTypeButton name="loginButton" label="Log In"
 *         enabled="true" visible="true" x="20" y="100" width="350" height="44"/>
 *     </XCUIElementTypeWindow>
 *   </XCUIElementTypeApplication>
 * </AppiumAUT>
 *
 * Each element tag IS the type (e.g. XCUIElementTypeButton).
 * Attributes include: type, name, label, value, enabled, visible,
 * accessible, x, y, width, height, index, selected, focused.
 */
export function parseIosHierarchy(xml: string): ViewNode[] {
  return parseXmlHierarchy(xml, 'AppiumAUT', iosNodeFromAttrs);
}

function iosNodeFromAttrs(
  tagName: string,
  attrs: Map<string, string>,
): ViewNode {
  // Strip "XCUIElementType" prefix for cleaner type names
  const type = tagName.startsWith('XCUIElementType')
    ? tagName.slice('XCUIElementType'.length)
    : tagName;

  const raw: Record<string, unknown> = {};
  for (const [k, v] of attrs) {
    raw[k] = v;
  }

  return {
    type,
    label: attrs.get('label') || undefined,
    identifier: attrs.get('name') || undefined,
    value: attrs.get('value') || undefined,
    text: undefined,
    placeholder: attrs.get('placeholderValue') || undefined,
    isVisible: attrs.get('visible') === 'true',
    isEnabled: attrs.get('enabled') === 'true',
    isSelected: attrs.get('selected') === 'true' ? true : undefined,
    isFocused: attrs.get('focused') === 'true' ? true : undefined,
    bounds: {
      x: parseNumericAttribute(attrs.get('x')),
      y: parseNumericAttribute(attrs.get('y')),
      width: parseNumericAttribute(attrs.get('width')),
      height: parseNumericAttribute(attrs.get('height')),
    },
    children: [],
    raw,
  };
}

function parseNumericAttribute(val: string | undefined): number {
  if (val === undefined) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}
