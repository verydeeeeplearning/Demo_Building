# Retrieval Budget

The context layer is hierarchical. Agents first load compact memory and routing metadata, then fetch only the sources named by the selected route.

## Budgets

- `minimal`: safety, clarification, and unsupported handling. Do not load render or simulation catalogs.
- `summary`: capability gap analysis and safe alternatives. Load capability data and concise registry facts only.
- `data-only`: deterministic tool payloads that should not include long prose references.
- `full`: supported circuit synthesis with validation, rendering, and simulation source IDs.

## Rules

- Route selection must happen before prompt assembly.
- Source IDs in routes must resolve through `agent-context/index.json` aliases or canonical IDs.
- Markdown files may explain behavior, but Zod-validated JSON and deterministic tools remain the source of truth.
- Prompt blocks must stay under the selected route's `maxPromptChars` value from `context-routing-map.json`.
