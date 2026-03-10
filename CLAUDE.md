# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`git-manager-lite` (CLI binary: `gml`) is a Bun-based CLI tool for managing multiple git repositories simultaneously from a parent directory. It bulk-syncs, lists, switches branches, inspects branch stats, and schedules automated daily syncs.

## Commands

```bash
bun install               # Install dependencies
bun run index.ts          # Run CLI from source (dev mode)
bun run lint              # Type-check + Biome lint
bun run check-types       # TypeScript type-check only (tsc --noEmit)
bun run build             # Bundle to ./bin/gml.js
bun run build:exe         # Full release: build + bump patch version + compile to ./bin/gml.exe
```

There are no tests — no test framework is present.

## Architecture

**Entry point (`index.ts`):** Parses `Bun.argv.slice(2)`, dispatches via a `switch` on a `Command` enum. All help/usage strings live in a `man` record keyed by `Command`. No CLI framework — everything is manual.

**Core infrastructure (`commands/core.ts`):** All shared logic lives here:
- `runGit` / `runGitAsync` — sync/async git execution via Bun's `spawnSync`/`spawn`
- `getRepos()` — scans CWD for subdirectories containing `.git`, returns alphabetically sorted
- `processReposParallel(perRepo, options)` — fires all per-repo async tasks in parallel but prints results in stable alphabetical order; optionally shows a `cli-progress` bar and a `prompts` multiselect filter
- `getBranchStatus` / `getBranchStatusAsync` — queries branch, upstream, ahead/behind, uncommitted changes
- State persistence: reads/writes `~/.gml-state.json` to track last sync per repo
- Stash helpers: `stashSave`, `stashApply`, `stashDrop`

**Commands (`commands/`):** Each file exports a single async function. All commands are re-exported from `commands/index.ts`. Subcommands (e.g. `branches cleanup`, `branches manage`) are dispatched manually in `index.ts` by inspecting `args[1]`.

**Safety pattern in `manageBranches.ts`:** Before any branch deletion, a backup ref is created at `refs/safe-delete/<sessionId>/<branchName>`. On exit, user is offered a restore option.

**`GML_VERBOSE=1`** prints all underlying `git` invocations via `console.debug`.

## Code Style

Enforced by Biome 2.4.4:
- 2-space indentation, single quotes
- Auto-sorted imports (`organizeImports`)

TypeScript config: `strict: true`, `bundler` module resolution, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`. Note: `noUnusedLocals` and `noUnusedParameters` are intentionally disabled.
