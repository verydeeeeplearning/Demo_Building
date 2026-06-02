# Hardware Object Drag and Simulation Adjustment Implementation Plan

## 1. Goal

The product promise is that students can always inspect a safe hardware-shaped simulation when the request is hardware related. The rule gate should not be used as a stop sign that hides the simulation. It should be an automatic adjustment engine that turns deterministic evidence into the safest visible simulation, control policy, and claim scope.

This plan covers two interactive hardware-object movement features and four simulation adjustment modes:

- visual-only hardware object movement
- constraint-based hardware object movement
- `diagnostic_simulation`
- `placeholder_part_simulation`
- `safe_equivalent_simulation`
- `state_only`

The intended final user experience is:

> A student asks for a circuit, sees a 3D simulation, can move hardware objects when appropriate, and the system automatically snaps, reroutes, validates, and adjusts the visible scene without forcing the student into manual gate decisions.

## 2. Current State

The current stage renderer is already a Three.js scene in `src/stageScene.js`.

What exists now:

- The canvas is rendered as `data-renderer="three"`.
- Pointer picking exists for hover and inspector selection.
- Dragging currently rotates the scene root on the horizontal axis.
- Mouse wheel zooms the camera distance.
- The server emits render plan positions, endpoints, routes, labels, solver attempts, bounds, and camera fit metadata.
- The solver gate already separates `visibleSimulation`, `buildReady`, `simulationActivity`, and `benchConfirmed`.

What does not exist yet:

- A student cannot drag an Arduino, breadboard, sensor, display, or other rendered object to a new position.
- The frontend does not expose an edit mode for part movement.
- The server does not accept user placement proposals.
- A moved part does not trigger snap, reroute, collision detection, camera refit, or solver-gate recomputation.
- Adjustment modes are partially represented, but the language still sometimes reads as "blocking" or "degrading" rather than "presentation adjustment".

## 3. Design Principle: Rule Gate As Automatic Adjustment

The rule gate is still necessary. It should decide what can be claimed and what must be automatically adjusted. The important distinction is:

```text
bad: rule gate fails -> no simulation
good: rule gate evaluates evidence -> automatically adjusts simulation mode, controls, and claims
```

The adjustment layer must not be a keyword router. It should be a deterministic presentation contract produced from evidence that already exists in the agent/toolchain.

Inputs:

- user intent
- context packet
- synthesized circuit spec
- deterministic hardware validation
- render plan
- visual warnings
- simulation plan
- safety repair or safe-equivalent provenance

Outputs:

- visible scene mode
- student-visible controls
- verified claims
- not-yet-verified claims
- visual overlays
- Run/current-flow eligibility
- share/export eligibility
- next agent action if the system can improve automatically

This means:

- `visibleSimulation` answers: "Can the student see a safe 3D scene?"
- `buildReady` answers: "Can we claim this is physically buildable?"
- `simulationActivity` answers: "What kind of runtime behavior can be shown with evidence?"
- `benchConfirmed` remains false unless real hardware testing exists.

The UI should avoid "blocked" language for safe hardware scenes. A hardware scene can be "review-only", "placeholder-adjusted", "safe-equivalent", or "state-only" while still being visible. Internally, the gate may still record strict rule failures, but the product behavior is automatic adjustment rather than hiding the scene.

## 4. Feature A: Visual-Only Hardware Object Movement

### 4.1 Purpose

Visual-only movement lets a student explore the 3D scene by repositioning objects without changing the validated circuit truth.

This is useful for:

- inspecting crowded scenes
- moving a module aside to see wires
- creating a clearer screenshot
- teaching layout concepts before committing to a physical layout

### 4.2 Behavior

When visual edit mode is enabled:

1. Student clicks or taps a part.
2. The selected object shows a subtle outline/anchor marker.
3. Student drags the object on the current allowed surface.
4. The object moves visually.
5. Connected wire endpoints follow the visual transform as preview routes.
6. The app marks the scene as a visual arrangement, not a validated hardware edit.
7. Reset restores the server-generated layout.

Important refinement:

- preview wires must be dashed/ghosted overlays, not replacements for verified wire routes
- current animation remains tied to the base verified render plan
- if the visual arrangement makes verified animation visually misleading, current animation is paused until reset or hardware-resolved placement

### 4.3 Data Model

```ts
type VisualObjectTransform = {
  componentId: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  source: 'student_visual_adjustment';
  committed: false;
};

type VisualArrangementState = {
  transforms: Record<string, VisualObjectTransform>;
  baseRenderPlanId: string;
  baseRenderPlanRevision: string;
  circuitSpecHash: string;
  dirty: boolean;
};
```

### 4.4 Constraints

Visual-only movement must not:

- change `CircuitSpec`
- claim `buildReady=true`
- change pin assignments
- rewrite the requirement document
- unlock current animation if the base solver did not verify it

It may:

- move meshes and labels
- preview rerouted wires
- change camera framing
- export a "visual arrangement" screenshot

### 4.5 Implementation Steps

1. Add `interactionMode` to frontend state:
   - `inspect`
   - `orbit`
   - `visual_move`
   - later `hardware_move`
2. Refactor `src/stageScene.js` pointer handling:
   - keep existing raycast target picking
   - add drag state for selected part
   - distinguish scene orbit drag from part drag
3. Refactor the Three.js scene graph into movable units:
   - `partGroupsById`
   - `wireGroupsByConnectionId`
   - `labelGroupsByPartId`
   - `previewWireGroupsByConnectionId`
   - `getPartWorldBounds(componentId)`
   - `applyVisualTransform(componentId, transform)`
   - `resetVisualTransforms()`
4. Add a drag plane:
   - breadboard-compatible parts move on breadboard plane
   - stage-only parts move on stage plane
   - controller boards move on beside-breadboard plane
5. Apply transforms to the selected part group.
6. Recompute affected preview wire overlays locally.
7. Store visual transforms in `state.visualArrangement`, not in `CircuitSpec` or canonical `RenderPlan`.
8. Add reset and undo for visual transforms.
9. Add E2E test:
   - load PCB tab
   - select LED or module
   - drag it
   - verify canvas is nonblank
   - verify selected part world position changes
   - verify screenshot pixel delta is meaningful
   - verify preview wire route hash changes when wires are shown
   - verify `CircuitSpec` hash is unchanged
   - verify no `buildReady` claim changes

## 5. Feature B: Constraint-Based Hardware Object Movement

### 5.1 Purpose

Constraint-based movement is the real hardware edit path. The student drags an object, but the system does not blindly accept arbitrary coordinates. It treats the drag as a placement intent, resolves it through the solver, reroutes wires, validates electrical and visual constraints, and returns an adjusted render plan.

This is the feature aligned with the long-term product goal.

### 5.2 Behavior

1. Student enters hardware edit mode.
2. Student drags a part.
3. The frontend shows a local ghost preview while the pointer moves.
4. On pointer up, the frontend sends a placement intent to the server.
5. The solver snaps the part to a legal region:
   - breadboard hole
   - beside-breadboard area
   - stage area
   - module-specific mounting zone
6. The solver recalculates:
   - part bounds
   - pin anchors
   - wire routes
   - collision status
   - camera framing
   - labels
   - solver gate result
7. The frontend replaces the scene with the adjusted render plan.
8. If the placement cannot be made build-ready, the system still shows the closest safe adjusted scene and scopes the claims accordingly.

### 5.3 Server API

```ts
type PlacementIntent = {
  sessionId?: string;
  artifactId?: string;
  baseRevision: string;
  baseArtifact?: {
    circuitSpec: CircuitSpec;
    renderPlan: RenderPlan;
  };
  componentId: string;
  requestedTransform: {
    position: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
  };
  coordinateSpace: 'render_world';
  interactionSource: 'student_drag';
  snapPreference?: 'nearest_legal' | 'preserve_surface' | 'preserve_net_readability';
};

type PlacementResolutionStatus =
  | 'resolved_build_ready'
  | 'resolved_review_only'
  | 'adjusted_to_nearest_safe'
  | 'safe_equivalent_adjusted'
  | 'no_safe_visible_scene';

type PlacementResolution = {
  status: PlacementResolutionStatus;
  revision: string;
  requestedTransform: PlacementIntent['requestedTransform'];
  adjustedTransform: {
    position: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
  };
  snapTarget?: {
    surface: 'breadboard' | 'beside_breadboard' | 'stage';
    nodeId?: string;
    regionId?: string;
  };
  renderPlan: RenderPlan;
  simulationPlan: SimulationPlan;
  buildRunnableReport: BuildRunnableReport;
  solverGateResult: SolverGateResult;
  appliedPatch: LayoutOverridePatch;
  presentationNotes: PresentationNote[];
};
```

Proposed endpoint:

```text
POST /api/agent/placement/resolve
```

The endpoint should be deterministic and must not call the LLM for ordinary drag resolution. LLM usage is only needed if the student changes the circuit goal, asks for a semantic redesign, or introduces a new part/function.

Before adding the endpoint, extract a deterministic module:

```ts
function resolvePlacementLayout(
  baseArtifact: { circuitSpec: CircuitSpec; renderPlan: RenderPlan },
  intent: PlacementIntent,
  options: PlacementResolverOptions
): PlacementResolution;
```

This avoids overloading the full `compileRenderPlan()` path with single-part edit semantics.

### 5.4 Constraint Layers

Placement resolution should apply these layers in order:

1. **Surface eligibility**
   - breadboard-compatible
   - beside-breadboard
   - stage-only
   - controller-board
   - fixed/locked
2. **Snap**
   - breadboard hole grid
   - rail row
   - module anchor
   - stage grid
3. **Collision**
   - part body overlap
   - wire/body overlap
   - label overlap
   - camera clipping
4. **Electrical preservation**
   - pin anchors remain valid
   - no floating required net is introduced
   - power/ground continuity remains intact
   - no unsafe current path is introduced
5. **Wire rerouting**
   - route from current endpoints
   - avoid obstacles
   - preserve signal color/role
   - mark unverifiable endpoints as diagnostic markers
6. **Camera refit**
   - recompute bounds
   - fit all parts and key labels
   - update zoom clamp
7. **Revision and stale-edit check**
   - reject or rebase stale `baseRevision`
   - preserve locked components
   - keep movement replayable for undo/share/export

### 5.5 Persistence

Hardware movement should be represented as a patch, not as uncontrolled mutation.

```ts
type LayoutOverridePatch = {
  id: string;
  source: 'student_hardware_move';
  createdAt: string;
  baseCircuitSpecId: string;
  baseRevision: string;
  partTransforms: Record<string, {
    position: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
    snapTarget?: string;
  }>;
};
```

The system should support:

- undo last placement
- reset to solver layout
- share adjusted layout
- export adjusted layout in the document
- replay placement attempts in logs

## 6. Adjustment Modes

### 6.1 `diagnostic_simulation`

Use when:

- the requested hardware concept is safe to show
- the render plan has enough parts to display
- build-ready evidence is incomplete
- current/signal animation should not be claimed
- the rule gate has enough evidence for `safeToRender=true`

Expected behavior:

- show a 3D scene
- show diagnostic markers or review-only overlays
- keep Run/current-flow controls tied to verified evidence
- preserve next-step hints for automatic improvement

Example:

- a sensor request where the part exists visually, but exact electrical primitive or pin evidence is incomplete

### 6.2 `placeholder_part_simulation`

Use when:

- the requested part exists in context or can be safely represented
- exact render footprint/model evidence is missing or uncertain
- a generic geometry can communicate the concept safely
- the placeholder footprint is explicitly registered, not invented ad hoc

Expected behavior:

- show a distinct generic placeholder
- label it clearly as a placeholder in internal metadata and UI detail panels
- avoid claiming exact physical size or pin geometry
- keep build-ready false unless exact footprint/pin evidence is later added
- include `placeholderFootprintId`, `missingEvidence`, `exactGeometryClaim:false`, and `pinGeometryClaim:false`

Example:

- a module with known electrical behavior but no exact 3D model or footprint mapping

### 6.3 `safe_equivalent_simulation`

Use when:

- the original request is unsafe or physically invalid
- the system can synthesize a safe educational equivalent

Expected behavior:

- never mark the original request as build-ready
- show the safe equivalent circuit
- store original-vs-equivalent provenance
- make the replacement visible in logs and exported artifacts
- keep student language natural, without exposing internal gate jargon
- scope any build-ready claim to the displayed equivalent only

Example:

- a high-voltage lamp request becomes a low-voltage LED + resistor equivalent

### 6.4 `state_only`

Use when:

- the scene is useful for context or pin/layout inspection
- there is no verified current path animation
- the expected state can still be shown

Expected behavior:

- show the 3D scene
- show static state, pin labels, board context, or layout context
- do not imply animated current flow
- make it strong enough visually to prove the intended context is present

Examples:

- Arduino Nano pin-map context
- perfboard layout context
- display-only static state where no current path primitive is available

Important correction:

`state_only` should not require `buildReady=true`. It should be derived from evidence that the state/context view is meaningful, even if physical build claims are still review-only.

## 7. SolverGateResult Changes

### 7.1 Current Issue

The current result shape is close, but implementation and copy still sometimes imply "blocking" or "degrade". That weakens the intended product model.

### 7.2 Proposed Additive Fields

Avoid breaking the legacy `buildRunnableReport` contract in the first migration. Add presentation-specific fields to `solverGateResult`.

```ts
type PresentationAdjustment =
  | {
      kind: 'none';
      reason: 'verified_build';
    }
  | {
      kind: 'diagnostic_simulation';
      reason: string;
      visibleOverlays: string[];
    }
  | {
      kind: 'placeholder_part_simulation';
      placeholderPartIds: string[];
      reason: string;
    }
  | {
      kind: 'safe_equivalent_simulation';
      originalSpecId: string;
      equivalentSpecId: string;
      originalBuildReady: false;
      displayedEquivalentBuildReady: boolean;
      blockedOriginalReasons: string[];
      equivalenceClaims: string[];
      nonEquivalentWarnings: string[];
      reason: string;
    }
  | {
      kind: 'state_only';
      stateEvidence: string[];
      reason: string;
    };

type SolverGateResultVNext = SolverGateResult & {
  presentationAdjustment: PresentationAdjustment;
  buildReadyScope: 'original' | 'displayed_equivalent' | 'none';
  safeToRenderEvidence: string[];
  controls: {
    runEnabled: boolean;
    currentAnimationEnabled: boolean;
    hardwareMoveEnabled: boolean;
    visualMoveEnabled: boolean;
    shareEnabled: boolean;
  };
};
```

### 7.3 Activity Calculation Correction

`simulationActivity` should be calculated from available evidence, not only from `buildReady`.

Target logic:

```text
if verified current paths exist -> verified_current
else if verified signal paths exist -> verified_signal
else if meaningful expected state/context evidence exists -> state_only
else -> diagnostic
```

Then control availability is derived separately:

```text
Run/current animation requires build-ready-compatible verified paths.
Visible scene requires safe renderable hardware evidence.
State-only scene requires meaningful state/context evidence.
```

### 7.4 Mode Evidence Matrix

| Mode | Required Evidence | Automatic Adjustment | Control Policy |
| --- | --- | --- | --- |
| `diagnostic_simulation` | safe hardware concept, renderable parts, incomplete build/current evidence | show review scene with diagnostic overlays | Run/current animation off unless verified paths exist |
| `placeholder_part_simulation` | explicit placeholder footprint, known missing exact evidence | show generic placeholder with exact-geometry claims disabled | Run depends on electrical evidence; exact build claim off |
| `safe_equivalent_simulation` | unsafe/invalid original, safe equivalent spec, provenance | show equivalent circuit and scope claims to displayed equivalent | original never build-ready; equivalent controls depend on validation |
| `state_only` | meaningful expected state, pin-map, layout, or context evidence | show static state/context scene | current animation off; static inspection on |

## 8. Frontend UX Plan

### 8.1 Interaction Modes

Add a compact stage toolbar:

- inspect
- orbit
- move visually
- move hardware
- reset layout
- undo

The toolbar should use icons and tooltips rather than explanatory text-heavy controls.

Current UI density risk:

- the existing stage controls already contain run/step/reset/fit-style controls
- mobile width may not support another large pill group
- first implementation should use a compact icon toolbar with hover/focus tooltips and move controls hidden unless a scene is visible

### 8.2 Drag Rules

Pointer behavior:

- inspect mode: click selects part/connection
- orbit mode: drag rotates camera/scene
- visual move mode: drag selected part visually
- hardware move mode: drag selected part and resolve through server solver

Keyboard accessibility:

- selected part can be nudged with arrow keys in move modes
- Escape cancels active drag
- Cmd/Ctrl+Z undoes placement
- Enter commits preview when hardware move resolution is pending

### 8.3 Student-Facing Language

Use:

- "검토용 3D"
- "안전 대체 회로"
- "상태 확인 장면"
- "자리 맞춤 중"
- "자동 배치가 조정됨"

Avoid:

- "blocked"
- "hard gate failed"
- "degraded"
- "unsupported context bundle evidence"
- "cannot proceed" when a safe visible scene exists

## 9. Verification Plan

### 9.1 Unit Tests

Add or update tests for:

- `simulationActivity='state_only'` when expected state evidence exists but `buildReady=false`
- placeholder mode with generic visual but no build-ready claim
- safe-equivalent provenance
- diagnostic mode with visible scene and disabled current animation
- visual transform does not mutate circuit spec
- hardware placement intent resolves through constraints
- solver copy does not expose "blocked", "degraded", or internal context-bundle jargon in student-facing text for visible safe scenes

### 9.2 E2E Tests

Add Playwright cases:

1. Drag a part in visual move mode.
   - canvas remains nonblank
   - part transform changes
   - screenshot before/after pixel delta exceeds a minimum threshold
   - `stageDebug().partPositions[componentId]` changes
   - `stageDebug().circuitSpecHash` does not change
   - build-ready state does not change
2. Drag a part in hardware move mode.
   - local ghost preview appears during pointer move
   - server placement endpoint is called on pointer up
   - request body includes `componentId`, `baseRevision`, `coordinateSpace`, and `requestedTransform`
   - render plan is replaced
   - `stageDebug().renderPlanRevision` changes
   - wires reroute
   - `stageDebug().wireRouteHash` changes when routing changes
   - solver gate summary updates
3. Diagnostic simulation remains visible.
4. Placeholder part simulation shows generic geometry.
5. Safe equivalent simulation shows the replacement circuit.
6. State-only Nano or perfboard scene visibly exposes context.

### 9.3 Stage Debug Contract

Expose a test-only debug snapshot from the stage canvas or scene handle:

```ts
type StageDebugSnapshot = {
  interactionMode: 'inspect' | 'orbit' | 'visual_move' | 'hardware_move';
  renderPlanRevision: string;
  circuitSpecHash: string;
  buildReady: boolean;
  presentationAdjustmentKind: string;
  partPositions: Record<string, { x: number; y: number; z: number }>;
  visualTransformRevision: number;
  wireRouteHash: string;
  previewWireRouteHash?: string;
};
```

This lets E2E prove object movement and route changes without relying only on nonblank screenshots.

### 9.4 Adjustment Mode Browser Matrix

| Mode | Browser Fixture | Must Assert |
| --- | --- | --- |
| `diagnostic_simulation` | safe but incomplete evidence scene | visible canvas, review overlay, Run/current policy, no no-scene fallback |
| `placeholder_part_simulation` | registered placeholder footprint scene | placeholder mesh visible, exact geometry claim false, build-ready scoped correctly |
| `safe_equivalent_simulation` | unsafe original request with safe equivalent | original provenance, equivalent scene visible, original build-ready false |
| `state_only` | Nano/perfboard/static context scene | meaningful board/context visual, no current animation, state evidence metadata |

### 9.5 Document/Evidence Tests

The Word E2E document should stop relying on static PIL diagrams as proof of renderer behavior. It should include real browser screenshots for:

- verified build simulation
- diagnostic simulation
- placeholder part simulation
- safe equivalent simulation
- state-only context scene
- visual move before/after
- hardware move before/after

PIL render-plan diagrams may remain as schematics, but the evidence figures must come from Playwright browser screenshots. Each figure should include:

- test name
- viewport
- screenshot hash
- render plan revision
- mode
- build-ready scope
- presentation adjustment kind

### 9.6 QA Commands

Add dedicated QA commands:

```json
{
  "qa:e2e-assets": "playwright test <browser-evidence-spec>",
  "qa:word": "tsx scripts/generate_e2e_word_assets.ts --browser-evidence && python scripts/build_e2e_word_doc.py"
}
```

Final acceptance should include:

```text
npm run check
npm run qa:e2e-assets
npm run qa:word
```

### 9.7 Hardware Truth Limits

Passing this system means:

- part/pin/context data was used
- deterministic validation passed for claimed build-ready circuits
- placement and routing constraints passed
- render QA passed
- simulation claims match available primitives

It still does not mean:

- real hardware was bench-tested
- analog readings are physically calibrated
- every component tolerance is modeled
- thermal behavior is modeled
- manufacturer-specific 3D model exactness is guaranteed unless sourced

## 10. Implementation Phases

### Phase 1: Rule-Gate Adjustment Contract Migration

Scope:

- preserve strict deterministic rule gates
- make rule gates produce automatic presentation adjustments instead of no-scene behavior for safe hardware scenes
- update solver-gate wording from blocking/degrade to adjustment/review in student-facing paths
- calculate `state_only` from state evidence independent of buildReady
- add `presentationAdjustment`, `buildReadyScope`, `safeToRenderEvidence`, and `controls`
- define safe-equivalent original/displayed-equivalent claim scope
- define placeholder footprint evidence requirements
- update frontend copy and tests

Exit criteria:

- existing tests pass
- diagnostic, placeholder, safe-equivalent, and state-only fixtures have explicit expected UI/control behavior
- no visible safe hardware scene is hidden solely because `buildReady=false`
- internal strict failures are retained in logs, but student-facing copy describes automatic adjustment

### Phase 2: Stage Scene Graph Refactor

Scope:

- create part, wire, label, and preview-wire groups
- expose part world bounds and stage debug snapshot
- preserve existing hover/selection behavior
- keep orbit mode behavior stable

Exit criteria:

- current E2E canvas tests still pass
- part groups can be selected by `componentId`
- debug snapshot exposes part positions and route hashes

### Phase 3: Visual-Only Movement

Scope:

- add interaction mode state
- add part drag preview in `src/stageScene.js`
- add local transform store
- add reset/undo
- add E2E drag test

Exit criteria:

- student can drag a part visually
- preview wires/labels remain coherent enough for inspection
- validated claims remain unchanged
- undo/reset restores server-generated layout

### Phase 4: Constraint-Based Hardware Movement

Scope:

- introduce render/circuit artifact revision identity
- extract `resolvePlacementLayout()`
- add placement intent endpoint
- add solver placement resolution
- reroute wires after solver-resolved movement
- recompute visual DRC and camera fit
- return updated `SolverGateResult`

Exit criteria:

- student can drag a part and receive an adjusted, validated render plan
- invalid placements auto-snap or become review-only scenes
- no arbitrary coordinate mutation bypasses the solver
- response uses `status/resolutionKind`, not `accepted/blocked`

### Phase 5: Evidence Document and Regression Suite

Scope:

- capture real browser screenshots
- include before/after movement cases
- include all adjustment modes
- require nonblank canvas and metadata assertions

Exit criteria:

- Word document demonstrates actual app-rendered scenes
- E2E covers both build-ready and review-only visible simulations

## 11. LLM Usage Boundary

LLM is useful for:

- requirement analysis
- context retrieval orchestration
- generating or revising `CircuitSpec`
- explaining adjustments to students
- choosing safe equivalent intent when the original request is unsafe

LLM should not be used for:

- raw drag coordinate resolution
- collision detection
- breadboard snap
- wire routing geometry
- camera fitting
- whether a verified current path exists

Those must be deterministic tools.

## 12. Open Risks

- Dragging a breadboard-mounted part can invalidate row topology unless the solver owns the final placement.
- Visual-only movement could confuse students if the UI does not distinguish arrangement from hardware edit.
- Placeholder geometry may be mistaken as exact hardware unless visually distinct.
- Safe equivalents must preserve provenance to avoid claiming the unsafe original is buildable.
- State-only scenes must be visually strong enough; a tiny board rectangle is not sufficient evidence of pin-map or context rendering.
- Hardware edit mode can become slow if every pointer move calls the server. Use local preview and debounce server resolution.

## 13. Recommended First Implementation Slice

Start with Phase 1, then Phase 2 before any drag feature.

Reason:

- Phase 1 fixes the current conceptual mismatch: rule gates remain strict, but produce automatic simulation adjustments.
- Phase 2 creates the missing scene-graph unit of movement.
- Phase 3 can then add visual movement without risking hardware truth.
- Phase 4 can reuse the same interaction surface and replace visual transforms with solver-confirmed placement patches.

The first PR should therefore include:

- rule-gate adjustment contract migration
- `state_only` evidence calculation fix
- safe-equivalent and placeholder claim-scope metadata
- student-facing copy cleanup
- targeted unit and E2E tests

The second PR should include:

- stage scene graph refactor
- stage debug snapshot
- visual-only drag skeleton

The third PR should include:

- visual-only drag completion
- undo/reset
- browser screenshot evidence

The fourth PR should include:

- placement resolver module
- placement endpoint
- constraint-based drag and rerouting

## 14. Subagent Review Incorporation

Three `gpt-5.5` / `xhigh` subagent reviews were requested and incorporated.

Key accepted corrections:

- Add a part-level Three.js grouping layer before implementing drag.
- Keep visual-only preview wires separate from verified wire/current animation.
- Replace `accepted:boolean` with adjustment-oriented placement resolution status.
- Use `componentId`/render part id rather than ambiguous `partId` in placement intents.
- Add artifact/revision identity before server-side placement edits.
- Treat placeholder geometry as explicitly registered placeholder evidence, not ad hoc fallback geometry.
- Scope safe-equivalent build-ready claims to the displayed equivalent, never the unsafe original.
- Add browser-based evidence for all adjustment modes and object movement.
- Add a stage debug contract so E2E can prove movement, route changes, and claim invariants.
- Keep rule gates, but make them produce automatic simulation adjustments rather than hiding safe hardware scenes.
