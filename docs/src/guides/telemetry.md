---
title: Telemetry
---

# Telemetry

Mobilewright collects anonymous usage telemetry to understand which commands are used and how often test runs succeed. It never sends personal information, test code, test names, app data or screenshots.

## What is sent

| Event | When |
|-------|------|
| `mw_test` | `mobilewright test` starts |
| `mw_test-ended` | `mobilewright test` finishes, with its status |
| `mw_doctor` | `mobilewright doctor` runs |
| `mw_init` | `mobilewright init` runs |

Each event includes your operating system, the Mobilewright version, and a random identifier stored in `~/.config/mobilenext/mobilewright/config.json`. Events are sent to [PostHog](https://posthog.com). `mobilewright test` also requests a [Scarf](https://scarf.sh) pixel, a plain HTTP request, so Scarf receives the usual request metadata (source IP, user agent); Scarf states it does not retain raw IP addresses.

## Opting out

Set either environment variable to turn off both PostHog and Scarf:

| Variable | Disables telemetry when |
|----------|-------------------------|
| `MOBILEWRIGHT_DISABLE_TELEMETRY` | set to any value |
| [`DO_NOT_TRACK`](https://consoledonottrack.com) | set to any value except `0` or `false` |

```bash
DO_NOT_TRACK=1 npx mobilewright test
```

To opt out permanently, add it to your shell profile:

```bash
echo 'export DO_NOT_TRACK=1' >> ~/.zshrc
```

In CI, set the variable in your pipeline's environment, for example in GitHub Actions:

```yaml
env:
  DO_NOT_TRACK: 1
```

When telemetry is disabled, no identifier file is created and no network requests are made.
