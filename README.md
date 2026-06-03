# H-eduware

An educational circuit-synthesis demo for students. A learner describes a circuit
in plain language; an AI agent interviews them briefly, builds an Arduino + I2C OLED
breadboard circuit, and renders it as an interactive 3D stage that can "run" the
simulation. Scope is intentionally narrow: **one polished Arduino + OLED breadboard
demo**, not a general circuit simulator.

## Stack

- **Frontend:** Vanilla JavaScript + [Vite](https://vite.dev) + [three.js](https://threejs.org)
  (no UI framework). DOM UI is plain JS in `src/`; the 3D stage is three.js
  (`src/stageScene.js`). three.js and the part-library browser are code-split and
  lazy-loaded so the initial bundle stays small.
- **Agent server:** TypeScript runtime under `server/` (LangChain / deepagents) exposing
  a small HTTP API for chat, placement, and circuit sharing. Default tests use **mocked**
  AI responses — no live OpenAI calls or secrets required.

## Layout

| Path | What |
|---|---|
| `src/` | Frontend (UI, i18n ko/en, 3D stage, share flow) |
| `server/` | Agent runtime (`agent/`, layered-context `context/`, `qa/`, `share/`) |
| `Spec/` | Binding product + design-system specs (source of truth) |
| `docs/` | Living reference docs, plans (`docs/plans/`), and audits (`docs/audit/`) |
| `tests/` | `unit/` (node:test / tsx) and `e2e/` (Playwright) |

See `AGENTS.md` for the agent/contributor contract and `docs/README.md` for the docs index.

## Develop (two processes)

The app talks to the agent server, so run both:

```bash
npm install

# Terminal 1 — frontend dev server (Vite)
npm run dev            # http://127.0.0.1:5173 (or 4173 in the e2e harness)

# Terminal 2 — agent server
npm run agent:dev      # http://127.0.0.1:8787
```

A temporary local API key (for live agent mode) belongs in an explicit local-only
config path — never commit real keys. Default development and tests run against mocked
responses.

## Verify

`npm run check` is the acceptance gate and must pass before shipping:

```bash
npm run check          # unit tests + typecheck + production build + Playwright e2e
```

Individual gates:

```bash
npm test               # unit tests (mocked AI)
npm run typecheck      # tsc --noEmit
npm run build          # vite production build
npm run test:e2e       # Playwright (boots dev + agent servers; non-blank 3D canvas check)
npm run lint           # ESLint (JS/TS)
npm run lint:css       # stylelint (CSS custom-property safety)
npm run format         # Prettier (write)
npm run audit:security # npm audit, fails on high/critical
```

> The e2e suite verifies the full demo path — vague student prompt → AI follow-up →
> confirm → requirement document → 3D breadboard → Run showing OLED text — including a
> canvas pixel check so a blank 3D stage cannot pass.
