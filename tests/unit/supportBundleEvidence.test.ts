import assert from 'node:assert/strict';
import test from 'node:test';

import { SupportBundleEvidenceSchema } from '../../server/agent/schemas.ts';
import {
  buildSupportBundleEvidence,
  bundleEvidenceBlocksSynthesis
} from '../../server/context/supportBundleEvidence.ts';

test('support bundle evidence summarizes verified capability coverage', () => {
  const evidence = SupportBundleEvidenceSchema.parse({
    capabilityId: 'digital-light-output',
    bundleId: 'digital-light-output-starter',
    supportLevel: 'supported',
    status: 'complete',
    requiredParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220'],
    requiredArtifacts: ['source-claims', 'part-capability', 'validation-rule', 'render-footprint', 'simulation-primitive'],
    presentArtifacts: ['source-claims', 'part-capability', 'validation-rule', 'render-footprint', 'simulation-primitive'],
    missingArtifacts: [],
    sourceClaimIds: ['arduino-uno-rev3-io-current-20ma', 'led-5mm-requires-current-limit'],
    sourceTiers: ['manufacturer-official', 'educational-reference'],
    promptSummary: 'digital-light-output has complete verified hardware support data.'
  });

  assert.equal(evidence.status, 'complete');
  assert.equal(evidence.capabilityId, 'digital-light-output');
  assert.deepEqual(evidence.missingArtifacts, []);
});

test('buildSupportBundleEvidence returns complete evidence for a supported starter capability', async () => {
  const evidence = await buildSupportBundleEvidence([
    {
      id: 'digital-light-output',
      supportLevel: 'supported',
      positivePhrases: ['blink led'],
      requiredEvidence: ['led'],
      negativeEvidence: [],
      minimumScore: 0.62,
      studentPhrases: ['blink led'],
      inputModalities: ['time'],
      outputModalities: ['light'],
      requiredRoles: ['controller', 'digital-output', 'series-current-limit', 'dc-load', 'ground-return'],
      requiredParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220'],
      optionalParts: ['jumper-wire'],
      protocols: ['gpio', 'power'],
      simulationPrimitives: ['digital_on_off', 'blink_timer', 'current_flow_animation'],
      renderFootprints: ['arduino', 'breadboard', 'led', 'resistor', 'wire'],
      validationRules: ['series-current-limit', 'led-polarity', 'closed-current-path'],
      commonMistakes: [],
      safeAlternatives: []
    }
  ]);

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].capabilityId, 'digital-light-output');
  assert.equal(evidence[0].status, 'complete');
  assert.equal(evidence[0].missingArtifacts.length, 0);
});

test('incomplete supported bundle evidence blocks synthesis eligibility', () => {
  assert.equal(bundleEvidenceBlocksSynthesis([{
    capabilityId: 'digital-light-output',
    bundleId: 'digital-light-output-starter',
    supportLevel: 'supported',
    status: 'incomplete',
    requiredParts: ['arduino-uno', 'led-5mm'],
    requiredArtifacts: ['source-claims'],
    presentArtifacts: [],
    missingArtifacts: ['source-claims'],
    sourceClaimIds: ['missing-claim'],
    sourceTiers: [],
    promptSummary: 'digital-light-output is missing verified source data: source-claims.'
  }]), true);

  assert.equal(bundleEvidenceBlocksSynthesis([{
    capabilityId: 'future-sensor-display',
    bundleId: null,
    supportLevel: 'planned',
    status: 'missing',
    requiredParts: ['future-sensor-module'],
    requiredArtifacts: ['source-claims'],
    presentArtifacts: [],
    missingArtifacts: ['source-claims'],
    sourceClaimIds: [],
    sourceTiers: [],
    promptSummary: 'future-sensor-display has no verified hardware support data.'
  }]), false);
});
