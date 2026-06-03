import assert from 'node:assert/strict';
import { test } from 'node:test';

// Contract-equivalence guard for the contextPacket split (PLAN_god_module_refactor, Phase A.4/C).
// Prompt presentation + intent extraction are being extracted into sibling modules, but
// `contextPacket.ts` must keep exposing `buildContextPacket` (and the `ContextPacketDeps` type) so
// every call site is untouched. This freezes the runtime surface.
import * as contextPacket from '../../server/context/contextPacket.ts';

test('contextPacket re-exports buildContextPacket as a callable', () => {
  const exported = contextPacket as unknown as Record<string, unknown>;
  assert.equal(
    typeof exported.buildContextPacket,
    'function',
    'missing public export: buildContextPacket'
  );
});

test('contextPacket exposes exactly the expected value exports', () => {
  // ContextPacketDeps is a type-only export (erased at runtime); only buildContextPacket is a value.
  const actual = Object.keys(contextPacket as unknown as Record<string, unknown>)
    .filter(
      (key) => typeof (contextPacket as unknown as Record<string, unknown>)[key] === 'function'
    )
    .sort();
  assert.deepEqual(actual, ['buildContextPacket']);
});
