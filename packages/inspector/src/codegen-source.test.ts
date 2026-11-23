import { test, expect } from '@playwright/test';
// @ts-expect-error: plain browser module without type declarations
import { insertBeforeBodyEnd } from '../public/js/codegen-source.js';

const TEST_END = '});';
const LIBRARY_END = 'await device.close();';
const TAP_MENU = 'await screen.getByText(\'Menu\').tap();';

function recordIntoTest(source: string, line: string): string {
  return insertBeforeBodyEnd(source, TEST_END, `  ${line}`);
}

function recordIntoLibrary(source: string, line: string): string {
  return insertBeforeBodyEnd(source, LIBRARY_END, line);
}

const EMPTY_TEST = `import { test, expect } from '@mobilewright/test';

test('test', async ({ device, screen }) => {
});
`;

test('records a step inside an empty test', () => {
  const result = recordIntoTest(EMPTY_TEST, TAP_MENU);

  expect(result).toBe(`import { test, expect } from '@mobilewright/test';

test('test', async ({ device, screen }) => {
  await screen.getByText('Menu').tap();
});
`);
});

test('records after a step that itself ends in });', () => {
  const withLocation = recordIntoTest(EMPTY_TEST, 'await device.setGeolocation({ latitude: 1, longitude: 2 });');

  const result = recordIntoTest(withLocation, TAP_MENU);

  expect(result).toBe(`import { test, expect } from '@mobilewright/test';

test('test', async ({ device, screen }) => {
  await device.setGeolocation({ latitude: 1, longitude: 2 });
  await screen.getByText('Menu').tap();
});
`);
});

test('records inside the test when code after the test also contains });', () => {
  const withCodeAfterTest = `${EMPTY_TEST}console.log({});
`;

  const result = recordIntoTest(withCodeAfterTest, TAP_MENU);

  expect(result).toBe(`import { test, expect } from '@mobilewright/test';

test('test', async ({ device, screen }) => {
  await screen.getByText('Menu').tap();
});
console.log({});
`);
});

test('records inside the first test when a second test follows', () => {
  const twoTests = `${EMPTY_TEST}
test('second', async ({ screen }) => {
});
`;

  const result = recordIntoTest(twoTests, TAP_MENU);

  expect(result).toBe(`import { test, expect } from '@mobilewright/test';

test('test', async ({ device, screen }) => {
  await screen.getByText('Menu').tap();
});

test('second', async ({ screen }) => {
});
`);
});

test('appends to the end when the closing line was deleted', () => {
  const withoutClosing = `test('test', async ({ device, screen }) => {
`;

  const result = recordIntoTest(withoutClosing, TAP_MENU);

  expect(result).toBe(`test('test', async ({ device, screen }) => {
  await screen.getByText('Menu').tap();
`);
});

test('records before device.close() in a library script', () => {
  const script = `import { ios, expect } from 'mobilewright';

const device = await ios.launch();
const { screen } = device;

await device.close();
`;

  const result = recordIntoLibrary(script, TAP_MENU);

  expect(result).toBe(`import { ios, expect } from 'mobilewright';

const device = await ios.launch();
const { screen } = device;

await screen.getByText('Menu').tap();
await device.close();
`);
});
