import { test, expect } from '@playwright/test';
import type { ViewNode } from '@mobilewright/protocol';
import { deriveLocator, deriveElementList } from './locator-derivation.js';

function node(overrides: Partial<ViewNode> = {}): ViewNode {
  return {
    type: 'statictext',
    isVisible: true,
    isEnabled: true,
    bounds: { x: 0, y: 0, width: 100, height: 30 },
    children: [],
    ...overrides,
  } as ViewNode;
}

function roleName(locator: ReturnType<typeof deriveLocator>): string | undefined {
  return locator?.kind === 'role' ? locator.name : undefined;
}

// ---- Priority order ----

test.describe('deriveLocator — priority order', () => {
  test('testId (identifier) beats role, label, text', () => {
    expect(
      deriveLocator(node({ type: 'button', identifier: 'my-id', label: 'Label', text: 'Text' })),
    ).toEqual({ kind: 'testId', value: 'my-id' });
  });

  test('testId (resourceId) beats role, label, text', () => {
    expect(
      deriveLocator(node({ resourceId: 'com.example:id/btn', label: 'Tap me' })),
    ).toEqual({ kind: 'testId', value: 'com.example:id/btn' });
  });

  test('identifier takes precedence over resourceId', () => {
    expect(
      deriveLocator(node({ identifier: 'first', resourceId: 'second' })),
    ).toEqual({ kind: 'testId', value: 'first' });
  });

  test('role beats label and text', () => {
    const result = deriveLocator(node({ type: 'button', label: 'Tap', text: 'Tap me' }));
    expect(result?.kind).toBe('role');
    expect(result?.value).toBe('button');
  });

  test('label beats text', () => {
    expect(
      deriveLocator(node({ type: 'unknown', label: 'My Label', text: 'My Text' })),
    ).toEqual({ kind: 'label', value: 'My Label' });
  });

  test('text used when no label and no role', () => {
    expect(
      deriveLocator(node({ type: 'unknown', text: 'Hello' })),
    ).toEqual({ kind: 'text', value: 'Hello' });
  });

  test('value used as text fallback', () => {
    expect(
      deriveLocator(node({ type: 'unknown', value: 'typed' })),
    ).toEqual({ kind: 'text', value: 'typed' });
  });

  test('returns null when nothing available', () => {
    expect(deriveLocator(node({ type: 'unknown' }))).toBeNull();
  });
});

// ---- Role: name field ----

test.describe('deriveLocator — role name', () => {
  test('role includes name from label', () => {
    expect(
      deriveLocator(node({ type: 'button', label: 'Submit' })),
    ).toEqual({ kind: 'role', value: 'button', name: 'Submit' });
  });

  test('role includes name from text when no label', () => {
    expect(
      deriveLocator(node({ type: 'button', text: 'OK' })),
    ).toEqual({ kind: 'role', value: 'button', name: 'OK' });
  });

  test('role with no label or text has undefined name', () => {
    expect(
      deriveLocator(node({ type: 'button' })),
    ).toEqual({ kind: 'role', value: 'button', name: undefined });
  });
});

// ---- Role type mapping ----

const roleMappingCases: [string, string][] = [
  ['button',            'button'],
  ['imagebutton',       'button'],
  ['textfield',         'textfield'],
  ['securetextfield',   'textfield'],
  ['edittext',          'textfield'],
  ['searchfield',       'textfield'],
  ['reactedittext',     'textfield'],
  ['statictext',        'text'],
  ['textview',          'text'],
  ['text',              'text'],
  ['image',             'image'],
  ['imageview',         'image'],
  ['reactimageview',    'image'],
  ['switch',            'switch'],
  ['toggle',            'switch'],
  ['checkbox',          'checkbox'],
  ['slider',            'slider'],
  ['seekbar',           'slider'],
  ['table',             'list'],
  ['collectionview',    'list'],
  ['listview',          'list'],
  ['recyclerview',      'list'],
  ['scrollview',        'list'],
  ['reactscrollview',   'list'],
  ['cell',              'listitem'],
  ['linearlayout',      'listitem'],
  ['relativelayout',    'listitem'],
  ['tab',               'tab'],
  ['tabbar',            'tab'],
  ['link',              'link'],
  ['navigationbar',     'header'],
  ['toolbar',           'header'],
  ['header',            'header'],
];

test.describe('deriveLocator — role type mapping', () => {
  for (const [type, expectedRole] of roleMappingCases) {
    test(`${type} -> ${expectedRole}`, () => {
      const result = deriveLocator(node({ type }));
      expect(result?.kind).toBe('role');
      expect(result?.value).toBe(expectedRole);
    });
  }

  test('unknown type does not get a role', () => {
    expect(deriveLocator(node({ type: 'unknownwidget' }))?.kind).not.toBe('role');
  });

  test('other type does not map to listitem', () => {
    const result = deriveLocator(node({ type: 'other' }));
    expect(result?.value).not.toBe('listitem');
  });
});

// ---- Case-insensitive type ----

test.describe('deriveLocator — case insensitive type', () => {
  test('BUTTON maps to button role', () => {
    const result = deriveLocator(node({ type: 'BUTTON' }));
    expect(result?.kind).toBe('role');
    expect(result?.value).toBe('button');
  });

  test('MixedCase maps correctly', () => {
    const result = deriveLocator(node({ type: 'StaticText' }));
    expect(result?.kind).toBe('role');
    expect(result?.value).toBe('text');
  });
});

// ---- reactviewgroup special case ----

test.describe('deriveLocator — reactviewgroup', () => {
  test('clickable=true -> button role', () => {
    expect(
      deriveLocator(node({ type: 'reactviewgroup', raw: { clickable: 'true' } })),
    ).toEqual({ kind: 'role', value: 'button', name: undefined });
  });

  test('accessible=true -> button role', () => {
    expect(
      deriveLocator(node({ type: 'reactviewgroup', raw: { accessible: 'true' } })),
    ).toEqual({ kind: 'role', value: 'button', name: undefined });
  });

  test('clickable=false falls through to label', () => {
    expect(
      deriveLocator(node({ type: 'reactviewgroup', label: 'wrapper', raw: { clickable: 'false' } })),
    ).toEqual({ kind: 'label', value: 'wrapper' });
  });

  test('no raw prop falls through to label', () => {
    expect(
      deriveLocator(node({ type: 'reactviewgroup', label: 'wrapper' })),
    ).toEqual({ kind: 'label', value: 'wrapper' });
  });

  test('non-clickable with no label returns null', () => {
    expect(deriveLocator(node({ type: 'reactviewgroup' }))).toBeNull();
  });
});

// ---- deriveElementList ----

test.describe('deriveElementList', () => {
  test('empty input returns empty array', () => {
    expect(deriveElementList([])).toEqual([]);
  });

  test('flattens nested tree depth-first', () => {
    const roots = [
      node({ type: 'table', identifier: 'list', children: [
        node({ type: 'cell', label: 'Row 1', children: [] }),
        node({ type: 'cell', label: 'Row 2', children: [] }),
      ] }),
    ];
    const result = deriveElementList(roots);
    expect(result.length).toBe(3);
    expect(result[0].locator?.kind).toBe('testId');
    expect(result[0].locator?.value).toBe('list');
    expect(result[1].locator?.kind).toBe('role');
    expect(result[1].locator?.value).toBe('listitem');
    expect(roleName(result[1].locator)).toBe('Row 1');
    expect(roleName(result[2].locator)).toBe('Row 2');
  });

  test('includes nodes with no locator', () => {
    const result = deriveElementList([node({ type: 'unknown' })]);
    expect(result.length).toBe(1);
    expect(result[0].locator).toBeNull();
  });

  test('each entry has node and locator fields', () => {
    const root = node({ type: 'button', label: 'Go' });
    const result = deriveElementList([root]);
    expect('node' in result[0]).toBe(true);
    expect('locator' in result[0]).toBe(true);
    expect(result[0].node).toBe(root);
  });

  test('deeply nested tree flattened correctly', () => {
    const deep = node({ type: 'button', label: 'Deep', children: [] });
    const mid = node({ type: 'statictext', text: 'Mid', children: [deep] });
    const root = node({ identifier: 'root', children: [mid] });
    const result = deriveElementList([root]);
    expect(result.length).toBe(3);
    expect(result[0].locator?.value).toBe('root');
    expect(result[1].locator?.kind).toBe('role');
    expect(roleName(result[1].locator)).toBe('Mid');
    expect(result[2].locator?.kind).toBe('role');
    expect(roleName(result[2].locator)).toBe('Deep');
  });
});
