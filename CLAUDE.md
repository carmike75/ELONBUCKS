# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This repo bundles **three independent projects** under one root. They do not share code, dependencies, or CI beyond what's noted below — orient by which one a task actually touches before assuming conventions carry over between them.

1. **`@solana/spl-token-registry`** (repo root: `src/`, `package.json`, `tsconfig*.json`) — the original project, a Solana SPL token metadata list + TypeScript client library. Per `README.md` this project is **EOL/archived upstream** (new tokens should go through Metaplex Fungible Token Metadata, not this JSON list) — but still treat task instructions as authoritative if asked to change it.
2. **`automerge/`** — a Go CLI tool run by a GitHub Actions cron job that auto-merges compliant token-list PRs.
3. **`jsystem-voice-agent/`** — an unrelated, self-contained Node/Express app: a bilingual (EN/JA) Claude-powered chat+voice widget for a bridge-inspection company. It has its own `package.json`, `tsconfig.json`, and a thorough `jsystem-voice-agent/README.md` describing its architecture and guardrails — read that directly rather than duplicating it here.

`DG PLANNER` at the repo root is ad hoc git push notes for this fork's remote, not part of any project's source.

## Commands

### Root TS package (`@solana/spl-token-registry`)

```bash
yarn                    # install
yarn build              # tsc -p tsconfig.json && tsc -p tsconfig.module.json (main + module builds)
yarn test               # build, then eslint + prettier --list-different + ava unit tests (via nyc)
yarn test:unit          # just the ava unit tests, with coverage instrumentation
yarn fix                # prettier --write + eslint --fix
yarn test:lint          # eslint src --ext .ts (no autofix)
yarn test:prettier      # prettier --list-different (check only)
```

Run a single test: ava supports `--match`, e.g. `npx ava src/lib/tokenlist.spec.ts --match "*duplicate*"`. There's only one spec file, `src/lib/tokenlist.spec.ts`.

Validating the token list data against its schema requires the `cue` CLI (`go install cuelang.org/go/cmd/cue@v0.4.0`), then:

```bash
./validate.sh    # cue vet src/tokens/solana.tokenlist.json automerge/schema.cue -d '#Tokenlist'
```

This is what `build.yml` runs in CI — if you edit `src/tokens/solana.tokenlist.json` or `automerge/schema.cue`, validate locally before pushing.

### `automerge/` (Go module, `go.mod` at `automerge/go.mod`)

```bash
cd automerge && go build -o ~/automerge github.com/solana-labs/token-list/automerge
go test ./...    # exercises automerge/parser/parser_test.go
```

### `jsystem-voice-agent/` (independent Node project)

```bash
cd jsystem-voice-agent
npm install
npm run dev      # tsx watch src/server.ts, http://localhost:3000
npm run build && npm start
```

## Architecture

### Token list library (`src/`)

- `src/tokens/solana.tokenlist.json` is the actual data: one large JSON file with a `tokens` array of `{chainId, address, name, decimals, symbol, logoURI?, tags?, extensions?}` entries. This is what gets published and what CI/schema validation guards.
- `src/lib/tokenlist.ts` is the whole library surface (re-exported by `src/index.ts`):
  - `TokenListProvider.resolve(strategy)` fetches the list via one of four `Strategy` values — `GitHub` (raw.githubusercontent.com), `CDN` (jsdelivr, the default), `Solana` (token-list.solana.com), or `Static` (the bundled JSON, also the fallback if a network fetch fails).
  - `TokenListContainer` wraps a resolved token array and supports chained, immutable filtering: `filterByTag`, `filterByChainId`/`excludeByChainId`, `excludeByTag`, `filterByClusterSlug` (via `CLUSTER_SLUGS`: `mainnet-beta`/`testnet`/`devnet` → `ENV` enum values).
- `src/types/` is currently an empty placeholder (`.keep` only).

### Schema validation and the automerge bot

- `automerge/schema.cue` defines the `#Tokenlist` CUE schema: address formats differ by chain (`#Base58Address` for Solana, `#EthAddress` for bridged tokens), and includes explicit `#SymbolWhitelist`/`#NameWhitelist` grandfather lists for existing entries that don't fit the strict naming rules. **New entries with a non-compliant name/symbol must be added to these whitelists in the schema, not worked around in code.**
- `automerge/automerge.go` is a CLI (not a long-running service), invoked hourly by `.github/workflows/automerge_new.yml`. It scans open PRs that modify `solana.tokenlist.json`, uses `automerge/parser/` to extract the diff's added token entries, validates them against the embedded CUE schema, and merges compliant PRs into an `automerge-pending` branch for later fast-forward into `main`. `automerge/auth/auth.go` handles the GitHub App authentication used for this.

### CI (`.github/workflows/`)

- `build.yml` — runs on PRs: `yarn test`, then installs `cue` and runs `validate.sh`.
- `main.yml` — runs on push to `main`; build/publish jobs are gated with `if: github.repository_owner == 'solana-labs'`, so on this fork the version-bump/npm-publish/CDN-purge steps are effectively no-ops.
- `automerge_new.yml` — hourly cron driving the automerge bot described above.
- `release.yml` — creates a GitHub Release on `v*` tags.
- `codeql_analysis.yml` — CodeQL scan on push/PR to `main` plus a weekly schedule.

## Conventions (root TS package)

- Prettier: single quotes. ESLint enforces `import/order` (alphabetized, blank line between groups) and `sort-imports` — keep import blocks sorted or `yarn fix`/`yarn test:lint` will flag it.
- `CHANGELOG.md` is generated by `standard-version` from Conventional Commits (`cz-conventional-changelog` is configured as the commitizen adapter) — don't hand-edit it.
