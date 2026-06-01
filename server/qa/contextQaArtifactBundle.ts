import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildGeneralizationEvalReport, type GeneralizationEvalReport } from '../context/generalizationEvalReport.ts';

const DEFAULT_QA_ROOT = 'qa-artifacts/manual-product-qa';

export type ContextQaArtifactBundleOptions = {
  rootDir?: string;
  runId?: string;
  generatedAt?: string;
};

export type ContextQaArtifactBundle = {
  runId: string;
  runDir: string;
  generatedAt: string;
  files: {
    generalizationEvalReport: string;
    capabilityPromotionGaps: string;
    browserVerificationPlan: string;
    summaryMarkdown: string;
    manifest: string;
  };
};

export async function createContextQaArtifactBundle(
  options: ContextQaArtifactBundleOptions = {}
): Promise<ContextQaArtifactBundle> {
  const report = await buildGeneralizationEvalReport({ generatedAt: options.generatedAt });
  const runId = options.runId ?? defaultRunId(report.generatedAt);
  const runDir = path.resolve(options.rootDir ?? DEFAULT_QA_ROOT, runId);
  await mkdir(runDir, { recursive: true });

  const files = {
    generalizationEvalReport: path.join(runDir, 'generalization-eval-report.json'),
    capabilityPromotionGaps: path.join(runDir, 'capability-promotion-gaps.json'),
    browserVerificationPlan: path.join(runDir, 'browser-verification-plan.json'),
    summaryMarkdown: path.join(runDir, 'context-qa-summary.md'),
    manifest: path.join(runDir, 'context-qa-manifest.json')
  };
  const browserVerificationPlan = buildBrowserVerificationPlan(report);

  await writeFile(files.generalizationEvalReport, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(
    files.capabilityPromotionGaps,
    `${JSON.stringify(report.capabilityPromotionGaps, null, 2)}\n`,
    'utf8'
  );
  await writeFile(files.browserVerificationPlan, `${JSON.stringify(browserVerificationPlan, null, 2)}\n`, 'utf8');
  await writeFile(files.summaryMarkdown, renderSummary(report, browserVerificationPlan), 'utf8');
  await writeFile(
    files.manifest,
    `${JSON.stringify({
      version: '1',
      runId,
      generatedAt: report.generatedAt,
      files: {
        generalizationEvalReport: path.basename(files.generalizationEvalReport),
        capabilityPromotionGaps: path.basename(files.capabilityPromotionGaps),
        browserVerificationPlan: path.basename(files.browserVerificationPlan),
        summaryMarkdown: path.basename(files.summaryMarkdown)
      },
      browserVerification: {
        targetUrl: browserVerificationPlan.targetUrl,
        checklistItemCount: browserVerificationPlan.checklist.length,
        promptRows: browserVerificationPlan.promptMatrix.length,
        liveModeOptIn: browserVerificationPlan.liveModeOptIn
      }
    }, null, 2)}\n`,
    'utf8'
  );

  return {
    runId,
    runDir,
    generatedAt: report.generatedAt,
    files
  };
}

type BrowserVerificationPlan = ReturnType<typeof buildBrowserVerificationPlan>;

function buildBrowserVerificationPlan(report: GeneralizationEvalReport) {
  return {
    version: '1',
    targetUrl: 'http://127.0.0.1:4173/',
    defaultMode: 'offline-safe mocked or cached agent boundary',
    liveModeOptIn: {
      env: ['RUN_LIVE_E2E=1', 'H_EDUWARE_AGENT_MODE=live', 'OPENAI_API_KEY', 'H_EDUWARE_AGENT_MODEL'],
      note: 'Live Deepagents browser/API smoke checks stay opt-in; default QA must not require secrets.'
    },
    checklist: [
      {
        id: 'chat-secret-safety',
        label: 'Chat never exposes server secrets or raw environment values.'
      },
      {
        id: 'files-requirement-and-context-evidence',
        label: 'Files tab shows requirement markdown and context coverage evidence for agent-built circuits.'
      },
      {
        id: 'pcb-nonblank-render-plan-canvas',
        label: 'PCB tab shows a nonblank three.js canvas backed by RenderPlan parts.'
      },
      {
        id: 'component-and-wire-selection',
        label: 'At least one component and one wire can be selected or hovered.'
      },
      {
        id: 'inspector-tutor-grounding',
        label: 'Inspector tutor answers selected target questions using current artifact grounding.'
      },
      {
        id: 'run-valid-current-only',
        label: 'Run current animation appears only when validation and simulation are valid.'
      },
      {
        id: 'support-gap-no-render-or-current',
        label: 'Planned context gaps show support-readiness text and do not render or animate current.'
      },
      {
        id: 'unsafe-unsupported-no-render-or-current',
        label: 'Unsupported and unsafe requests end before build, render, or current simulation artifacts.'
      }
    ],
    promptMatrix: report.rows.map((row) => ({
      id: row.id,
      family: row.family,
      locale: row.locale,
      prompt: row.prompt,
      expectedFailureClass: row.expectedFailureClass,
      expectedContextRouteId: row.expectedContextRouteId,
      expectedCoverageStatus: row.expectedCoverageStatus,
      expectedSynthesisEligibility: row.expectedSynthesisEligibility,
      expectedSufficientFor: row.expectedSufficientFor,
      forbiddenSufficientFor: row.forbiddenSufficientFor,
      expectedBrowserOutcome: row.expectedBrowserOutcome ?? expectedBrowserOutcome(row)
    }))
  };
}

function expectedBrowserOutcome(row: GeneralizationEvalReport['rows'][number]) {
  if (row.expectedSufficientFor.includes('unsafe_refusal')) {
    return 'unsafe-refusal-no-render-or-current';
  }
  if (row.expectedCoverageStatus === 'insufficient' && row.expectedSufficientFor.includes('unsupported_response')) {
    return 'support-gap-no-render-or-current';
  }
  if (row.expectedFailureClass === 'ambiguous-request') {
    return 'clarification-only-no-render-or-current';
  }
  if (row.expectedCoverageStatus === 'sufficient' && row.expectedSynthesisEligibility === 'eligible') {
    return 'render-and-run-valid-simulation';
  }
  return 'record-failure-class-and-context-evidence';
}

function renderSummary(report: GeneralizationEvalReport, browserPlan: BrowserVerificationPlan) {
  const blocked = report.capabilityPromotionGaps.blockedFromSupported;
  const gapLines = report.capabilityPromotionGaps.gapsByArtifact
    .map((gap) => `- ${gap.artifact}: ${gap.count} capabilities (${gap.capabilityIds.join(', ')})`)
    .join('\n');

  return `# Context QA Summary

Generated at: ${report.generatedAt}

## Files

- generalization-eval-report.json
- capability-promotion-gaps.json
- browser-verification-plan.json
- context-qa-manifest.json

## Eval Coverage

- Total rows: ${report.totalRows}
- Expected failure classes: ${JSON.stringify(report.byExpectedFailureClass)}
- Observed failure classes: ${JSON.stringify(report.byObservedFailureClass)}

## Capability Promotion

- Ready for supported: ${report.capabilityPromotionGaps.readyForSupported.join(', ') || 'none'}
- Blocked from supported: ${blocked.join(', ') || 'none'}

## Gaps By Artifact

${gapLines || '- none'}

## Browser Verification

- Target URL: ${browserPlan.targetUrl}
- Default mode: ${browserPlan.defaultMode}
- Live opt-in env: ${browserPlan.liveModeOptIn.env.join(', ')}
- Checklist items: ${browserPlan.checklist.length}
- Prompt rows: ${browserPlan.promptMatrix.length}
`;
}

function defaultRunId(generatedAt: string) {
  return `context-qa-${generatedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}
