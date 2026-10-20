# Test Plan - Virtual Data Room MVP

| | |
|---|---|
| **Product** | [evo9/virtual-data-room](https://github.com/evo9/virtual-data-room) (web on Vercel, API on Railway, files on Supabase Storage) |
| **Requirements** | [`task.md`](https://github.com/evo9/virtual-data-room/blob/main/task.md) + README "Project decisions" (treated as the intended behaviour) |
| **Environment** | Public deployment only (no staging). All test data is created by throwaway accounts (`qa-*@example.com`), and the shared demo accounts are left untouched |
| **Time box** | One working day |

## 1. Objective

Decide whether the MVP is fit to hold confidential M&A documents, and leave behind automation that keeps answering that question.

A data room fails its users in two ways: **someone sees a document they shouldn't**, or **an owner can't trust what is in the room** (wrong, duplicated or lost files). Both outrank cosmetic or convenience problems, so effort and severity follow that order.

## 2. Risk-based scope

| # | Area | Risk if broken | Likelihood (from code review) | Priority |
|---|---|---|---|---|
| R1 | **Authorization** - owner / viewer / stranger / anonymous across room, folder, file | Confidential data leak | Medium: hand-written `resolveAccess`, polymorphic shares without FK | **P0** |
| R2 | **Sharing lifecycle** - grant, inherit to subtree, revoke, delete shared item, public links, id substitution | Leak or stale access | Medium | **P0** |
| R3 | **Identity** - registration, login, sessions, token handling | Account takeover leads to a leak | Medium: no email verification, 7-day JWT | **P0** |
| R4 | **File integrity** - three-step upload (intent, storage PUT, complete), name-conflict resolution, move, delete | Lost, duplicated or mislabelled documents | High: check-then-insert naming, no unique index, client-declared metadata | **P1** |
| R5 | **Folder tree** - nesting, breadcrumbs, rename conflicts, recursive delete + preview | Wrong structure or silent data loss | Low-Medium | **P1** |
| R6 | **UX / error states** - empty, not-found, revoked, upload failures, validation messages | Users stuck or misled (the assignment's #1 criterion) | Medium | **P1** |
| R7 | Pagination / scale claims (keyset cursors) | Missing or duplicated rows in large rooms | Low | P2 |
| R8 | Responsive layout, PDF viewing across browsers | Feature unusable on some devices | Medium | P2 |

**Out of scope:** load testing (it would hit someone else's production), destructive security testing (no DoS, no brute force beyond a 15-request probe), search and versioning (optional and not built), and folder move (documented as cut).

## 3. Approach

1. **Static review first (about 1 h).** Read the API controllers, services, DTOs and schema to turn the code into concrete hypotheses ("names are resolved by check-then-insert, so they might race", "share applies to an email before the account exists, so it might be claimable"). This targets exploratory time at likely defects instead of clicking around.
2. **Exploratory API probing.** Scripted probes (`explore/api-probe-*.mjs`) confirm or refute each hypothesis against the live API. Refuted hypotheses are recorded too: they become regression tests.
3. **Exploratory UI sessions.** Scripted walk-throughs (`explore/ui-explore.mjs`) plus manual checks in real Chrome cover owner, viewer, anonymous and mobile viewports, with screenshots as evidence.
4. **Automate what was learned**, following the pyramid (section 5).
5. **Report.** Findings are prioritized as Severity x Likelihood. Each automatable bug has a reproducing automated test. Each UI-only bug has a screenshot or a saved probe output.

## 4. Test design techniques

| Technique | Applied to |
|---|---|
| **Authorization matrix** (actor x operation x resource scope) | R1/R2: 4 actors x up to 18 operations (62 checks), plus inheritance and id-substitution cases |
| **State transitions** | Share: none, active, revoked, re-created. Upload: intent, PUT, complete (or abandoned) |
| **Equivalence classes and boundaries** | Names (empty, whitespace, 200/201 chars, case variants, extensions), file size (0, 1, 50 MB, 50 MB + 1), pagination `limit` (0, 1, 100, 101) |
| **Concurrency / race** | Parallel same-name uploads and folder creates |
| **Error guessing** | Abandoned uploads, tokens for deleted resources, forged/alg-none JWTs, malformed cursors and UUIDs |
| **Oracle-based checks** | Expected conflict-suffix names computed independently (`src/data/conflict-name.ts`) and compared with the API |

## 5. Automation strategy (testing pyramid)

| Layer | What | Count | Runtime | Runs on |
|---|---|---|---|---|
| **Unit** | Framework oracles and data builders (naming oracle, PDF builder, id generators) | 10 | < 1 s | every commit |
| **API** | Contracts, validation, authorization matrix, sharing lifecycle, known-bug regressions | 44 | 2-4 min | every PR |
| **E2E (UI)** | 6 critical journeys: owner organizes a room, deep links, sign-out, public link + revoke, invited viewer read-only, duplicate-drop bug | 6 | 1-2 min | PR + opt-in nightly |

Runtimes depend on the shared deployment's latency (ENV-02). A full run takes 3-6 min.

Most of the weight sits on the API layer. All authorization logic lives server-side, so the API is the cheapest place to assert it exhaustively, and a UI test there would only re-test the same rule through a slower, flakier path. E2E covers what only a browser can show: wiring, client-side validation, navigation and read-only rendering.

**Rules the framework enforces:**
- Every test creates its **own users** and seeds through the API. There is no shared state and no ordering, so tests are parallel-safe.
- Teardown empties the test's rooms. Accounts carry a `qa-auto-` prefix for out-of-band purging, since the API has no user delete.
- **Known bugs stay in the suite** as `test.fail()` with a `BUG-xx` annotation. The marker goes **after** setup, and setup asserts "no 5xx", so only the bug itself can produce the expected failure. The suite stays green, and when a fix ships the test reports "expected to fail but passed", prompting removal of the marker.
- Tags: `@smoke` (release gate, 9 tests) and `@security` (authorization and identity).

## 6. Entry / exit criteria

**Entry:** `/health` is 200 and both demo accounts can log in.

**Exit (release readiness):**
- No open **Critical** findings and no open **P0-area** (R1-R3) High findings.
- Regression suite green: every non-known-bug test passes, and every known-bug test fails as expected.
- No `@security` test is still marked as a known bug. A green suite alone does not mean releasable.
- Every High finding has an automated regression test.

## 7. Deliverables

| Document | Path |
|---|---|
| Test plan (this) | `docs/TEST_PLAN.md` |
| Findings report | `docs/FINDINGS.md` |
| QA report | `docs/QA_REPORT.md` |
| Framework + how to run | `README.md`, `src/`, `tests/` |
| Exploration scripts and evidence | `explore/`, `docs/evidence/` |
