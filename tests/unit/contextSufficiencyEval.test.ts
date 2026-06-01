import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';

type Fixture = {
  id: string;
  locale: 'ko' | 'en';
  prompt: string;
  expectedCapabilityIds: string[];
  forbiddenCapabilityIds: string[];
  expectedCandidatePartIds: string[];
  expectedInputModalities?: string[];
  expectedOutputModalities?: string[];
  expectedSupportGapPatterns: string[];
  expectedUnsupportedSignalPatterns: string[];
  expectedAmbiguity?: boolean;
  family?: string;
  expectedFailureClass?: string;
};

const fixturesPath = path.resolve('agent-context/evals/context-sufficiency-prompts.jsonl');

test('context packet prompt-family evals classify supported, planned, unsupported, and ambiguous requests', async () => {
  const fixtures = await loadFixtures();

  for (const fixture of fixtures) {
    const packet = await buildContextPacket({
      message: fixture.prompt,
      locale: fixture.locale
    });
    const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
    const candidatePartIds = packet.candidateParts.map((part) => part.id);

    for (const capabilityId of fixture.expectedCapabilityIds) {
      assert.ok(
        capabilityIds.includes(capabilityId),
        `${fixture.id} should include capability ${capabilityId}; got ${capabilityIds.join(', ')}`
      );
    }

    for (const capabilityId of fixture.forbiddenCapabilityIds) {
      assert.equal(
        capabilityIds.includes(capabilityId),
        false,
        `${fixture.id} should not overmatch capability ${capabilityId}; got ${capabilityIds.join(', ')}`
      );
    }

    for (const partId of fixture.expectedCandidatePartIds) {
      assert.ok(
        candidatePartIds.includes(partId),
        `${fixture.id} should include candidate part ${partId}; got ${candidatePartIds.join(', ')}`
      );
    }

    for (const modality of fixture.expectedInputModalities ?? []) {
      assert.ok(packet.intentHints.inputModalities.includes(modality), `${fixture.id} input modality ${modality}`);
    }

    for (const modality of fixture.expectedOutputModalities ?? []) {
      assert.ok(packet.intentHints.outputModalities.includes(modality), `${fixture.id} output modality ${modality}`);
    }

    for (const pattern of fixture.expectedSupportGapPatterns) {
      assert.ok(
        packet.supportGaps.some((gap) => new RegExp(pattern, 'i').test(gap)),
        `${fixture.id} should report support gap matching ${pattern}; got ${packet.supportGaps.join(' | ')}`
      );
    }

    for (const pattern of fixture.expectedUnsupportedSignalPatterns) {
      assert.ok(
        packet.unsupportedSignals.some((signal) => new RegExp(pattern, 'i').test(signal)),
        `${fixture.id} should report unsupported signal matching ${pattern}; got ${packet.unsupportedSignals.join(' | ')}`
      );
    }

    if (fixture.expectedAmbiguity) {
      assert.ok(packet.intentHints.ambiguity.length > 0, `${fixture.id} should ask for clarification context`);
    }
  }
});

async function loadFixtures() {
  const raw = await readFile(fixturesPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Fixture);
}
