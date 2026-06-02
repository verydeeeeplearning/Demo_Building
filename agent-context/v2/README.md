# H-eduware Agent Context v2

Context v2 is the bundle-first source-of-truth layer for Deepagents.

## Retrieval Levels

- L0: always-loaded operating rules.
- L1: safety, clarification, unsupported, and truthfulness policy.
- L2: selected capability bundle summaries.
- L3: selected bundle manifests and canonical reference IDs.
- L4: heavy canonical data loaded only by deterministic tools.

## Bundle Rule

Deepagents should reason from selected bundles, not from the entire context tree. A bundle contains a short `BUNDLE.md` for prompt use and a strict `manifest.json` for tool and validator gating.

## Prompt Rule

Prompt payload should include bundle summaries and compact IDs. It should not include full render anchors, full current path recipes, raw source quotes, or broad catalogs unless a bounded tool call explicitly returns them.

## Canonical data (L0)

v2 is the single routing and bundle source. The `shared` paths point at the
canonical registry/data/electrical/simulation/ontology/rendering files — these
are the L0 foundation (part bundles, footprints, primitives, topologies), not a
separate "v1". The old `agent-context/legacy/v1` snapshot and the v1
`routing/context-routing-map.json` have been removed; there is no dual routing.
