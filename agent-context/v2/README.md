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

## Compatibility

v2 may reference v1 canonical JSON while migration is in progress. Deleting v1 files is not part of the initial v2 rollout.
