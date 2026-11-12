// Converts mobilecli's unfiltered iOS tree (device.dump.ui with format "raw")
// into ViewNodes. mobilecli's default iOS filter drops XCUIElementTypeOther
// nodes that have no accessibilityIdentifier, even when they carry a label.
// This filter keeps any visible node with a label, identifier, value or placeholder.

import type { ViewNode } from '@mobilewright/protocol';

/** One node of the raw XCTest snapshot as mobilecli returns it. */
export interface RawIosNode {
  elementType?: number;
  label?: string;
  identifier?: string;
  title?: string;
  value?: unknown;
  placeholderValue?: string;
  enabled?: boolean;
  selected?: boolean;
  hasFocus?: boolean;
  frame?: { X: number; Y: number; Width: number; Height: number };
  children?: RawIosNode[];
}

/** XCUIElementType raw values (XCTest), index = enum value. */
const XCUI_ELEMENT_TYPES = [
  'Any', 'Other', 'Application', 'Group', 'Window', 'Sheet', 'Drawer', 'Alert', 'Dialog', 'Button',
  'RadioButton', 'RadioGroup', 'CheckBox', 'DisclosureTriangle', 'PopUpButton', 'ComboBox', 'MenuButton',
  'ToolbarButton', 'Popover', 'Keyboard', 'Key', 'NavigationBar', 'TabBar', 'TabGroup', 'Toolbar',
  'StatusBar', 'Table', 'TableRow', 'TableColumn', 'Outline', 'OutlineRow', 'Browser', 'CollectionView',
  'Slider', 'PageIndicator', 'ProgressIndicator', 'ActivityIndicator', 'SegmentedControl', 'Picker',
  'PickerWheel', 'Switch', 'Toggle', 'Link', 'Image', 'Icon', 'SearchField', 'ScrollView', 'ScrollBar',
  'StaticText', 'TextField', 'SecureTextField', 'DatePicker', 'TextView', 'Menu', 'MenuItem', 'MenuBar',
  'MenuBarItem', 'Map', 'WebView', 'IncrementArrow', 'DecrementArrow', 'Timeline', 'RatingIndicator',
  'ValueIndicator', 'SplitGroup', 'Splitter', 'RelevanceIndicator', 'ColorWell', 'HelpTag', 'Matte',
  'DockItem', 'Ruler', 'RulerMarker', 'Grid', 'LevelIndicator', 'Cell', 'LayoutArea', 'LayoutItem',
  'Handle', 'Stepper', 'Tab', 'TouchBar', 'StatusItem',
];

/** Kept even with no label/identifier, because they are interactive by nature. */
const ALWAYS_KEEP = new Set([
  'Button', 'TextField', 'SecureTextField', 'TextView', 'SearchField', 'Switch', 'Toggle',
  'Slider', 'Picker', 'PickerWheel', 'WebView',
]);

/** Containers that would only add a whole-screen node to the list. */
const NEVER_KEEP = new Set(['Application', 'Window']);

function typeName(elementType: number | undefined): string {
  return XCUI_ELEMENT_TYPES[elementType ?? 1] ?? 'Other';
}

function nonEmpty(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value);
  return text.trim() === '' ? undefined : text;
}

/** On screen and non-zero size. Partly off-screen nodes (x < 0) still count. */
function isOnScreen(frame: RawIosNode['frame']): boolean {
  if (!frame) return false;
  return frame.Width > 0 && frame.Height > 0 && frame.X + frame.Width > 0 && frame.Y + frame.Height > 0;
}

/** Children of a rejected node are hoisted to the nearest kept ancestor. */
export function rawIosTreeToViewNodes(node: RawIosNode): ViewNode[] {
  const children = (node.children ?? []).flatMap(rawIosTreeToViewNodes);

  const type = typeName(node.elementType);
  const label = nonEmpty(node.label);
  const identifier = nonEmpty(node.identifier);
  const value = nonEmpty(node.value);
  const placeholder = nonEmpty(node.placeholderValue);
  const describable = Boolean(label || identifier || value || placeholder);

  const keep = !NEVER_KEEP.has(type) && isOnScreen(node.frame) && (describable || ALWAYS_KEEP.has(type));
  if (!keep) {
    return children;
  }

  const frame = node.frame!;
  return [{
    type,
    label,
    identifier,
    value,
    // No `text`: core's getByText already falls back to label on iOS.
    placeholder,
    isVisible: true,
    isEnabled: node.enabled ?? true,
    isSelected: node.selected ?? false,
    isFocused: node.hasFocus ?? false,
    isChecked: false,
    bounds: {
      x: Math.round(frame.X),
      y: Math.round(frame.Y),
      width: Math.round(frame.Width),
      height: Math.round(frame.Height),
    },
    children,
    raw: { ...node, children: undefined },
  }];
}
