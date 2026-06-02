<claude-mem-context>
# Memory Context

# [SourceCode] recent context, 2026-06-01 10:42am GMT+9

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (20,787t read) | 1,001,712t work | 98% savings

### May 31, 2026
S214 Circuit inspector and tutor agent feature implementation (completed with full validation); transitioning to general chat integration with server agent API as primary path with fallback support (May 31, 9:12 AM)
S213 Implement Circuit Inspector + Tutor Agent feature for H-eduware: Complete Phase 1 (Inspection Catalog) with comprehensive plan document and code implementation (May 31, 9:12 AM)
S215 Analyze the entire application codebase and plan improvements using subagents if needed. Claude identified a 3-part change scope for enhancing agent API integration. (May 31, 12:00 PM)
S216 Comprehensive codebase analysis of the application with full subagent utilization (5.5XHIGH) authorized. (May 31, 12:03 PM)
S217 Set up and verify H-eduware development environment with OpenAI agent integration on ports 8787 (agent) and 4173 (frontend) (May 31, 12:04 PM)
S218 Analyze entire H-eduware app codebase using subagents (5.5xHIGH); add RED tests for primitive contracts, validation leak prevention, and path kind overlay styles (May 31, 12:42 PM)
S220 Comprehensive H-eduware codebase analysis focusing on Slice 38 (Invalid Shared Import Render Guard) implementation and validation boundary closure across all external surfaces; final architectural verification (May 31, 6:50 PM)
### Jun 1, 2026
5053 8:18a 🔵 H-eduware codebase features deterministic context validation pipeline with browser verification gates
5054 " 🟣 Public circuit sharing MVP implemented with snapshot projection, server storage, and read-only share view
5055 " 🟣 Simulation workspace reorganized: floating cards removed, hardware panel separated from tutor chat drawer, keyboard focus restored on close
5056 8:25a ✅ Full app acceptance gate passes after chat drawer focus restoration implementation
5057 8:35a 🔵 H-eduware Agent Architecture: Deep Agent Tools and Context System
5058 " 🔵 Six-Stage Subagent Orchestration for Circuit Design Synthesis
5059 8:36a 🔵 Part Search Tool Scoped to Context-Packet Candidate Parts
5060 " 🔴 Test Reveals search_part_capabilities Tool Does Not Respect candidateParts Boundary
5061 " 🔴 Implement Context-Bound Part Search Filtering in deepAgentTools
5062 8:37a ✅ Wire Context Packet candidateParts to Agent Tool Options
5063 " ✅ Remove Unused ContextCoverageReport Import from deepAgentRuntime
5064 " 🔴 Part Search Filtering Partially Works—OLED Still Returns Results
5065 8:38a 🔵 LED Matches OLED Search via Substring Scoring Logic
5066 " 🔴 Context-Bound Part Search Filter Now Working—All Tests Pass
5067 " ✅ Add TypeScript Type Annotations to Part Search Test
5068 " ✅ TypeScript Type Checking Now Passes
5069 8:41a ✅ Full Test Suite and Build Validation Passes
5070 " ✅ Agent Server Restarted with Context-Bound Filtering Code
5071 8:42a 🟣 Candidate Part Allowlist Gate for Circuit Draft Validation
5072 " 🔵 Three-Layer Deepagents Context-Boundary Enforcement
5073 " ✅ Part Search Scoring Tightened to Avoid Substring Collisions
5074 8:55a ✅ Full Test Suite Passing: Three-Layer Deepagents Context Guardrails Complete
5075 8:56a ✅ Agent Server Restarted with Fresh Source Status
5076 8:57a ✅ Context-Validation Deepagents Workflow Fully Documented and Completed
5077 " 🔵 All Implementation Artifacts Verified in Place
5078 " ⚖️ Extended Coverage: Candidate-Part Gate for Compile Tools
5079 " 🔵 Detect Faults Tool Missing Candidate-Part Gate
5080 8:58a 🔵 Underlying detectFaults Function Already Validates Spec
5081 " 🔵 Detect Faults Implementation Detail: Early Return on Invalid Specs
5082 " 🔵 RED Test Confirms Detect Faults Tool Missing Candidate-Part Gate
5085 9:14a 🔵 build_netlist context-boundary validation gap identified
5086 9:15a ✅ RED test added for build_netlist validation gate
5087 " 🔵 RED test confirms build_netlist validation gate not yet implemented
5088 9:16a 🟣 build_netlist tool implements validation gate before exposing netlist
5089 " 🔴 build_netlist validation gate implemented and verified GREEN
5090 " ✅ TypeScript compilation verified clean
5091 9:19a 🔵 Full test suite passes including build_netlist validation gate verification
5092 " ✅ Implementation slice documented: Validation-gated netlist tool
5093 " ✅ Work documented in coworking handoff memo
5094 " 🔵 Agent server restarted with validation-gated netlist code
5095 " 🔵 Implementation work completed and verified end-to-end
5096 9:20a ⚖️ Next iteration planned: additional context/validation gap remediation
5097 9:21a 🔵 Tool surface audit in progress: examining validation boundaries
5098 " 🔵 Capability promotion and support-level infrastructure audit completed
5099 " 🔵 Context layer validation infrastructure thoroughly mapped
5100 " 🔵 Comprehensive system audit completed; next validation boundary identified
5194 10:15a ⚖️ Context Layer Source Bundle Collection Architecture Plan Created
5195 10:18a 🟣 Implementation Plan Created: Context Layer Source Bundle Collection
S221 Comprehensive codebase analysis of H-eduware educational circuit synthesis app with full test/build verification and GitHub deployment (Jun 1, 10:29 AM)
5199 10:36a ⚖️ Agent Context v2 Bundle-First Architecture Plan Created
5200 10:40a ✅ Agent Context v2 Plan Enhanced with Source-of-Truth Separation and Bloat Control Rules

Access 1002k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>

# H-eduware Agent Instructions

## Source of truth

- Treat `Spec/H-eduware_master_statement.md` as binding product scope.
- Treat `Spec/H-eduware_design_system.md` as binding visual and interaction language.
- Treat `Spec/flux_ai_ui_ux_analysis.md` as the layout reference only.
- For the current Context Layer architecture (single v2 router, L0 part bundles → L2 topology composition → L3 capability bundles, v1 removed), use `docs/plans/PLAN_layered_context_architecture.md` and its adversarial review `docs/plans/REVIEW_layered_context_architecture_2026-06-02.md`.
- Keep the hackathon boundary: one polished Arduino + I2C OLED breadboard demo, not a general circuit simulator.

## Documentation map

- See `docs/README.md` for the index of living reference documents (observability,
  Deepagents architecture anchor, Korean UX copy guide, solver-gate design) and the
  active plans under `docs/plans/`.
- Keep additions focused on what changed, why it changed, where the relevant files are,
  and how to verify the work. Update the living reference docs in place instead of adding
  dated snapshots unless the user explicitly asks for one.

## Stack

- Use Vanilla JavaScript, Vite, and three.js.
- Keep DOM UI state in plain JavaScript.
- Keep 3D stage code in three.js.
- Do not add a frontend framework unless the spec changes.

## Harness contract

Default verification must not depend on live OpenAI calls or secrets.

Required commands:

```powershell
npm install
npm test
npm run build
npm run test:e2e
npm run check
```

`npm run check` is the acceptance gate for goal-mode work. It must run unit tests, production build, and Playwright e2e tests.

## Test expectations

- Unit tests cover circuit metadata: parts, pins, legal connections, educational floating-card copy, and demo text.
- Playwright e2e covers the demo-day path:
  - student enters a vague request,
  - AI asks a simple follow-up,
  - student confirms,
  - Files tab shows the readable requirement document,
  - PCB tab shows breadboard, Arduino, OLED, jumper wires, and floating cards,
  - Run displays the OLED demo text.
- E2E must include a canvas pixel/screenshot check so a blank 3D stage cannot pass.
- Mocked or cached AI responses are required in default tests. Live API smoke tests, if added later, must be opt-in.

## Security notes

- Do not commit real API keys.
- If a stage demo needs a temporary hardcoded key, isolate it behind an explicit local-only config path and keep the automated harness on mocked responses.
- Never print secrets in logs, tests, screenshots, or e2e traces.

## Goal handoff

For `/goal` or OMX work, use this acceptance wording:

```text
Build H-eduware from Spec/*.md as a Vanilla JS + three.js Vite app.
Acceptance harness: npm install, npm test, npm run build, npm run test:e2e, and npm run check must pass.
Default tests use mocked/cached AI responses, not live OpenAI calls.
E2E must verify the full demo path from vague student prompt to Run showing OLED text, including nonblank 3D canvas evidence.
```
