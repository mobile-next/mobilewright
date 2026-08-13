import { test, expect } from '@playwright/test';
import { parseOsVersion, osVersionSatisfies } from './os-version.js';

// ─── bare version = prefix match ─────────────────────────────

test('a bare major version matches any release of that major', () => {
  expect(osVersionSatisfies('17.0', '17')).toBe(true);
  expect(osVersionSatisfies('17.5.1', '17')).toBe(true);
  expect(osVersionSatisfies('17', '17')).toBe(true);
});

test('a bare major version rejects neighboring majors', () => {
  expect(osVersionSatisfies('16.9', '17')).toBe(false);
  expect(osVersionSatisfies('18.0', '17')).toBe(false);
  expect(osVersionSatisfies('18', '17')).toBe(false);
});

test('a two-segment version matches only that minor release', () => {
  expect(osVersionSatisfies('26.0', '26.0')).toBe(true);
  expect(osVersionSatisfies('26.0.1', '26.0')).toBe(true);
  expect(osVersionSatisfies('26.1', '26.0')).toBe(false);
  expect(osVersionSatisfies('26.5', '26.0')).toBe(false);
});

// ─── comparators ─────────────────────────────────────────────

test('>= matches the version itself and anything above', () => {
  expect(osVersionSatisfies('17', '>=17')).toBe(true);
  expect(osVersionSatisfies('19.2', '>=17')).toBe(true);
  expect(osVersionSatisfies('16.9', '>=17')).toBe(false);
});

test('a >= and < pair expresses a range', () => {
  expect(osVersionSatisfies('17.0', '>=17 <19')).toBe(true);
  expect(osVersionSatisfies('18.4', '>=17 <19')).toBe(true);
  expect(osVersionSatisfies('19.0', '>=17 <19')).toBe(false);
  expect(osVersionSatisfies('16.9', '>=17 <19')).toBe(false);
});

test('strict > excludes the version itself', () => {
  expect(osVersionSatisfies('17.0', '>17')).toBe(false);
  expect(osVersionSatisfies('17.0.1', '>17')).toBe(true);
});

test('<= includes the version itself', () => {
  expect(osVersionSatisfies('18', '<=18')).toBe(true);
  expect(osVersionSatisfies('18.0.1', '<=18')).toBe(false);
});

// ─── numeric (not lexicographic) comparison ──────────────────

test('segments compare numerically so 10 sorts above 9', () => {
  expect(osVersionSatisfies('10.0', '>=9')).toBe(true);
  expect(osVersionSatisfies('17.10', '>=17.9')).toBe(true);
});

// ─── parse output (used to build fleet API filters) ──────────

test('parsing a bare version yields inclusive lower and exclusive upper bounds', () => {
  expect(parseOsVersion('17')).toEqual({
    min: { version: '17', inclusive: true },
    max: { version: '18', inclusive: false },
  });
  expect(parseOsVersion('26.0')).toEqual({
    min: { version: '26.0', inclusive: true },
    max: { version: '26.1', inclusive: false },
  });
});

test('parsing comparators yields only the bounds given', () => {
  expect(parseOsVersion('>=17')).toEqual({ min: { version: '17', inclusive: true } });
  expect(parseOsVersion('>=17 <19')).toEqual({
    min: { version: '17', inclusive: true },
    max: { version: '19', inclusive: false },
  });
});

// ─── invalid input fails loudly ──────────────────────────────

test('malformed expressions throw', () => {
  expect(() => parseOsVersion('')).toThrow();
  expect(() => parseOsVersion('abc')).toThrow();
  expect(() => parseOsVersion('>=x')).toThrow();
  expect(() => parseOsVersion('~17')).toThrow();
  expect(() => parseOsVersion('17 <19')).toThrow(); // bare version cannot mix with comparators
  expect(() => parseOsVersion('>=17 >=18')).toThrow(); // duplicate lower bounds
});
