# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status: archived / EOL

This is a fork of `solana-labs/token-list`. **The upstream project is archived and read-only as of June 20** — new token metadata now flows through Metaplex Fungible Token Metadata (see `README.md`), not this repo. Treat the token-list portion (`src/`, `assets/`, `automerge/`) as legacy/frozen unless the user explicitly asks to work on it. Two unrelated projects have since been added on top of the fork: `jsystem-voice-agent/` (an active Node/TypeScript app) and `DG PLANNER` (a plain-text note with git push instructions, not code).

This repo therefore contains three independent, unconnected codebases. Check which one a task is about before assuming shared tooling/conventions.

## 1. Token list package (`src/`) — TypeScript, npm package `@solana/spl-token-registry`

A tiny library that fetches/filters the Solana token list. Entry point `src/index.ts` re-exports everything from `src/lib/tokenlist.ts`.

- `src/lib/tokenlist.ts` — all the logic: `TokenListProvider` resolves a token list via one of four `Strategy` values (`GitHub`, `CDN`, `Solana`, `Static`); `TokenListContainer` provides chainable, immutable filters (`filterByTag`, `filterByChainId`, `excludeByChainId`, `excludeByTag`, `filterByClusterSlug`). Every filter method returns a **new** `TokenListContainer` rather than mutating.
- `src/tokens/solana.tokenlist.json` — the actual data file (~13.6k token entries). This is the file all the validation tooling below exists to protect; it is not meant to be built or generated, only appended to.
- `assets/mainnet/<address>/logo.*` — per-token logo images (~11.3k), referenced by `logoURI` in the JSON, one directory per base58 mint address.

### Commands (run from repo root; package manager is **yarn**, matches `yarn.lock` and CI)

```bash
yarn                    # install deps
yarn build              # tsc -p tsconfig.json && tsc -p tsconfig.module.json (CJS + ESM output to dist/)
yarn test               # build + lint + prettier check + unit tests (what CI runs)
yarn test:unit          # ava unit tests only (src/lib/tokenlist.spec.ts), via nyc for coverage
yarn test:lint          # eslint src --ext .ts
yarn test:prettier      # prettier --list-different (check only, no write)
yarn fix                # fix:prettier + fix:lint (auto-format and auto-fix lint issues)
yarn watch:test         # ava --watch
```

To run a single test: ava doesn't have a first-class CLI test-name filter wired into package.json, so either use `npx ava src/lib/tokenlist.spec.ts` (after `yarn build`, since ava's `rewritePaths` config runs compiled output from `dist/main/`) or temporarily use ava's `.only` modifier on the test in question.

### Validating `solana.tokenlist.json` against the schema

```bash
go install cuelang.org/go/cmd/cue@v0.4.0   # one-time
./validate.sh                              # cue vet against automerge/schema.cue's #Tokenlist definition
```
This is what CI (`build.yml`) runs after `yarn test`, and is the authoritative structural check for the token list — not the TypeScript types in `tokenlist.ts`, which are looser.

### Conventions
- Imports: `import/order` (grouped, alphabetized, blank line between groups) and `sort-imports` are enforced by ESLint — run `yarn fix` rather than hand-ordering imports.
- Prettier: single quotes, otherwise defaults; enforced by `test:prettier`, applied by `fix:prettier`.
- `TokenListContainer` methods must stay pure/immutable (return new containers) — this is relied on by tests like "Token list returns new object upon filter".

## 2. `automerge/` — Go service that auto-merges token-list PRs

Not part of the npm package; it's a standalone Go module (`go 1.17`, own `go.mod`/`go.sum`) that runs as a scheduled GitHub Action (`.github/workflows/automerge_new.yml`, hourly cron) against `solana-labs/token-list` specifically (hardcoded owner/repo in `main()`).

- `automerge.go` — the `Automerger`: lists open PRs, restricts each PR's diff to `assets/mainnet/**` (new files only) + `src/tokens/solana.tokenlist.json`, extracts only the **added** lines from the tokenlist diff (any removed/modified line fails the PR outright — this tool only ever appends tokens, never edits/deletes them), parses those added lines with `parser.NormalizeWhatever`, validates each token against the CUE schema, checks for duplicate/blacklisted tokens, verifies `logoURI`/website/coingeckoId/twitter fields with live HEAD requests, then commits the merged tokenlist to a local in-memory clone (`go-git` + `memfs`) and pushes to the `automerge-pending` branch. Reports success/failure back to the PR via GitHub check runs and `automerge`/`automerge-error` labels.
- `parser/parser.go` (`NormalizeWhatever`) — a deliberately forgiving parser ("A wild custom JSON parser appears. May the gods have mercy!") that takes a raw diff hunk's added lines (which form a syntactically incomplete JSON fragment) and reconstructs valid JSON by tracking brace/bracket balance, patching trailing commas, and falling back to `hujson` for lenient parsing. This is intentionally hacky — don't over-refactor without understanding the diff shapes it needs to survive.
- `schema.cue` — the CUE schema (`#TokenInfo`, `#Tokenlist`, `#StrictTokenInfo`) that both `validate.sh` and the automerge Go binary validate against. `#StrictTokenInfo` (used only for new tokens via automerge) additionally requires `logoURI` to be set, unlike full-file validation. Contains grandfathered whitelists (`#SymbolWhitelist`, `#NameWhitelist`) for legacy entries that don't match the general regex rules — new entries should conform to the regexes, not be added to the whitelists.
- `auth/auth.go` — GitHub App installation-token auth, used when `GITHUB_APP_PEM` is set instead of `GITHUB_TOKEN`.

Build/run: `cd automerge && go build -o ~/automerge github.com/solana-labs/token-list/automerge`, then `~/automerge -dryRun -v=1` locally (requires `GITHUB_TOKEN` or `GITHUB_APP_PEM` env var; talks to the real GitHub API, so always pass `-dryRun` unless you intend to mutate the live repo). Tests: `cd automerge && go test ./...` (only `parser/parser_test.go` currently exists).

## 3. `jsystem-voice-agent/` — bilingual (EN/JA) AI chat+voice widget

Fully independent Node/TypeScript/Express app, unrelated to the token list. Built for Giken Kaihatsu's "J System" bridge-inspection product; see `jsystem-voice-agent/README.md` for full details. Key points:

- **Package manager here is npm**, not yarn (own `package.json`, no lockfile checked in for this subdir at time of writing) — don't run root `yarn` commands expecting them to touch this directory.
- Architecture: browser (`public/index.html` + `app.js`, using Web Speech API for STT/TTS) → `POST /api/chat` on the Express server (`src/server.ts`) → Anthropic Messages API. The system prompt (`src/systemPrompt.ts`) is rebuilt once at server startup from `knowledge/jsystem-knowledge.json` via `src/knowledge.ts`, and is re-sent in full on every request (no RAG/retrieval — the knowledge base is small enough to fit in context).
- Guardrails live in `systemPrompt.ts`: the model is scope-locked to J System topics, instructed to resist prompt-injection/instruction-disclosure attempts, and told to admit when a fact isn't in the knowledge base rather than inventing one. Preserve this scope lock when editing the prompt.
- To add/correct facts, edit `knowledge/jsystem-knowledge.json` only (bilingual `_en`/`_ja` field pairs) — `knowledge.ts` flattens it automatically; no other file needs to change.
- Commands (run from `jsystem-voice-agent/`):
  ```bash
  npm install
  cp .env.example .env      # set ANTHROPIC_API_KEY
  npm run dev                # tsx watch src/server.ts — http://localhost:3000
  npm run build               # tsc -p tsconfig.json
  npm start                   # node dist/server.js (after build)
  ```
- No test suite in this subdirectory currently.
- Server-side input caps in `server.ts` (`MAX_HISTORY_MESSAGES = 20`, 4000-char message limit) exist to bound request size to the Anthropic API — preserve them if touching `/api/chat`.

## Root CI (GitHub Actions)

- `.github/workflows/build.yml` (PRs): `yarn` → `yarn test` → install `cue` → `./validate.sh`. This is the full gate for the token-list package; it does not touch `jsystem-voice-agent/`.
- `.github/workflows/main.yml` (push to `main`, gated to `github.repository_owner == 'solana-labs'`): builds, publishes `@solana/spl-token-registry` to npm, bumps patch version, purges the jsDelivr CDN cache. This will not run for forks (the owner check fails), which is expected here.
- `.github/workflows/automerge_new.yml`: builds and runs the `automerge/` Go binary hourly against `solana-labs/token-list`; also fork-irrelevant unless repointed.
