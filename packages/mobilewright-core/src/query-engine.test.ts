import { test, expect } from '@playwright/test';
import type { ViewNode } from '@mobilewright/protocol';
import { queryAll, type LocatorStrategy } from './query-engine.js';

function node(
  overrides: Partial<ViewNode> & { type: string },
): ViewNode {
  return {
    isVisible: true,
    isEnabled: true,
    bounds: { x: 0, y: 0, width: 100, height: 44 },
    children: [],
    ...overrides,
  };
}

const sampleTree: ViewNode[] = [
  node({
    type: 'Application',
    children: [
      node({
        type: 'Window',
        children: [
          node({
            type: 'NavigationBar',
            label: 'Login',
            children: [
              node({ type: 'StaticText', label: 'Login', text: 'Login' }),
            ],
          }),
          node({
            type: 'TextField',
            label: 'Email',
            identifier: 'emailField',
            placeholder: 'Enter email',
            bounds: { x: 20, y: 120, width: 350, height: 44 },
          }),
          node({
            type: 'SecureTextField',
            label: 'Password',
            identifier: 'passwordField',
            bounds: { x: 20, y: 180, width: 350, height: 44 },
          }),
          node({
            type: 'Button',
            label: 'Sign In',
            identifier: 'loginButton',
            bounds: { x: 20, y: 250, width: 350, height: 50 },
          }),
          node({
            type: 'Button',
            label: 'Forgot Password?',
            identifier: 'forgotPassword',
            isVisible: false,
            bounds: { x: 20, y: 320, width: 350, height: 30 },
          }),
          node({
            type: 'Switch',
            label: 'Remember Me',
            identifier: 'rememberMe',
            value: '0',
            bounds: { x: 20, y: 370, width: 51, height: 31 },
          }),
        ],
      }),
    ],
  }),
];

test.describe('queryAll', () => {
  test('finds by label (exact)', () => {
    const results = queryAll(sampleTree, { kind: 'label', value: 'Sign In' });
    expect(results).toHaveLength(1);
    expect(results[0].identifier).toBe('loginButton');
  });

  test('finds by label (substring, exact=false)', () => {
    const results = queryAll(sampleTree, {
      kind: 'label',
      value: 'sign in',
      exact: false,
    });
    expect(results).toHaveLength(1);
    expect(results[0].identifier).toBe('loginButton');
  });

  test('finds by testId', () => {
    const results = queryAll(sampleTree, {
      kind: 'testId',
      value: 'emailField',
    });
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Email');
  });

  test('finds by text (exact string)', () => {
    const results = queryAll(sampleTree, {
      kind: 'text',
      value: 'Login',
    });
    // StaticText has text='Login', NavigationBar has label='Login'
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('NavigationBar');
  });

  test('finds by text (regex)', () => {
    const results = queryAll(sampleTree, {
      kind: 'text',
      value: /forgot/i,
    });
    expect(results).toHaveLength(1);
    expect(results[0].identifier).toBe('forgotPassword');
  });

  test('finds by type', () => {
    const results = queryAll(sampleTree, {
      kind: 'type',
      value: 'Button',
    });
    expect(results).toHaveLength(2);
  });

  test('type matching is case-insensitive', () => {
    const results = queryAll(sampleTree, {
      kind: 'type',
      value: 'button',
    });
    expect(results).toHaveLength(2);
  });

  test('finds by role (button)', () => {
    const results = queryAll(sampleTree, {
      kind: 'role',
      value: 'button',
    });
    expect(results).toHaveLength(2);
  });

  test('finds by role with name filter', () => {
    const results = queryAll(sampleTree, {
      kind: 'role',
      value: 'button',
      name: 'Sign In',
    });
    expect(results).toHaveLength(1);
    expect(results[0].identifier).toBe('loginButton');
  });

  test('finds by role with regex name filter', () => {
    const results = queryAll(sampleTree, {
      kind: 'role',
      value: 'button',
      name: /forgot/i,
    });
    expect(results).toHaveLength(1);
    expect(results[0].identifier).toBe('forgotPassword');
  });

  test('supports chained queries', () => {
    const strategy: LocatorStrategy = {
      kind: 'chain',
      parent: { kind: 'type', value: 'NavigationBar' },
      child: { kind: 'type', value: 'StaticText' },
    };
    const results = queryAll(sampleTree, strategy);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Login');
  });

  test('returns empty array when nothing matches', () => {
    const results = queryAll(sampleTree, {
      kind: 'testId',
      value: 'nonExistent',
    });
    expect(results).toHaveLength(0);
  });

  test('returns results in document order', () => {
    const results = queryAll(sampleTree, { kind: 'type', value: 'Button' });
    expect(results[0].label).toBe('Sign In');
    expect(results[1].label).toBe('Forgot Password?');
  });
});

test.describe('queryAll with flat hierarchy (bounds-based chains)', () => {
  // Simulates mobilecli's flat element list — no children, all at root level
  const flatList: ViewNode[] = [
    node({
      type: 'Cell',
      label: 'Row 1',
      bounds: { x: 0, y: 0, width: 400, height: 100 },
    }),
    node({
      type: 'StaticText',
      label: 'Title 1',
      text: 'Title 1',
      bounds: { x: 10, y: 10, width: 200, height: 30 },
    }),
    node({
      type: 'Button',
      label: 'Delete',
      identifier: 'delete1',
      bounds: { x: 300, y: 10, width: 80, height: 30 },
    }),
    node({
      type: 'Cell',
      label: 'Row 2',
      bounds: { x: 0, y: 100, width: 400, height: 100 },
    }),
    node({
      type: 'StaticText',
      label: 'Title 2',
      text: 'Title 2',
      bounds: { x: 10, y: 110, width: 200, height: 30 },
    }),
    node({
      type: 'Button',
      label: 'Delete',
      identifier: 'delete2',
      bounds: { x: 300, y: 110, width: 80, height: 30 },
    }),
  ];

  test('chain finds elements within parent bounds', () => {
    const strategy: LocatorStrategy = {
      kind: 'chain',
      parent: { kind: 'label', value: 'Row 1' },
      child: { kind: 'role', value: 'button' },
    };
    const results = queryAll(flatList, strategy);
    expect(results).toHaveLength(1);
    expect(results[0].identifier).toBe('delete1');
  });

  test('chain finds text within specific row', () => {
    const strategy: LocatorStrategy = {
      kind: 'chain',
      parent: { kind: 'label', value: 'Row 2' },
      child: { kind: 'type', value: 'StaticText' },
    };
    const results = queryAll(flatList, strategy);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Title 2');
  });

  test('chain returns empty when no children in parent bounds', () => {
    const strategy: LocatorStrategy = {
      kind: 'chain',
      parent: { kind: 'label', value: 'Row 1' },
      child: { kind: 'type', value: 'Image' },
    };
    const results = queryAll(flatList, strategy);
    expect(results).toHaveLength(0);
  });

  test('does not match parent itself as a child result', () => {
    const strategy: LocatorStrategy = {
      kind: 'chain',
      parent: { kind: 'label', value: 'Row 1' },
      child: { kind: 'type', value: 'Cell' },
    };
    const results = queryAll(flatList, strategy);
    // Row 2 is NOT within Row 1's bounds, and Row 1 should not match itself
    expect(results).toHaveLength(0);
  });
});

test.describe('React Native Android role mapping', () => {
  const rnTree: ViewNode[] = [
    node({
      type: 'ReactViewGroup',
      label: 'Login',
      raw: { clickable: 'true', accessible: 'true' },
      children: [
        node({ type: 'ReactTextView', text: 'Hello World' }),
        node({
          type: 'ReactEditText',
          placeholder: 'Enter email',
          raw: { hint: 'Enter email' },
        }),
        node({ type: 'ReactImageView', label: 'Avatar' }),
        node({
          type: 'ReactScrollView',
          children: [
            node({ type: 'ReactTextView', text: 'Item 1' }),
          ],
        }),
      ],
    }),
    node({
      type: 'ReactViewGroup',
      label: 'Container',
      raw: { clickable: 'false', accessible: 'false' },
    }),
  ];

  test('ReactViewGroup with clickable=true matches button role', () => {
    const results = queryAll(rnTree, { kind: 'role', value: 'button' });
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Login');
  });

  test('ReactViewGroup without clickable does not match button role', () => {
    const results = queryAll(rnTree, { kind: 'role', value: 'button', name: 'Container' });
    expect(results).toHaveLength(0);
  });

  test('ReactTextView matches text role', () => {
    const results = queryAll(rnTree, { kind: 'role', value: 'text' });
    expect(results).toHaveLength(2);
  });

  test('ReactEditText matches textfield role', () => {
    const results = queryAll(rnTree, { kind: 'role', value: 'textfield' });
    expect(results).toHaveLength(1);
  });

  test('ReactImageView matches image role', () => {
    const results = queryAll(rnTree, { kind: 'role', value: 'image' });
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Avatar');
  });

  test('ReactScrollView matches list role', () => {
    const results = queryAll(rnTree, { kind: 'role', value: 'list' });
    expect(results).toHaveLength(1);
  });
});

test.describe('placeholder strategy', () => {
  const tree: ViewNode[] = [
    node({ type: 'TextField', placeholder: 'Enter email' }),
    node({ type: 'TextField', placeholder: 'Enter password' }),
    node({ type: 'Button', label: 'Submit' }),
  ];

  test('finds by exact placeholder', () => {
    const results = queryAll(tree, { kind: 'placeholder', value: 'Enter email' });
    expect(results).toHaveLength(1);
    expect(results[0].placeholder).toBe('Enter email');
  });

  test('finds by substring placeholder (exact=false)', () => {
    const results = queryAll(tree, { kind: 'placeholder', value: 'enter', exact: false });
    expect(results).toHaveLength(2);
  });

  test('returns empty when no placeholder matches', () => {
    const results = queryAll(tree, { kind: 'placeholder', value: 'Phone' });
    expect(results).toHaveLength(0);
  });
});

test.describe('testId with resourceId', () => {
  const tree: ViewNode[] = [
    node({
      type: 'EditText',
      identifier: 'login_button',
      resourceId: 'com.example:id/login_button',
    }),
  ];

  test('matches short identifier', () => {
    const results = queryAll(tree, { kind: 'testId', value: 'login_button' });
    expect(results).toHaveLength(1);
  });

  test('matches full resourceId', () => {
    const results = queryAll(tree, { kind: 'testId', value: 'com.example:id/login_button' });
    expect(results).toHaveLength(1);
  });

  test('does not match partial resourceId', () => {
    const results = queryAll(tree, { kind: 'testId', value: 'example:id/login_button' });
    expect(results).toHaveLength(0);
  });
});
