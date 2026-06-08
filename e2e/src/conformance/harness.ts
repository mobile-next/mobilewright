import type { Device, Screen, Page } from 'mobilewright';

const PLAYGROUND_APP = 'com.mobilenext.playground';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Launch the Playground app, open its WebView screen, and return the web Page.
// All conformance tests start from the Page this returns.
export async function openWebviewPage(ctx: { device: Device; screen: Screen }): Promise<Page> {
  await ctx.device.terminateApp(PLAYGROUND_APP).catch(() => {});
  await ctx.device.launchApp(PLAYGROUND_APP);
  // Android's foreground detection races right after launch (a known mobilecli
  // flake), which makes the subsequent webview list fail; let it settle.
  await sleep(2000);
  const webviewButton = ctx.screen.getByText('Web View');
  await webviewButton.tap();
  const page = await ctx.screen.getByWebView().page();
  return page;
}
