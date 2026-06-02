# Context Layer Refactor Methodology

작성일: 2026-06-01

## Decision

WP-05 through WP-12 should continue only after the context layer is refactored around generated aggregates and route-budget gates.

The selected method is:

1. Keep runtime aggregate JSON files for compatibility and speed.
2. Move human edits into category source files.
3. Generate aggregate JSON from those source files.
4. Keep v2 bundles as compact LLM prompt contracts.
5. Load heavy coordinates, pins, current paths, topology details, and source evidence through deterministic tools.
6. Enforce prompt budgets in tests.
7. Treat route overmatching as a blocker, not a harmless retrieval detail.

## Why This Method

The current context layer can run, but the maintenance shape is risky:

- `registry/part-capabilities.json` is over 5,000 lines.
- `data/render-footprints.json`, `electrical/topology-templates.json`, `data/capability-graph.json`, and source bundle catalogs are also large.
- The runtime mostly avoids injecting entire catalogs into the LLM, but policy-only v2 routes could still fall back to verbose prompt rendering.
- Route ambiguity can inflate prompt size and can choose the wrong support bundle before synthesis.

The best split is therefore not "make the LLM traverse a hierarchy." The best split is "make humans edit a hierarchy, while runtime keeps bounded aggregate lookups."

## Alternatives Considered

### Keep One Big File

Rejected.

It preserves runtime simplicity but makes WP-05 through WP-12 increasingly expensive to review. A single registry file also makes ownership unclear: display, sensor, power, controller, and interface changes all collide in the same file.

### Load Hierarchical Files Directly at Runtime

Rejected for now.

This adds runtime path complexity and raises regression risk without reducing prompt size by itself. The existing loader, audits, validator, render compiler, and tests already expect aggregate IDs such as `part-capabilities`, `render-footprints`, and `topology-templates`.

### Retrieve Everything Once Because Large Context Windows Exist

Rejected.

It may work within a large model context window, but it raises cost, latency, and routing instability. It also makes the model arbitrate between too many plausible facts instead of using deterministic route and validator gates.

### Generated Aggregate From Category Sources

Selected.

This keeps runtime compatibility while making maintenance sane. It also lets tests enforce drift between source files and generated aggregates.

## Source Ownership

Generated-source files currently live under:

- `agent-context/registry/part-capabilities.sources/`
- `agent-context/data/render-footprints.sources/`
- `agent-context/electrical/topology-templates.sources/`
- `agent-context/data/capability-graph.sources/`

Part capability categories:

- `controller`
- `prototyping`
- `passive`
- `input`
- `sensor`
- `display`
- `actuator`
- `power`
- `communication`
- `interface`

The generated runtime files remain:

- `agent-context/registry/part-capabilities.json`
- `agent-context/data/render-footprints.json`
- `agent-context/electrical/topology-templates.json`
- `agent-context/data/capability-graph.json`

Commands:

```bash
npm run context:check
```

## LLM Prompt Contract

v2 bundles remain the prompt-facing layer. A bundle should include:

- capability id
- support level
- allowed and required part ids
- required topology ids
- validation rule ids
- simulation primitive ids
- render footprint ids
- short summary

A bundle should not include:

- full pin coordinate maps
- full render anchors
- raw source quotes
- long current path recipes
- broad part catalogs

Those details stay in aggregate JSON and are loaded by deterministic tools after route selection.

## Budget Gate

Every context packet used by eval fixtures must satisfy:

`promptBlock.length <= retrievalPlan.maxPromptChars`

Policy-only v2 routes must also use compact prompt rendering. Ambiguous requests are not allowed to become larger than supported synthesis routes.

## Routing Gate

Route overmatching is a quality failure.

Examples that must remain protected:

- `1자리 7세그먼트` routes to `bare-seven-segment-display-output`, not TM1637/MAX7219 LED-array output.
- Generic `온도랑 습도 값을 OLED에 표시` stays clarification/minimal unless the student names a supported sensor such as DHT11 or DHT22.
- Explicit DHT11 and DHT22 requests route to their own support bundles and do not share bundle evidence.
- Screen/app visualization wording does not fetch hardware display bundles.

## WP-05 Through WP-12 Rule

Before adding a new part family:

1. Add or update category source files.
2. Regenerate aggregate files.
3. Add source claims and hardware support bundle entries.
4. Add or extend v2 bundle and route.
5. Add topology, render footprint, simulation primitive, and validator contracts.
6. Add supported eval and unsupported counterexample eval.
7. Add prompt budget and route pruning coverage.
8. Run the audit/test/build gate.

Do not promote a part to simulation-ready only by adding it to the registry.

## Current Implementation Status

Implemented in this refactor slice:

- `part-capabilities` category source directory.
- `render-footprints`, `topology-templates`, and `capability-graph` WP-01 through WP-04 source directories.
- Generated aggregate build/check scripts for parts, footprints, topologies, and capabilities.
- Unit test that proves each aggregate equals its category sources.
- Prompt budget assertion for context sufficiency evals.
- Compact v2 policy-only prompt rendering.
- Korean bare 7-segment route protection for `1자리 7세그먼트` and `한 자리 7세그먼트`.

Verified gates:

- `npm run context:check`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run audit:sources`
- `npm run audit:capabilities`
- `npm run audit:context:v2`
- `npm run audit:visual-coverage -- --write`

Remaining refactor candidates before or during WP-05:

- Apply the same generated-source pattern to `simulation/primitives.json` if primitive editing starts to dominate WP-05 through WP-12 changes.
- Consider the same pattern for `sources/source-claims.json` and `sources/hardware-support-bundles.json` after WP-05 proves the source bundle shape.
- Add route-level budget regression samples outside the eval corpus for common Korean ambiguous prompts.
