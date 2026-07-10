# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This repo is a fork of `solana-labs/token-list`, the (now-archived/EOL — see the banner in `README.md`) registry of SPL token metadata published as the npm package `@solana/spl-token-registry`. It contains two unrelated projects living side by side:

1. **`@solana/spl-token-registry`** (repo root: `src/`, `automerge/`) — the original TypeScript library + Go-based PR automerge bot that maintains `src/tokens/solana.tokenlist.json`, the canonical list of Solana token metadata.
2. **`jsystem-voice-agent/`** — a standalone Node/Express + Anthropic API bilingual (EN/JA) voice/chat widget for an unrelated product (Giken Kaihatsu's "J System" bridge inspection tech). It has its own `package.json`, `tsconfig.json`, and dev workflow, and does not depend on or interact with the token-list code.

Treat these as two independent codebases sharing a git history. Do not assume a change in one affects the other, and don't try to unify their tooling.

## Project 1: `@solana/spl-token-registry` (repo root)

### Commands

Run from the repo root with `yarn` (Node 12 is what CI uses; `engines.node >= 10`):

```bash
yarn                      # install deps
yarn build                # compile both CJS (dist/main) and ESM (dist/module) via tsconfig.json / tsconfig.module.json
yarn test                 # build + lint + prettier check + unit tests (what CI runs)
yarn test:unit            # run the ava test suite only (src/lib/tokenlist.spec.ts), via nyc for coverage
yarn watch:test           # ava in watch mode
yarn fix                  # yarn fix:prettier + yarn fix:lint (auto-fix formatting/lint issues)
yarn test:lint            # eslint src --ext .ts (no fix)
yarn test:prettier        # prettier --list-different (no write)
```

Run a single test: ava doesn't have a first-class "run one file" yarn script wired up, but you can invoke it directly, e.g. `npx ava dist/main/lib/tokenlist.spec.js` (tests run against the compiled `dist/main` output per the `ava.typescript.rewritePaths` config in `package.json`, so `yarn build` must run first — `yarn test:unit` does this via `run-s build test:unit`... actually `test:unit` alone assumes a prior build, so prefer `yarn test` or `yarn build && yarn test:unit` when iterating).

### Validating the token list itself

`src/tokens/solana.tokenlist.json` is validated against a CUE schema (`automerge/schema.cue`), not just JSON-parsed:

```bash
./validate.sh   # requires the `cue` CLI (cuelang.org/go/cmd/cue) on PATH; run by CI (.github/workflows/build.yml)
```

### Architecture

- `src/index.ts` — public entry point, re-exports everything from `src/lib/tokenlist.ts`.
- `src/lib/tokenlist.ts` — the entire library:
  - `TokenInfo` / `TokenList` / `TokenExtensions` — the data model for a token entry.
  - Resolution strategies (`GitHubTokenListResolutionStrategy`, `CDNTokenListResolutionStrategy`, `SolanaTokenListResolutionStrategy`, `StaticTokenListResolutionStrategy`) — each fetches `solana.tokenlist.json` from a different source (raw GitHub, jsDelivr CDN, `token-list.solana.com`, or the bundled static JSON), falling back to the static bundled copy on fetch failure.
  - `TokenListProvider.resolve(strategy)` — picks a strategy (defaults to CDN) and returns a `TokenListContainer`.
  - `TokenListContainer` — immutable-style filtering API (`filterByTag`, `filterByChainId`, `excludeByChainId`, `excludeByTag`, `filterByClusterSlug`, `getList`) — every filter returns a *new* container.
- `src/tokens/solana.tokenlist.json` — the actual data file (~185K lines). This is the thing PRs to the upstream repo almost always modify; it's compiled into the package as the static fallback.
- Build emits two module formats: `dist/main` (CommonJS, `tsconfig.json`) and `dist/module` (ESM, `tsconfig.module.json`, which extends the main config).

### The automerge bot (`automerge/`, Go)

A separate Go program (module `github.com/solana-labs/token-list/automerge`) that runs on a cron (`.github/workflows/automerge_new.yml`, hourly) against the upstream `solana-labs/token-list` repo, not this fork. It processes open PRs labeled for automerge:

- `automerge/automerge.go` — main logic: fetches each open PR's diff, restricts it to only touching `src/tokens/solana.tokenlist.json` and new files under `assets/mainnet/<address>/*`, extracts *added* JSON lines from the diff (any removed/modified line fails the PR), parses them into token entries (`automerge/parser`), validates each against the CUE schema (`#StrictTokenInfo` in `schema.cue`, which additionally requires `logoURI`), checks for duplicate addresses/names, verifies external URLs (logo, website, CoinGecko ID) with HEAD requests, then commits the merged tokenlist to a working branch and eventually merges to `main`. Reports pass/fail back to the PR via GitHub check runs and `automerge` / `automerge-error` labels.
- `automerge/schema.cue` — the CUE schema for a valid token entry (address format, name/symbol character rules, extension URL patterns, plus explicit "grandfathered" whitelists for legacy non-conforming names/symbols). This is the source of truth for what a valid token list entry looks like — check it before changing token metadata shape.
- `automerge/parser/` — parses raw JSON token entries out of a diff hunk into the internal `Token` struct.
- `automerge/auth/` — GitHub App installation-token auth helper.

If you're asked to add/modify entries in `solana.tokenlist.json`, validate against `schema.cue` (via `validate.sh`) — this is what actually gates merges upstream.

### Conventions

- Formatting/linting: Prettier (single quotes) + ESLint (`@typescript-eslint`, `import/order` enforced alphabetized with newlines between groups, `sort-imports` for named imports). Run `yarn fix` before committing.
- Commits use `commitizen`/`cz-conventional-changelog` (see `config.commitizen` in `package.json`) and `standard-version` drives `CHANGELOG.md` + version bumps on release — don't hand-edit `CHANGELOG.md` or the `version` field.
- `.github/workflows/main.yml` (push to `main`) and `.github/workflows/release.yml` publish to npm; both are gated to `github.repository_owner == 'solana-labs'`, so they're inert on this fork.

## Project 2: `jsystem-voice-agent/`

Independent Node/Express app. All commands run from inside `jsystem-voice-agent/`:

```bash
cd jsystem-voice-agent
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY
npm run dev            # tsx watch src/server.ts — http://localhost:3000, hot reload
npm run build           # tsc -p tsconfig.json -> dist/
npm start                # node dist/server.js (run build first)
```

No test suite or lint config is defined for this subproject.

### Architecture

```
Browser (public/)             Node/Express (src/)                 Anthropic API
index.html / app.js   --->    POST /api/chat                --->  Claude
 - chat UI                     - loads system prompt +             (model from
 - mic (Web Speech STT)          knowledge base                     ANTHROPIC_MODEL,
 - speech (TTS)        <---     - forwards conversation      <---   default claude-sonnet-5)
 - EN/JA toggle                   history
```

- `src/systemPrompt.ts` — builds the system prompt that scope-locks the model to J System / bridge-inspection topics only, instructs it to refuse off-topic questions and resist prompt-injection attempts to reveal instructions or the raw knowledge file, and to respond in whichever language (EN/JA) the user used.
- `src/knowledge.ts` — flattens `knowledge/jsystem-knowledge.json` (bilingual `_en`/`_ja` fact pairs transcribed from the official product brochure) into a text block injected into the system prompt on every request. There is no retrieval/embedding step — the whole knowledge base fits in context. If it outgrows that, swap the flattening call for retrieval without touching `systemPrompt.ts`'s guardrails.
- `src/server.ts` — Express server: serves `public/` as static assets, exposes `POST /api/chat` (`{ message, history } -> { reply }`, transport-agnostic by design so it could sit behind a telephony bridge later) and `GET /api/health`. Caps message length (4000 chars) and history length (`MAX_HISTORY_MESSAGES = 20`) server-side before calling `anthropic.messages.create`.
- `public/` — the frontend widget itself (chat bubble + mic button using the browser's `SpeechRecognition`/`SpeechSynthesis` APIs). Voice input/output only works well in Chrome/Edge; other browsers degrade to text-only chat.

### Conventions / guardrails to preserve when editing this subproject

- **Knowledge is the only source of truth.** New facts go into `knowledge/jsystem-knowledge.json` as sourced `_en`/`_ja` pairs from official Giken Kaihatsu material — never invent facts in `systemPrompt.ts` or elsewhere.
- **Don't loosen the scope guard or anti-injection instructions** in `systemPrompt.ts` without being asked to — they're the point of this app (it must never answer outside J System topics or leak its instructions/knowledge file verbatim).
- **Don't remove the server-side input caps** in `server.ts` (message length, history length) — they bound request size/cost.
- Model default is `claude-sonnet-5`; keep the `ANTHROPIC_MODEL` env override.
