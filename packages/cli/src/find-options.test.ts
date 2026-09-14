import { test, expect } from '@playwright/test';
import { buildStrategy } from './find-options.js';

test('a single flag becomes a plain strategy', () => {
  expect(buildStrategy({ text: 'Login' })).toEqual({ kind: 'text', value: 'Login', exact: undefined });
  expect(buildStrategy({ testId: 'submit' })).toEqual({ kind: 'testId', value: 'submit' });
});

test('slash-delimited values become regular expressions', () => {
  expect(buildStrategy({ text: '/log ?in/i' })).toEqual({ kind: 'text', value: /log ?in/i, exact: undefined });
  expect(buildStrategy({ role: 'button', name: '/sign/' })).toEqual({ kind: 'role', value: 'button', name: /sign/ });
});

test('several flags are combined with and', () => {
  expect(buildStrategy({ role: 'button', text: 'Go' })).toEqual({
    kind: 'and',
    left: { kind: 'text', value: 'Go', exact: undefined },
    right: { kind: 'role', value: 'button', name: undefined },
  });
});

test('has-text wraps the base strategy in a filter, then nth picks one match', () => {
  expect(buildStrategy({ role: 'listitem', hasText: 'Milk', nth: '-1' })).toEqual({
    kind: 'nth',
    index: -1,
    parent: { kind: 'filter', parent: { kind: 'role', value: 'listitem', name: undefined }, hasText: 'Milk', hasNotText: undefined },
  });
});

test('first and last are shorthands for nth', () => {
  expect(buildStrategy({ text: 'x', first: true })).toMatchObject({ kind: 'nth', index: 0 });
  expect(buildStrategy({ text: 'x', last: true })).toMatchObject({ kind: 'nth', index: -1 });
});

test('unknown roles and missing selectors are rejected with a helpful message', () => {
  expect(() => buildStrategy({ role: 'textbox' })).toThrow('unknown role "textbox"');
  expect(() => buildStrategy({})).toThrow('specify at least one of');
  expect(() => buildStrategy({ text: 'x', nth: 'two' })).toThrow('--nth must be an integer');
});
