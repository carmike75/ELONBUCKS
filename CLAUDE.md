# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status: EOL

This repo (`@solana/spl-token-registry`) is **archived / read-only as of June 20**, per `DG PLANNER` (the repo's actual README content — see below). New Solana token metadata now goes through Metaplex Fungible Token Metadata (via the Strata Protocol Launchpad or Token Creator Demo), not this repository. Do not add new tokens to `src/tokens/solana.tokenlist.json` in the expectation that they'll be consumed on-chain — only the legacy `TokenListProvider` API here still works for existing consumers.

Note: `README.md` in the working tree currently contains generic solana-labs boilerplate; the file named `DG PLANNER` at the repo root actually holds the real, current README content (EOL notice, new-token instructions, the `TokenListProvider`/`TokenListContainer` usage examples, and the legal disclaimer). Treat `DG PLANNER` as authoritative over `README.md` until they're reconciled.

## What this repo is

Two independent pieces living in one repo:

1. **`@solana/spl-token-registry`** (TypeScript, `src/`) — a tiny npm package that fetches/serves a list of Solana SPL token metadata (`src/tokens/solana.tokenlist.json`) and exposes filtering helpers.
2. **`automerge`** (Go, `automerge/`) — a standalone GitHub bot/CLI, built and deployed independently of the npm package, that validates and auto-merges community PRs which add entries to `solana.tokenlist.json`.

These have separate build systems (yarn/tsc vs. go modules) and are not linked at build time — the Go program only reads the JSON file and the CUE schema at runtime/embed time.

## Commands

### TypeScript package (root)

```bash
yarn                    # install deps
yarn build              # tsc -p tsconfig.json && tsc -p tsconfig.module.json (via build:main/build:module)
yarn test               # build + lint + prettier check + unit tests (run-s build test:*)
yarn test:unit          # ava unit tests only (compiled output in dist/main, per ava config in package.json)
yarn test:lint          # eslint src --ext .ts
yarn test:prettier      # prettier check, no write
yarn fix                # fix:prettier + fix:lint (auto-format and autofix lint issues)
yarn watch:test         # ava --watch
```

- Run a single test: ava does not have a first-class `-g` filter wired into package.json scripts; either run `npx ava dist/main/lib/tokenlist.spec.js` directly after `yarn build`, or use `npx ava --match '<test name>'` against the compiled `dist/main` output (ava is configured to run compiled JS, not `.ts` directly — see `ava.files`/`rewritePaths` in `package.json`).
- Coverage: `yarn cov` (nyc html + open), `yarn cov:check` requires 100% lines/functions/branches.
- `yarn reset-hard` does `git clean -dfx && git reset --hard && npm i` — destructive, only used by the release flow.

### Token list schema validation (CUE)

```bash
./validate.sh   # cue vet src/tokens/solana.tokenlist.json automerge/schema.cue -d '#Tokenlist'
```

Requires the `cue` CLI (`go install cuelang.org/go/cmd/cue@v0.4.0`) on PATH. This is what CI (`build.yml`) runs after `yarn test` on every PR — it's the authoritative check that `solana.tokenlist.json` still satisfies `automerge/schema.cue`'s `#Tokenlist` definition.

### Go automerge bot

```bash
cd automerge && go build -o ~/automerge github.com/solana-labs/token-list/automerge
~/automerge -v=1 -dryRun            # dry run against open PRs, no writes/comments
go test ./...                        # parser has unit tests (automerge/parser/parser_test.go)
```

Auth: needs `GITHUB_TOKEN` or `GITHUB_APP_PEM` (base64-encoded PEM) in the environment. `-setRemoteForCI` adds a git remote authenticated as the GitHub App for CI push access.

## CI workflows (`.github/workflows/`)

- **`build.yml`** (on PR): `yarn && yarn test`, then installs `cue` and runs `./validate.sh`. This is the gate every PR must pass.
- **`main.yml`** (on push to `main`, `solana-labs` org only): builds, publishes a patched version to npm, pushes tags, purges the jsDelivr CDN cache for `solana.tokenlist.json`.
- **`automerge_new.yml`** (hourly cron): builds and runs the Go `automerge` bot against `main`, which merges eligible open PRs into a `automerge-pending` branch and force-pushes it into `main` using the GitHub App identity.
- **`codeql_analysis.yml`**: standard CodeQL scan.

## Architecture: the TypeScript package (`src/`)

- `src/tokens/solana.tokenlist.json` — the actual data: a `TokenList` (name, logoURI, tags, timestamp, `tokens: TokenInfo[]`). This is the file both the npm package and the automerge bot read/write, and the only file most PRs touch.
- `src/lib/tokenlist.ts` — all the logic:
  - `TokenInfo` / `TokenList` / `TokenExtensions` types mirror (a superset of) the CUE schema in `automerge/schema.cue`.
  - Four `*ResolutionStrategy` classes (`GitHubTokenListResolutionStrategy`, `CDNTokenListResolutionStrategy`, `SolanaTokenListResolutionStrategy`, `StaticTokenListResolutionStrategy`) each fetch the list from a different source (GitHub raw, jsDelivr CDN, `token-list.solana.com`, or the bundled static JSON), with the bundled JSON as the fallback if `fetch` fails.
  - `TokenListProvider.resolve(strategy)` picks a strategy (defaults to `Strategy.CDN`) and wraps the result in a `TokenListContainer`.
  - `TokenListContainer` is immutable — every `filterByTag`/`excludeByTag`/`filterByChainId`/`excludeByChainId`/`filterByClusterSlug` call returns a **new** container rather than mutating `this`.
  - `CLUSTER_SLUGS` maps `mainnet-beta`/`testnet`/`devnet` to the numeric `ENV` chain IDs (101/102/103) used everywhere else in the codebase (including the Go schema).
- `src/index.ts` just re-exports `./lib/tokenlist`.
- Dual build output: `tsconfig.json` builds CommonJS to `dist/main` (declarations included); `tsconfig.module.json` builds ES modules to `dist/module`. `package.json`'s `main`/`module`/`typings` fields point at these.

## Architecture: the automerge bot (`automerge/`)

Entry point `automerge/automerge.go` (`package main`), supported by `automerge/parser/` and `automerge/auth/`.

Flow (`main()` → `Automerger`):
1. Authenticate to GitHub (PAT via `GITHUB_TOKEN`, or a GitHub App installation token derived from `GITHUB_APP_PEM` via `automerge/auth/auth.go`'s JWT signing + `GetInstallationToken`).
2. `InitRepo()` clones the *local working copy* (`file://$PWD`) into an in-memory `go-git` repo/filesystem — it operates on a virtual worktree, not the real one on disk.
3. `InitTokenlist()` loads `src/tokens/solana.tokenlist.json` from that virtual worktree and indexes existing tokens by `(chainId, address)` and `(chainId, lowercased name)` into `knownAddrs`/`knownNames`, to detect duplicates in incoming PRs.
4. For each open PR (`GetOpenPRs`), `ProcessPR`:
   - Fetches the raw unified diff and parses it with `sourcegraph/go-diff`.
   - `parseDiff` restricts the PR to touching only `src/tokens/solana.tokenlist.json` (added lines only) and new files under `assets/mainnet/<address>/*.{png,jpg,svg}`; anything else (deletions, unrelated files) is rejected. `CHANGELOG.md`/`package.json` changes are silently ignored.
   - `processTokenlist` extracts only the `+`-added lines from each hunk, hands them to `parser.NormalizeWhatever` (a deliberately permissive/forgiving JSON repairer — see below), then for every parsed `Token`: checks for in-PR and cross-PR duplicate address/name, checks the blacklist (`IsBlacklistedToken`), validates against the CUE schema (`#StrictTokenInfo`, embedded from `schema.cue` via `//go:embed`), requires a non-empty name, and does live HEAD-request verification of `logoURI`, `coingeckoId`, and `website` extension fields.
   - On success, `commitTokenDiff` downloads any new asset files from the PR's branch (rejecting anything >200KiB), appends the new tokens to the in-memory tokenlist, commits it (authored as the PR's submitter), and reports success via a GitHub check run + `automerge` label; on any failure, `reportError` posts a failing check run + `automerge-error` label instead.
5. After processing all PRs (or `-max N` of them), force-pushes the accumulated in-memory commits to the `automerge-pending` branch (never allowed to force-push to `main`/`master` — see the guard in `Push`). The hourly cron workflow then merges `automerge-pending` into `main`.

`automerge/parser/parser.go`'s `NormalizeWhatever` is intentionally hacky: it's fed only the `+`-added lines of a diff hunk (not full valid JSON), so it re-balances stripped braces/brackets using a stack, patches trailing commas, and uses `tailscale/hujson` (JWCC-tolerant JSON) to parse. Changes here directly affect what malformed-but-close-enough PR diffs get accepted — be conservative modifying it, since it's a security-relevant surface (arbitrary PR authors control the input).

`automerge/schema.cue` (`package tokenlist`) is the source of truth for token/list validity, shared conceptually (not by import) with the TypeScript types in `tokenlist.ts`. It intentionally diverges from the upstream Uniswap token list schema in places (marked `INCOMPATIBLE:` in comments — e.g. base58 addresses, tag identifiers allowing `-`, longer name limits) and carries hardcoded `#SymbolWhitelist`/`#NameWhitelist` grandfather lists for tokens that predate stricter validation. `#StrictTokenInfo` (requires `logoURI`) is used only for new tokens being merged in, not for validating the file as a whole (`#Tokenlist` uses plain `#TokenInfo`).

## Conventions

- TypeScript: strict mode, `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns` all on. ESLint config (`eslint:recommended`, `@typescript-eslint/recommended`, prettier) enforces import ordering (`import/order`, alphabetized, newlines between groups) — run `yarn fix` before committing.
- PRs that only touch `src/tokens/solana.tokenlist.json` (adding tokens) plus corresponding new `assets/mainnet/<address>/` files are handled by the automerge bot per `.github/PULL_REQUEST_TEMPLATE.md`; PRs modifying anything else go through manual review. Don't hand-edit existing token entries in the same PR as new additions — the bot (and CI) rejects diffs containing removed/modified lines in the tokenlist.
- Go code favors `klog` for logging (`-v` verbosity flags) and wraps errors with `fmt.Errorf("...: %v", err)` / `%w` throughout `automerge/`.
