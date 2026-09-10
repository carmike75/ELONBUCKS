# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repository is a writable fork of the legacy `solana-labs/token-list` project. GitHub currently reports the `carmike75/ELONBUCKS` fork as active rather than archived.

The EOL notice in `README.md` was inherited from the upstream project. It says the upstream Solana Token List stopped accepting metadata updates and directs new Solana token metadata to Metaplex Fungible Token Metadata. Do not assume that adding an entry to `src/tokens/solana.tokenlist.json` registers current on-chain metadata.

`README.md` contains the inherited project documentation and EOL notice. The root file named `DG PLANNER` is not a README; it only contains local Git push notes and should not be treated as authoritative project documentation.

## What this repository contains

Two independent components live in the repository:

1. **`@solana/spl-token-registry`** (TypeScript, `src/`) — the legacy npm package that fetches and serves a list of Solana SPL token metadata and exposes filtering helpers.
2. **`automerge`** (Go, `automerge/`) — the upstream project's standalone GitHub bot/CLI for validating and merging token-addition PRs.

They have separate build systems (Yarn/TypeScript and Go modules). The Go program reads the token-list JSON and embeds the CUE schema, but it is not linked to the TypeScript package at build time.

## Commands

### TypeScript package (repository root)

```bash
yarn                    # install dependencies
yarn build              # run build:main and build:module in parallel
yarn test               # build, lint, Prettier check, and AVA unit tests
yarn test:unit          # run AVA tests against compiled output
yarn test:lint          # eslint src --ext .ts
yarn test:prettier      # check formatting without writing
yarn fix                # apply Prettier and ESLint fixes
yarn watch:test         # run AVA in watch mode
```

AVA is configured to use compiled JavaScript under `dist/main`. Build before invoking a compiled test directly, for example:

```bash
yarn build
npx ava dist/main/lib/tokenlist.spec.js
npx ava --match '<test name>'
```

Coverage commands:

- `yarn cov` generates HTML and LCOV coverage reports and opens the HTML report.
- `yarn cov:check` requires 100% line, function, and branch coverage.

Warning: `yarn reset-hard` runs `git clean -dfx && git reset --hard && npm i`. It destroys untracked and ignored files and discards tracked working-tree changes. Do not run it unless that destructive reset is explicitly intended.

### Token-list schema validation

```bash
./validate.sh
```

This runs:

```bash
cue vet src/tokens/solana.tokenlist.json automerge/schema.cue -d '#Tokenlist'
```

It requires the CUE CLI on `PATH`. The Build workflow installs `cuelang.org/go/cmd/cue@v0.4.0` before running the script.

### Go automerge bot

```bash
cd automerge
go build -o ~/automerge github.com/solana-labs/token-list/automerge
go test ./...
```

Treat this bot as upstream-specific legacy code:

- `main()` hardcodes the GitHub owner and repository as `solana-labs/token-list`.
- GitHub App authentication is also tied to the upstream organization and a fixed app ID.
- `configureLocalGitRemoteToken` hardcodes the upstream push URL.
- Running it in this fork does not automatically retarget it to `carmike75/ELONBUCKS`.

Do not describe `-dryRun` as write-free. It suppresses GitHub checks and label changes, but the current program still creates in-memory commits and calls `Push` for the `automerge-pending` branch. Do not run the bot against real credentials or remotes until its repository targeting and dry-run behavior have been reviewed.

Authentication uses `GITHUB_TOKEN` or a base64-encoded `GITHUB_APP_PEM`. The `-setRemoteForCI` flag adds an authenticated `app` remote using the upstream GitHub App configuration.

## GitHub Actions workflows

Workflows are stored in `.github/workflows/`.

- **`build.yml`** runs for pull requests and manual dispatch. It installs dependencies, runs `yarn test`, installs CUE, and runs `./validate.sh`.
- **`main.yml`** is triggered by pushes to `main` and manual dispatch, but both jobs require `github.repository_owner == 'solana-labs'`. Those jobs are therefore skipped in the `carmike75` fork. In the upstream repository, the workflow builds, increments a patch version, pushes tags, purges the jsDelivr cache, and publishes to npm.
- **`automerge_new.yml`** runs hourly at minute 10 and by manual dispatch. It builds the Go bot, runs it with upstream-specific GitHub App credentials, force-pushes accumulated commits to `automerge-pending`, then performs a normal `--no-ff` merge of that branch into `main` and pushes `main`. It is not configured for safe operation as an ELONBUCKS-specific bot.
- **`codeql_analysis.yml`** is a legacy JavaScript-only CodeQL workflow. It uses `github/codeql-action@v1` and does not scan the Go component.

Do not assume every workflow is an active merge gate in this fork. Confirm the checks shown on the current PR and inspect skipped or missing jobs before merging.

## TypeScript architecture

- `src/tokens/solana.tokenlist.json` contains the legacy token-list data used by the package and automerge bot.
- `src/lib/tokenlist.ts` contains the public types, resolution strategies, provider, and filtering container.
- `src/index.ts` re-exports `./lib/tokenlist`.
- `tsconfig.json` builds CommonJS with declarations into `dist/main`.
- `tsconfig.module.json` builds ES modules into `dist/module`.
- The `main`, `module`, and `typings` fields in `package.json` point to those outputs.

The four resolution strategies are:

- `GitHubTokenListResolutionStrategy`: upstream GitHub raw content.
- `CDNTokenListResolutionStrategy`: jsDelivr.
- `SolanaTokenListResolutionStrategy`: `token-list.solana.com`.
- `StaticTokenListResolutionStrategy`: bundled JSON.

`TokenListProvider.resolve()` defaults to `Strategy.CDN`. Network strategies fall back to the bundled list when fetching or parsing fails.

The TypeScript interfaces and CUE schema describe overlapping metadata structures, but they are maintained independently and are not exact equivalents. For example, the CUE list schema includes fields not declared on the TypeScript `TokenList` interface, and their extension-field sets differ.

The filtering methods on `TokenListContainer` return new containers instead of mutating the current container. However, `getList()` returns the underlying array, so the class should not be described as strictly immutable.

`CLUSTER_SLUGS` maps `mainnet-beta`, `testnet`, and `devnet` to chain IDs 101, 102, and 103.

## Automerge architecture

The entry point is `automerge/automerge.go`, supported by `automerge/parser/` and `automerge/auth/`.

High-level upstream flow:

1. Authenticate using a personal access token or the upstream GitHub App.
2. Clone the local working copy into an in-memory `go-git` repository and filesystem.
3. Load the token list and index known addresses and lowercased names.
4. Fetch open PRs from the hardcoded upstream repository.
5. Parse each raw unified diff.
6. Accept the token-list file, permitted new assets, and ignored `CHANGELOG.md` or `package.json` changes; reject unsupported files.
7. Normalize added JSON lines, check duplicates and the blacklist, validate new tokens against `#StrictTokenInfo`, and verify supported external fields.
8. Download permitted assets, append tokens, create commits, and report results with GitHub checks and labels.
9. Force-push accumulated commits to `automerge-pending`. The workflow later merges that branch normally into `main`.

New assets must be under `assets/mainnet/<address>/`, must use PNG, JPG, or SVG extensions, and must not exceed 200 KiB according to the response's declared content length.

`parser.NormalizeWhatever` repairs partial JSON assembled from added diff lines. It balances braces and brackets, patches commas, and uses `tailscale/hujson` before standard JSON decoding. Treat changes to this parser conservatively because untrusted PR authors control its input.

`automerge/schema.cue` is the CUE source of truth for bot validation. It intentionally differs from the upstream Uniswap token-list schema. `#StrictTokenInfo` requires `logoURI` for newly merged tokens, while full-list validation uses `#TokenInfo`.

## Conventions

- TypeScript uses strict mode with unused-local, unused-parameter, implicit-return, and fallthrough checks.
- ESLint enforces import grouping and alphabetical order. Run `yarn fix` before committing TypeScript changes.
- The inherited PR template describes token-only automerge rules, but the current Go bot is hardcoded to the upstream repository. Do not assume those rules are operational for this fork.
- Do not edit existing token entries in the same PR as additions intended for the legacy bot; removed or modified token-list lines require manual review.
- Go code uses `klog` and wraps errors with `fmt.Errorf`.
