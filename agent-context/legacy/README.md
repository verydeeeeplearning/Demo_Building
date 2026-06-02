# Legacy Context Snapshots

This directory stores non-runtime snapshots of older context-layer shapes.

Runtime code should continue to read from `agent-context/`, `agent-context/v2/`, and `agent-context/sources/` unless a migration explicitly changes those paths.

## Snapshots

- `v1/`: root context-layer snapshot preserved on 2026-06-01 before Deepagents workflow optimization work. It excludes the new `v2/` bundle directory, but keeps the v1 canonical data, routing, policies, schemas, evals, and source provenance files that existed at the time of archival.
