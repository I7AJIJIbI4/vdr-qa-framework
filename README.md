# VDR QA Framework

QA deliverables and a reusable test automation framework for the [Virtual Data Room MVP](https://github.com/evo9/virtual-data-room).

> **Verdict: NO-GO for production / real deal documents. Conditional GO for a demo with seeded, non-confidential data.**
> - **Blocker:** BUG-01. A per-user share sent to an email without an account goes to whoever registers that email first. There is no email verification.
> - **Also open:** no login throttling (BUG-04); duplicate and permanently reserved file names (BUG-02, BUG-03). Moving a file into a publicly linked folder makes it public with no warning (PI-01).
> - **Coverage:** 60 automated tests (10 unit, 44 API incl. a 62-check authorization matrix, 6 E2E). 11 of them are open-bug regressions.
> - One working day, against the public deployment. Details: [QA report](docs/QA_REPORT.md) · [Findings](docs/FINDINGS.md) · [Errata](#errata-post-submission).

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

npm test                # everything: unit + API, then E2E (3-6 min, depends on backend latency)
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
- **Known bugs live in the suite.** `knownBug('BUG-xx', ...)` marks a test that asserts *correct* behaviour as expected-to-fail. The suite stays green while the bug is open, and goes red ("expected to fail but passed") once it's fixed. The marker is placed **after** all setup, and setup asserts it got no server error. A broken environment or a failing setup step therefore turns the test red, instead of passing as the "expected" failure. A green suite means "no regressions"; it does **not** mean "releasable" (see the release gate in the QA report).
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
- The shared deployment is slow and partly serializes database access (ENV-02). The suite therefore runs with 3 workers, E2E runs after the API layer, and E2E assertions wait up to 20 s.

## Errata (post-submission)

After submission, the deliverable was put through an internal review: a code review of the suite plus a five-perspective critique of the documents. These changes followed. The originally submitted version is commit `5de4a88`.

| Area | Change |
|---|---|
| Known-bug tests | `knownBug()` moved after setup in all 11 tests. Setup now asserts "no 5xx", so an environment failure can no longer pass as the expected failure. BUG-02/05/06/08/01 assertions accept any correct fix (e.g. a 409 for the losing upload, any 4xx instead of exactly 400), so a real fix is reported instead of being masked. |
| Release gate | The exit criterion "100% of @smoke/@security pass" was ticked ✅ while BUG-01 (itself `@security`) was open. It is now split into "regression suite green" and "no open Critical/High known bug" (❌). |
| Authorization matrix | The owner row now also performs all writes (it previously ran reads only). |
| CI | Empty repository variables no longer override the default URLs (`??` → `||` in `src/config.ts`). |
| E2E | Viewer read-only check also opens the row menu. The anonymous-visitor browser context is always closed. A race was removed from `ensurePublicLink`. |
| Evidence | Saved outputs for probes 3 and 4. Added `probe-5-crosscheck` with screenshots for BUG-05 (declared size), BUG-13 and BUG-14, which previously had no recorded evidence. |
| Findings | ENV-02 downgraded to Info: part of that load came from the suite itself, and load testing is out of scope. PI-01 reframed as intended behaviour that needs a product decision. Root-cause and fix text removed from BUG-11. Registration-based account enumeration noted. Test counts and runtimes reconciled across documents. |
