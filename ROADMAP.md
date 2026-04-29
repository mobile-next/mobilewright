# Roadmap

This is a living document of planned and in-progress features. Items are roughly prioritized top-to-bottom. Have a feature request? [Open an issue](https://github.com/mobile-next/mobilewright/issues/new/choose).

| Feature | Description | Status |
|---|---|---|
| **Mobilewright CLI** | Command-line tool for managing fleets of real devices — provisioning, grouping, and running tests across many devices in parallel. | Planned |
| **Mobilewright MCP** | MCP server exposing Mobilewright capabilities to AI agents and coding assistants. | Planned |
| **Device Logs** | Programmatic access to device system logs (iOS `os_log`, Android `logcat`). Filter, capture, and assert on log output from within your test. | Planned |
| **Codegen** | Record interactions on a real device or simulator and automatically generate Mobilewright TypeScript test code. Similar to `playwright codegen`. | Planned |
| **Tracing** | Step-by-step execution traces with per-action logs, screenshots, and timing attached to a visual timeline. Open with `mobilewright show-trace`. | Planned |
| **Flutter Support** | Full locator support for Flutter apps via the Dart VM Service driver. Flutter renders via Skia/Impeller rather than native views, requiring a dedicated driver. | Planned |
| **Network Capture** | Record `.har` files and inspect HTTP/HTTPS traffic during test runs. | Planned |
| **Device Settings** | Prepare device system settings before a test — dark mode, high contrast, font size, locale, and permissions. | Planned |
| **App Launch Options** | Launch an app with custom environment variables and locale overrides, without modifying the app binary. | Planned |
| **Visual Screenshot Comparison** | Pixel-level screenshot diffing to catch unintended UI regressions across commits. | Planned |
| **Camera & Photo Injection** | Mock the photo or video returned by the system camera API during a test. | Planned |
| **WebView Support** | Inspect and interact with WebView content inside an app or a full mobile browser session using the standard Mobilewright locator API. | Planned |
| **Kotlin Multiplatform** | Full iOS support for Kotlin Multiplatform apps using Compose Multiplatform. Android native already works; iOS requires mapping Compose Multiplatform to native accessibility nodes. | Planned |
| **Additional Cloud Providers** | Support for running Mobilewright tests on additional device cloud providers. | Planned |
