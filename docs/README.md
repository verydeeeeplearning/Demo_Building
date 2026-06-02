# H-eduware Documentation

This folder holds living reference documents and the active architecture plan.
Dated point-in-time analyses, audits, and completed implementation plans have been
removed to keep the docs surface current; the work they described lives in the code,
the test suite, and git history.

## Reference (living)

These describe how the current system works and should be updated in place.

- [`agent-observability-logging.md`](agent-observability-logging.md) — tracing agent
  requests via local structured logs and optional LangSmith.
- [`deepagents-official-architecture-anchor.md`](deepagents-official-architecture-anchor.md) —
  anchors the Deepagents implementation to the official LangChain Deep Agents model.
- [`korean_ux_copy_style_guide.md`](korean_ux_copy_style_guide.md) — Korean UI copy
  style guide (student-first, not translated-from-English).
- [`solver_gate_design.md`](solver_gate_design.md) — the solver-gate product rule for
  deciding visible-but-safe simulation, control policy, and claim scope.

## Plans (active)

- [`plans/PLAN_layered_context_architecture.md`](plans/PLAN_layered_context_architecture.md) —
  the current Context Layer architecture: single v2 router, L0 part bundles → L2 topology
  composition → L3 capability bundles, v1 removed.
- [`plans/REVIEW_layered_context_architecture_2026-06-02.md`](plans/REVIEW_layered_context_architecture_2026-06-02.md) —
  adversarial review synthesis for the plan above.

## Generated

- [`visual_part_simulation_coverage_report.md`](visual_part_simulation_coverage_report.md) —
  produced by `npm run audit:visual-coverage`. Do not edit by hand.

## Binding product spec

Product scope, the design system, and the layout reference live under
[`../Spec/`](../Spec/) and are treated as binding (see `AGENTS.md`).
