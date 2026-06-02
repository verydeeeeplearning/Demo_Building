import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildGeneralizationEvalReport } from '../../server/context/generalizationEvalReport.ts';
import { buildContextPacket } from '../../server/context/contextPacket.ts';

type PromptEvalRow = {
  id: string;
  locale: 'ko' | 'en';
  prompt: string;
  family: string;
  expectedFailureClass: FailureClass;
  expectedContextRouteId: string;
  expectedCoverageStatus: 'sufficient' | 'insufficient';
  expectedSynthesisEligibility: 'eligible' | 'ineligible';
  expectedSufficientFor: string[];
  forbiddenSufficientFor: string[];
  expectedBrowserOutcome: BrowserOutcome;
  expectedCapabilityIds: string[];
  forbiddenCapabilityIds: string[];
  expectedCandidatePartIds: string[];
  forbiddenCandidatePartIds?: string[];
  expectedInputModalities?: string[];
  expectedOutputModalities?: string[];
  expectedSupportGapPatterns: string[];
  expectedUnsupportedSignalPatterns: string[];
  expectedAmbiguity?: boolean;
};

type FailureClass = typeof allowedFailureClasses[number];
type BrowserOutcome = typeof allowedBrowserOutcomes[number];

const requiredPromptFamilies = [
  'display-output',
  'light-output',
  'sound-output',
  'motion-output',
  'digital-input',
  'analog-input',
  'sensor-readout',
  'multi-output',
  'ambiguous',
  'unsafe',
  'unsupported',
  'mixed-language',
  'typo-heavy'
] as const;

const allowedFailureClasses = [
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

const allowedBrowserOutcomes = [
  'render-and-run-valid-simulation',
  'support-gap-no-render-or-current',
  'unsupported-response-no-render-or-current',
  'unsafe-refusal-no-render-or-current',
  'clarification-only-no-render-or-current',
  'record-failure-class-and-context-evidence'
] as const;

test('generalization eval corpus covers required prompt families and failure taxonomy', async () => {
  const rows = await readJsonl<PromptEvalRow>('agent-context/evals/context-sufficiency-prompts.jsonl');
  const families = new Set(rows.map((row) => row.family));

  for (const family of requiredPromptFamilies) {
    assert.ok(families.has(family), `missing eval family: ${family}`);
  }

  for (const row of rows) {
    assert.ok(row.id.length > 0, 'eval row needs id');
    assert.ok(row.prompt.length > 0, `${row.id} needs prompt`);
    assert.ok(allowedFailureClasses.includes(row.expectedFailureClass), `${row.id} has unknown failure class`);
    assert.ok(row.family.length > 0, `${row.id} needs family`);
    assert.equal(typeof row.expectedContextRouteId, 'string', `${row.id} needs expectedContextRouteId`);
    assert.ok(row.expectedContextRouteId.length > 0, `${row.id} needs non-empty expectedContextRouteId`);
    assert.ok(['sufficient', 'insufficient'].includes(row.expectedCoverageStatus), `${row.id} needs expectedCoverageStatus`);
    assert.ok(['eligible', 'ineligible'].includes(row.expectedSynthesisEligibility), `${row.id} needs expectedSynthesisEligibility`);
    assert.ok(allowedBrowserOutcomes.includes(row.expectedBrowserOutcome), `${row.id} needs expectedBrowserOutcome`);
    assert.ok(Array.isArray(row.expectedSufficientFor), `${row.id} expectedSufficientFor`);
    assert.ok(Array.isArray(row.forbiddenSufficientFor), `${row.id} forbiddenSufficientFor`);
    assert.ok(Array.isArray(row.expectedCapabilityIds), `${row.id} expectedCapabilityIds`);
    assert.ok(Array.isArray(row.forbiddenCapabilityIds), `${row.id} forbiddenCapabilityIds`);
  }
});

test('generalization eval rows execute through context routing with expected failure class behavior', async () => {
  const rows = await readJsonl<PromptEvalRow>('agent-context/evals/context-sufficiency-prompts.jsonl');

  for (const row of rows) {
    const packet = await buildContextPacket({
      message: row.prompt,
      locale: row.locale
    });
    const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
    const candidatePartIds = packet.candidateParts.map((part) => part.id);

    for (const capabilityId of row.expectedCapabilityIds) {
      assert.ok(capabilityIds.includes(capabilityId), `${row.id} missing capability ${capabilityId}`);
    }

    for (const capabilityId of row.forbiddenCapabilityIds) {
      assert.equal(capabilityIds.includes(capabilityId), false, `${row.id} overmatched ${capabilityId}`);
    }

    for (const partId of row.expectedCandidatePartIds) {
      assert.ok(candidatePartIds.includes(partId), `${row.id} missing candidate part ${partId}`);
    }

    for (const partId of row.forbiddenCandidatePartIds ?? []) {
      assert.equal(candidatePartIds.includes(partId), false, `${row.id} overmatched candidate part ${partId}`);
    }

    for (const modality of row.expectedInputModalities ?? []) {
      assert.ok(packet.intentHints.inputModalities.includes(modality), `${row.id} missing input modality ${modality}`);
    }

    for (const modality of row.expectedOutputModalities ?? []) {
      assert.ok(packet.intentHints.outputModalities.includes(modality), `${row.id} missing output modality ${modality}`);
    }

    for (const pattern of row.expectedSupportGapPatterns) {
      assert.ok(packet.supportGaps.some((gap) => new RegExp(pattern, 'i').test(gap)), `${row.id} missing support gap ${pattern}`);
    }

    for (const pattern of row.expectedUnsupportedSignalPatterns) {
      assert.ok(packet.unsupportedSignals.some((signal) => new RegExp(pattern, 'i').test(signal)), `${row.id} missing unsupported signal ${pattern}`);
    }

    assert.equal(packet.contextRoute.routeId, row.expectedContextRouteId, `${row.id} route mismatch`);
    assert.equal(packet.contextCoverage.status, row.expectedCoverageStatus, `${row.id} coverage status mismatch`);
    assert.equal(
      packet.contextCoverage.synthesisEligibility.status,
      row.expectedSynthesisEligibility,
      `${row.id} synthesis eligibility mismatch`
    );

    for (const purpose of row.expectedSufficientFor) {
      assert.ok(packet.contextCoverage.sufficientFor.includes(purpose as never), `${row.id} missing sufficientFor ${purpose}`);
    }

    for (const purpose of row.forbiddenSufficientFor) {
      assert.equal(packet.contextCoverage.sufficientFor.includes(purpose as never), false, `${row.id} should not be sufficientFor ${purpose}`);
    }

    if (row.expectedFailureClass === 'none') {
      assert.equal(packet.contextCoverage.status, 'sufficient', `${row.id} should be fully grounded`);
    }
    if (row.expectedFailureClass === 'context-gap') {
      assert.ok(packet.supportGaps.length > 0, `${row.id} should expose context gap`);
      assert.equal(packet.contextCoverage.status, 'insufficient', `${row.id} should not pass coverage`);
    }
    if (row.expectedFailureClass === 'ambiguous-request') {
      assert.equal(packet.contextRoute.routeId, row.expectedContextRouteId, `${row.id} should use minimal clarification route`);
      assert.ok(packet.intentHints.ambiguity.length > 0, `${row.id} should be ambiguous`);
    }
    if (row.expectedAmbiguity !== undefined) {
      assert.equal(packet.intentHints.ambiguity.length > 0, row.expectedAmbiguity, `${row.id} ambiguity flag mismatch`);
    }
    if (row.expectedFailureClass === 'unsafe-request' || row.expectedFailureClass === 'unsupported-request') {
      assert.equal(packet.contextRoute.routeId, 'unsupported-safety', `${row.id} should use unsupported safety route`);
      assert.equal(packet.contextCoverage.status, 'insufficient', `${row.id} should not pass coverage`);
    }

    assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars, `${row.id} exceeded retrieval budget`);
  }
});

test('validation and simulation eval fixtures declare families and failure taxonomy', async () => {
  const validationRows = await readJsonl<Record<string, unknown>>('agent-context/evals/expected-validation-results.jsonl');
  const simulationRows = await readJsonl<Record<string, unknown>>('agent-context/evals/expected-simulation-results.jsonl');

  for (const row of [...validationRows, ...simulationRows]) {
    assert.equal(typeof row.id, 'string');
    assert.equal(typeof row.family, 'string', `${row.id} missing family`);
    assert.ok(allowedFailureClasses.includes(row.expectedFailureClass as FailureClass), `${row.id} has unknown failure class`);
  }
});

test('generalization eval report attaches capability promotion blockers for context gaps', async () => {
  const [rows, report] = await Promise.all([
    readJsonl<PromptEvalRow>('agent-context/evals/context-sufficiency-prompts.jsonl'),
    buildGeneralizationEvalReport({ generatedAt: '2026-06-01T00:00:00.000Z' })
  ]);

  assert.equal(report.totalRows, rows.length);
  assert.equal(report.generatedAt, '2026-06-01T00:00:00.000Z');
  assert.equal(report.byExpectedFailureClass['context-gap'], 0);
  assert.equal(report.byObservedFailureClass['context-gap'], 0);
  assert.ok(
    report.capabilityPromotionGaps.gapsByArtifact.some((gap) => gap.artifact === 'source-claims'),
    'report should include capability promotion gap buckets'
  );

  const potentiometerRow = report.rows.find((row) => row.id === 'potentiometer-supported');
  assert.ok(potentiometerRow, 'potentiometer-supported row should exist');
  assert.equal(potentiometerRow.expectedContextRouteId, 'v2-analog-led-dimmer');
  assert.equal(potentiometerRow.expectedCoverageStatus, 'sufficient');
  assert.equal(potentiometerRow.expectedSynthesisEligibility, 'eligible');
  assert.equal(potentiometerRow.expectedContextRouteId, potentiometerRow.contextRouteId);
  assert.equal(potentiometerRow.expectedCoverageStatus, potentiometerRow.contextCoverage.status);
  assert.equal(potentiometerRow.expectedSynthesisEligibility, potentiometerRow.contextCoverage.synthesisEligibility.status);
  assert.equal(potentiometerRow.contextCoverage.status, 'sufficient');
  assert.ok(potentiometerRow.matchedCapabilityIds.includes('analog-led-dimmer'));
  assert.equal(potentiometerRow.promotionBlockers.some((blocker) => blocker.capabilityId === 'analog-led-dimmer'), false);

  const dht11Row = report.rows.find((row) => row.id === 'dht11-display-supported');
  assert.ok(dht11Row, 'dht11-display-supported row should exist');
  assert.equal(dht11Row.expectedContextRouteId, 'v2-dht11-temperature-humidity-display');
  assert.equal(dht11Row.expectedCoverageStatus, 'sufficient');
  assert.equal(dht11Row.expectedSynthesisEligibility, 'eligible');
  assert.equal(dht11Row.expectedContextRouteId, dht11Row.contextRouteId);
  assert.equal(dht11Row.contextCoverage.status, 'sufficient');
  assert.equal(dht11Row.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(dht11Row.matchedCapabilityIds.includes('dht11-temperature-humidity-display'));
  assert.deepEqual(dht11Row.promotionBlockers, []);
});

test('button LED buzzer eval row is promoted to valid render and run synthesis', async () => {
  const [rows, report] = await Promise.all([
    readJsonl<PromptEvalRow>('agent-context/evals/context-sufficiency-prompts.jsonl'),
    buildGeneralizationEvalReport({ generatedAt: '2026-06-01T00:00:00.000Z' })
  ]);
  const fixture = rows.find((row) => row.id === 'button-led-buzzer');
  const row = report.rows.find((candidate) => candidate.id === 'button-led-buzzer');

  assert.ok(fixture, 'button-led-buzzer fixture should exist');
  assert.equal(fixture.expectedFailureClass, 'none');
  assert.equal(fixture.expectedBrowserOutcome, 'render-and-run-valid-simulation');
  assert.equal(fixture.expectedCoverageStatus, 'sufficient');
  assert.equal(fixture.expectedSynthesisEligibility, 'eligible');
  assert.ok(fixture.expectedSufficientFor.includes('valid_circuit_synthesis'));
  assert.ok(fixture.expectedCapabilityIds.includes('button-controlled-light-output'));
  assert.ok(fixture.expectedCapabilityIds.includes('sound-alert-output'));

  assert.ok(row, 'button-led-buzzer report row should exist');
  assert.equal(row.expectedFailureClass, 'none');
  assert.equal(row.observedFailureClass, 'none');
  assert.equal(row.expectedBrowserOutcome, 'render-and-run-valid-simulation');
  assert.equal(row.contextCoverage.status, 'sufficient');
  assert.equal(row.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(row.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'));
  assert.deepEqual(row.promotionBlockers, []);
  assert.equal(report.byExpectedFailureClass.none, rows.filter((candidate) => candidate.expectedFailureClass === 'none').length);
  assert.equal(report.byExpectedFailureClass['model-synthesis-gap'] ?? 0, 0);
  assert.equal(report.byObservedFailureClass.none, report.rows.filter((candidate) => candidate.observedFailureClass === 'none').length);
  assert.equal(report.byObservedFailureClass['model-synthesis-gap'] ?? 0, 0);
});

async function readJsonl<T>(file: string): Promise<T[]> {
  const raw = await readFile(file, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
