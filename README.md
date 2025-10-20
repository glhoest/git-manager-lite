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

- gml sync — fetch and pull for all repositories under the current directory (including current, if it is a git repo)
- gml main (alias: master) — interactively switch selected repos to default branch and hard reset to origin/DEFAULT
- gml list (alias: ls) — show current branch for each repository
- gml branches — show local branch statistics per repository (total, with upstream, no upstream, stale)
- gml cleanup branches — interactively choose a repository, review its local branches with details, and select branches to delete

Tips:
- Use environment variable GML_VERBOSE=1 to print underlying git commands: `GML_VERBOSE=1 bun run index.ts branches`
