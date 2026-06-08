import type { Page, Expect } from '@playwright/test';
import { actionsSpec } from './actions.spec.js';
import { stateAssertionsSpec } from './assertions-state.spec.js';
import { textAssertionsSpec } from './assertions-text.spec.js';
import { webAssertionsSpec } from './assertions-web.spec.js';
import { locatorsSpec } from './locators.spec.js';
import { realNavigationSpec } from './real-navigation.spec.js';

export interface ConformanceCase {
  name: string;
  run: (page: Page, expect: Expect) => Promise<void>;
}

// The single source of truth for the conformance suite. Each runtime wrapper
// (mobilewright and Playwright) iterates this list and registers a test per
// case, so the spec bodies are written once and run under both runners.
export const conformanceSpecs: ConformanceCase[] = [
  { name: 'actions affect the DOM like Playwright', run: actionsSpec },
  { name: 'state assertions match Playwright', run: stateAssertionsSpec },
  { name: 'text assertions match Playwright (incl. whitespace normalization)', run: textAssertionsSpec },
  { name: 'web-only assertions match Playwright', run: webAssertionsSpec },
  { name: 'locator factories resolve like Playwright', run: locatorsSpec },
  { name: 'navigates to a live page and drives it like Playwright', run: realNavigationSpec },
];
