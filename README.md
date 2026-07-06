# git-manager-lite

`git-manager-lite` (CLI binary: `gml`) is a Bun-based CLI tool for managing multiple git repositories simultaneously from a parent directory. It bulk-syncs, lists, switches branches, inspects branch stats, and schedules automated daily syncs.

## Development Commands

```bash
bun install               # Install dependencies
bun run index.ts          # Run CLI from source (dev mode)
bun run lint              # Type-check + Biome lint
bun run check-types       # TypeScript type-check only (tsc --noEmit)
bun run build             # Bundle to ./bin/gml.js
bun run build:exe         # Full release: build + bump patch version + compile to ./bin/gml.exe
```

## GML Commands

- `gml sync` — Fetch and pull the latest changes for all repositories under the current directory (including CWD if it is a git repo).
- `gml fetch` — Alias of `sync --fetch-only`.
- `gml main` (alias: `master`) — Interactively switch selected repositories to their default branch (main or master) and hard reset to origin/DEFAULT.
- `gml list` (alias: `ls`) — List repositories and show their current branches in color (green=main/master, red=release/*, yellow=other).
- `gml branches` — Show per-repository local branch statistics (total, stale, no upstream, with upstream).
- `gml branches cleanup` — Interactively choose a repository, review its local branches with details, and select branches to delete.
- `gml stashes` — List or clean up GML auto-stashes left behind by interrupted sync operations.
- `gml schedule <setup|remove|run>` — Setup and manage a daily sync of all repositories using OS native schedulers.
    - `setup` — Register a daily sync task
    - `remove` — Remove the sync task
    - `run` — Manually trigger the scheduled sync logic
- `gml config` — Manage GML configuration (.gml file) and presets.
- `gml version` — Show the current CLI version.
- `gml help [command]` — Show help for the CLI or a specific command.

### Tips:
- Use environment variable `GML_VERBOSE=1` to print underlying git commands: `GML_VERBOSE=1 bun run index.ts branches`
