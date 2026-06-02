import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applySafetyOverlay, evaluateSafetyOverlay, type SafetyOverlay } from '../../server/context/safetyOverlay.ts';
import type { GeneratedComposition } from '../../server/context/generatedComposition.ts';

// Phase 2.5 — safety-overlay bridge. review-only -> build-ready ONLY with a valid, human-reviewed
// overlay AND a complete composition. Preserves the cycle-breaker (no machine self-promotion).

function composition(overrides: Partial<GeneratedComposition> = {}): GeneratedComposition {
  return {
    provenance: 'generated-composition',
    topologyId: 'topo-led-blink',
    candidatePartIds: ['arduino-uno', 'led-5mm', 'resistor-220'],
    slotAssignments: { controller: 'arduino-uno', load: 'led-5mm' },
    netlist: [],
    validationRules: ['series-current-limit'],
    simulationPrimitiveHints: [],
    safetyOverlayPresent: false,
    buildReadyScope: 'review-only',
    blockingConditions: [],
    complete: true,
    ...overrides
  };
}

function overlay(overrides: Partial<SafetyOverlay> = {}): SafetyOverlay {
  return {
    topologyId: 'topo-led-blink',
    reviewedBy: 'safety-reviewer',
    reviewedAt: '2026-06-02T00:00:00Z',
    safetyChecks: ['low-voltage-only', 'current-limited'],
    riskAcknowledged: true,
    ...overrides
  };
}

void test('complete composition + valid overlay becomes build-ready (original)', () => {
  const bridged = applySafetyOverlay(composition(), overlay());
  assert.equal(bridged.buildReadyScope, 'original');
  assert.equal(bridged.safetyOverlayPresent, true);
  assert.ok(bridged.safetyOverlay);
});

void test('complete composition WITHOUT an overlay stays review-only (safe default)', () => {
  const bridged = applySafetyOverlay(composition(), null);
  assert.equal(bridged.buildReadyScope, 'review-only');
  assert.equal(bridged.safetyOverlayPresent, false);
  assert.ok(bridged.blockingConditions.includes('safety-overlay:missing-safety-overlay'));
});

void test('an invalid overlay never lifts review-only (cycle-breaker)', () => {
  for (const [label, bad] of [
    ['not reviewed', overlay({ riskAcknowledged: false })],
    ['no reviewer', overlay({ reviewedBy: '  ' })],
    ['no checks', overlay({ safetyChecks: [] })],
    ['topology mismatch', overlay({ topologyId: 'topo-other' })]
  ] as const) {
    const bridged = applySafetyOverlay(composition(), bad);
    assert.equal(bridged.buildReadyScope, 'review-only', `${label} must stay review-only`);
    assert.equal(bridged.safetyOverlayPresent, false, `${label} overlay must be invalid`);
  }
});

void test('an incomplete composition stays review-only even with a valid overlay', () => {
  const bridged = applySafetyOverlay(composition({ complete: false }), overlay());
  assert.equal(bridged.buildReadyScope, 'review-only');
  assert.ok(bridged.blockingConditions.includes('composition-incomplete'));
});

void test('evaluateSafetyOverlay reports precise reasons', () => {
  assert.deepEqual(evaluateSafetyOverlay(composition(), overlay()), { valid: true, reasons: [] });
  assert.deepEqual(evaluateSafetyOverlay(composition(), null), { valid: false, reasons: ['missing-safety-overlay'] });
  const partial = evaluateSafetyOverlay(composition(), overlay({ riskAcknowledged: false, safetyChecks: [] }));
  assert.equal(partial.valid, false);
  assert.deepEqual(partial.reasons.sort(), ['no-safety-checks', 'risk-not-acknowledged']);
});
