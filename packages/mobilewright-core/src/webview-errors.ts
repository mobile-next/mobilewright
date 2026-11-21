/**
 * Thrown when a WebView operation fails (attachment, navigation, injection, etc.).
 */
export class WebViewError extends Error {
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
 * Thrown when a WebView locator matches more than one WebView (strict mode).
 */
export class WebViewStrictModeViolationError extends WebViewError {
  constructor(message: string, readonly matchCount: number) {
    super(message);
    this.name = 'WebViewStrictModeViolationError';
  }
}
