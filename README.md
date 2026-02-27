# git-manager-lite

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.19. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Commands

- `gml sync` — Fetch and pull the latest changes for all repositories under the current directory (including CWD if it is a git repo).
- `gml main` (alias: `master`) — Interactively switch selected repositories to their default branch (main or master) and hard reset to origin/DEFAULT.
- `gml list` (alias: `ls`) — List repositories and show their current branches in color (green=main/master, red=release/*, yellow=other).
- `gml branches` — Show per-repository local branch statistics (total, stale, no upstream, with upstream).
- `gml branches cleanup` — Interactively choose a repository, review its local branches with details, and select branches to delete.
- `gml schedule <setup|remove|run>` — Setup and manage a daily sync of all repositories using OS native schedulers.
    - `setup` — Register a daily sync task
    - `remove` — Remove the sync task
    - `run` — Manually trigger the scheduled sync logic
- `gml version` — Show the current CLI version.
- `gml help [command]` — Show help for the CLI or a specific command.

Tips:
- Use environment variable `GML_VERBOSE=1` to print underlying git commands: `GML_VERBOSE=1 bun run index.ts branches`
