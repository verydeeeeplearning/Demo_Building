# Solver Gate Design

## Goal

The solver gate must not decide whether a hardware-shaped result is visible. The product rule is:

> Return a visible 3D scene for hardware synthesis whenever a safe educational scene can be shown. Gates decide confidence, repair actions, overlays, Run/share eligibility, and build-ready claims.

This replaces the older interpretation where `buildRunnableReport.runnable=false` always meant an empty render plan. Clarification-only, meta, or non-hardware turns can still remain no-scene.

## Current Problem

The current pipeline already has enough context to render all 130 catalog parts:

- 130 part capability entries.
- 0 missing `renderFootprint` mappings.
- 0 missing render-footprint catalog entries.
- 0 missing pin anchors relative to declared part pins.

Recent placement bugs came from solver behavior, not data absence:

- Arduino overlapped the breadboard because the default controller position ignored footprint bounds.
- Stage-only context parts such as perfboard could overlap the breadboard because stage placement was not constraint-driven.

Therefore the next layer should focus on deterministic auto-layout and visual repair, not asking users to redesign.

## Contract Split

The system must separate four claims:

| Claim | Meaning | Blocking? |
| --- | --- | --- |
| `visibleSimulation` | A 3D scene can be shown for the current hardware artifact. | Block only for clarification-only/meta/no-hardware turns or renderer failure. |
| `simulationActivity` | Signals/current/state can animate with evidence. | Degrade when evidence is weak. |
| `buildReady` | The circuit can be presented as a physically plausible build. | Strict. |
| `benchConfirmed` | Real hardware was measured/tested. | Never claimed automatically. |

## Review Corrections

Subagent review found mandatory corrections before implementation:

1. `SolverGateResult` must be additive in the first migration. Do not replace `buildRunnableReport` immediately because server, frontend, share, and tests still treat `buildRunnableReport.runnable` as the strict build/run/share gate.
2. `safe_equivalent_simulation` must carry original-vs-equivalent provenance. The original unsafe request is never build-ready; any build-ready claim can apply only to the generated safe equivalent circuit.
3. Solver repair must distinguish layout repair, routing repair, circuit mutation, safe-equivalent replacement, and placeholder degradation. Moving a part is not the same as adding a resistor or replacing an unsafe circuit.
4. The frontend renderer must consume server positions, routes, and camera-fit metadata. Server-side placement is not enough if special meshes or wires remain hardcoded on the client.

## Simulation Modes

Every finalized hardware scene should choose one visible mode:

| Mode | Use When | User Experience |
| --- | --- | --- |
| `verified_build_simulation` | Hardware, placement, routing, and render QA pass. | Normal build-ready 3D simulation. |
| `auto_repaired_simulation` | The first layout failed, but solver repaired it automatically. | Final repaired simulation with small internal trace. |
| `diagnostic_simulation` | Some electrical or visual evidence is incomplete, but the requested concept is safe to show. | Scene is visible with diagnostic overlays/warnings. |
| `safe_equivalent_simulation` | Original request is unsafe or physically invalid. | A safe low-voltage equivalent is shown; the original request is not build-ready. |
| `placeholder_part_simulation` | A part must be shown with generic/parametric geometry. | Generic module remains visually distinct from verified footprints and is not build-ready unless exact evidence later exists. |

## Pipeline

```text
student request
  -> requirement analysis
  -> circuit synthesis
  -> hardware fast gate
  -> auto placement solver
  -> wire routing solver
  -> visual DRC
  -> render QA
  -> solver gate result
  -> visible simulation
```

The agent may repair the circuit spec when the hardware gate fails. The solver repairs placement/routing/camera without asking the user.

## Solver Gate Result

```ts
type SolverGateMode =
  | 'verified_build_simulation'
  | 'auto_repaired_simulation'
  | 'diagnostic_simulation'
  | 'safe_equivalent_simulation'
  | 'placeholder_part_simulation';

type SolverGateResult = {
  visibleSimulation: boolean;
  mode: SolverGateMode;
  buildReady: boolean;
  simulationActivity: 'verified_current' | 'verified_signal' | 'state_only' | 'diagnostic';
  benchConfirmed: false;
  sourceSpecId?: string;
  repairedSpecId?: string;
  equivalentSpecId?: string;
  repairLevel: 'none' | 'layout' | 'routing' | 'circuit_mutation' | 'safe_equivalent' | 'placeholder';
  attempts: SolverAttempt[];
  verifiedClaims: string[];
  notVerified: string[];
  visualWarnings: VisualWarning[];
  hardwareWarnings: string[];
  repairSummary: string[];
};

type SolverAttempt = {
  attempt: number;
  stage: 'placement' | 'routing' | 'camera' | 'label' | 'degrade';
  action: string;
  result: 'passed' | 'repaired' | 'degraded';
  warnings: string[];
};
```

`SolverGateResult.visibleSimulation` controls whether a scene can be shown for a finalized hardware artifact. It may be `false` for clarification-only or non-hardware turns. If build evidence is weak, `buildReady=false` and the renderer must visually distinguish the uncertainty.

Initial migration rule:

```text
buildRunnableReport.runnable -> strict legacy build-ready/run/share gate
solverGateResult.visibleSimulation -> new visible-scene contract
```

`buildRunnableReport` remains strict for Run/share/build-ready claims. `solverGateResult` controls visible scene availability, including diagnostic, placeholder, and safe-equivalent scenes that must not unlock Run/current animation unless verified.

## Hard Gates

Hard gates affect `buildReady`, not `visibleSimulation`.

| Gate | Failure Means | Automatic Response |
| --- | --- | --- |
| Missing part catalog | Cannot claim exact build. | Use safe equivalent or placeholder. |
| Missing footprint | Cannot claim exact visual geometry. | Use parametric placeholder. |
| Missing pin anchor | Cannot animate verified current/signal to that pin. | Show diagnostic wire endpoint marker. |
| Unsafe mains/high voltage | Cannot show build-ready original. | Show safe low-voltage equivalent. |
| LED without resistor | Cannot claim build-ready. | Auto-add required resistor when topology allows. |
| Motor directly on GPIO | Cannot claim build-ready. | Auto-add driver/MOSFET topology when available. |
| No common ground | Cannot claim build-ready. | Auto-add common ground wire when unambiguous. |
| Render collision | Cannot claim visually trustworthy build. | Re-run placement solver. |
| Wire endpoint missing | Cannot animate verified path. | Re-route or degrade to diagnostic. |

Hard gates also determine animation claims:

- verified current animation requires validated current path ids, render anchors, and routed endpoints.
- verified signal animation requires validated signal or bus path ids plus render anchors.
- diagnostic scenes may show endpoint badges and static wires, but must not imply verified current flow.

## Optimization Gates

Optimization gates should never ask the user to choose. They run internally:

- reduce wire crossing count;
- keep parts close enough to be readable;
- preserve breadboard row continuity clarity;
- avoid label overlap;
- avoid wire/body intersections;
- fit all parts inside camera frame;
- keep controller USB/power side clear when known.

## Auto Placement Solver

Inputs:

- `CircuitSpec.components`
- render footprints
- breadboard grid
- allowed surfaces
- pin anchors
- connection graph

Regions:

```text
controller-left  | breadboard-grid | stage-right columns
                 |                 | off-board modules / motors / displays
```

Placement rules:

1. Breadboard surface is placed first at origin.
2. Controller boards are placed beside the breadboard, not on it.
3. Breadboard-compatible parts are snapped to breadboard holes.
4. Stage-only or beside-breadboard parts are placed in right-side stage columns.
5. Large parts that cannot fit inside the breadboard Z span get their own stage column.
6. Parts are never moved by `defaultPosition` except as a last diagnostic fallback.
7. Explicit `component.position` is a hint, not an unconditional trust boundary. The solver may move it when it violates surface, collision, grid, or camera constraints.

Repair loop:

```text
attempt 1: semantic region placement
attempt 2: collision-aware repack
attempt 3: spread stage columns
attempt 4: compact breadboard groups by nets
attempt 5: degrade only the failing part to placeholder/diagnostic
```

Required placement outputs:

```ts
type PlacementLayout = {
  partBounds: Record<string, Bounds3>;
  obstacleBounds: Record<string, Bounds3>;
  sceneBounds: Bounds3;
  occupiedBreadboardNodes: string[];
  warnings: VisualWarning[];
};
```

## Wire Routing Solver

Inputs:

- positioned parts
- endpoint layout
- connection list
- obstacle bounding boxes
- signal type colors

Rules:

1. Endpoint must attach to exact `partId:pin` anchor.
2. Wires should use routed polylines instead of body-crossing straight lines.
3. Wire/body intersections are warnings.
4. Crossings are allowed only with visual bridge/overpass styling.
5. Verified current animation is allowed only when endpoint anchors and current paths are validated.

Routing stages:

```text
direct route
  -> orthogonal route
  -> edge-bus route around breadboard
  -> diagnostic route with endpoint badges
```

Required route outputs:

```ts
type RoutedWire = {
  connectionId: string;
  points: Array<{ x: number; y: number; z: number }>;
  layer: 'board' | 'air' | 'diagnostic';
  crossings: Array<{ withConnectionId: string; style: 'bridge' | 'overpass' }>;
  warnings: VisualWarning[];
};
```

The frontend must render these routed points. Client-only CatmullRom routes are allowed only as a temporary fallback and must be marked diagnostic if they are not server-verified.

## Visual DRC

The visual DRC should return structured warnings:

| Code | Meaning | Repair |
| --- | --- | --- |
| `PART_COLLISION` | Footprint boxes overlap. | Repack region. |
| `SURFACE_VIOLATION` | Part is on a disallowed surface. | Move to allowed region. |
| `BREADBOARD_GRID_MISALIGNMENT` | Breadboard pin is not on hole grid. | Snap to nearest valid hole. |
| `BREADBOARD_NODE_CONFLICT` | Unconnected pins share a physical node. | Move one part to another row. |
| `WIRE_ENDPOINT_MISSING` | Wire endpoint has no anchor. | Diagnostic endpoint badge. |
| `WIRE_BODY_INTERSECTION` | Wire crosses a component body. | Re-route. |
| `LABEL_OVERLAP` | Label hides another label/part/wire. | Reposition labels. |
| `CAMERA_CLIPPING` | Scene is outside camera frame. | Recalculate camera bounds. |
| `PLACEMENT_CAPACITY_EXCEEDED` | Breadboard/stage has no valid non-overlapping placement. | Degrade failing part or spread region. |

## Camera Framing

Camera framing must be generated from the final scene bounding box:

1. Include every part footprint bound.
2. Include routed wire bends.
3. Include label bounds.
4. Add fixed margin.
5. Recheck with screenshot or canvas bounds.

This prevents the document bug where a diagram used only part centers and clipped the breadboard edge.

The frontend render scene must use server-provided positions and camera-fit metadata. Hardcoded special meshes for Arduino, breadboard, OLED, or other parts are allowed only if their transform is derived from the corresponding `RenderPlan.parts[].position`.

## Product Behavior

Do not show the student score-based choices.

Good:

> 회로를 구성했어요. 시뮬레이션을 시작할게요.

Allowed when degraded:

> 이 장면은 안전한 대체 회로로 표시됩니다. 실제 220V 배선은 그리지 않습니다.

Avoid:

> 점수가 낮으니 다시 설계해 주세요.

## Integration Points

Short-term integration:

1. Rename or supplement `buildRunnableReport` with a `solverGateResult`.
2. Keep `buildReady` strict, but stop using it as the condition for showing any simulation.
3. Add `visibleSimulation` metadata to agent artifacts.
4. Convert render-blocking warnings into solver repair inputs first.
5. Only after repair attempts should warnings degrade `buildReady` or animation mode.

Current non-breaking contract:

1. `buildSolverGateResult(validationReport, renderPlan, simulationPlan, buildRunnableReport)` is additive beside the legacy runnable gate.
2. `buildReady` maps to `buildRunnableReport.runnable` and remains the strict condition for Run/current animation/share claims.
3. `visibleSimulation` maps to actual render-plan scene availability and can be true while `buildReady=false`.
4. Clarification-only/meta requests remain no-scene.
5. Unsupported hardware specs may produce `diagnostic_simulation` scenes with warnings and no verified current-flow claim.
6. Missing exact footprints may produce `placeholder_part_simulation`; placeholder geometry is visible but not build-ready.
7. Unsafe or physically invalid requests may produce `safe_equivalent_simulation`; the safe equivalent can be shown, while the original request remains blocked.

Current code touchpoints:

- `server/agent/circuitTools.ts`
  - `compileRenderPlan`
  - `planDefaultRenderPositions`
  - render DRC helpers
  - `compileSimulationPlan`
  - `buildRunnableReport`
- `server/agent/deepAgentRuntime.ts`
  - `finalizeAgentResult`
  - quality repair loop
  - student-facing message when runnable is false
- `server/agent/schemas.ts`
  - add `SolverGateResultSchema`
  - extend agent artifact schema

## Test Matrix

Must-pass cases:

1. Arduino + breadboard never overlap.
2. Stage-only parts never overlap breadboard.
3. Breadboard-compatible parts snap to holes.
4. Hidden breadboard node conflicts trigger automatic row relocation.
5. Wire endpoint missing degrades current animation but still shows a visible scene.
6. Unsafe high-voltage request returns safe equivalent simulation.
7. Missing exact footprint uses placeholder simulation.
8. Camera frame includes all part footprint bounds, not only centers.
9. Label overlap is repaired or reported as diagnostic.
10. Agent result still includes a render plan even when `buildReady=false`.
11. Explicit bad positions are repaired or downgraded; they are not trusted blindly.
12. Specialized frontend meshes consume server positions.
13. Routed wire endpoints match server endpoint anchors.
14. Visible non-build-ready shares preserve the scene without claiming build-ready.
15. `benchConfirmed` remains false unless explicit bench evidence is attached.

## Implementation Order

1. Add `SolverGateResultSchema` as an additive optional contract.
2. Add a builder adapter that derives a first solver gate result from existing artifacts.
3. Add tests proving visible simulation and build-ready are separate claims.
4. Extract placement into `AutoPlacementSolver`.
5. Convert current placement audits into `VisualDRC`.
6. Add repair attempts around placement before simulation compile.
7. Add route/camera/label data structures to `RenderPlan.layout`.
8. Update frontend stage rendering to consume server positions/routes/camera.
9. Add share/import support for visible-but-not-build-ready artifacts.
10. Stabilize invalid/unsupported outputs as clarification-only no-scene, diagnostic scenes, placeholders, or safe equivalents according to the gate result.
11. Update agent messages so non-build-ready no longer means "no simulation" when a diagnostic, placeholder, or safe-equivalent scene is available.
