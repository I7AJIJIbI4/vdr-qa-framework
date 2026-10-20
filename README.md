# VDR QA Framework

QA deliverables and a reusable test automation framework for the [Virtual Data Room MVP](https://github.com/evo9/virtual-data-room).

| Deliverable | Where |
|---|---|
| Test plan | [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) |
| Prioritized findings (bugs + product issues) | [`docs/FINDINGS.md`](docs/FINDINGS.md) |
| Final QA report (incl. testing approach and AI usage) | [`docs/QA_REPORT.md`](docs/QA_REPORT.md) |
| Automated tests | [`tests/`](tests) |
| Exploration scripts and screenshots | [`explore/`](explore), [`docs/evidence/`](docs/evidence) |

## Quick start

```bash
npm install
npx playwright install chromium

npm test                # everything (~3 min)
npm run test:unit       # pyramid base, no network
npm run test:api        # API layer
npm run test:e2e        # UI journeys
npm run test:smoke      # release gate (@smoke)
npm run test:security   # authorization and identity (@security)
npm run report          # open the HTML report
```

Targets the public deployment by default. Override with `WEB_URL` and `API_URL` (see `src/config.ts`) to run against staging or a local stack.

## Structure

```
src/
  config.ts            target URLs, password, email prefix (env-overridable)
  fixtures.ts          test.extend: fresh actors per test, auto-cleanup, knownBug()
  api/client.ts        typed client for every endpoint + 3-step upload helper
  api/types.ts         response shapes
  data/                builders and oracles: real PDFs, unique emails, expected conflict names
  pages/               page objects: LoginPage, ExplorerPage, ShareDialog
tests/
  unit/                checks for the oracles the other layers rely on
  api/                 auth, folders, files, access-control matrix, sharing
  e2e/                 owner journey, sharing journeys
explore/               the exploratory probes that found the bugs (kept for reproducibility)
```

## Design decisions

- **One runner, three layers.** Playwright Test runs unit, API and E2E as separate projects, so there is one toolchain, one report and one CI job definition. TypeScript matches the product's stack, so its developers can maintain the suite.
- **Weighted to the API.** Every authorization rule lives in the backend, so it is asserted exhaustively there (the access-control matrix). E2E covers only what needs a browser.
- **Isolation by construction.** The `newActor()` fixture registers fresh users per test and empties their rooms afterwards. There are no shared accounts, no ordering dependencies, and the suite is safe to run in parallel against a shared environment.
- **Seed through the API, assert through the UI.** E2E tests create their preconditions with API calls (fast and deterministic) and spend browser time only on the behaviour under test.
- **Known bugs live in the suite.** `knownBug('BUG-xx', ...)` marks a test that asserts *correct* behaviour as expected-to-fail. The suite stays green while the bug is open, and goes red ("expected to fail but passed") once it's fixed.
- **Independent oracles.** Expected values such as conflict suffixes are computed by our own code (unit-tested), not copied from the product's responses.

## Adding a test

```ts
import { expect, test } from '../../src/fixtures';
import { must } from '../../src/api/client';

test('viewer cannot rename a shared folder @security', async ({ owner, newActor }) => {
  const viewer = await newActor('viewer');
  const folder = must(await owner.api.createFolder({ name: 'Deal', dataRoomId: owner.roomId }));
  must(await owner.api.share({ resourceType: 'FOLDER', resourceId: folder.id, mode: 'USER', granteeEmail: viewer.email }));

  expect((await viewer.api.renameFolder(folder.id, 'x')).status).toBe(404);
});
```

## Known limitations

- There is no staging environment, so the suite runs against the public deployment. The API has no user-delete endpoint, so test accounts (`qa-auto-*@example.com`) accumulate. Rooms are emptied after each test.
- The E2E layer runs on Chromium only. Firefox and WebKit are the next step (see the QA report).
- Headless Chromium has no PDF plugin, so inline PDF rendering was verified manually in real Chrome (`docs/evidence/18-viewer-real-chrome.png`).
