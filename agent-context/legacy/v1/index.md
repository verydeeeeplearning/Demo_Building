# H-eduware Context Index

This index tells agents and tools where to retrieve context and which source wins when files disagree.

## Authority

1. Safety policies.
2. Deterministic validation output.
3. Schemas.
4. Source claims and support bundles for hardware promotion.
5. Registry and electrical model data.
6. Product requirements.
7. Pedagogy guidance.
8. Agent suggestions.

## Retrieval Recipes

- Intent work: read ontology intent and behavior primitives, then produce `IntentSpec`.
- Safety work: read safety and unsupported policies, then call validators.
- Circuit synthesis: query registry capabilities instead of reading every registry file.
- Topology synthesis: choose a role-based topology template before validating concrete wires.
- Current simulation: build netlist, estimate current, detect faults, then explain only returned paths.
- Rendering: compile a render plan from a valid circuit spec and the rendering contracts.

Markdown explains judgment. Schemas, registries, and deterministic tools decide validity.

## Hierarchical Routing

`routing/context-routing-map.json` is the first on-demand map after always-loaded memory. It selects a bounded context route from intent signals, safety signals, capability IDs, and support level.

Retrieval levels:

- `L0`: always-loaded constitutional memory and route index metadata.
- `L1`: safety, unsupported, clarification, and truthfulness policies.
- `L2`: skill and reference summaries needed to reason about a route.
- `L3`: canonical registries, source claims, support bundles, capability graph entries, topology templates, and pin aliases.
- `L4`: render footprints, simulation primitives, eval fixtures, and other heavier route-specific data.

Agents should not scan all Markdown and JSON files for each student prompt. A request must first produce `ContextRoute` and `RetrievalPlan`; only source IDs in that plan should be summarized into the prompt. Ambiguous or unsupported routes must stay policy-first and avoid render or simulation catalogs.

## v2 Bundle-First Context

`v2/` is the preferred retrieval shape for Deepagents. It groups agent-readable summaries and machine-readable manifests by capability so each request can load one or a few bounded bundles instead of broad artifact catalogs.

The existing v1 registry/data/reference files remain canonical shared data during migration. v2 bundles reference those canonical IDs and reduce prompt bloat.

## Data-First Expansion Rule

No hardware family can move from `planned` to `supported` unless the same change includes:

- capability graph entry
- canonical part registry entries
- pin aliases
- deterministic electrical validation rules
- simulation primitive contracts
- render footprints and pin anchors
- at least one supported eval prompt
- at least one unsupported or negative counterexample
- browser-visible verification evidence

In short: no hardware family can move from `planned` to `supported` unless the same change includes capability graph entry, canonical part registry, pin aliases, electrical validation rule, simulation primitive, render footprint, supported eval prompt, unsupported counterexample, and browser-visible verification.

Every supported hardware family must include source-claim coverage. A source claim proves where each critical canonical fact came from; runtime agents consume the canonical data, while audits consume the source claims.

Regression tests may use concrete hardware cases, but the roadmap must not be expressed as a fixed hardware order. A hardware case is a probe of pipeline capability, not a product objective.

## Topology Templates

`electrical/topology-templates.json` defines reusable circuit structures by role. Agents should use these templates as the circuit grammar between capability matching and validation. Templates must stay role-based and must not encode concrete part ids such as `oled-i2c-096`, `led-5mm`, or `micro-servo`.
