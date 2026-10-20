# QA Report - Virtual Data Room MVP

**Date:** 2026-10-20 · **Build under test:** public deployment (Vercel web + Railway API + Supabase Storage) · **Effort:** one working day

## TL;DR

The product is **well built for an MVP**: tenant isolation, viewer read-only enforcement, public-link scoping, revocation and error states all held up under a deliberately adversarial authorization matrix. However, it is **not ready to hold real deal documents**. One critical flaw (**BUG-01**) lets anyone get access to a room shared with a not-yet-registered email simply by registering that email first. Three high-severity issues affect file integrity (duplicate names, permanently "ghost-reserved" names) and login brute-force protection.

**Release readiness: NO-GO for production / real data. Conditional GO for a demo** with seeded, non-confidential data and sharing limited to known test accounts.

---

## 1. What was tested

| Area | Depth | How |
|---|---|---|
| Authorization (owner / viewer / stranger / anonymous) | **Deep** | Code review of `resolveAccess` + an automated matrix (4 actors, up to 18 operations each, 62 checks) |
| Sharing: per-user, public link, inheritance, revoke, delete-while-shared, id substitution | **Deep** | API probes + automated API and E2E tests |
| Auth: registration, login, JWT tampering, session end | Deep | API tests |
| Files: 3-step upload, name conflicts (sequential *and* concurrent), rename, move, delete, view/download | Deep | API + UI, including race conditions |
| Folders: nesting, breadcrumbs, rename conflicts, recursive delete + preview, pagination | Medium | API tests |
| UI: empty / not-found / revoked states, validation messages, upload panel, read-only views | Medium | Scripted exploratory sessions + 6 E2E journeys |
| Responsive (375 px) and real-Chrome PDF viewing | Light | Exploratory, with screenshots |
| **Not tested** | - | Load/performance, Firefox/Safari/iOS, accessibility audit, 7-day token expiry, near-50 MB uploads on slow networks |

## 2. Key issues and risks

Full details with reproduction steps are in [`FINDINGS.md`](FINDINGS.md): **14 bugs** (1 Critical, 3 High, 1 Medium, 9 Low), **10 product issues** and two environment notes.

### Must fix before real use
| | Finding | Why it is first |
|---|---|---|
| **BUG-01** | Per-user share is claimable by registering the invited email (no email verification) | Direct confidential-data leak. The precondition (inviting an external advisor without an account) is the normal flow |
| **BUG-04** | No login throttling | Unlimited password guessing. 7-day tokens can't be revoked (PI-02) |

### Needs a product decision before real use
| | Finding | Why |
|---|---|---|
| **PI-01** | Moving a file into a publicly-linked folder publishes it instantly, without a warning | Intended inheritance model, so not a bug. But it is the easiest *accidental* leak path, so the owner should confirm the exposure change |
| **PI-02** | Sign-out doesn't revoke the 7-day token | A deliberate MVP cut per the product README ("not for production"). Fine for a demo, required for production |

PI-01 ranks above BUG-02/03 because accidental exposure of a document is worse than a naming problem with it.

### Should fix (trust in the room's contents)
| | Finding |
|---|---|
| **BUG-02** | Uploading the same name twice quickly creates two identical `NDA.pdf` files (reproduced in the UI 100% of the time) |
| **BUG-03** | Any interrupted upload permanently reserves its name. The re-upload becomes `name (1).pdf` and can never be renamed back |
| **BUG-05** | Server stores any bytes or extension as "PDF". The PDF check is browser-only |

### Risk themes
1. **Identity is assumed, not verified.** Email is the sharing key, but nobody proves they own it (BUG-01, PI-06).
2. **Uniqueness is enforced by "check, then insert"**, with no database guarantee. The product's own docs describe the missing unique index as a deliberate choice. What we observed is the cost of that choice: it breaks under concurrency (BUG-02) and leaks invisible state (BUG-03). The two are linked. The name check counts unfinished uploads on purpose, so that files in one batch don't collide, and that is exactly what makes abandoned uploads hold names. A fix for one has to be checked against the other. Folder creation held up (6 parallel creates gave one 201 and five 409s). Our hypothesis is that the `connection_limit=1` pooler setting from the product README serializes those requests. If so, it is likely to break when the pool is enlarged. Not verified.
3. **Client-side checks aren't mirrored server-side, and the API is lenient with bad input** (BUG-05, BUG-07, BUG-11: unknown fields are dropped silently instead of rejected).
4. **Access is computed from location**, which is elegant, but moving items changes exposure without telling the user (PI-01).

## 3. Automated coverage

**60 tests, all behaving as expected on the final run. A full run takes 3-6 minutes, depending on backend latency.** Earlier, 3 E2E tests flaked under full-suite load because of the 10 s UI timeout and slow backend responses (ENV-02). Since then the E2E timeout is 20 s, the suite runs with 3 workers, and E2E runs after the API layer instead of alongside it. There are no retries locally (CI retries once).

| Layer | Tests | Covers |
|---|---|---|
| Unit | 10 | Test oracles (expected conflict-suffix names, duplicate detection), PDF builder, id generators |
| API | 44 | Auth and JWT tampering · folder CRUD, conflicts, validation, recursive delete preview · file upload/view/download round-trip with byte comparison · sequential conflict naming · move rules · **authorization matrix (62 actor x operation checks)** · breadcrumb boundary · per-user share lifecycle · public-link scope, id substitution and 410 on revoke · keyset pagination integrity |
| E2E | 6 | Owner organizes a room (folder, multi-upload with non-PDF rejection, rename keeps extension, delete with subtree warning) · deep links and not-found recovery · sign-out · public link viewed anonymously, then revoked live · invited viewer is read-only, then revoked live · BUG-02 in the UI |

- **11 of the 60 tests are known-bug regressions** (`test.fail` + `BUG-xx` annotation). The marker is placed after all setup, and setup asserts that it got no server error. A broken environment therefore turns the test red; it can't count as the "expected" failure. The final assertion accepts any correct fix (for example, any 4xx instead of exactly 400). When a fix ships, the test turns red with "expected to fail but passed", which is the signal to drop the marker.
- `@smoke` (9 tests, about 1 min) is the proposed release gate. `@security` runs the authorization and identity subset.
- A CI workflow is included (`.github/workflows/qa.yml`): unit + API on every PR, E2E after them, and an opt-in nightly full run (`RUN_NIGHTLY=true`).

**Not automated (deliberately):** the 51 MB storage-limit probe (heavy on a shared bucket), the mobile layout and PDF-viewer title checks (visual, so screenshot evidence was used instead), and brute force beyond 15 requests.

## 4. Release readiness

| Exit criterion (from the test plan) | Status |
|---|---|
| No open Critical findings | ❌ BUG-01 |
| No open High findings in P0 areas (authz, sharing, identity) | ❌ BUG-04 |
| Regression suite green: every non-known-bug test passes and every known-bug test fails as expected | ✅ |
| No open Critical/High known-bug tests in `@security` (BUG-01, BUG-04 are still open) | ❌ |
| Every High finding has a regression test | ✅ |

A green suite means "nothing regressed". It does not mean "releasable": the second row is what blocks.

**Verdict: NO-GO for production. Conditional GO for demo use** (seeded, non-confidential data).

Minimum to flip to GO for production: close BUG-01 and BUG-04, decide on PI-01 (a confirmation when a move changes exposure), and close PI-02 (server-side session revocation, which the product README already marks "not for production"). BUG-02 and BUG-03 should follow in the same release, because they erode trust in the room's contents. They have to be fixed together, see risk theme 2.

## 5. What to test or automate next

1. **Staging environment + data cleanup endpoint.** (Until then the nightly CI run is opt-in via the `RUN_NIGHTLY` repo variable, so the framework is safe by default.) Today the suite has to run against production and leaves `qa-auto-*` accounts behind. That is the biggest constraint on running it more often.
2. **Cross-browser E2E** (Firefox, WebKit) for the PDF viewer and the upload panel. Add mobile WebKit, because iOS Safari cannot render `<object>` PDFs inline, so "view file in UI" probably degrades to download-only there.
3. **Contract tests from the API's own OpenAPI spec** (`/docs-json` is published). Generate response-schema assertions so frontend/backend drift is caught at the API layer.
4. **Concurrency suite**, once BUG-02 is fixed: parallel rename, move-into-conflict and folder create with a larger connection pool.
5. **Performance smoke** on a staging copy: list 10k items in one folder, delete-preview on a deep tree, and the 100k-file claim from the README.
6. **Locale matrix:** run the E2E smoke with a non-English browser locale (it would have caught BUG-12; today the project pins `en-US`).
7. **Accessibility:** axe-core scan on each page, plus keyboard-only E2E for row menus (the README itself mentions a keyboard bug that slipped through review).
8. **Large real uploads:** 45-50 MB PDFs on throttled networks. Check progress, retry and the abandoned-upload path end to end.

---

## Testing approach (short)

**Code-first, risk-driven, then automate what was learned.**
I read the backend before touching the UI, because in a data room the backend decides who sees what. Each suspicious pattern became a concrete hypothesis, for example: "share applies before the account exists, so can the share be claimed?" or "name check, then insert, so does it race?". Short scripted probes against the live API then confirmed or killed each hypothesis within minutes. That is how BUG-01, BUG-02 and BUG-03 were found. They are not visible by clicking around. Then came scripted UI sessions with screenshots, to judge UX and to confirm API bugs were user-reachable (BUG-02 is). Finally, everything confirmed, *and* everything that held up, went into the suite: refuted hypotheses become regression tests too.

Tests are weighted toward the API layer. Authorization is server-side, so a 62-check matrix there is cheaper and more thorough than any amount of UI clicking. E2E is kept to six journeys that prove the wiring.

## Where AI was used

I used Claude Code throughout. It worked well where speed mattered and needed a human check where judgement mattered.

| Where | How it helped | What I checked |
|---|---|---|
| **Code review for hypotheses** | Read about 40 backend files quickly and pointed out the risky patterns (check-then-insert naming, client-trusted MIME, share-before-registration, missing unique indexes) | Each hypothesis was verified live. Several were **refuted** (the HTML-upload XSS idea failed because storage serves `text/plain`; the folder-create race is serialized). Only confirmed results reached the report |
| **Probe and test scaffolding** | Drafted the probe scripts, the typed API client, fixtures and page objects | Ran everything against prod. Fixed selector ambiguities found on first run. Inspected **why** each known-bug test fails, to rule out false "expected failures" |
| **Test design** | Proposed the authorization-matrix structure and boundary sets | Pruned it to what is risk-relevant |
| **Writing** | Drafted the plan, findings and report | Removed claims that weren't backed by evidence. One example: an early draft claimed that renaming a duplicate "doesn't help", which was never tested, so it was cut |
| **Second session (same model)** | A second Claude session tested the same product in parallel without seeing this work (API probes + a real browser), then reviewed this suite | It reached the same top findings (BUG-01, BUG-02, BUG-04, BUG-05, PI-05). Both sessions were the same model, so this is consistency, not independent confirmation. It added BUG-11 to BUG-14, PI-10 and ENV-01. BUG-11 to BUG-14 and PI-10 were then re-checked here with recorded evidence. ENV-01 is reported as that session observed it. It also caught two inconsistencies: a smoke test title that claimed "immediate" revoke despite PI-05, and a nightly CI job that would have registered accounts on someone else's production every night |
| **Post-submission review** | A code review of the suite and a five-perspective critique of the documents | Found that known-bug markers sat before setup (so an environment failure could pass as "expected") and that the release gate showed ✅ with a Critical open. Both were fixed; see the README errata |

The main risk with AI here is plausible but unverified claims. The guardrail was simple: no finding goes in without a recorded reproduction, and no test goes in without seeing it fail for the stated reason. The post-submission review showed where that guardrail had slipped: one size claim and three UI bugs had no saved evidence. They were re-checked and evidence was added.
