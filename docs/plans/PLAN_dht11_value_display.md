# Implementation Plan: DHT11 value-display routing fix

**Status**: Complete
**Started**: 2026-06-04
**Last Updated**: 2026-06-04

> Shipped in `3b2bbaa`. Both Korean cases route to `v2-dht11-temperature-humidity-display`
> with the `dht11` part and `sufficient` coverage; the English quantity-only guard stays
> ambiguous. Full generalization eval 5/5 (105 rows, 0 regression); 150 context unit tests green.

## Overview

### Feature Description
Korean temperature/humidity-sensor requests silently fail to build. Measured:
- `온습도센서 OLED에 표시` → route `v2-ambiguous-minimal` (clarification), **no candidate parts**, even though
  `dht11-temperature-humidity-display` is the #1 capability match.
- `DHT11로 온습도 OLED에 표시` → route `v2-analog-sensor-display-readout`, candidate parts
  `[arduino-uno, breadboard-half, oled-i2c-096]` — **no sensor** (the analog bundle has no temp/humidity part).

### Root Cause (verified live)
Two coupled defects in `server/context/contextPacket.ts`, NOT in the capability matcher (the matcher already
ranks `dht11` first for these queries):

1. **Over-rule (Bug A)** — `needsSpecificTemperatureHumiditySensor` (`contextPacket.ts:2113`) flags ambiguity
   whenever a query mentions temp/humidity **unless the literal text contains `dht11|dht22|bmp280|tmp36`**. The
   generic Korean word `온습도센서` is not one of those tokens, so it is wrongly treated as "no sensor named" →
   `inferIntentHints` pushes an ambiguity reason → `selectContextRouteV2` short-circuits to `v2-ambiguous-minimal`.

2. **Route priority beats capability rank (Bug B)** — when DHT11 *is* resolved, both `v2-analog-sensor-display-readout`
   (priority 32) and `v2-dht11-temperature-humidity-display` (priority 33) pass their `when` gates (their modalities
   are all present in `intentSignals` because both capabilities matched). `selectContextRouteV2` picks the lowest
   priority **number**, so the generic analog route wins over the specific dht11 route.

### Success Criteria
- [ ] `온습도센서 OLED에 표시` → route `v2-dht11-temperature-humidity-display`, coverage `sufficient`, candidate parts include `dht11`.
- [ ] `DHT11로 온습도 OLED에 표시` → route `v2-dht11-...` (not analog), candidate parts include `dht11`.
- [ ] Existing guard `generic-temperature-humidity-needs-sensor` ("temperature and humidity on the OLED", no sensor named) stays `v2-ambiguous-minimal`.
- [ ] Full generalization eval: 0 regressions across the existing 103 rows.

## Architecture Decisions (Clean Architecture)
| Layer | Component | Change |
|-------|-----------|--------|
| Application (context routing) | `inferIntentHints` / `needsSpecificTemperatureHumiditySensor` | Gate the temp/humidity ambiguity push on whether a *supported* temp/humidity-sensor capability is actually matched (derive disambiguation from the capability graph, not a hardcoded part-name allowlist). |
| Data (v2 routes) | `agent-context/v2/routes.json` | Raise specific temp/humidity sensor routes above the generic analog/digital sensor-display routes (specific-over-generic ordering). |
| Test corpus | `agent-context/evals/context-sufficiency-prompts.jsonl` | Add RED fixtures for the two Korean cases. |

### Key Decision: why not full capability-rank-aware route selection?
Rewriting `selectContextRouteV2` to make capability rank the primary sort key would reorder route selection for
all 103 fixtures (high regression surface). The priority adjustment is surgical: `dht11`/`dht22` capabilities only
match when their specific evidence tokens appear, so raising their route priority changes outcomes *only* for genuine
temp/humidity-sensor queries. Same correct end-state, far smaller blast radius.

## Test Strategy
| Test Type | Coverage | Purpose |
|-----------|----------|---------|
| Generalization eval (fixtures) | 2 new RED rows + 103 existing | Lock routing/coverage; prove 0 regression |

## Implementation Phases

### Phase 1 — RED: add failing fixtures
- [ ] Add `korean-temp-humidity-sensor-oled-unspaced` (`온습도센서 OLED에 표시`) → expect `v2-dht11-...`, sufficient, dht11 part, ambiguity false.
- [ ] Add `korean-dht11-explicit-oled` (`DHT11로 온습도 OLED에 표시`) → expect `v2-dht11-...`, dht11 part, forbid no-sensor build.
- [ ] `npm run eval:generalization` → these FAIL.

### Phase 2 — GREEN: relax over-rule + reprioritize routes
- [ ] `inferIntentHints`: pass `capabilityMatches`; skip the temp/humidity ambiguity push when a supported
      `temperature-humidity-sensor` capability is matched.
- [ ] `routes.json`: raise `v2-dht11-...` / `v2-dht22-...` priority above `v2-analog-sensor-display-readout` (32) and `v2-digital-input-display-readout` (30).
- [ ] `npm run eval:generalization` → all GREEN, 0 regression.

### Phase 3 — Verify & commit
- [ ] `npx tsc --noEmit` clean; `context:check` green.
- [ ] Live `buildContextPacket` spot-check both Korean prompts.
- [ ] Commit on `feat/layered-context-architecture`.

#### Quality Gate
- [ ] TDD RED→GREEN followed
- [ ] Full eval 0 regression (103 + 2)
- [ ] Typecheck clean
- [ ] Dependency rule respected (data + application only; no new outward deps)
- [ ] Guard fixture preserved

## Risk Assessment
| Risk | Prob | Impact | Mitigation |
|------|------|--------|------------|
| Priority bump regresses an analog/digital sensor fixture | Low | Med | dht11/dht22 caps only match on their own evidence tokens; full eval gate |
| Over-rule relaxation lets a genuine quantity-only request build sensorless | Low | Med | Gate strictly on *supported* temp/humidity-sensor capability match; guard fixture preserved |

## Notes & Learnings
- The matcher was already correct (dht11 ranks #1); the bug was purely in routing/ambiguity downstream.
- `intentSignals` already contains the dht11 route's required modalities via `buildIntentSignals` (capability modalities), so no modality-data change is needed.
