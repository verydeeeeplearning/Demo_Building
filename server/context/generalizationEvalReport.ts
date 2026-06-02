import { readFile } from 'node:fs/promises';

import type { ContextCoverageReport } from '../agent/schemas.ts';
import { auditCapabilityPromotionGaps, type CapabilityCoverageReport, type CapabilityPromotionGapReport } from './contextLayer.ts';
import { buildContextPacket } from './contextPacket.ts';

const DEFAULT_EVAL_PATH = 'agent-context/evals/context-sufficiency-prompts.jsonl';

const FAILURE_CLASSES = [
  'none',
  'context-gap',
  'registry-gap',
  'validator-gap',
  'renderer-gap',
  'simulator-gap',
  'model-synthesis-gap',
  'unsafe-request',
  'ambiguous-request',
  'unsupported-request'
] as const;

export type GeneralizationFailureClass = typeof FAILURE_CLASSES[number];

type PromptEvalRow = {
  id: string;
  locale: 'ko' | 'en';
  prompt: string;
  family: string;
  expectedFailureClass: GeneralizationFailureClass;
  expectedContextRouteId: string;
  expectedCoverageStatus: ContextCoverageReport['status'];
  expectedSynthesisEligibility: ContextCoverageReport['synthesisEligibility']['status'];
  expectedSufficientFor: ContextCoverageReport['sufficientFor'];
  forbiddenSufficientFor: ContextCoverageReport['sufficientFor'];
  expectedBrowserOutcome: BrowserVerificationOutcome;
};

export type BrowserVerificationOutcome =
  | 'render-and-run-valid-simulation'
  | 'support-gap-no-render-or-current'
  | 'unsupported-response-no-render-or-current'
  | 'unsafe-refusal-no-render-or-current'
  | 'clarification-only-no-render-or-current'
  | 'record-failure-class-and-context-evidence';

export type GeneralizationPromotionBlocker = Pick<
  CapabilityCoverageReport,
  'capabilityId' | 'supportLevel' | 'recommendedSupportLevel' | 'canBeSupported' | 'missing' | 'details'
>;

export type GeneralizationEvalReportRow = {
  id: string;
  family: string;
  locale: 'ko' | 'en';
  prompt: string;
  expectedFailureClass: GeneralizationFailureClass;
  expectedContextRouteId: string;
  expectedCoverageStatus: ContextCoverageReport['status'];
  expectedSynthesisEligibility: ContextCoverageReport['synthesisEligibility']['status'];
  expectedSufficientFor: ContextCoverageReport['sufficientFor'];
  forbiddenSufficientFor: ContextCoverageReport['sufficientFor'];
  expectedBrowserOutcome: BrowserVerificationOutcome;
  observedFailureClass: GeneralizationFailureClass;
  contextRouteId: string;
  matchedCapabilityIds: string[];
  candidatePartIds: string[];
  supportGaps: string[];
  unsupportedSignals: string[];
  contextCoverage: Pick<
    ContextCoverageReport,
    'status' | 'score' | 'sufficientFor' | 'synthesisEligibility' | 'missingSourceTypes' | 'warnings'
  >;
  promotionBlockers: GeneralizationPromotionBlocker[];
};

export type GeneralizationEvalReport = {
  version: '1';
  generatedAt: string;
  totalRows: number;
  byExpectedFailureClass: Record<GeneralizationFailureClass, number>;
  byObservedFailureClass: Record<GeneralizationFailureClass, number>;
  capabilityPromotionGaps: CapabilityPromotionGapReport;
  rows: GeneralizationEvalReportRow[];
};

export async function buildGeneralizationEvalReport(options: {
  evalPath?: string;
  generatedAt?: string;
} = {}): Promise<GeneralizationEvalReport> {
  const rows = await readJsonl<PromptEvalRow>(options.evalPath ?? DEFAULT_EVAL_PATH);
  const capabilityPromotionGaps = await auditCapabilityPromotionGaps();
  const coverageByCapability = new Map(
    capabilityPromotionGaps.reports.map((report) => [report.capabilityId, report])
  );
  const byExpectedFailureClass = emptyFailureClassCounts();
  const byObservedFailureClass = emptyFailureClassCounts();
  const reportRows: GeneralizationEvalReportRow[] = [];

  for (const row of rows) {
    const packet = await buildContextPacket({
      message: row.prompt,
      locale: row.locale
    });
    const matchedCapabilityIds = packet.capabilityMatches.map((capability) => capability.id);
    const observedFailureClass = inferObservedFailureClass(row, packet);

    byExpectedFailureClass[row.expectedFailureClass] += 1;
    byObservedFailureClass[observedFailureClass] += 1;

    reportRows.push({
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
      expectedBrowserOutcome: row.expectedBrowserOutcome,
      observedFailureClass,
      contextRouteId: packet.contextRoute.routeId,
      matchedCapabilityIds,
      candidatePartIds: packet.candidateParts.map((part) => part.id),
      supportGaps: packet.supportGaps,
      unsupportedSignals: packet.unsupportedSignals,
      contextCoverage: {
        status: packet.contextCoverage.status,
        score: packet.contextCoverage.score,
        sufficientFor: packet.contextCoverage.sufficientFor,
        synthesisEligibility: packet.contextCoverage.synthesisEligibility,
        missingSourceTypes: packet.contextCoverage.missingSourceTypes,
        warnings: packet.contextCoverage.warnings
      },
      promotionBlockers: matchedCapabilityIds
        .map((capabilityId) => coverageByCapability.get(capabilityId))
        .filter((report): report is CapabilityCoverageReport => Boolean(report))
        .filter((report) => !report.canBeSupported)
        .map(toPromotionBlocker)
    });
  }

  return {
    version: '1',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    totalRows: reportRows.length,
    byExpectedFailureClass,
    byObservedFailureClass,
    capabilityPromotionGaps,
    rows: reportRows
  };
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const raw = await readFile(file, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function inferObservedFailureClass(
  expected: PromptEvalRow,
  packet: Awaited<ReturnType<typeof buildContextPacket>>
): GeneralizationFailureClass {
  if (packet.contextCoverage.status === 'sufficient') {
    return expected.expectedFailureClass === 'model-synthesis-gap' ? 'model-synthesis-gap' : 'none';
  }
  if (packet.contextRoute.routeId === 'ambiguous-minimal' || packet.contextRoute.routeId === 'v2-ambiguous-minimal') {
    return 'ambiguous-request';
  }
  if (packet.contextRoute.routeId === 'unsupported-safety') {
    return expected.expectedFailureClass === 'unsafe-request' ? 'unsafe-request' : 'unsupported-request';
  }
  if (packet.contextCoverage.missingSourceTypes.includes('registry')) {
    return 'registry-gap';
  }
  if (packet.contextCoverage.missingSourceTypes.includes('simulation')) {
    return 'simulator-gap';
  }
  if (packet.contextCoverage.missingSourceTypes.includes('rendering')) {
    return 'renderer-gap';
  }
  if (packet.contextCoverage.missingSourceTypes.includes('reference')) {
    return 'validator-gap';
  }
  return packet.supportGaps.length > 0 ? 'context-gap' : 'model-synthesis-gap';
}

function toPromotionBlocker(report: CapabilityCoverageReport): GeneralizationPromotionBlocker {
  return {
    capabilityId: report.capabilityId,
    supportLevel: report.supportLevel,
    recommendedSupportLevel: report.recommendedSupportLevel,
    canBeSupported: report.canBeSupported,
    missing: report.missing,
    details: report.details
  };
}

function emptyFailureClassCounts(): Record<GeneralizationFailureClass, number> {
  return {
    none: 0,
    'context-gap': 0,
    'registry-gap': 0,
    'validator-gap': 0,
    'renderer-gap': 0,
    'simulator-gap': 0,
    'model-synthesis-gap': 0,
    'unsafe-request': 0,
    'ambiguous-request': 0,
    'unsupported-request': 0
  };
}
