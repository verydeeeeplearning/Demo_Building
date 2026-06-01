# Browser Generalization Verification

For each prompt family:

1. Open `http://127.0.0.1:4173/`.
2. Submit a natural student prompt.
3. Verify the chat does not expose server secrets, API keys, or raw environment values.
4. Verify Files tab includes requirement markdown and, for agent-built circuits, context coverage evidence.
5. Verify PCB tab has a nonblank three.js canvas and visible parts from `RenderPlan`.
6. Hover or select at least one component and one wire.
7. Ask the inspector tutor why that target is needed.
8. Press Run.
9. Verify current animation appears only when validation is valid.
10. Record the prompt family and failure class when any step fails.

Default CI may use the offline-safe demo and mocked agent boundary. Live Deepagents browser checks remain opt-in through `RUN_LIVE_E2E=1` and a configured server key.

## Context QA Artifacts

For each manual or browser QA run, attach the context and promotion evidence to the same run folder:

```powershell
npm run qa:context-artifacts -- --run-id <run-id>
```

By default this writes to `qa-artifacts/manual-product-qa/<run-id>/`:

- `generalization-eval-report.json`
- `capability-promotion-gaps.json`
- `browser-verification-plan.json`
- `context-qa-summary.md`
- `context-qa-manifest.json`

`browser-verification-plan.json` is the machine-readable bridge between the browser checklist and the context eval corpus. It includes the target URL, offline-safe default mode, live opt-in environment variables, the required browser checklist, and a prompt matrix with each row's expected route, coverage status, synthesis eligibility, response purposes, and expected browser outcome.

Use these files to connect browser-visible failures to context coverage, capability routing, and missing promotion artifacts instead of treating the failure as a generic UI issue.
