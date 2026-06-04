# H-eduware Documentation

This folder holds living reference documents and the active architecture plan.
Dated point-in-time analyses, audits, and completed implementation plans have
been removed to keep the docs surface current; the work they described lives in
the code, the test suite, and git history.

## Reference (living)

These describe how the current system works and should be updated in place.

- [`agent-observability-logging.md`](agent-observability-logging.md) - tracing
  agent requests via local structured logs and optional LangSmith.
- [`agent-request-to-simulation-workflow.md`](agent-request-to-simulation-workflow.md) -
  ordered request-to-simulation workflow, context layer boundaries, Deep
  Agents/LangGraph handoffs, and opt-in live category evaluation.
- [`agent-tutor-serving-workflow.md`](agent-tutor-serving-workflow.md) -
  right-side tutor chat serving contract, fallback policy, and observability.
- [`context-layer-architecture.md`](context-layer-architecture.md) -
  Context Layer structure, packet data example, roles, and gate model.
- [`deepagents-official-architecture-anchor.md`](deepagents-official-architecture-anchor.md) -
  anchors the Deepagents implementation to the official LangChain Deep Agents
  model.
- [`korean_ux_copy_style_guide.md`](korean_ux_copy_style_guide.md) - Korean UI
  copy style guide (student-first, not translated-from-English).
- [`solver_gate_design.md`](solver_gate_design.md) - the solver-gate product
  rule for deciding visible-but-safe simulation, control policy, and claim
  scope.

## Plans (active)

- [`plans/PLAN_layered_context_architecture.md`](plans/PLAN_layered_context_architecture.md) -
  the current Context Layer architecture: single v2 router, L0 part bundles to
  L2 topology composition to L3 capability bundles, v1 removed.
- [`plans/PLAN_chat_ui_context_layer_refactor.md`](plans/PLAN_chat_ui_context_layer_refactor.md) -
  chat UI serving, context eligibility, tutor fallback, and logging refactor
  plan.
- [`plans/PLAN_agent_trajectory_robustness.md`](plans/PLAN_agent_trajectory_robustness.md) -
  main chat and tutor chat trajectory robustness plan: task/thread identity,
  artifact preservation, stale response guards, clarification identity, and
  tutor freshness.
- [`plans/PLAN_tutor_always_live_serving.md`](plans/PLAN_tutor_always_live_serving.md) -
  approved Ralph/Ralplan follow-up for making the right-side tutor live-first
  when the server is configured, with explicit local fallback.
- [`plans/REVIEW_layered_context_architecture_2026-06-02.md`](plans/REVIEW_layered_context_architecture_2026-06-02.md) -
  adversarial review synthesis for the layered context architecture plan.

## Generated

- [`visual_part_simulation_coverage_report.md`](visual_part_simulation_coverage_report.md) -
  produced by `npm run audit:visual-coverage`. Do not edit by hand.

## Binding Product Spec

Product scope, the design system, and the layout reference live under
[`../Spec/`](../Spec/) and are treated as binding (see `AGENTS.md`).
