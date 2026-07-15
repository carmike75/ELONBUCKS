# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This repo is a fork of `solana-labs/token-list` (npm package `@solana/spl-token-registry`), archived/EOL upstream, that now also hosts two unrelated bolted-on subprojects. Treat it as three independent codebases sharing one repo root:

1. **Root (TypeScript)** — the `@solana/spl-token-registry` npm package: a static registry of Solana SPL token metadata (`src/tokens/solana.tokenlist.json`) plus a small client library (`src/lib/tokenlist.ts`) for resolving/filtering it.
2. **`automerge/` (Go)** — a bot that validates and auto-merges community PRs adding tokens to `src/tokens/solana.tokenlist.json`.
3. **`jsystem-voice-agent/` (Node/Express/TypeScript)** — a standalone, unrelated bilingual (EN/JA) AI chat+voice widget for a bridge-inspection company, powered by the Anthropic API. It does not depend on and is not depended on by the other two.

Note: `README.md` states the upstream project is EOL as of June 20 and points contributors to external tools (Strata Protocol Launchpad, Token Creator Demo) and Metaplex Fungible Token Metadata for adding new tokens instead of PRs to this list.

## 1. Root package (`@solana/spl-token-registry`)

### Commands

```bash
yarn                    # install deps
yarn build              # tsc -p tsconfig.json && tsc -p tsconfig.module.json (CJS + ESM output to dist/)
yarn test               # build + lint + prettier check + unit tests
yarn test:unit          # nyc + ava unit tests only (src/**/*.spec.ts)
yarn fix                # prettier --write + eslint --fix
yarn test:lint          # eslint src --ext .ts
yarn test:prettier      # prettier --list-different
```

Run a single test with ava directly, e.g.:
```bash
npx ava dist/main/lib/tokenlist.spec.js   # ava runs against built output; rewritePaths maps src/ -> dist/main/ (see package.json "ava" config)
```
Since `test:unit` depends on the TS build, run `yarn build` first if testing ad hoc.

### Structure

- `src/tokens/solana.tokenlist.json` — the actual token list data (chainId, address, name, decimals, symbol, logoURI, tags, extensions). This is the artifact PRs modify; also the file `automerge/` and `validate.sh` validate.
- `src/lib/tokenlist.ts` — `TokenListProvider` with pluggable resolution `Strategy` (`GitHub`, `CDN`, `Solana`, `Static`) that fetches (or falls back to the bundled static) token list, and `TokenListContainer` for filtering by tag/chainId.
- `src/index.ts` — re-exports `./lib/tokenlist`.
- `assets/mainnet/<token-address>/logo.png` — per-token logo assets referenced by `logoURI` in the tokenlist JSON.
- Package builds dual CJS (`tsconfig.json` → `dist/main`) and ESM (`tsconfig.module.json` → `dist/module`).

### Conventions

- Prettier: `singleQuote: true`. ESLint enforces import ordering (`import/order`, alphabetized, newline between groups) and `sort-imports`.
- Tests use `ava` (not jest/mocha) with `t.true`/`t.false`/`t.throwsAsync` assertions; spec files live next to source as `*.spec.ts`.
- `yarn test:unit` requires 100%-adjacent coverage config (`nyc` extends `@istanbuljs/nyc-config-typescript`) — see `yarn cov:check`.
- `yarn version --patch` + `git push --follow-tags` + `npm publish` happens automatically on merge to `main` via `.github/workflows/main.yml` (gated to `github.repository_owner == 'solana-labs'`, so it's a no-op in this fork).

## 2. `automerge/` (Go)

A bot (`cmd main.go` at `automerge/automerge.go`) that:
1. Fetches open PRs against the repo, parses each PR's diff.
2. Rejects PRs that touch anything other than new files under `assets/mainnet/<address>/*.{png,jpg,svg}` or additions to `src/tokens/solana.tokenlist.json` (deletions/modifications of existing lines are rejected).
3. Repairs/parses the added JSON fragment with a lenient custom parser (`automerge/parser/parser.go`, `NormalizeWhatever`) since PR diffs are often malformed/truncated JSON.
4. Validates each new token against a CUE schema (`automerge/schema.cue`, the `#StrictTokenInfo` definition) — this is the canonical schema for `TokenInfo` shape, including regex constraints on `name`/`symbol` and whitelisted legacy exceptions (`#NameWhitelist`, `#SymbolWhitelist`).
5. Does live verification: HEAD-requests `website`/`logoURI`/CoinGecko URLs, downloads and size-checks (<200 KiB) new logo assets from the PR branch.
6. On success, commits the merged tokenlist to a local in-memory git worktree and pushes to `automerge-pending`; sets GitHub check-run status (`automerge` / `automerge-error` labels) on the PR.
7. Auth: either `GITHUB_TOKEN` env var, or a GitHub App installation token derived from `GITHUB_APP_PEM` (`automerge/auth/auth.go`, JWT signed with the app's private key, `appId = 152533`).

Driven by `.github/workflows/automerge_new.yml` on an hourly cron: builds the binary, runs it against `origin`, then fast-forward-merges `automerge-pending` into `main` and pushes using the GitHub App's token (bypasses branch protection triggering issues with `GITHUB_TOKEN`).

### Commands

```bash
cd automerge
go build -o ~/automerge github.com/solana-labs/token-list/automerge
GITHUB_TOKEN=... ~/automerge -dryRun -max=5   # dry run against a handful of PRs
go test ./...                                  # parser_test.go covers NormalizeWhatever edge cases
```

Schema validation for the whole list (also run in CI, `.github/workflows/build.yml`) via `validate.sh`:
```bash
go install cuelang.org/go/cmd/cue@v0.4.0
./validate.sh   # cue vet src/tokens/solana.tokenlist.json automerge/schema.cue -d '#Tokenlist'
```

**`automerge/schema.cue` is the source of truth for what a valid `TokenInfo` entry looks like** — check it before hand-editing `solana.tokenlist.json` or changing the TS `TokenInfo` interface in `src/lib/tokenlist.ts`, since the two are meant to describe the same shape (the CUE schema is stricter/more current; the TS interface is the consumer-facing surface and doesn't include the CUE regex/whitelist constraints).

## 3. `jsystem-voice-agent/` (unrelated subproject)

A standalone bilingual (EN/JA) chat+voice widget for Giken Kaihatsu's "J System" bridge infrared-inspection product, backed by the Anthropic Messages API. Fully independent of the token-list code — has its own `package.json`, `tsconfig.json`, and `.env`.

### Commands

```bash
cd jsystem-voice-agent
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY
npm run dev             # tsx watch src/server.ts, http://localhost:3000
npm run build            # tsc -p tsconfig.json
npm start                # node dist/server.js (after build)
```

### Architecture

- `src/server.ts` — Express app; single `POST /api/chat` endpoint that forwards `{message, history}` to `anthropic.messages.create` with a system prompt built by `buildSystemPrompt()`, and a `GET /api/health` check. Input is bounded server-side (message ≤4000 chars, history capped to last 20 messages).
- `src/systemPrompt.ts` — builds the system prompt that scope-locks the model to J System topics only and instructs it to resist prompt-injection attempts to reveal the system prompt or raw knowledge file.
- `src/knowledge.ts` — flattens `knowledge/jsystem-knowledge.json` (bilingual `_en`/`_ja` fact pairs transcribed from the official product brochure) into the text block injected into the system prompt on every request; there is no retrieval step because the brochure is small enough for full context.
- `public/` — static frontend (chat UI + Web Speech API mic/TTS), served by Express from `dist`-adjacent `public/`.
- Model defaults to `claude-sonnet-5`, overridable via `ANTHROPIC_MODEL`.

To add/correct facts, edit `knowledge/jsystem-knowledge.json` directly (sourced from official Giken Kaihatsu material only) — no other code changes needed. Keep `systemPrompt.ts`'s guardrails intact when modifying prompt logic.

## Cross-cutting notes

- Root TS project and `jsystem-voice-agent` each have their own `package.json`/lockfile — don't run root `yarn` commands expecting them to affect `jsystem-voice-agent`, or vice versa.
- `.github/workflows/build.yml` (PR CI) runs both the Node test suite and the Go/CUE schema validation (`validate.sh`) — a change to `solana.tokenlist.json` must pass CUE validation, not just be valid JSON.
- Spell-checking is configured via `.cspell.json` at the repo root.
