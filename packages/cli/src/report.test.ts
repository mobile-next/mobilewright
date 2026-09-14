import { test, expect } from '@playwright/test';
import { formatReport } from './report.js';

test('an action prints code, device and snapshot sections in Playwright CLI order', () => {
  const text = formatReport({ code: 'await screen.getByText(\'Go\').tap();', deviceId: 'abc', app: 'com.x', snapshotPath: '.mobilewright-cli/screen-1.yml' });
  expect(text).toBe([
    '### Ran Mobilewright code',
    '```js',
    'await screen.getByText(\'Go\').tap();',
    '```',
    '### Device',
    '- Device ID: abc',
    '- App: com.x',
    '### Snapshot',
    '- [Snapshot](.mobilewright-cli/screen-1.yml)',
  ].join('\n'));
});

test('a plain result has no device or code sections', () => {
  expect(formatReport({ result: 'saved x.png' })).toBe('### Result\nsaved x.png');
});

test('the snapshot command inlines the tree as a yaml block instead of a file link', () => {
  const text = formatReport({ deviceId: 'abc', app: 'com.x', snapshotText: '- button "Go" [ref=e1]' });
  expect(text).toBe([
    '### Device',
    '- Device ID: abc',
    '- App: com.x',
    '### Snapshot',
    '```yaml',
    '- button "Go" [ref=e1]',
    '```',
  ].join('\n'));
});
