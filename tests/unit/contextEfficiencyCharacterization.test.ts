import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  countDeepAgentConstructionSites,
  measureContextEfficiency,
  measureTokenRatio
} from '../../server/agent/contextEfficiency.ts';
import { loadInCatalogCorpus, makeSyntheticPart } from '../fixtures/inCatalogCorpus.ts';
import { PartCapabilitySchema } from '../../server/agent/schemas.ts';

// Phase 0 characterization: locks the CURRENT (legacy) per-request behavior so later phases can
// prove improvement and no-regression. These snapshots encode measured ground truth (probed
// 2026-06-02). When a later phase intentionally changes behavior, it updates these expectations.

const CURRENT_CATALOG_SIZE = 130;
// synthesis + requirement-analysis(legacy) + requirement-doc authoring (faithful chain US-002,
// flag-gated by H_EDUWARE_REQUIREMENT_DOC_CHAIN=llm; static site present regardless of flag).
const CURRENT_CREATE_DEEP_AGENT_SITES = 3;

void test('in-catalog corpus loads, is schema-valid, and includes the keyword-collision set', async () => {
  const corpus = await loadInCatalogCorpus();
  assert.ok(corpus.cases.length >= 30, `expected >=30 corpus cases, got ${corpus.cases.length}`);

  // Case #1 (the measured root-cause bug) must be present and flagged known-bad for legacy.
  const oledBreadboard = corpus.cases.find((c) => c.id === 'collision-01-oled-breadboard');
  assert.ok(oledBreadboard, 'corpus must contain the OLED+breadboard collision case (#1)');
  assert.equal(oledBreadboard.knownBadLegacy, true);
  assert.deepEqual(oledBreadboard.mustIncludePartIds, ['arduino-uno', 'oled-i2c-096']);

  // Every capability-base case names at least one required part to include.
  for (const c of corpus.cases) {
    assert.ok(c.mustIncludePartIds.length >= 1, `case ${c.id} must include >=1 part`);
  }
});

void test('synthetic parts are schema-valid and deterministic by seed', () => {
  const a = makeSyntheticPart(1);
  const b = makeSyntheticPart(2);
  const aAgain = makeSyntheticPart(1);
  assert.doesNotThrow(() => PartCapabilitySchema.parse(a));
  assert.doesNotThrow(() => PartCapabilitySchema.parse(b));
  assert.notEqual(a.id, b.id);
  assert.deepEqual(a, aAgain, 'same seed must produce an identical part');
});

void test('static deep-agent construction-site count characterizes the two-run cost', async () => {
  const count = await countDeepAgentConstructionSites();
  assert.equal(
    count,
    CURRENT_CREATE_DEEP_AGENT_SITES,
    'deep-agent factory seam sites: synthesis + legacy requirement-analysis + faithful requirement-doc authoring (flag-gated)'
  );
});

void test('LEGACY characterization: OLED+breadboard mis-routes and DROPS the OLED + controller (bug #1)', async () => {
  const m = await measureContextEfficiency({
    message: '아두이노 브레드보드에 I2C OLED로 이벤트 이름 텍스트를 표시하고 싶어',
    locale: 'ko'
  });
  assert.equal(m.routeId, 'v2-prototyping-surface-context');
  assert.ok(!m.candidatePartIds.includes('oled-i2c-096'), 'legacy bug: OLED is dropped');
  assert.ok(!m.candidatePartIds.includes('arduino-uno'), 'legacy bug: controller is dropped');
  // O(catalog): selection scans the whole registry regardless of request.
  assert.equal(m.candidatesConsidered, CURRENT_CATALOG_SIZE);
  assert.equal(m.createDeepAgentCount, CURRENT_CREATE_DEEP_AGENT_SITES);
  assert.ok(m.entryTokens > 0 && m.entryChars > 0);
  // promptBlock size is NOT the cause (≈8k chars, not 38k).
  assert.ok(m.entryChars < 12_000, `entry context ${m.entryChars} chars should be modest, not huge`);
});

void test('LEGACY characterization: OLED WITHOUT breadboard keyword routes correctly (the fix target)', async () => {
  const m = await measureContextEfficiency({
    message: '아두이노에 I2C OLED로 이벤트 이름 텍스트를 표시하고 싶어',
    locale: 'ko'
  });
  assert.equal(m.routeId, 'v2-display-text-output');
  assert.ok(m.candidatePartIds.includes('oled-i2c-096'), 'OLED present when no surface keyword collides');
  assert.ok(m.candidatePartIds.includes('arduino-uno'));
});

void test('LEGACY characterization: LED blink routes correctly', async () => {
  const m = await measureContextEfficiency({ message: 'LED 하나를 저항이랑 같이 깜빡이게 해줘', locale: 'ko' });
  assert.equal(m.routeId, 'v2-digital-light-output');
  assert.ok(m.candidatePartIds.includes('led-5mm'));
  assert.ok(m.candidatePartIds.includes('resistor-220'));
});

void test('token measurement is in tokens (o200k) and tool-schema cost is non-trivial', async () => {
  const m = await measureContextEfficiency({ message: 'LED 하나를 저항이랑 같이 깜빡이게 해줘', locale: 'ko' });
  assert.ok(m.toolSchemaTokens > 100, `tool-schema tokens ${m.toolSchemaTokens} should be substantial (11 tools)`);

  // Publish the ko char->token ratio so later budgets are set in tokens, not chars.
  const ko = measureTokenRatio('아두이노 브레드보드에 I2C OLED로 이벤트 이름 텍스트를 표시하고 싶어');
  assert.ok(ko.ratio > 0 && ko.ratio < 2, `ko ratio ${ko.ratio} out of sane band`);
  console.log(
    `[phase0] ko token ratio = ${ko.ratio.toFixed(3)} tok/char (${ko.tokens}/${ko.chars}); ` +
      `entryTokens=${m.entryTokens} toolSchemaTokens=${m.toolSchemaTokens}`
  );
});
