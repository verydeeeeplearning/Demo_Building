# Architecture: Guided Circuit Design (slot-filling + conditional interaction)

**Status**: Design draft (for rigorous review)
**Date**: 2026-06-04
**Builds on**: `ARCH_agent_native_retrieval.md` (REVIEW VERDICT — deferred funnel-removal; do this ADDITIVELY, keep deterministic safety/validity gates).
**Origin**: iterated in design dialogue. Core idea (user): the agent decides one-shot vs interactive by whether the **design parameters (slots)** can be filled from the query; if a required slot can't be filled, it's ambiguous → ask only that slot.

---

## 0. The shape (converged)
- The agent (ReAct, no rule gate) decides per request: **one-shot build** vs **interactive guided design**. This is an extension of the existing chat/clarify/build routing.
- "Ambiguous?" is made concrete as **slot-filling**: a fixed parameter schema; a slot is *filled* (from query or a safe default) or *open* (ask). One-shot iff all required slots are filled & unambiguous; otherwise interactive, asking ONLY the open/multi-valued slots.
- **Progressive disclosure**: tiny always-on T0 (category menu + principles + safety); detail fetched stepwise. (Resolves the T0 budget blocker from the prior doc.)
- **Additive & safe**: this rides ALONGSIDE the existing deterministic gates — safety stays pre-emptive, the DRC validates output. The funnel is NOT removed here.
- Grounds in existing `IntentSpecV2` (already carries outputModalities / inputModalities / behaviors / controllerAssumptions / ambiguities) — the slot schema formalizes it; `ambiguities` = the open slots.

## 1. What the agent judges vs what stays deterministic
| Agent judges (discretion OK) | Deterministic (no discretion) |
|---|---|
| one-shot vs interactive (via slot fill) | **safety** — unsafe intent pre-empted before design |
| which open slot to ask, and how | **DRC** — validates the final spec regardless of choices |
| weak-default vs ask for a slot | **grounding** — parts/pins only from the catalog |
| user override ("just build" / "let me choose") respected above agent judgment | conditional rule enforcement (e.g. I2C pull-ups) in DRC |

---

## 2. THE SLOT SCHEMA (the ambiguity decision)

### Core intent slots
| # | Slot | Required | Fill from query | Default | Open ⇒ |
|---|------|----------|-----------------|---------|--------|
| 1 | **output** (acting device) | ✅ | output noun → catalog (LED/부저/모터/디스플레이/서보/릴레이) | — | ASK |
| 2 | **behavior** (action + timing) | ✅ | verb (깜빡/울리기/켜기/표시/회전/조절) | **weak default per output type** (LED→on/blink, buzzer→tone) | ASK only if no default |
| 3 | **trigger** (input/driver) | conditional | input noun (버튼/센서/가변저항) or explicit none | **none (time-based) IF output self-drives**; else REQUIRED | ASK if required & empty |
| 4 | **trigger_condition** (input→output logic) | ✅ if trigger present | "누르면/어두우면/가까우면/값이 ~보다" | — | ASK |

### Conditional slots (activate by output/part type)
| # | Slot | Active when | Fill | Open ⇒ |
|---|------|-------------|------|--------|
| 5 | **display_content** | output ∈ {display} | "HELLO" / "거리값" / "온도" | ASK ("무엇을 표시?") |
| 6 | **voltage_domain** | a 3.3V-only part is chosen | auto from part rating | not asked; **DRC** flags 5V↔3.3V mismatch (level-shift) |

### Defaulted slots (auto; surfaced only to change)
| # | Slot | Default | From query if |
|---|------|---------|---------------|
| 7 | **controller** | arduino-uno | board named |
| 8 | **pins** | auto-assign | pin named ("D9") |
| 9 | **quantity** | 1 | number named ("3개") |
| 10 | **power** | USB 5V | battery/supply named |

### Auto-derived (never asked)
| # | Slot | Source |
|---|------|--------|
| 11 | **passives** | principles (LED→220Ω series, etc.) |
| 12 | **topology / wiring** | derived from filled slots |

### Disambiguation rule (slot has multiple catalog candidates)
- **ASK** when the choice changes **behavior/correctness**: active vs passive buzzer (different drive: DC on/off vs `tone()`/PWM); generic "센서" → which sensor; motor type (DC/servo/stepper).
- **AUTO-default** when **cosmetic/preference**: LED color (red), resistor value (220Ω), exact pin — with a "바꿀래?" affordance.

### 2.1 Required-slots-per-output-type rule table (the correctness core)

**Cross-cutting trigger/input rule (applies to every output):**
- **input is REQUIRED** when the desired behavior is a *function of an external value/event* (reactive): `누르면` / `어두우면` / `가까우면` / `값에 따라` / "센서값/온도/거리 **표시**".
- **input is OPTIONAL → default `none` (time-based)** when the behavior is *self-contained*: `깜빡` / `켜기` / `톤 울리기` / `HELLO 표시` / `스윕`.
- The agent infers reactivity from the behavior verb/condition. Reactive intent + no named input → **ASK which input** (and disambiguate the sensor if generic). Self-contained → no input slot.

**Per output type:**

| Output type (family) | output | behavior (default) | input/trigger | special required | disambiguation ASK |
|---|---|---|---|---|---|
| **simple light** (light-output: LED, laser) | ✅ | on / blink | OPTIONAL (default none); use if given | — | RGB → color (auto = red) |
| **sound** (sound-output: piezo/active buzzer) | ✅ | beep / tone | OPTIONAL; use if given | — | **active vs passive (ASK — drive differs)** |
| **static display** (display-i2c/led-array showing fixed text/number) | ✅ | show | none | **`display_content` REQUIRED** | — |
| **value display** (display showing a measured reading) | ✅ | show | **sensor input REQUIRED** | `display_content` = which value | **which sensor (ASK if generic)** |
| **motion** (servo-output) | ✅ | sweep / move-to-angle | OPTIONAL or input-driven | angle/range (default = sweep) | — |
| **switched / rotational load** (motor-or-inductive, relay-output) | ✅ | on / off / spin | OPTIONAL or input-driven | — (driver + flyback AUTO from principles) | **motor type DC/stepper (ASK if generic)** |
| **addressable / array light** (LED matrix, NeoPixel) | ✅ | pattern | OPTIONAL | pattern/content (default = simple) | — |

**Always-auto (never asked, per principles):** `controller`=arduino-uno, `power`=USB 5V, `pins`=auto, `quantity`=1, `passives` (LED→220Ω; motor→driver+flyback; button→pull), `topology`.

**Worked through the table:**
- `OLED에 HELLO 표시` → static display, `content="HELLO"` filled, no input → **one-shot**.
- `OLED에 온도 표시` → **value display** → `content=온도` + **sensor REQUIRED** but unnamed → ASK "어떤 온도 센서? (DHT11/DHT22)" → one question.
- `초음파로 거리 표시` → value display, sensor=ultrasonic named, content=거리 → **one-shot**.
- `모터 돌리기` → switched load, **motor type generic** → ASK "DC 모터 / 스테퍼?" → one question.
- `버튼 누르면 부저` → sound + reactive(누르면)+input(버튼) given, but **buzzer active/passive** → ASK that one → one question.

**Edge:** no output named (`회로 추천`, `버튼 만들기`) → `output` open → recommend / ask "무엇을 동작시킬까?" first (output is the root slot).

---

## 3. Fill / interaction algorithm
```
slots = extract_intent_slots(query)              // LLM fills what the query supports
required = required_slots_for(slots.output)      // output type decides which slots are required
open = []
for s in required:
    if s.empty:        s = safe_default(s, context)        // may remain empty
    if s.empty:        open.push(s)                         // truly unfillable → ask
    elif s.candidates > 1 and choice_affects_behavior(s):  open.push(s)   // disambiguate
mode = open.isEmpty ? ONE_SHOT : INTERACTIVE(ask = open)
// user override wins: "그냥 만들어" → ONE_SHOT (fill opens with best default);
//                     "내가 고를래" → INTERACTIVE
```
- **Safety runs BEFORE this** (pre-emptive). **DRC runs AFTER** the spec is assembled, regardless of mode.
- Interactive mode asks ONLY the `open` slots — minimal friction. Each answer fills a slot; re-evaluate; build when none open.

---

## 4. Worked examples
| Query | Slot fill | Mode |
|---|---|---|
| `D9로 LED 깜빡` | output=LED, behavior=blink, trigger=none(self-drive), pins=D9 | **one-shot** |
| `버튼 누르면 부저 울리기` | output=부저 **[active\|passive → ASK]**, behavior=tone, trigger=button, cond=on-press | **interactive (1 question)** |
| `OLED에 글자 표시` | output=display, behavior=show, **display_content empty → ASK** | interactive (1) |
| `온도 표시` | output=display, **trigger required (temp sensor) → ASK which (DHT11/22)**, content=온도 | interactive (1) |
| `회로 추천해줘` | output empty → fully open | interactive / recommend menu |
| `조도센서로 LED 켜기` | output=LED, behavior=on, trigger=light-sensor, cond=when-dark(default) | one-shot (after KO data fix matches 조도센서) |

---

## 5. Interaction mechanism (Deep Agents)
- Use LangGraph **human-in-the-loop (interrupt)**: the agent pauses at an open slot, asks, resumes with the answer. Fits the framework natively.
- The "ask" surfaces as a structured choice (like AskUserQuestion) when candidates are enumerable (active/passive buzzer), or a free-form prompt when open (display content).
- Terminal action = **`submit_circuit(spec)` tool** (not `responseFormat`) → runs DRC → repair loop. (Avoids the providerStrategy-400 / toolStrategy-0/6 issue.)
- Detail (part specs, wiring) fetched stepwise to the virtual filesystem; only summaries in the conversation.

## 6. Why this clears the prior blockers
| Prior blocker (ARCH_agent_native_retrieval verdict) | Here |
|---|---|
| T0 menu budget (18.7KB) | small category menu + stepwise fetch |
| non-determinism (teaching regression) | **user choices determine the circuit** → reproducible, pedagogical |
| mis-selection among similar parts | **user disambiguates** (active/passive buzzer) |
| safety moved to output (unsafe) | **safety stays pre-emptive** (additive; gates kept) |
| DRC parity required | **not required** — funnel/validity gates kept |
| Korean matching | handled by the separate per-capability DATA fix |

---

## 7. Open trade-offs / risks (for review)
1. **Friction vs control**: too many questions annoys a "just build it" user. Mitigate with weak defaults + "그냥 만들어" override + ask-only-open-slots. Tune the ask-rate by measurement.
2. **Agent mis-judges fillability**: the agent might think a slot is filled when it isn't (or vice-versa). The slot extraction must be testable; the DRC + a "confirm before build" step backstop wrong fills.
3. **Required-slot rules per output type**: the "which slots are required" table (e.g. display needs content; threshold output needs a sensor) must be authored correctly — a small rule set, but it's the heart of correctness.
4. **Under-ask on safety-adjacent slots**: voltage domain, current budget — keep these as DETERMINISTIC DRC checks, never as agent-discretion asks.
5. **Product shape**: this is "mode/conditional" (agent decides), not always-interactive — confirmed. The agent's mode judgment is steerable by the user.

## 8. Data changes needed (measured against `agent-context/registry/part-capabilities.json`, 130 parts)

**Already sufficient (strong foundation):** `pins` (roles+aliases), `electrical` (voltageRange/maxCurrentMa/requiresCurrentLimiting), `capabilities`, `compatibleTopologies`/`forbiddenTopologies`, `compatibleSimulationPrimitives`, `requiredPassives` (6/130 = LED-class only, correct), `commonMistakes` (130/130), `safeSubstitutes` (107/130), `kind` (7 values), `family` (30 values). The heavy slot-fill / wiring / validation data already exists.

| Priority | Change | New? | Size | Note |
|---|---|---|---|---|
| **MUST** | **Korean aliases — consistent backfill (spaced + unspaced)** | augment | **large (core)** | Inconsistent today: `active-buzzer` has "능동 부저/액티브 부저" but **`piezo-buzzer` has ZERO Korean**; only ~28 unspaced KO tokens across 130. Same work as the Korean matching data-fix. |
| **MUST** | **Required-slots-per-output-type rule table** | new | small (critical) | e.g. `LED→trigger optional (self-drives)`, `display→content required`, `threshold-output→sensor required`. The correctness core. |
| **MUST** | **Behavior-default-per-output-type map** | new | small | `LED→on/blink`, `buzzer→tone`, `motor→rotate`. For the weak-default rule. |
| derive | `category` (8-value menu), `requiresInput` (self-drive), disambiguation groups (active/passive buzzer) | derive | ~0 | Derivable from existing `kind`+`family`+`capabilities`; no new fields strictly needed. |
| later | `logicVoltage`/`vddMax` (3.3V vs 5V domain) | new | deferred | `electrical.voltageRange` exists; add a clean logic-level field ONLY when the level-shift DRC is built. |
| optional | one-line `summary` per part | new | optional | menu readability; not required. |

→ **No new catalog needed.** The two small rule tables + consistent KO aliases are the real work; the rest derives from existing fields.

## 9. Deep Agents workflow (the operating mechanism)

Grounded in the verified mechanics (`deepagents@1.10`, `langchain@1.4`, OpenAI Responses API). Corrections from the prior Deep-Agents review are baked in: terminal `submit_circuit` tool (not `responseFormat`), detail to the virtual filesystem, `write_todos` planning, deterministic DRC enforcement, bounded repair, build as a `task` subagent.

### Agent topology
- **Main agent** — system prompt = **T0** (category menu + universal principles + safety policy + operating rules). Tools: `search_parts`, `get_category`, `get_part_detail`. Decides chat / recommend / clarify / build (ReAct, no rule gate). On a build intent → delegates to the build subagent via the `task` tool.
- **Build subagent** (`task`, isolated context, small tool surface) — runs the slot-filling + interactive design + wiring + submit. Keeps the noisy multi-step retrieval/repair history out of the main thread and gives structured output a small, reliable tool surface.

### Build workflow (step by step)
```
[0] PRE-EMPTIVE SAFETY  (deterministic, BEFORE the agent)
      detectUnsupportedSignals(query) → unsafe? → refuse + safe-alternative draft. STOP.
[1] task → build subagent;  write_todos: [extract slots, resolve open, fetch detail, wire, submit]
[2] EXTRACT SLOTS         fill slots from query (reuse/extend IntentSpecV2)
[3] OPEN-SLOT DETECTION   required-slots(output type) → any empty/multi-valued? (the §2/§3 algorithm)
[4] INTERACTIVE ASK       for each open slot → human-in-the-loop INTERRUPT (LangGraph interrupt):
                            enumerable → structured choice (active/passive buzzer);
                            open → free-form ("무엇을 표시?").  resume → fill → re-eval [3].
[5] GROUND (per chosen part)  get_part_detail(id) → write full detail to virtual FS, summary to context
[6] WIRE                  get_wiring_guidance(parts) → topology (exemplar)
[7] TERMINAL              submit_circuit(spec)  ← a TOOL, not responseFormat
        └─ DRC (deterministic): pin-provenance (pins ∈ fetched catalog) +
           electrical validity + conditional rules (I2C pull-ups etc.) + safety belt
        └─ fail → structured violations fed back → repair (bounded N=2) → re-submit
        └─ pass → finalize
[8] FINALIZE             (deterministic) validate→render→simulate → AgentRunResult
```

### Deterministic guardrails (NOT agent discretion)
- **Safety** = step [0], pre-emptive (intent-shaped danger has no part/spec signature).
- **DRC** = step [7]: enforces grounding (no hallucinated pins), conditional rules (e.g. I2C pull-ups regardless of whether the agent fetched `get_protocol_rules`), electrical validity. The DRC is the grounding + safety-belt enforcer, not just an electrical check.
- **Bounded repair** (N=2) + explicit `recursionLimit` (LangGraph default 25 → `GraphRecursionError`).

### Tools
| Tool | Tier | Returns |
|---|---|---|
| `get_category(cat)` | T0→T1 | parts in a category (compact) |
| `search_parts(query)` | T0→T1 | ranked catalog matches over the FULL catalog (fuzzy-normalized: NFKC + KO particle strip + jamo edit-distance) |
| `get_part_detail(id)` | T1 | pins/limits/passives/footprint summary/mistakes → full detail to virtual FS |
| `get_wiring_guidance(parts)` | T2 | topology + wiring rules (exemplar) |
| `get_protocol_rules(bus)` / `get_electrical_budget(parts)` | T3 | conditional reference (enforcement lives in DRC) |
| `submit_circuit(spec)` | terminal | runs DRC; on pass writes canonical CircuitSpec |

### Additive migration (funnel stays)
This runs ALONGSIDE the existing deterministic funnel: the funnel's safety + candidate/coverage/validity gates remain; the guided workflow adds the slot-filling + stepwise retrieval + interactive asks. No gate is removed. Gated behind `pipelineMode` so it can be A/B'd against the current path.

# REVIEW VERDICT (4-angle rigorous review) — 2026-06-04

Product/UX · Deep-Agents-mechanism · codebase-fit · slot/rule-table-correctness reviewers converged. **The slot schema is sound, but one reframing (UX) dissolves the design's hardest blockers, and three other findings re-scope it substantially.**

## R1 — THE KEY REFRAME: default-and-explain, NOT ask (UX)
For a *beginner teaching tool*, the disambiguation asks (active/passive buzzer, DHT11/22, DC/stepper) **demand the exact knowledge the user came to learn** — asking is the wrong model. The catalog itself refutes the asks: `active-buzzer`↔`piezo-buzzer` are mutual `safeSubstitutes`; "온도" already aliases to DHT11.
→ **Default = deterministic one-shot build with the canonical beginner part, then EXPLAIN the choice + a one-tap change.** Ask ONLY for genuinely *user-held* info (output/intent absent, `display_content`). The teaching moment is AFTER the build, not a pre-build gate the user can't pass. "Agent decides mode" breaks classroom reproducibility → default must be deterministic. The "그냥 만들어" override is invisible to beginners → make it a visible affordance with a default-selected option. New data: a small **canonical-beginner-part per family** table (~6 rows).

## R2 — default-and-explain DISSOLVES the Deep-Agents blocker (huge)
The §9 core — **human-in-the-loop interrupt INSIDE a `task` subagent, resumed across HTTP turns** — **does not work on this stack**: actively-buggy on JS (deepagentsjs#131, deepagents#420/#554), `recursionLimit` not propagated to subagents (#1698), and **the server has NO checkpointer/persistence/resume path** (stateless one-shot POST; `thread_id` is decorative). That would be a multi-day server change, NOT additive.
→ **But if the default is one-shot-build-and-explain (R1), the common path needs NO interactive interrupt at all.** Interactive asking shrinks to the rare "no output named" case, which the EXISTING stateless clarification path (client-held `conversationContext`, like `awaitingBuildConfirmation`) already handles. **The whole interrupt/checkpointer/resume infrastructure becomes unnecessary for v1.** If ever needed: hoist interrupt to the top-level graph (not the subagent), add a real checkpointer + resume endpoint.

## R3 — The rule table ALREADY EXISTS (don't re-author)
§2.1's 7-row table is a **lossy re-derivation of `capability-graph.json` (42 capabilities)** — already authored, KO-localized, wired to validation, carrying `requiredEvidence` (the content→sensor map) and `negativeEvidence` (safety/overclaim guards). Hand-authoring it will **diverge from the graph the DRC keys off, and drop the safety guards**. → **Derive/wire from the 42 capabilities; don't write a parallel table.** Gaps the 7 rows dropped: communication-module readout (UART/SPI/RS485), logic/interface-IC readout, human-input readout (joystick/encoder/keypad), bare-7seg, SPI graphic displays. The **"value-display always needs a sensor" rule is WRONG** (forces phantom sensors on counter/timer/static-number displays). **DHT11/22 should be AUTO, not ASK** (precision, not behavior — contradicts the doc's own rule). Disambiguation boundary = `protocols`/`requiredRoles` divergence (ASK: I2C-vs-SPI variant, unipolar-vs-bipolar stepper) vs `capabilities`-only (AUTO).

## R4 — Codebase-fit caveats
- **IntentSpecV2 reuse is partial**: carries the axes but as flat derived strings, no fill-state, no `triggerCondition`/`displayContent`; `ambiguities` is prose. → extend the schema (parallel slot model), not pure reuse.
- **`pipelineMode` is overloaded** (legacy/shadow/next already toggle 3 behaviors) → use a NEW flag.
- **Intent-authority drift**: deterministic `extractIntentSignals` + agent slots = two intent sources; `applyIntentFulfillmentGate` validates against the deterministic one → decide authority.
- **candidateParts gate**: a user-chosen off-list part is gated out → defer candidate finalization or keep choices in-set.
- **THIRD Korean surface**: registry `aliases` vs `HARDWARE_KEYWORDS` vs `ACTIVE_HARDWARE_KEYWORDS` → consolidate. `family` has 8 `undefined` incl. core parts (led-5mm, piezo-buzzer, micro-servo, button-tactile, arduino-uno) → family backfill is urgent.

## R5 — The simplified design (consensus)
1. **Default = deterministic one-shot build** with canonical beginner parts (from capability-graph + a small canonical-part table) → **explain the choice + one-tap change**. No interrupt machinery.
2. **Ask only when output/intent is genuinely absent** → reuse the existing stateless clarification path.
3. **Derive routing/disambiguation/content→sensor from `capability-graph.json`** (don't re-author); fix the "value-display needs sensor" over-rule.
4. **Data work** = Korean alias + family backfill (consolidate the 3 KO surfaces) + canonical-beginner-part table. This is the same data fix already prioritized.
5. **Defer** the interactive interrupt/stateful-resume architecture until a measured need + the server statefulness investment justify it.

**Net: the design collapses to "deterministic build with good defaults + explain + one-tap change, powered by the existing capability-graph + a Korean/family data backfill." Most of the new machinery (interrupt, subagent build, rule table, slot interrupts) is unnecessary for v1.**

---

## 10. Next (superseded by REVIEW VERDICT R5 above)
1. ~~Author the required-slots-per-output-type rule table~~ → **derive from capability-graph.json (R3)**.
2. Author the **behavior-default-per-output-type** map (§8).
3. Backfill **consistent Korean aliases** (spaced+unspaced) — shared with the Korean matching data-fix.
4. Map the slot schema onto the existing `IntentSpecV2` (reuse, don't duplicate).
5. Implement additively per §9: slot extraction → open-slot detection → interactive asks (interrupt) → `submit_circuit` → DRC, with the funnel gates intact, behind `pipelineMode`.
6. Rigorous multi-angle review BEFORE implementation.
