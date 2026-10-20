# Findings Report - Virtual Data Room MVP

Tested against the public deployment on 2026-10-20. Every bug below was reproduced at least twice. Where it is automatable it has a test that fails on the bug (marked `test.fail`, see the *Test* line); UI-only issues carry screenshot or step evidence instead. BUG-11 to BUG-14 came from a second, independent session (API probes + browser) and were cross-checked against this suite.

**Severity** = impact if it happens. **Priority** = fix order, weighing severity against how easily real users hit it.

## Summary

| ID | Title | Severity | Priority | Area |
|---|---|---|---|---|
| [BUG-01](#bug-01) | Anyone can claim a per-user share by registering the invited email | **Critical** | **P0 - blocker** | Sharing / Identity |
| [BUG-02](#bug-02) | Uploading the same file name twice in quick succession creates duplicate names | High | P1 | Files |
| [BUG-03](#bug-03) | A failed or abandoned upload permanently reserves the file name | High | P1 | Files |
| [BUG-04](#bug-04) | No rate limiting or lockout on login | High | P1 | Identity |
| [BUG-05](#bug-05) | Server accepts non-PDF content and arbitrary extensions as "PDF" | Medium | P2 | Files |
| [BUG-06](#bug-06) | Completing an upload whose bytes never arrived returns 500 | Low | P2 | Files / API |
| [BUG-07](#bug-07) | Whitespace-only user name and data room name are accepted and stored empty | Low | P3 | Validation |
| [BUG-08](#bug-08) | "Shared with me" lists items the recipient cannot open | Low | P3 | Sharing |
| [BUG-09](#bug-09) | Mobile: row action menu (rename/move/share/delete) is clipped off-screen | Low | P3 | UI |
| [BUG-10](#bug-10) | Inline PDF viewer shows the storage UUID instead of the file name | Low | P3 | UI |
| [BUG-11](#bug-11) | Unknown request fields are silently ignored; a mistyped move field relocates the file to the room root | Low | P2 | API contract / Files |
| [BUG-12](#bug-12) | Dates render in the browser locale inside an English-only UI | Low | P3 | UI / i18n |
| [BUG-13](#bug-13) | Public view keeps showing a file the owner deleted | Low | P3 | Sharing / UI |
| [BUG-14](#bug-14) | Invalid-link page offers a Retry that can never succeed | Low | P3 | Sharing / UI |

Product issues and gaps (not defects against the spec, but risks for the stated use case) follow in [section 2](#2-product-issues-and-gaps).

---

## 1. Bugs

### BUG-01
**Anyone can claim a per-user share by registering the invited email**

| Severity | Priority | Area | Test |
|---|---|---|---|
| Critical | P0 | Sharing / Identity | `tests/api/sharing.spec.ts` - *BUG-01* |

**Steps**
1. Owner shares a data room (or folder/file) with `cfo@target.com`, an address that has no account yet. The UI and the API both allow this ("the share applies as soon as an account with this email exists").
2. A different person registers a new account with `cfo@target.com`. Registration does not verify email ownership.
3. That person opens **Shared with me**.

**Expected:** Only the real owner of the mailbox can get access.

**Actual:** The new account immediately gets read access to the whole shared room (API `GET /data-rooms/:id/contents` returns 200 with the room's items).

**Impact:** Confidential deal documents are exposed to whoever registers the invited address first. External advisors (lawyers, auditors, bidders) are exactly the people who won't have an account yet, so the precondition is the normal case for a data room. The attacker only needs to know or guess the invitee's email.

---

### BUG-02
**Uploading the same file name twice in quick succession creates duplicate names**

| Severity | Priority | Area | Test |
|---|---|---|---|
| High | P1 | Files | `tests/api/files.spec.ts` + `tests/e2e/owner-journey.spec.ts` - *BUG-02* |

**Steps (UI)**
1. In any folder, select `NDA.pdf` with **Upload** (or drop it).
2. Before the first upload finishes, upload `NDA.pdf` again.

**Expected:** Second file is named `NDA (1).pdf` (requirement: *"resolve name conflicts within a folder"*). Sequential uploads do behave this way.

**Actual:** Both files are listed as `NDA.pdf` (see `docs/evidence/06-double-upload.png`). Via the API, 4 parallel uploads of `Term Sheet.pdf` produced `Term Sheet.pdf` + 3x `Term Sheet (1).pdf`. Reproduced 100% in automated runs. Also reproduces with **case-different** names in one drop: `one.pdf` + `ONE.pdf` are both kept, although sequential uploads treat them as a conflict.

**Impact:** Two documents that look identical in a due-diligence folder means nobody can tell which version is authoritative, and viewers have no way to notice. The requirement is broken silently: no error or warning is shown.

---

### BUG-03
**A failed or abandoned upload permanently reserves the file name**

| Severity | Priority | Area | Test |
|---|---|---|---|
| High | P1 | Files | `tests/api/files.spec.ts` - *BUG-03* |

**Steps**
1. Start uploading `Q3 Report.pdf` and interrupt it after it starts (close the tab, lose network, or hit a storage error).
2. The file is not shown in the folder (correct).
3. Upload `Q3 Report.pdf` again, successfully.
4. Try renaming it to `Q3 Report.pdf`.

**Expected:** The file is stored as `Q3 Report.pdf`.

**Actual:** It is stored as `Q3 Report (1).pdf`, although no other file with that name is visible. Renaming back to `Q3 Report.pdf` "succeeds" but silently re-applies `(1)`. The clean name can never be used again in that folder.

**Impact:** Any flaky upload leaves permanent, unexplainable `(1)` suffixes. The user can't fix it, and support can't explain it from the UI.

---

### BUG-04
**No rate limiting or lockout on login**

| Severity | Priority | Area | Test |
|---|---|---|---|
| High | P1 | Identity | `tests/api/auth.spec.ts` - *BUG-04* |

**Steps:** Send 15 `POST /auth/login` requests with wrong passwords for one account in a few seconds.

**Expected:** Throttling (HTTP 429), a delay or a temporary lockout after a handful of failures.

**Actual:** All 15 return 401 immediately. There is no throttling and no lockout. The minimum password length is 8 with no other rules.

**Impact:** Online password guessing against known owner emails is unrestricted. Combined with 7-day non-revocable tokens (PI-02), one successful guess gives a week of access.

---

### BUG-05
**Server accepts non-PDF content and arbitrary extensions as "PDF"**

| Severity | Priority | Area | Test |
|---|---|---|---|
| Medium | P2 | Files | `tests/api/files.spec.ts` - *BUG-05* |

**Steps (API):**
1. `POST /files/upload-intent` with `name: "invoice.exe"`, `mimeType: "application/pdf"`.
2. PUT an HTML document to the returned upload URL, then `POST /files/:id/complete`.
3. Separately: `PATCH /files/:id` with `name: "renamed.exe"` on a real PDF.

**Expected:** Only PDFs can be stored (the product's stated scope). The extension and content are validated server-side.

**Actual:** All accepted. The declared size is not enforced either (intent with `size: 1000`, 2 MB PUT, accepted and stored as 2 MB). The file is recorded as `application/pdf` and listed as `invoice.exe`. Downloads keep the `.exe` name. The PDF check exists only in the browser.

**Impact:** A data room can distribute arbitrary files under a trusted-looking public link. Owners who script uploads can also store wrong content by mistake. *Not* an XSS: storage serves HTML as `text/plain` (verified).

---

### BUG-06
**Completing an upload whose bytes never arrived returns 500**

| Severity | Priority | Area | Test |
|---|---|---|---|
| Low | P2 | Files / API | `tests/api/files.spec.ts` - *BUG-06* |

**Steps:** Create an upload intent, skip the storage PUT (or let it fail, e.g. with a file over 50 MB), then call `POST /files/:id/complete`.

**Expected:** `400 "Upload did not finish - please try again"` (that is the API's documented behaviour for this case).

**Actual:** `500 Internal Server Error - "Could not verify the upload"`.

**Impact:** Every interrupted upload shows up as a server error in monitoring, which hides real 500s. Clients that treat 5xx as "retry later" retry an operation that can never succeed.

---

### BUG-07
**Whitespace-only user name and data room name are accepted and stored empty**

| Severity | Priority | Area | Test |
|---|---|---|---|
| Low | P3 | Validation | `tests/api/auth.spec.ts`, `tests/api/folders.spec.ts` - *BUG-07* |

**Steps:** `POST /auth/register` with `name: "   "`, or `POST /data-rooms` with `name: "   "`.

**Expected:** 400, the same as folder and file names (which are validated correctly).

**Actual:** 201. The stored name is `""` (confirmed via `GET /auth/me` and `GET /data-rooms`), so the user or room has no displayable name anywhere it is shown. The web form blocks this, but the API does not.

---

### BUG-08
**"Shared with me" lists items the recipient cannot open**

| Severity | Priority | Area | Test |
|---|---|---|---|
| Low | P3 | Sharing | `tests/api/sharing.spec.ts` - *BUG-08* |

**Steps / Actual:**
- Share a file whose upload never completed. The recipient sees it in *Shared with me*, and opening it gives *File not found*.
- The owner can share their own room with their own email. The room then appears in the owner's own *Shared with me*.

**Expected:** *Shared with me* lists only items the user can actually open and doesn't already own.

---

### BUG-09
**Mobile: row action menu is clipped off-screen**

| Severity | Priority | Area | Evidence |
|---|---|---|---|
| Low | P3 | UI (375 px viewport) | `docs/evidence/19-mobile-actions.png` |

**Steps:** Open a room with files on a 375 px wide phone viewport.

**Expected:** The **⋮** menu (Rename / Move / Download / Share / Delete) is visible on every row.

**Actual:** The actions column sits outside the table's visible area. The table scrolls horizontally inside its container, with no visual hint, so on a phone the actions look missing. With longer file names or locales with longer dates it gets worse.

---

### BUG-10
**Inline PDF viewer shows the storage UUID instead of the file name**

| Severity | Priority | Area | Evidence |
|---|---|---|---|
| Low | P3 | UI | `docs/evidence/18-viewer-real-chrome.png` |

**Steps:** Open any PDF in Chrome.

**Actual:** The browser PDF toolbar title is the storage key (e.g. `fc856f38-eadb-...`). The viewer's built-in download and print buttons produce a file named `<uuid>.pdf`. The app's own **Download** button is correct.

**Expected:** The document's real name everywhere.

---

### BUG-11
**Unknown request fields are silently ignored; a mistyped move field relocates the file to the room root**

| Severity | Priority | Area | Test |
|---|---|---|---|
| Low | P2 | API contract / Files | `tests/api/files.spec.ts` - *BUG-11* |

**Steps:** File lives in folder `Source`. `PATCH /files/:id/move` with `{"folderId": "<Target id>"}` (the DTO field is `targetFolderId`).

**Expected:** `400` for an unknown property, file stays in `Source`.

**Actual:** `200`, and the file is moved to the **room root**. The global `ValidationPipe` uses `whitelist: true` without `forbidNonWhitelisted`, so the unknown field is stripped and the now-empty body means "move to root".

**Impact:** Any client or integration with a typo in a field name gets success responses while data changes in an unintended way. For move this also changes who can see the file (see PI-01). Fix: `forbidNonWhitelisted: true`.

---

### BUG-12
**Dates render in the browser locale inside an English-only UI**

| Severity | Priority | Area | Evidence |
|---|---|---|---|
| Low | P3 | UI / i18n | Manual, browser with `ru`/`uk` locale |

**Actual:** The "Modified" column shows `20 окт. 2026 г.` next to English labels. The product rule is "English-only UI". The E2E project pins `locale: 'en-US'`, which is why the suite does not see it.

**Expected:** One consistent locale (format dates with a fixed `en-US` locale, or localize the whole UI).

---

### BUG-13
**Public view keeps showing a file the owner deleted**

| Severity | Priority | Area | Evidence |
|---|---|---|---|
| Low | P3 | Sharing / UI | Manual |

**Steps:** Open a public folder link. In another session the owner deletes one of its files. Click **Download** on that row.

**Actual:** Toast "File not found", but the row stays in the list until a manual reload.

**Expected:** On 404 the list refetches (or the row is removed) so the visitor isn't offered a dead item again.

---

### BUG-14
**Invalid-link page offers a Retry that can never succeed**

| Severity | Priority | Area | Evidence |
|---|---|---|---|
| Low | P3 | Sharing / UI | `/share/<garbage-token>` |

**Actual:** "Link not available - This link is invalid or no longer available." with a **Retry** button. A 404 token will never resolve on retry.

**Expected:** Retry only for network/5xx errors; for 404 offer "Go to my data room" / "Ask the owner for a new link" (as the revoked-link screen already does).

---

## 2. Product issues and gaps

These aren't violations of `task.md`, but each is a real risk for "a repository for securely storing and distributing documents" in an M&A deal.

| ID | Issue | Why it matters | Rec. priority |
|---|---|---|---|
| PI-01 | **Moving a file silently changes who can see it.** Moving a document *into* a publicly-linked folder exposes it to the internet at once (verified: `explore/api-probe-4-move-exposure.mjs`, anonymous view returns 200 right after the move), and moving it *out* silently revokes viewers. There is no warning in the Move dialog. | Easiest accidental leak path in the product | P1 |
| PI-02 | **Sign-out does not end the session server-side.** A token copied before sign-out keeps working for 7 days (verified: `GET /auth/me` returns 200 after sign-out). Documented as an MVP cut. | Stolen or shared-device tokens can't be killed | P1 for production |
| PI-03 | **No room-wide view of who has access.** Shares are visible only per item, in each item's Share dialog. | The owner can't audit exposure before or after a deal | P2 |
| PI-04 | **"Shared with me" doesn't show who shared an item**, and every room is named "My Data Room" with no way to rename it. A recipient sees several identical "My Data Room" entries (`docs/evidence/12-viewer-shared-with-me.png`). | Confusing as soon as two counterparties share | P2 |
| PI-05 | **Revocation is not instant for open documents.** Signed file URLs stay valid up to 5 minutes after revoke (verified). Documented trade-off. | Acceptable, but should be stated in the UI | P3 |
| PI-06 | **Invitees aren't notified**, and the owner isn't told whether the email has an account. | Shares go unnoticed, and typos go unnoticed (compounds BUG-01) | P2 |
| PI-07 | **No access/audit log** (who viewed or downloaded what, when). | A standard data-room expectation in due diligence | Roadmap |
| PI-08 | **"Modified" column shows the creation date** and does not change on rename or move. | Misleading label | P3 |
| PI-09 | **No CSP / X-Frame-Options** on the web app (HSTS is present). | The app can be framed (clickjacking) | P3 |
| PI-10 | **No return to the requested page after sign-in.** A recipient who opens a deep link while signed out (e.g. from an invite) lands on their own room, not on the shared item. Verified in the UI: signed out, opened `/shared-with-me`, signed in, landed on `/` (`explore/ui-session-checks.mjs`). | Extra friction exactly on the invite path | P3 |
| ENV-01 | **Shared demo accounts hold third-party data.** The `john@example.com` room is used by every candidate and contains uploads that look like real CVs with personal names. | PII on a public demo env; also makes manual testing on demo accounts noisy. This suite avoids it by using its own accounts | Info |
| ENV-02 | **Slow, partly serialized API under light load.** Measured in the afternoon of 2026-10-20: about 1 s per authenticated call that touches the database (`/health` takes 0.2 s). 10 parallel identical reads take 3.5 s wall time, so requests queue. Earlier in the day the same suite ran about 2x faster. With 8 parallel test workers, `POST /auth/register` intermittently returned `500 Internal server error`. | A handful of concurrent users will feel multi-second waits. The first E2E runs used a 10 s UI timeout and flaked under the suite's own load, so the E2E timeout was raised to 20 s | P2 (performance) |

## 3. Verified working (regression-protected)

These hypotheses were tested and found **correct**. They are in the suite so they stay that way:

- **Tenant isolation:** a stranger gets 404 (not 403) on every read and write of another user's room, folder, file or shares.
- **Viewer is strictly read-only:** create, rename, move, delete, upload, share and delete-preview all return 404 for a viewer.
- **Inheritance:** a folder share covers nested folders and files. Breadcrumbs for a viewer stop at the share boundary (no ancestor or room names leak).
- **Public links:** token scope is enforced against id substitution (files or room root outside the subtree give 404). A revoked link gives 410 with a clear UI message. A recreated link gets a new token. Tokens are 32 chars of base64url.
- **JWT:** missing, garbage, forged-payload and `alg:none` tokens are rejected.
- **Login** does not reveal whether an account exists.
- **Folder names:** case-insensitive uniqueness. Rename conflicts give 409. Trimming and length limits work.
- **Sequential** file name conflicts (upload, rename, move) produce correct `name (n).ext` suffixes.
- **Recursive delete** with an accurate preview (folder count, file count, total size). A viewer inside a deleted folder gets a clean "Folder not found" with a way back.
- **Keyset pagination:** no duplicates or gaps across the folder/file page boundary. Bad cursors and limits give 400.
- **Storage:** files over 50 MB are rejected by the bucket. HTML content is served as `text/plain` (no stored XSS). Downloads carry the real file name.
- Concurrent **folder** creation with the same name (6 parallel) gave exactly one 201 and five 409s.
- CORS rejects foreign origins. SPA deep links survive reload.
- **No cross-user cache leak on sign-out:** user A opens a folder, signs out, user B signs in. A MutationObserver watching the DOM recorded zero appearances of A's data during B's session, including after browser Back and on a direct link to A's folder (`explore/ui-session-checks.mjs`). The README notes this bug existed earlier and was fixed.
