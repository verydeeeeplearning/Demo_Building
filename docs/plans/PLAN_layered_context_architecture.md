# Layered Context Architecture Plan

> Current architecture anchor for agent-context v2 routing and scoped context access.

## Runtime Shape

The current Context Layer uses `agent-context/v2`, `server/context/contextPacket.ts`, and `server/context/contextLayer.ts` as the source-of-truth path.

The active shape is:

- L0 part/source bundles selected from context routes.
- L2 topology composition and validation inputs generated from selected sources.
- L3 capability bundles and source-bundle evidence exposed through `contextTrace`.
- Item-level trace ids such as `registry:part-capabilities:<id>` and `data:simulation-primitives:<id>` name one selected evidence item, not authorization to read an aggregate document.

## Access Rule

Any agent or tutor context reader must preserve the item-level boundary. Aggregate files may be used internally to resolve a projection, but a scoped read for one item must return only that item.

## Implementation Anchors

- Context index and source-id resolution: `server/context/contextLayer.ts`
- Context packet assembly and `contextTrace`: `server/context/contextPacket.ts`
- v2 context bundles: `agent-context/v2/`
- Current tutor robustness plan: `docs/plans/PLAN_tutor_context_layer_memory_robustness.md`

## Non-Goals

- This document is not a dated adversarial review.
- This document does not authorize unscoped context reads.
- This document does not replace product scope in `Spec/`.
