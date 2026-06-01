# Public Circuit Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the inactive Share button into a student-facing sharing loop where a validated H-eduware circuit can be packaged as a public, read-only project page, image card, and reusable project snapshot.

**Architecture:** Add a share snapshot boundary between the live app state and external viewers. The frontend creates sanitized share artifacts from validated project outputs, the server stores and serves public snapshots by opaque IDs, and the same Vanilla JS app renders a read-only share view from `?share=<id>`. The feature must exclude raw agent traces, secrets, environment values, and private chat history from every shared artifact.

**Tech Stack:** Vanilla JavaScript, Vite, three.js, Node HTTP server, TypeScript server modules, Zod schemas, Playwright, `node:test`, existing i18n system.

---

## 1. Product Rationale

The Share button should not be a generic "copy current URL" action. H-eduware's strongest external acquisition loop is:

```text
Student builds a circuit
-> H-eduware validates and simulates it
-> Student shares the result with friends, teachers, parents, or community
-> External viewer sees the circuit and learning value
-> Viewer clicks "Start from this circuit" or "Create my own circuit"
```

This makes sharing a growth feature and a student motivation feature at the same time.

For students, the shared object is a small portfolio artifact: "I designed this circuit, and it works." For external viewers, the shared object is the first product experience: "This app can turn a student idea into a visualized, explainable circuit."

## 2. Current State

Current app behavior:

- The top bar renders a Share button label through i18n.
- The button has no `data-action`, no event listener, and no functional behavior.
- The app already has the ingredients needed for meaningful sharing:
  - `requirementMarkdown`
  - `circuitSpec`
  - `validationReport`
  - `renderPlan`
  - `simulationPlan`
  - context coverage evidence
  - PCB canvas rendering
  - current-flow simulation state
  - bilingual UI strings

Current constraints:

- The app runs locally at `http://127.0.0.1:4173/` in development.
- A real external link cannot be made by copying the local URL.
- The default verification harness must not require live OpenAI calls or secrets.
- Shared data must be sanitized because agent results may contain internal events, warnings, or user-entered text.

## 3. Product Scope

### 3.1 MVP Scope

MVP must include:

- A working Share button in the top bar.
- A share modal for the current project.
- A sanitized project snapshot generated from validated artifacts.
- Markdown summary copy.
- JSON project snapshot download.
- PNG share card download generated client-side.
- Server-backed share link creation through an API.
- Public read-only share view loaded by `?share=<id>`.
- "Start from this circuit" action that imports the shared snapshot into the current app session.
- "Create my own circuit" action that opens a new-project state.
- Korean and English copy.
- Unit and E2E tests that pass without live LLM calls.

### 3.2 Post-MVP Scope

Post-MVP can add:

- Social preview metadata for deployed public URLs.
- A hosted gallery of selected shared circuits.
- Teacher classroom collections.
- Commenting, likes, remix counters, or profiles.
- Cloud database storage with abuse reporting and expiration policy.

These are intentionally outside MVP because the first release should prove the share loop without adding accounts or moderation surfaces.

### 3.3 Non-Goals

MVP must not include:

- User accounts.
- Public editing of someone else's project.
- Raw chat transcript sharing.
- Raw `agentEvents` sharing.
- Raw context trace dumps beyond concise source evidence.
- Server-side shell execution.
- Live LLM calls inside default tests.
- A frontend framework migration.

## 4. User Experience

### 4.1 Student Flow

1. Student creates or loads a circuit.
2. Student optionally presses Run to see the simulation.
3. Student presses Share.
4. Share modal opens with:
   - circuit title
   - one-line explanation
   - validation status
   - preview card
   - copy/download/link actions
5. Student chooses one:
   - Copy share link
   - Save image
   - Copy Markdown
   - Download project JSON
6. Student sends the link or image to someone else.

### 4.2 External Viewer Flow

1. Viewer opens a public link such as:

```text
https://<deployed-h-eduware-host>/?share=<opaque-share-id>
```

2. App loads the shared snapshot from the server.
3. App renders a read-only share page:
   - title
   - preview
   - what the circuit does
   - parts list
   - validation state
   - simulation explanation
   - limited context evidence
4. Viewer can:
   - Start from this circuit
   - Create my own circuit
   - Download project JSON

### 4.3 Invalid Circuit Flow

If the current project is invalid or incomplete:

- Share modal still opens.
- Validation state is shown as "검증 필요" / "Needs verification".
- The app must not describe the circuit as working.
- Current-flow animation and simulation claims must be omitted or marked as unavailable.
- The public page CTA says "Use as draft" instead of "Start from working circuit".

## 5. Information Architecture

### 5.1 Share Artifact Types

The feature should produce four artifact types from one canonical snapshot:

1. `ShareSnapshot`
   - Canonical, sanitized data used by all share surfaces.
2. `ShareMarkdown`
   - Human-readable project summary for copy/paste.
3. `ShareCardImage`
   - Client-generated PNG card for social sharing.
4. `PublicSharePage`
   - Read-only app view loaded from a server-stored snapshot.

### 5.2 Public Page Content

Required public page sections:

- Header:
  - H-eduware brand
  - shared project title
  - validation badge
- Circuit Preview:
  - render-plan based project preview when available
  - fallback share card when canvas is unavailable
- What It Does:
  - one concise explanation
- Parts:
  - component names, quantities, and roles
- How It Works:
  - current path summary only if validation is valid
  - expected states from `simulationPlan`
- Safety and Verification:
  - validation status
  - warnings
  - unsupported items
- Context Evidence:
  - coverage status
  - concise source type summary
  - no raw internal trace
- CTA:
  - Start from this circuit
  - Create my own circuit

## 6. Data Contract

### 6.1 Share Snapshot

Create a schema that can be shared safely and rendered without the live agent.

```ts
export const ShareSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().optional(),
  createdAt: z.string(),
  locale: z.enum(['ko', 'en']),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(280),
  status: z.enum(['valid', 'warning', 'invalid', 'draft']),
  source: z.enum(['agent', 'demo', 'imported']),
  studentPromptSummary: z.string().max(280).optional(),
  requirementMarkdown: z.string().max(12000),
  circuit: z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(500),
    components: z.array(z.object({
      id: z.string(),
      type: z.string(),
      name: z.string(),
      role: z.string().optional()
    })).max(80),
    connections: z.array(z.object({
      from: z.string(),
      to: z.string(),
      label: z.string().optional()
    })).max(200)
  }),
  validation: z.object({
    status: z.enum(['valid', 'warning', 'invalid']),
    warnings: z.array(z.string()).max(30),
    unsupportedItems: z.array(z.string()).max(30)
  }),
  simulation: z.object({
    available: z.boolean(),
    runText: z.string().max(120).optional(),
    explanation: z.string().max(1000),
    currentPathCount: z.number().int().min(0).max(60)
  }),
  renderPlan: z.unknown().optional(),
  contextEvidence: z.object({
    coverageStatus: z.string(),
    score: z.number().min(0).max(1).optional(),
    sourceTypes: z.array(z.string()).max(20),
    warnings: z.array(z.string()).max(20)
  }).optional()
});
```

Implementation can refine `renderPlan` to a stricter schema by reusing the existing `RenderPlanSchema` when importing from TypeScript server code. The key rule is that `ShareSnapshot` is not a dump of `AgentRunResult`; it is a curated projection.

### 6.2 Excluded Fields

The snapshot builder must exclude:

- `agentEvents`
- raw chat messages
- raw `contextTrace`
- server environment fields
- API keys
- provider request or response payloads
- stack traces
- local file paths
- browser storage values
- unbounded free text

### 6.3 Redaction Rules

Before saving or copying a share artifact, run redaction over all strings:

```ts
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /sk-proj-[A-Za-z0-9_-]{20,}/g,
  /OPENAI_API_KEY\s*=\s*[^\s]+/g,
  /H_EDUWARE_AGENT_MODEL\s*=\s*[^\s]+/g
];
```

Replacement text should be:

```text
[redacted]
```

## 7. API Design

### 7.1 Create Share

```http
POST /api/share/projects
content-type: application/json
```

Request:

```json
{
  "snapshot": {
    "schemaVersion": 1
  }
}
```

Response:

```json
{
  "shareId": "01jz4v1p7x6r8k2m9q3t4w5y6z",
  "shareUrl": "http://127.0.0.1:4173/?share=01jz4v1p7x6r8k2m9q3t4w5y6z",
  "createdAt": "2026-05-31T00:00:00.000Z"
}
```

### 7.2 Read Share

```http
GET /api/share/projects/:shareId
```

Response:

```json
{
  "snapshot": {
    "schemaVersion": 1
  }
}
```

### 7.3 API Failure Behavior

- `400`: invalid snapshot schema or oversized payload.
- `404`: unknown share ID.
- `413`: snapshot too large.
- `500`: storage failure.

Frontend behavior:

- If API create fails, keep image/Markdown/JSON actions available.
- If public page load fails, show a read-only error page with "Create my own circuit".

## 8. Storage Design

### 8.1 Local Development Storage

Use file-backed storage in development:

```text
.local/shared-projects/<shareId>.json
```

Reasons:

- Works without a database.
- Keeps default tests deterministic.
- Fits the current Node server.
- Can be replaced by database storage behind the same interface.

### 8.2 Store Interface

Create a narrow interface:

```ts
export type ShareStore = {
  create(snapshot: ShareSnapshot): Promise<StoredShare>;
  read(shareId: string): Promise<StoredShare | null>;
};
```

The server should depend on this interface, not directly on file operations from route handlers.

### 8.3 ID Rules

Share IDs must be:

- opaque
- non-sequential
- URL-safe
- at least 128 bits of entropy

Use `crypto.randomUUID()` without dashes or `crypto.randomBytes(16).toString('hex')`.

## 9. Frontend Architecture

### 9.1 New Frontend Modules

Create:

- `src/shareSnapshot.js`
  - Builds a sanitized `ShareSnapshot` from current app state.
  - Exports redaction helpers.
- `src/shareClient.js`
  - Calls `/api/share/projects`.
  - Reads shared snapshots.
  - Handles timeout and API errors.
- `src/shareModal.js`
  - Renders and binds share modal UI.
  - Supports copy, download, and link creation.
- `src/shareCard.js`
  - Generates PNG share card using Canvas 2D.
  - Avoids new dependencies.
- `src/shareView.js`
  - Renders public read-only view from a `ShareSnapshot`.

Modify:

- `src/main.js`
  - Add `data-action="share"` to the Share button.
  - Open modal on click.
  - Detect `new URLSearchParams(location.search).get('share')`.
  - Render read-only share view when `share` is present.
  - Import shared snapshot into local project when viewer clicks "Start from this circuit".
- `src/styles.css`
  - Add modal, share card, public page, and badge styles.
- `src/locales/ko.js`
  - Add natural Korean copy for sharing.
- `src/locales/en.js`
  - Add English copy.

### 9.2 Share Modal States

The modal needs explicit states:

- `idle`: preview shown, actions enabled.
- `creating-link`: server request in progress.
- `link-created`: share URL visible and copied.
- `link-failed`: link creation failed, offline actions still available.
- `copied`: Markdown or URL copied.
- `downloaded`: JSON or PNG download started.

### 9.3 Share Button Rules

The top bar Share button should be:

- enabled only when `state.projectLoaded === true`
- disabled for a blank new project
- still available for invalid circuits after a project exists
- labelled naturally in both languages

Korean label suggestions:

- Button: `공유`
- Modal title: `내 회로 공유하기`
- Link action: `공유 링크 만들기`
- PNG action: `이미지 저장`
- Markdown action: `요약 복사`
- JSON action: `프로젝트 파일 저장`
- Valid badge: `검증 완료`
- Draft badge: `초안`
- Invalid badge: `검증 필요`

## 10. Public Share View

### 10.1 Read-Only Behavior

Public share view must:

- Not show the live agent input by default.
- Not allow editing until "Start from this circuit" is clicked.
- Not automatically run a simulation unless the snapshot is valid.
- Not show internal Files tab source details beyond the curated requirement summary.
- Show H-eduware branding and a clear CTA.

### 10.2 Import Behavior

When viewer clicks "Start from this circuit":

1. Convert `ShareSnapshot` into the existing `state.project` shape.
2. Set `state.projectLoaded = true`.
3. Set `state.activeTab = 'PCB'`.
4. Set `state.running = false`.
5. Preserve a file named `shared-requirements`.
6. Add a local banner: "공유된 회로에서 시작했습니다."

The imported project is local to the viewer's browser session.

## 11. Agent and Context Layer Boundary

The share feature must not call Deepagents to create a share page. It should reuse already validated artifacts.

Allowed source data:

- requirement document
- `circuitSpec`
- `validationReport`
- `renderPlan`
- `simulationPlan`
- context coverage summary

Disallowed source data:

- raw `agentEvents`
- raw model messages
- raw context documents
- prompt templates
- provider-specific metadata

If the project came from the demo fallback, set:

```json
{
  "source": "demo",
  "contextEvidence": {
    "coverageStatus": "demo-fixture",
    "sourceTypes": ["fixture"]
  }
}
```

## 12. Security and Privacy Requirements

### 12.1 Secret Safety

All share actions must pass through the same redaction function. Tests must assert that these strings never appear in shared output:

- `sk-proj-`
- `sk-`
- `OPENAI_API_KEY`
- `H_EDUWARE_AGENT_MODEL`
- `.local/agent.env`

### 12.2 Personal Data Safety

The app currently does not have accounts, so MVP should not collect names or student identity. The share title should default to the circuit name, not the student name.

If the student prompt contains personal data, it can only appear as a short sanitized summary. Raw prompt sharing should be avoided.

### 12.3 Abuse Surface

Since public links can contain user text:

- Limit title to 80 characters.
- Limit summary to 280 characters.
- Limit Markdown to 12,000 characters.
- Escape all rendered HTML.
- Store JSON, not HTML.
- Render Markdown as escaped text in the existing file viewer style unless a trusted Markdown renderer is introduced.

## 13. Test Plan

### 13.1 Unit Tests

Create:

- `tests/unit/shareSnapshot.test.js`
- `tests/unit/shareClient.test.js`
- `tests/unit/shareStore.test.ts`
- `tests/unit/shareSchemas.test.ts`

Required assertions:

- Share button source project produces a valid snapshot.
- Snapshot builder excludes `agentEvents`.
- Snapshot builder excludes raw chat messages.
- Redaction removes `sk-proj-*` patterns.
- Invalid circuit snapshot status becomes `invalid` or `draft`, never `valid`.
- Markdown summary contains title, parts, validation status, and app CTA.
- JSON snapshot round-trips through schema parse.
- File store creates and reads a share by opaque ID.
- File store rejects path traversal IDs such as `../secret`.
- i18n has Korean and English strings for all share keys.

### 13.2 E2E Tests

Modify `tests/e2e/features.spec.js`.

Required flows:

1. Share modal opens after demo project is loaded.
2. Share button is disabled before a project exists.
3. Markdown copy exposes no secrets and contains the project title.
4. PNG download action creates a non-empty image.
5. Create link calls local API and shows a URL.
6. Visiting `/?share=<id>` renders public read-only page.
7. Public page shows validation badge, parts list, and CTA.
8. "Start from this circuit" imports the shared project and opens PCB tab.
9. Public page does not expose raw agent events or environment names.

### 13.3 Manual Browser Verification

Use the in-app browser at:

```text
http://127.0.0.1:4173/
```

Manual protocol:

1. Load demo or create a live agent project.
2. Press Share.
3. Verify the modal is natural in Korean.
4. Save PNG and inspect the card visually.
5. Copy Markdown and verify the summary reads like a student portfolio artifact.
6. Create link.
7. Open link in a fresh tab.
8. Verify read-only page loads without asking for API keys.
9. Click "Start from this circuit".
10. Verify Files, PCB, and Run still behave.

## 14. Implementation Tasks

### Task 1: Add Share Schemas

**Files:**

- Create: `server/share/shareSchemas.ts`
- Test: `tests/unit/shareSchemas.test.ts`

- [x] Define `ShareSnapshotSchema`, `ShareCreateRequestSchema`, `ShareCreateResponseSchema`, and `ShareReadResponseSchema`.
- [x] Export TypeScript types inferred from Zod.
- [x] Add tests for valid snapshot, oversized strings, invalid status, and missing required fields.
- [x] Run:

```powershell
tsx --test tests/unit/shareSchemas.test.ts
```

Expected: new schema tests pass.

### Task 2: Add Server Share Store

**Files:**

- Create: `server/share/shareStore.ts`
- Test: `tests/unit/shareStore.test.ts`

- [x] Implement file-backed `create()` and `read()`.
- [x] Store snapshots under `.local/shared-projects`.
- [x] Reject IDs that do not match `/^[a-f0-9]{32}$/`.
- [x] Generate IDs with `crypto.randomBytes(16).toString('hex')`.
- [x] Ensure writes create the directory recursively.
- [x] Add tests for create/read, unknown ID, and path traversal rejection.
- [x] Run:

```powershell
tsx --test tests/unit/shareStore.test.ts
```

Expected: store tests pass without network or live model calls.

### Task 3: Add Share API Routes

**Files:**

- Modify: `server/index.ts`
- Test: `tests/unit/shareStore.test.ts`

- [x] Add `POST /api/share/projects`.
- [x] Add `GET /api/share/projects/:shareId`.
- [x] Add CORS support for the new routes using the existing `sendJson()` path.
- [x] Return `shareUrl` using `H_EDUWARE_PUBLIC_APP_URL` when set, otherwise `http://127.0.0.1:4173`.
- [x] Keep all route handlers schema-validated.
- [x] Do not log snapshot content.

### Task 4: Build Client Snapshot Projection

**Files:**

- Create: `src/shareSnapshot.js`
- Test: `tests/unit/shareSnapshot.test.js`

- [x] Implement `createShareSnapshot(project, options)`.
- [x] Implement `redactShareText(value)`.
- [x] Implement `createShareMarkdown(snapshot, locale)`.
- [x] Convert current project shape into share-safe fields.
- [x] Add tests for demo project, agent-like project, invalid project, and secret redaction.
- [x] Run:

```powershell
node --test tests/unit/shareSnapshot.test.js
```

Expected: snapshot projection tests pass.

### Task 5: Add Share API Client

**Files:**

- Create: `src/shareClient.js`
- Test: `tests/unit/shareClient.test.js`

- [x] Implement `createPublicShare(snapshot)`.
- [x] Implement `readPublicShare(shareId)`.
- [x] Reuse the current agent API base from local storage when available.
- [x] Add timeout handling.
- [x] Throw typed errors with safe messages.
- [x] Add tests with mocked `fetch`.

### Task 6: Add Share Modal

**Files:**

- Create: `src/shareModal.js`
- Modify: `src/main.js`
- Modify: `src/styles.css`
- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`
- Test: `tests/e2e/features.spec.js`

- [x] Add `data-action="share"` and `data-testid="share-project"` to the Share button.
- [x] Disable Share before `state.projectLoaded`.
- [x] Mount modal from `openShareModal()`.
- [x] Include actions for link, PNG, Markdown, and JSON.
- [x] Keep modal keyboard accessible.
- [x] Escape all dynamic text.

### Task 7: Add PNG Share Card

**Files:**

- Create: `src/shareCard.js`
- Test: `tests/unit/shareSnapshot.test.js`
- Test: `tests/e2e/features.spec.js`

- [x] Generate a 1200x630 PNG with Canvas 2D.
- [x] Include title, summary, validation badge, top five parts, and H-eduware brand.
- [x] Use restrained product styling consistent with current app colors.
- [x] Do not rely on remote images or external fonts.
- [x] Add a non-empty PNG assertion in E2E.

### Task 8: Add Public Read-Only Share View

**Files:**

- Create: `src/shareView.js`
- Modify: `src/main.js`
- Modify: `src/styles.css`
- Test: `tests/e2e/features.spec.js`

- [x] On app start, detect `?share=<id>`.
- [x] Fetch snapshot through `readPublicShare()`.
- [x] Render a public read-only page.
- [x] Hide the live chat panel until user imports or starts a new circuit.
- [x] Render validation badge, parts, simulation summary, and CTAs.
- [x] Add "Start from this circuit" import behavior.
- [x] Add "Create my own circuit" behavior.

### Task 9: Add Share Import Adapter

**Files:**

- Create: `src/shareImport.js`
- Modify: `src/main.js`
- Test: `tests/unit/shareSnapshot.test.js`

- [x] Convert `ShareSnapshot` into the existing project shape.
- [x] Preserve requirement markdown as a file.
- [x] Preserve render plan when present.
- [x] Set a safe run text from `simulation.runText`.
- [x] Mark imported projects with `source: "imported"`.

### Task 10: Strengthen E2E and Full Check

**Files:**

- Modify: `tests/e2e/features.spec.js`
- Modify: `tests/unit/i18n.test.js`

- [x] Add E2E tests for disabled Share button, modal, link creation, public page, and import.
- [x] Add i18n key coverage assertions.
- [x] Run:

```powershell
npm run test:unit
npm run typecheck
npm run build
npm run test:e2e
npm run check
```

Expected:

- Unit tests pass.
- Typecheck passes.
- Production build passes.
- E2E passes.
- `npm run check` passes without live OpenAI calls.

## 14.1 Implementation Notes

- 2026-06-01: Completed the server-side sharing boundary for Tasks 1-3.
  - Added `server/share/shareSchemas.ts` with `ShareSnapshotSchema`, create/read API schemas, stored-share schema, and exported inferred TypeScript types.
  - Added `server/share/shareStore.ts` with file-backed storage under `.local/shared-projects`, 128-bit hex IDs, path traversal rejection, and create/read helpers.
  - Added `POST /api/share/projects` and `GET /api/share/projects/:shareId` to `server/index.ts`.
  - Route smoke verified local link creation and readback: `POST` returned a 32-character hex id and `http://127.0.0.1:4173/?share=<id>`, and `GET` returned the stored snapshot with matching id.
  - Invalid share ids return a safe 400 response through the existing error mapper; unknown valid ids return 404.
- Verification:
  - `npm exec -- tsx --test tests/unit/shareSchemas.test.ts tests/unit/shareStore.test.ts`: 6/6 passed.
  - `npm run typecheck`: passed.
  - `npm run check`: passed with 65 JavaScript unit tests, 138 TypeScript unit tests, production build, and Playwright E2E 44 passed / 8 skipped.
  - Agent server restarted; `/api/agent/health` returned `sourceStatus.stale=false`.
- Next implementation slice:
  - Build `src/shareSnapshot.js` and `tests/unit/shareSnapshot.test.js`.
  - Replace the current summary-only `src/shareModal.js` behavior with snapshot-backed Markdown/JSON/link actions.
  - Add public `?share=<id>` read-only view and import behavior after the snapshot projection is tested.
- 2026-06-01: Completed the frontend snapshot/client/link modal slice for Tasks 4-6.
  - Added `src/shareSnapshot.js` as the frontend projection boundary from app project state into a curated public snapshot.
  - Added `redactShareText()` and applied it to snapshot strings and share Markdown so API keys, env var names, and local secret paths are removed before sharing.
  - Added `src/shareClient.js` with `createPublicShare()` and `readPublicShare()` using the existing local agent API base override.
  - Replaced the summary-only modal with snapshot-backed Markdown copy, JSON export, public-link creation, and link-copy UI.
  - Updated `src/main.js` so `openShareModal()` passes the current project and marks the snapshot source as `agent` or `demo`.
  - Added Korean/English copy for link creation, link copy, and JSON export.
  - Extended the share E2E to mock `POST /api/share/projects`, assert that a public link is shown, and assert the posted snapshot excludes internal events, chat history, and secret markers.
- Verification:
  - `node --test tests/unit/shareSnapshot.test.js tests/unit/shareClient.test.js`: 8/8 passed.
  - `npx playwright test tests/e2e/features.spec.js -g "share button" --project=desktop-chromium --timeout=30000`: 1/1 passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed.
- Remaining share scope:
  - Disable the Share button for a truly blank project, or intentionally keep the current empty-state modal and update the acceptance criteria.
  - Add PNG share card generation.
- 2026-06-01: Completed the public read-only share view and import/remix slice for Tasks 8-9.
  - Added `src/shareView.js` with a read-only public share page for loading, error, and ready states.
  - Added `src/shareImport.js` to convert a curated `ShareSnapshot` into the existing local project shape.
  - Updated app boot in `src/main.js` to detect `?share=<id>`, fetch the snapshot through `readPublicShare()`, and suppress the live AI panel while viewing a public share.
  - Added "Start from this circuit" behavior that imports the snapshot, marks the project source as `imported`, opens the PCB tab, preserves requirement Markdown, and keeps simulation stopped until Run.
  - Added "Create my own circuit" behavior to leave the public share view and start from a blank local project.
  - Added `tests/unit/shareImport.test.js`.
  - Extended `tests/e2e/features.spec.js` with a public share route fixture that verifies read-only rendering, hidden live chat, validation/parts/simulation content, and import into the app.
- Verification:
  - `node --test tests/unit/shareImport.test.js`: 2/2 passed.
  - `npx playwright test tests/e2e/features.spec.js -g "public share link|share button" --project=desktop-chromium --timeout=50000`: 2/2 passed.
  - `npm run build`: passed.
- Remaining share scope after this slice:
  - PNG share card generation and non-empty PNG E2E.
  - Blank-project Share disabled vs empty-state modal product decision.
  - Full i18n key coverage for all share/public-share copy.
- 2026-06-01: Completed the PNG share card slice for Task 7.
  - Added `src/shareCard.js` with a 1200x630 Canvas 2D card renderer.
  - Card model includes title, summary, validation badge, up to five parts, simulation explanation, H-eduware brand, and footer copy.
  - Card text passes through share redaction so secret markers and environment names are not rendered into the image model.
  - Added `이미지 저장` / `Save image` action to `src/shareModal.js`.
  - Added Korean/English share image export strings.
  - Added `tests/unit/shareCard.test.js`.
  - Extended the share modal E2E to download the PNG, parse it with `pngjs`, assert 1200x630 dimensions, and assert non-background pixels.
- Verification:
  - `node --test tests/unit/shareCard.test.js`: 2/2 passed.
  - `npx playwright test tests/e2e/features.spec.js -g "share button" --project=desktop-chromium --timeout=50000`: 1/1 passed.
  - `npm run build`: passed.
- Remaining share scope after this slice:
- 2026-06-01: Resolved the blank-project Share behavior and public-share i18n coverage.
  - Blank projects now render the top-bar Share button as disabled instead of opening an empty-state modal.
  - `openShareModal()` also guards against calls before a project is loaded.
  - Added `publicShare.*` dictionaries to `src/locales/ko.js` and `src/locales/en.js`.
  - Updated `src/shareView.js` to read public share copy through the shared i18n system instead of a private local dictionary.
  - Extended `tests/unit/i18n.test.js` to cover share/public-share keys.
  - Updated the Share E2E to assert the blank-project Share button is disabled.
- Verification:
  - `node --test tests/unit/i18n.test.js`: 3/3 passed.
  - `npx playwright test tests/e2e/features.spec.js -g "share button|public share link" --project=desktop-chromium --timeout=60000`: 2/2 passed.
  - `npm run build`: passed.
- Remaining share scope after this slice:
  - No known MVP share acceptance item remains open in this plan.

- 2026-06-01: Reconciled the implementation checklist with the current verified state after the latest full app gate.
  - Tasks 4 and 10 `Run` checklist items are now marked complete because their referenced unit/typecheck/check commands have passed in the recorded share slices and the latest app-wide `npm run check`.
  - Latest full gate: `npm run check` passed with 77 JavaScript unit tests, 139 TypeScript unit tests, production build, and Playwright E2E 50 passed / 8 skipped.
  - The remaining skipped tests are opt-in live Deepagents E2E, not share MVP blockers.

- 2026-06-01: Added Share modal focus restoration for keyboard users.
  - The Share E2E now verifies that focus starts on the Share button, moves to the modal close button when the modal opens, and returns to the Share button when the modal closes.
  - `mountShareModal()` captures the previously focused element, prevents duplicate close handling, and restores focus after cleanup.
  - Verification:
    - RED: `npx playwright test tests/e2e/features.spec.js -g "share button opens a clear modal" --project=desktop-chromium --timeout=70000` failed because `share-project` was inactive after close.
    - GREEN: the same focused E2E passed after implementation.
    - `npm run typecheck`: passed.
    - `npm run check`: passed with 77 JavaScript unit tests, 139 TypeScript unit tests, production build, and Playwright E2E 52 passed / 8 skipped.

## 15. Acceptance Criteria

The feature is complete when:

- Share button is disabled for a blank new project.
- Share button opens a modal for a loaded project.
- Modal can create a sanitized Markdown summary.
- Modal can download a sanitized JSON snapshot.
- Modal can download a non-empty PNG card.
- Modal can create a public share link through the local server.
- Public link renders a read-only page from a server-stored snapshot.
- Viewer can import the shared circuit into their own local app session.
- Invalid circuits are never labelled as working.
- No shared artifact contains raw agent events, API keys, env var names, local secret paths, or raw stack traces.
- Korean and English UI copy is natural.
- `npm run check` passes.

## 16. Open Product Decisions Before Implementation

These decisions should be confirmed before coding:

1. Public link lifetime:
   - Recommended MVP: no expiration in local development, storage can be cleared manually.
2. Shared page default language:
   - Recommended MVP: use the creator's locale stored in the snapshot, with the existing ENG/KOR toggle still available.
3. Share card visual style:
   - Recommended MVP: product-card style with circuit title, validation badge, parts, and H-eduware branding.
4. Deployed host:
   - Recommended MVP: `H_EDUWARE_PUBLIC_APP_URL` controls generated URLs.

## 17. Risks and Mitigations

- Risk: Public links imply production hosting, but current app is local.
  - Mitigation: generate local URLs in development and make host configurable through `H_EDUWARE_PUBLIC_APP_URL`.
- Risk: Shared artifacts accidentally leak internal agent context.
  - Mitigation: share from a curated snapshot projection, never from raw agent result.
- Risk: Invalid circuits become marketing artifacts.
  - Mitigation: public badges and CTA copy must reflect `valid`, `warning`, `invalid`, or `draft`.
- Risk: PNG generation is brittle.
  - Mitigation: use Canvas 2D with fixed dimensions and test for non-background pixels.
- Risk: Server file storage is not production-grade.
  - Mitigation: isolate behind `ShareStore` so a database store can replace it without changing frontend or route contracts.

## 18. Recommended Implementation Order

1. Server schemas and store.
2. Frontend snapshot projection and redaction.
3. Share modal with offline actions.
4. Share API link creation.
5. Public read-only share view.
6. Import shared project as editable local project.
7. Browser polish and bilingual copy.
8. Full acceptance verification.

This order keeps the privacy boundary and deterministic data contract in place before any user-visible sharing behavior is added.
