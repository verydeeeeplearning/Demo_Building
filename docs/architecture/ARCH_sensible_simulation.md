# System Architecture: Reliable "At-Least-Sensible" Circuit Simulation

**Status**: Draft for review
**Date**: 2026-06-03
**Basis**: 4 parallel investigations (context-layer map, topology-generation trace, real breadboard simulators, LangChain Deep Agents patterns) + user's "universal hardware principles as default" insight.
**Foundation**: built ON the existing layered context (`agent-context/`, `server/context/`) and the existing Deep Agents runtime (`server/agent/deepAgentRuntime.ts`). NOT a rewrite — an extension.

---

## 0. The invariant we are buying

> For **any** of the 132 parts in **any** combination, and for **any** student phrasing, the user-facing result is **at least physically and electrically sensible** — or the agent answers conversationally / asks to clarify. It is never a structurally-valid-but-nonsensical circuit, and never a raw payload dump.

Two failure classes this must kill (both observed live):
- **Class A — leak**: the LLM's structured draft is shown as raw JSON in chat.
- **Class B — nonsense**: a circuit that bypasses the breadboard (point-to-point MCU wiring), or parts off-board / overlapping labels, passes as `runnable: true`.

---

## 1. Two design laws (everything below follows from these)

**Law 1 — Determinism boundary (from Deep Agents official guidance).**
The **LLM owns**: intent parsing, route (chat/clarify/build), component *selection*, topology *choices*, and the human explanation.
**Deterministic code owns**: breadboard electrical model, placement geometry, jumper/route generation, validation (DRC), and simulation. Anything that must *always* be correct is code, not prose.

**Law 2 — Single source of truth for hardware principles.**
The universal hardware-design principles are authored **once** and consumed in **two** places:
- (a) injected into the LLM prompt as an always-on **default** (guides authoring, generalizes to template-less combinations),
- (b) compiled into the deterministic **DRC** (guarantees, with structured violation feedback).
Prose-in-prompt is necessary but not sufficient (CircuitLM: models know rules yet violate them); the DRC is the guarantee.

---

## 2. The universal principle set (the new default layer)

A new always-on context layer, route-independent, small (fits prompt budget). ~10 principles that hold for every part combination:

| # | Principle | DRC-checkable? | Today |
|---|-----------|----------------|-------|
| 1 | Closed current loop for every active part | Yes (graph reachability) | partial in `validation.ts` |
| 2 | Common ground | Yes | partial |
| 3 | Power/ground distributed via +/− rails; parts tap rails | Yes (needs node model) | **missing** |
| 4 | Breadboard-mounted parts connect THROUGH rows/rails, not point-to-point to MCU | Yes (needs node model) | **missing** ← core bug |
| 5 | Current limiting (series R) for current-sensitive loads (LED…) | Yes | present (LED only) |
| 6 | No shorts: never power↔ground direct; a part's two legs in different nodes | Yes | present (direct short) |
| 7 | Digital inputs referenced (pull-up/down), not floating | Yes | partial (GND-only) |
| 8 | High-current loads via driver (transistor + flyback), not GPIO | Yes | present (motor) |
| 9 | ICs/buttons straddle the center gap | Render-DRC (geometry) | partial |
| 10 | Respect electrical limits (GPIO ≤20mA, V within ratings) | Yes (`board-electrical-limits.json`) | present |

Authored in `agent-context/principles/hardware-design-principles.md` (prose, for the prompt) + `agent-context/principles/principle-drc-map.json` (machine map: principle → validator id → blocking?).

---

## 3. The structural backbone: a node-named breadboard model

Adopt the **node-collapse model** every real simulator (Wokwi/Tinkercad/Fritzing) uses: breadboard rows and rails ARE electrical nodes; a pin placed in a hole joins that node; connectivity is *by construction*, not by routing-then-checking.

- Promote `agent-context/rendering/breadboard-grid.json` `continuityGroup`/rail data into first-class **electrical nodes** available to the netlist (today it is renderer-only).
- A `CircuitSpec` connection that lands two pins in the same row/rail = same node. Principle #4 becomes *expressible and enforceable*: a part whose pins never share a breadboard node with the rest of the circuit is "decoration" → DRC blocks.
- Keep the abstract `connections` for electrical intent, but compile them to physical nodes for the sensibleness gate.

---

## 4. End-to-end pipeline (mapped to existing files)

```
student message
  │
  ▼  [LLM, ReAct — NO rule gate]  deepAgentRuntime.runLiveAgent
  ├── route: chat / clarify / build         ← agent decides; assess_request_scope tool is ADVISORY
  │      └── chat/clarify → conversational reply (LLM prose; circuit detail N/A)
  ▼  build path
  [Context Packet]  buildContextPacket  (+ NEW principles default layer, always injected)
  │      candidateParts gate · contextCoverage gate · principles default
  ▼  [LLM synthesis]  responseFormat = CircuitSpec (ProviderStrategy native; ToolStrategy fallback)
  │      Zod SEMANTIC validators (pins exist, no short, breadboard-routed, series-R) → auto re-ask on fail
  ▼  [DETERMINISTIC]  circuitTools / circuit/*
  ├── buildNetlist + breadboard node model (§3)
  ├── placement (greedy row-slot; already in renderPlan.ts, keep in-bounds) + jumper generation
  ├── design_rule_check TOOL  ← compiles the 10 principles (§2), HARD gate, structured violations
  │       includes: breadboard-routed(#4), buzzer grid-snap, label-overlap repair
  ▼  repair loop (bounded N, idiomatic Deep Agents)
  │      DRC fail → violations fed back as ToolMessage → LLM self-repairs spec → re-run DRC
  ▼  [optional] critic SUBAGENT — soft "is this sensible for the student's intent?" (own context)
  ▼  finalize  finalizeAgentResult
         LLM prose LEADS (fix Class A leak); validated CircuitSpec → 3D scene + 문서 tab
         buildRunnableReport requires DRC-pass (not just electrical-valid)
```

---

## 5. Determinism split (what is LLM vs code)

| Concern | Owner | Mechanism / file |
|---|---|---|
| chat vs build routing | LLM (ReAct) | system prompt; tools optional (no forced tool_choice) |
| component selection | LLM, gated | `candidateParts` (`deepAgentTools.search_part_capabilities`) |
| topology choice | LLM, principle-guided | principles default + `topology-templates.json` as exemplars |
| structured emission | framework | ProviderStrategy native + Zod semantic validators (auto re-ask) |
| breadboard electrical model | code | node model from `breadboard-grid.json` (§3) |
| placement geometry | code | `renderPlan.planDefaultRenderPositions` (greedy row-slot, already in-bounds) |
| jumper/route generation | code | rule-based: power→+rail, gnd→−rail, signal→single jumper |
| sensibleness validation | code | `design_rule_check` tool = compiled principles (§2) |
| repair | LLM in loop | DRC violations → ToolMessage → self-repair (bounded) |
| pedagogical judgment | critic subagent | own prompt/context (official deepagents critique pattern) |
| explanation prose | LLM | leads the final message |

---

## 6. What changes in the existing system

**Add**
- `agent-context/principles/` (prose + DRC map) → new always-on layer in `buildContextPacket` (small budget).
- breadboard node model (extend `circuit/breadboardAudit.ts` + netlist).
- `design_rule_check` as a first-class agent tool + hard gate in `buildRunnableReport`.
- bounded DRC repair loop in `deepAgentRuntime`.
- (optional) circuit critic subagent.

**Promote / fix**
- `topology-templates.json`: from post-hoc reporting → injected exemplars + (optional) match gate.
- buzzer into `requiresStrictBreadboardGridAudit`; label-overlap warning → repair.
- Class A: LLM prose leads in `finalAssistantMessage`/`toConciseStudentMessage`; native structured output to stop JSON-as-text.

**Unchanged**
- The 5-layer context architecture, candidateParts/contextCoverage gates, the render placement solver's in-bounds guarantee, the ReAct no-rule-gate routing.

---

## 7. Phasing (each independently shippable, TDD)

- **P1 — Class A + structured output**: native ProviderStrategy, prose-leads finalize. (smallest, immediate)
- **P2 — Principles default layer**: author principles, inject as always-on context. (LLM authoring improves)
- **P3 — DRC tool + breadboard-routed gate (#3,#4)**: node model + `design_rule_check` hard gate. (kills Class B)
- **P4 — Repair loop**: bounded self-repair on DRC fail.
- **P5 — polish**: buzzer snap, label repair, critic subagent, template exemplars.

---

## 8. Open questions / risks (for reviewers)

1. **Prompt budget**: principles default + exemplars add chars to every build prompt; current routes cap at 9k–11k `maxPromptChars`. Does the principles layer fit, or must it be compacted/summarized?
2. **Node model depth**: how faithfully must we model row/rail continuity to gate #4 without false positives on legitimate point-to-point-via-jumper (a real jumper IS point-to-point but sensible)? Where is the line between "decoration" and "valid jumper"?
3. **Repair loop cost/latency**: bounded N re-asks on a slow model — acceptable UX? Cap N at 2?
4. **Determinism vs LLM topology**: if DRC is strict, does it over-reject creative-but-valid student circuits? Need an "advisory vs blocking" tier per principle.
5. **Templates' role**: exemplars-only, or a soft "snap if close" gate? Risk of over-constraining template-less combinations (the very thing principles were meant to cover).
6. **Migration**: does promoting `breadboard-grid.json` to electrical nodes break the existing renderer/placement contract?

---

# REVISION (post 4-angle subagent review) — 2026-06-03

Four adversarial reviews (Deep Agents correctness · EE domain · codebase-fit · holistic skeptic) converged. The original draft above is kept for history; **this revision supersedes §6–§8.**

## R1. Three factual corrections (the draft over-scoped by ~2×)

1. **The breadboard is NOT electrical decoration; the node-collapse model is ~70–80% already built.** `circuit/breadboardAudit.ts` already promotes `breadboard-grid.json` continuity/rail data into physical electrical nodes and blocks on `BREADBOARD_PHYSICAL_NODE_CONFLICT` / `_CONTINUITY_CONFLICT` / `_RAIL_CONFLICT` — all already in `SIMULATION_BLOCKING_RENDER_WARNING_CODES` (`circuitTools.ts:70-85`) and already gating `buildRunnableReport`. §3 is mostly redundant.
2. **The repair loop already exists.** `runAgentDraftRepairLoop` (`deepAgentRuntime.ts:1481`, N=2) already feeds quality-gate errors back into the next synthesis prompt and excludes unfixable context errors. §4 (P4) is a near-no-op (only new message strings).
3. **The Class-A JSON scrubber already exists and is leaking.** `toConciseStudentMessage` (`:1349`) already strips JSON-ish text — proving a post-hoc filter is the wrong layer. P1 must *replace* it with native structured output, not add a first defense.

## R2. The real gap is ONE predicate (the single highest-leverage change)

The existing audits check *conflict* (two pins on one node without a logical link). The actual Class-B hole is the **inverse — isolation**: a part wired point-to-point to the MCU shares **no** breadboard node with the rest, so nothing fires and it passes as runnable.

→ **Add one check:** *every active component must share ≥1 physical breadboard node with the rest of the netlist (reachability / no-dangling-node)*, built on the existing node map, registered in `SIMULATION_BLOCKING_RENDER_WARNING_CODES`, surfaced through the existing repair loop. ~30 LOC.

**Critical reframing of Principle #4:** phrase it as **reachability / isolated-node**, NEVER as "must route through a row, not point-to-point." Literal point-to-point ban FALSE-REJECTS the Arduino (not board-resident), Dupont-wired modules, and legitimate single jumpers. Requires a new per-part attribute **`isBoardResident`**, and the router + the gate must share ONE definition of "routed." Blocking only in the dangling-node form; "prefer routing through a row" is advisory.

## R3. Law 2 corrected; principles are an authoring nudge, not a dual source

"Single source of truth, two consumers" is aspirational-false: prose + `principle-drc-map.json` + 43 part-family validators (244 `PART_IDS` refs, not principle-indexed) = three artifacts that drift. **Decision:** the prose principles are an **LLM authoring nudge with no guarantee**; the guarantee is the existing/extended DRC. Drop `principle-drc-map.json` dual-authoring. Do NOT build a second DRC engine — `buildRunnableReport` is already the union gate; any `design_rule_check` is a **read-only surfacing** of it to the LLM.

## R4. Prompt budget makes "always-on prose principles" non-viable as drafted

Routes: median 14k `maxPromptChars`, but **≥10 of 43 routes ≤ 11k**, tightest `v2-display-text-output` = 9000 — which **already failed live at 9029/9000** (`deepAgentRuntime.ts:946`). Always-on prose (~1.5–3k chars) triggers compaction that **evicts the pins/parts/footprints grounding** (`contextCompaction.ts:108-114`) — self-defeating. → principles ride as a **compact principle-id list**, or inject prose only on `maxPromptChars ≥ 14000` routes, with a **43-route budget regression test**.

## R5. Principle set: ~10 → ~16, with scoping + blocking/advisory tier

Add: I2C/SPI/UART bus integrity, voltage-domain/level-shift (3.3V↔5V), aggregate current budget, flyback (split from #8), transistor base resistor, decoupling (advisory), analog reference. Scope the over-absolute ones: #5 raw-LED-only (not modules/buzzers), #6 whitelist caps/bleeders that legitimately bridge V↔GND, #7 mechanical-switch inputs only (not driven I2C/SPI/UART), #8 carve out integrated-driver modules. **Rule: BLOCK only on damage/dead-circuit AND only when exceptions are detectable; everything else advisory.** Several checks need new per-part data (`vddMax/vihMax`, `hasIntegratedSeriesResistor`, `hasBuiltInPullups`, `isBoardResident`, `buzzerType:active|passive`) — a latent gap.

## R6. Deep Agents plumbing fixes (move into the plan, de-risk in P1)

- `tools` + `response_format` → AutoStrategy silently demotes to ToolStrategy (#34463) → pass **`ProviderStrategy(CircuitSpec)` explicitly**.
- ToolStrategy fails **silently** when the model talks instead of emitting the tool call (#36349, no `structuredResponse`, no retry) → add an explicit **"no structured response" guard** + re-ask, then conversational fallback.
- `response_format` **suppresses natural prose** → conflicts with "prose leads." **Separate** prose generation from structured emission (or derive student prose from a field inside `CircuitSpec`).
- **Verify gpt-5.4-mini native structured-output support empirically before P1** (unconfirmed; if unreliable, P1's premise collapses).
- Consider **`RubricMiddleware`** (off-the-shelf bounded fix→re-grade with a cheaper grader model + tool access) instead of a hand-rolled loop/critic.
- Per-turn `response_format` narrowing via middleware is not enforced (#36568) → use a **two-agent / sub-call split** for build-vs-chat, or keep `CircuitSpec` as a tool.

## R6.5 EMPIRICAL VERDICT (live gpt-5.4-mini probe, 2026-06-03)

Ran 12 live calls (Responses API, reasoning low), `toolStrategy` vs `providerStrategy`, greeting + build, ×3 each, with a tool present + deepagents middleware:

| strategy / prompt | structuredResponse | JSON-leak in text channel |
|---|---|---|
| **tool**/greeting | **0/3** | 0/3 |
| **tool**/build | **0/3** | 0/3 |
| **provider**/greeting | **3/3** | **3/3** |
| **provider**/build | **3/3** (kind=circuit) | **3/3** |

Conclusions (these reshape P1):
1. **`toolStrategy` (current, line 483) almost never emits structured output** — the model just talks; `structuredResponse` is unpopulated 0/6. Production only works because `recoverDraftFromAgentMessages` salvages the plain text. That recovery is load-bearing and fragile (this is the root of the non-determinism).
2. **`providerStrategy` (native json_schema) is 100% reliable** for structured output (6/6, correct `responseKind`) AND **composes with tools** — the #34463 demotion does not bite when ProviderStrategy is passed explicitly.
3. **BUT native output ALSO echoes the full JSON into the message text channel (6/6).** So "switch to providerStrategy" does NOT by itself fix Class A — it would make the leak *more consistent* if any code surfaces the message text.

→ **The real P1 fix is two-part and now precisely defined:**
- (a) `responseFormat: providerStrategy(LiveAgentDraftSchema)` (synthesis + requirement-analysis), for reliable structured output;
- (b) **always derive the student message from `structuredResponse.assistantMessage`; NEVER from the raw message-text channel** when structured is present (`parseLiveAgentDraft` already prefers `structuredResponse` — so the leak is closed as long as no path reads the text channel). Keep `recoverDraftFromAgentMessages` only as the no-structured fallback + add a "no structured response" guard.
- Open follow-up: confirm providerStrategy still emits structured *after* multi-step real tool calls on the build path (probe used a no-op tool; structured is the loop-exit, expected to hold).

## R7. Revised phasing (measurement-first; ship the 80/20, defer the rest)

- **P0 — Measurement harness** on the existing evals (`agent-context/evals/diverse-prompts.jsonl`). North-star = first-pass-runnable rate + false-reject rate. Cheapest item; the only thing that says when to stop. **No phase ships without a before/after run.**
- **P1 — Class A: native structured output** (replace the leaking scrubber). Verify gpt-5.4-mini first. **Kill criterion:** if native unreliable on a 50-prompt eval, harden the scrubber and stop building on that premise.
- **P2 — The #4 isolation predicate** on the existing node map + `isBoardResident` carve-outs, shipped **advisory→blocking behind a flag**. Run in advisory mode over the evals first; flip to blocking only if false-reject rate < threshold. This is the real Class-B fix (~1 day).
- **Then STOP and re-measure.** If P1+P2 hit target, P3+ may be unnecessary.
- **DEFER (only if measurement shows residual need):** prose principles layer (budget-aware id-list); widening `requiresStrictBreadboardGridAudit` beyond the 5 current footprint types (each added type needs a false-positive test).
- **CUT:** critic subagent, `principle-drc-map.json`, template exemplars / "snap" gate, any second DRC engine.

## R8. Decisions (RESOLVED 2026-06-03)

1. **Blocking line — DECIDED: block only damage/dead-circuit; everything else advisory.** The DRC blocks only "physically impossible / unsafe / dead" cases; best-practice violations (series-R recommendation, decoupling, pull-style) are advisory notes. Beginner-friendly, minimizes false-rejects.
2. **`isBoardResident` per-part attribute — author in P2** (needed so the #4 gate does not false-reject the Arduino / Dupont-wired modules).
3. **Verify gpt-5.4-mini native structured output — DONE (R6.5):** providerStrategy 6/6 reliable; the fix is providerStrategy + discard the text channel.
4. **Failure UX — DECIDED: show the circuit + a flagged-problem note; disable only the simulation run.** This reuses the existing `DIAGNOSTIC_RENDER_ONLY` pattern (`renderPlan.ts:134-141` — renderable hardware shown for diagnosis when not valid). The #4 isolation gate becomes a `SIMULATION_BLOCKING_RENDER_WARNING` (3D scene still renders, run disabled, reason shown as a student note).
