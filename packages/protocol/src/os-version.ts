/**
 * OS-version constraint expressions for device allocation.
 *
 * Grammar:
 *   - bare version:  "17" or "26.0" — prefix match: >= the version, < the
 *     version with its last given segment bumped ("17" → >=17 <18).
 *   - comparators:   ">=17", ">=17 <19" — space-separated, at most one lower
 *     bound (>= or >) and one upper bound (< or <=).
 */

export interface OsVersionBound {
  version: string;
  inclusive: boolean;
}

export interface OsVersionRange {
  min?: OsVersionBound;
  max?: OsVersionBound;
}

const VERSION_RE = /^\d+(\.\d+)*$/;

function assertValidVersion(version: string): void {
  if (!VERSION_RE.test(version)) {
    throw new Error(`invalid OS version "${version}" — expected digits separated by dots, e.g. "17" or "26.0"`);
  }
}

/** Numeric dot-segment comparison; missing segments count as 0. */
function compareVersions(a: string, b: string): number {
  const as = a.split('.').map(Number);
  const bs = b.split('.').map(Number);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const diff = (as[i] ?? 0) - (bs[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** "26.0" → "26.1", "17" → "18" — the exclusive upper bound of a prefix match. */
function bumpLastSegment(version: string): string {
  const segments = version.split('.').map(Number);
  segments[segments.length - 1] += 1;
  return segments.join('.');
}

export function parseOsVersion(expr: string): OsVersionRange {
  const parts = expr.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error('empty OS version expression');
  }

  if (parts.length === 1 && VERSION_RE.test(parts[0])) {
    return {
      min: { version: parts[0], inclusive: true },
      max: { version: bumpLastSegment(parts[0]), inclusive: false },
    };
  }

  const range: OsVersionRange = {};
  for (const part of parts) {
    const match = /^(>=|<=|>|<)(.+)$/.exec(part);
    if (!match) {
      throw new Error(`invalid OS version constraint "${part}" — expected ">=", ">", "<=" or "<" followed by a version, or a single bare version`);
    }
    const [, op, version] = match;
    assertValidVersion(version);
    const isLower = op === '>=' || op === '>';
    const bound: OsVersionBound = { version, inclusive: op === '>=' || op === '<=' };
    if (isLower) {
      if (range.min) {
        throw new Error(`duplicate lower bound in OS version expression "${expr}"`);
      }
      range.min = bound;
    } else {
      if (range.max) {
        throw new Error(`duplicate upper bound in OS version expression "${expr}"`);
      }
      range.max = bound;
    }
  }
  if (range.min && range.max) {
    const cmp = compareVersions(range.min.version, range.max.version);
    if (cmp > 0 || (cmp === 0 && !(range.min.inclusive && range.max.inclusive))) {
      throw new Error(`impossible OS version range "${expr}" — no version can satisfy it`);
    }
  }
  return range;
}

export function osVersionSatisfies(version: string, expr: string): boolean {
  const range = parseOsVersion(expr);
  if (range.min) {
    const cmp = compareVersions(version, range.min.version);
    if (cmp < 0 || (cmp === 0 && !range.min.inclusive)) {
      return false;
    }
  }
  if (range.max) {
    const cmp = compareVersions(version, range.max.version);
    if (cmp > 0 || (cmp === 0 && !range.max.inclusive)) {
      return false;
    }
  }
  return true;
}
