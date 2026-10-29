export class MobilewrightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MobilewrightError';
  }
}

/**
 * Thrown when a WebView operation fails (attachment, navigation, injection, etc.).
 */
export class WebViewError extends MobilewrightError {
  constructor(message: string) {
    super(message);
    this.name = 'WebViewError';
  }
}

/**
 * Thrown when no WebView matching the locator criteria is found on the screen.
 */
export class WebViewNotFoundError extends WebViewError {
  constructor(message: string) {
    super(message);
    this.name = 'WebViewNotFoundError';
  }
}

/**
 * Thrown when the app containing the WebView is not debuggable or WebView debugging is disabled.
 */
export class WebViewDebugNotEnabledError extends WebViewError {
  constructor(platform: 'ios' | 'android') {
    const hint =
      platform === 'ios'
        ? 'Ensure the app is a development/simulator build with the get-task-allow entitlement.'
        : 'Ensure the app is a debug build with android:debuggable="true".';
    super(
      `WebView debugging not enabled on the app. ${hint}`,
    );
    this.name = 'WebViewDebugNotEnabledError';
  }
}

/**
 * Thrown when a locator within a WebView matches an unexpected number of elements (strict mode).
 */
export class WebViewStrictModeViolationError extends WebViewError {
  constructor(selector: string, matchCount: number) {
    super(
      `WebView locator matched ${matchCount} elements, expected 1 (strict mode). Selector: ${selector}`,
    );
    this.name = 'WebViewStrictModeViolationError';
  }
}
