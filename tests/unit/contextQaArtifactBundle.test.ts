import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createContextQaArtifactBundle } from '../../server/qa/contextQaArtifactBundle.ts';

test('context QA artifact bundle writes eval report and promotion gaps beside a browser QA run', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'h-eduware-context-qa-'));

  try {
    const bundle = await createContextQaArtifactBundle({
      rootDir,
      runId: 'manual-product-qa-test',
      generatedAt: '2026-06-01T00:00:00.000Z'
    });

    assert.equal(bundle.runId, 'manual-product-qa-test');
    assert.equal(bundle.generatedAt, '2026-06-01T00:00:00.000Z');
    assert.ok(bundle.runDir.startsWith(rootDir));

    const generalizationReport = JSON.parse(await readFile(bundle.files.generalizationEvalReport, 'utf8'));
    assert.ok(generalizationReport.totalRows >= 18, `expected expanded prompt corpus, got ${generalizationReport.totalRows}`);
    assert.ok(
      generalizationReport.rows.some((row: { id: string; promotionBlockers: unknown[] }) =>
        row.id === 'potentiometer-planned' && row.promotionBlockers.length > 0
      )
    );

    const promotionGaps = JSON.parse(await readFile(bundle.files.capabilityPromotionGaps, 'utf8'));
    assert.equal(promotionGaps.totalCapabilities, generalizationReport.capabilityPromotionGaps.totalCapabilities);
    assert.ok(promotionGaps.gapsByArtifact.some((gap: { artifact: string }) => gap.artifact === 'part-capability'));

    const summary = await readFile(bundle.files.summaryMarkdown, 'utf8');
    assert.match(summary, /generalization-eval-report\.json/);
    assert.match(summary, /capability-promotion-gaps\.json/);
    assert.match(summary, /browser-verification-plan\.json/);
    assert.match(summary, /Browser Verification/);
    assert.match(summary, /Blocked from supported/);

    const browserPlan = JSON.parse(await readFile(bundle.files.browserVerificationPlan, 'utf8'));
    assert.equal(browserPlan.targetUrl, 'http://127.0.0.1:4173/');
    assert.equal(browserPlan.defaultMode, 'offline-safe mocked or cached agent boundary');
    assert.ok(browserPlan.liveModeOptIn.env.includes('RUN_LIVE_E2E=1'));
    assert.ok(
      browserPlan.checklist.some((item: { id: string }) => item.id === 'pcb-nonblank-render-plan-canvas'),
      'browser plan should require nonblank RenderPlan-backed PCB canvas evidence'
    );
    assert.ok(
      browserPlan.checklist.some((item: { id: string }) => item.id === 'inspector-tutor-grounding'),
      'browser plan should require selected component/wire tutor grounding'
    );
    assert.equal(browserPlan.promptMatrix.length, generalizationReport.totalRows);
    assert.ok(
      browserPlan.promptMatrix.some((row: { id: string; prompt: string; expectedBrowserOutcome: string }) =>
        row.id === 'led-blink'
        && /Blink one LED/i.test(row.prompt)
        && row.expectedBrowserOutcome === 'render-and-run-valid-simulation'
      )
    );
    assert.ok(
      browserPlan.promptMatrix.some((row: { id: string; expectedFailureClass: string; expectedBrowserOutcome: string }) =>
        row.id === 'button-led-buzzer'
        && row.expectedFailureClass === 'none'
        && row.expectedBrowserOutcome === 'render-and-run-valid-simulation'
      ),
      'button-led-buzzer should require visible render/run verification instead of remaining a model synthesis gap'
    );
    assert.ok(
      browserPlan.promptMatrix.some((row: { id: string; expectedBrowserOutcome: string }) =>
        row.id === 'potentiometer-planned' && row.expectedBrowserOutcome === 'support-gap-no-render-or-current'
      )
    );
    assert.ok(
      browserPlan.promptMatrix.some((row: { id: string; expectedBrowserOutcome: string }) =>
        row.id === 'mains-unsupported' && row.expectedBrowserOutcome === 'unsafe-refusal-no-render-or-current'
      )
    );

    const manifest = JSON.parse(await readFile(bundle.files.manifest, 'utf8'));
    assert.equal(manifest.runId, 'manual-product-qa-test');
    assert.equal(manifest.files.generalizationEvalReport, 'generalization-eval-report.json');
    assert.equal(manifest.files.capabilityPromotionGaps, 'capability-promotion-gaps.json');
    assert.equal(manifest.files.browserVerificationPlan, 'browser-verification-plan.json');
    assert.equal(manifest.browserVerification.promptRows, generalizationReport.totalRows);
    assert.ok(manifest.browserVerification.checklistItemCount >= 8);
  } finally {
    const resolvedRoot = path.resolve(rootDir);
    const tempRoot = path.resolve(os.tmpdir());
    if (resolvedRoot.startsWith(tempRoot)) {
      await rm(resolvedRoot, { recursive: true, force: true });
    }
  }
});
