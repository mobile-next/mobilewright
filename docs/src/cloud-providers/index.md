---
sidebar_position: 1
title: Overview
---

# Cloud Providers

Mobilewright runs the same tests on a phone plugged into your laptop and on real devices in the
cloud. The only thing that changes is the `driver` in `mobilewright.config.ts` — your tests,
locators, and fixtures stay exactly as they are.

Cloud devices let you scale up fast: instead of maintaining a device lab, raise `workers` and
let the provider allocate one device per worker. A suite that takes an hour on a single device
finishes in minutes across a fleet, and CI no longer depends on hardware sitting under a desk.

Mobilewright supports these providers:

- [Mobile Next Cloud](./mobile-next-cloud.md) — the driver maintained by the Mobilewright team, with test results uploaded to your dashboard automatically.
- [BrowserStack](./browserstack.md) — App Automate sessions via the `@browserstack/mobilewright` driver.

A common pattern is to keep one config and switch drivers by environment: local device by
default, cloud when credentials are present. Each provider page shows how.
