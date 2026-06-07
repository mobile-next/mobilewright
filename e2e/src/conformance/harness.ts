import type { Device, Screen, Page } from 'mobilewright';

const PLAYGROUND_APP = 'com.mobilenext.playground';

// Launch the Playground app, open its WebView screen, and return the web Page.
// All conformance tests start from the Page this returns.
export async function openWebviewPage(ctx: { device: Device; screen: Screen }): Promise<Page> {
  await ctx.device.terminateApp(PLAYGROUND_APP).catch(() => {});
  await ctx.device.launchApp(PLAYGROUND_APP);
  const webviewButton = ctx.screen.getByText('Web View');
  await webviewButton.tap();
  const page = await ctx.screen.getByWebView().page();
  return page;
}
