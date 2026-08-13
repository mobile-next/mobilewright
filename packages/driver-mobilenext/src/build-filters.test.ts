import { test, expect } from '@playwright/test';
import { buildFilters } from './driver.js';

test('deviceType criteria becomes a type EQUALS filter', () => {
  const filters = buildFilters({ platform: 'ios', deviceType: 'real' });

  expect(filters).toContainEqual({ attribute: 'type', operator: 'EQUALS', value: 'real' });
});

test('a bare osVersion becomes inclusive-lower and exclusive-upper version filters', () => {
  const filters = buildFilters({ platform: 'ios', osVersion: '17' });

  expect(filters).toContainEqual({ attribute: 'version', operator: 'GREATER_THAN_OR_EQUALS', value: '17' });
  expect(filters).toContainEqual({ attribute: 'version', operator: 'LESS_THAN', value: '18' });
});

test('comparator osVersion expressions map onto the matching fleet operators', () => {
  expect(buildFilters({ platform: 'android', osVersion: '>16' })).toContainEqual(
    { attribute: 'version', operator: 'GREATER_THAN', value: '16' },
  );
  expect(buildFilters({ platform: 'android', osVersion: '<=16' })).toContainEqual(
    { attribute: 'version', operator: 'LESS_THAN_OR_EQUALS', value: '16' },
  );
});

test('an invalid osVersion expression throws before reaching the fleet API', () => {
  expect(() => buildFilters({ platform: 'ios', osVersion: 'latest' })).toThrow();
});
