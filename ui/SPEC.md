# GML Web UI — Implementation Specification

> This document is the authoritative reference for implementing a web UI and daemon server for the `gml` (Git Manager Lite) CLI tool. It describes the CLI's full feature set, all data structures, the daemon architecture, and the expected UI screens with their interactions.

---

## 1. CLI Overview

**Binary:** `gml` (compiled Bun executable, `./bin/gml.exe`)  
**Source entry:** `index.ts`  
**Commands directory:** `commands/`  
**State file:** `~/.gml-state.json` (JSON, per-repo sync history)  
**Config file:** `.gml` (JSON, in the CWD where `gml` is run — the "parent" directory containing all the managed repos)

The tool runs from a **parent directory** that contains one or more git repo subdirectories. It scans that directory for `.git` subdirectories and treats each as a managed repo. If the CWD itself is a git repo, it is also included.

### 1.1 Repo Discovery

```
getRepos() → string[]   // absolute paths, alphabetically sorted
```

- Scans CWD subdirectories for `.git`
- Also includes CWD itself if it has `.git`
- Result optionally filtered to a named **preset** (see §6)
- Env var `GML_VERBOSE=1` makes all `git` invocations print to console

### 1.2 Branch Status Model

Every repo exposes this shape:

```ts
type BranchStatus = {
  branch: string;        // current local branch name, or "(detached)"
  upstream?: string;     // e.g. "origin/main"
  ahead: number;         // local commits not on upstream
  behind: number;        // upstream commits not on local
  uncommitted: number;   // number of uncommitted changes (git status --porcelain lines)
}
```

### 1.3 State Model (`~/.gml-state.json`)

```ts
type RepoState = {
  lastSyncSuccess?: boolean;
  lastSyncError?: string;
  lastSyncTime?: string;        // ISO 8601
  customDefaultBranch?: string; // set via "branches manage" → set-default
}

type GmlState = {
  repos: Record<string, RepoState>; // key = absolute repo path
}
```

### 1.4 Config Model (`.gml`)

```ts
type GmlConfig = {
  defaultPreset?: string;
  presets: Record<string, string[]>; // key = preset name, value = array of repo basenames
}
```

---

## 2. Full Command Reference

### 2.1 `sync` / `fetch`

**CLI:** `gml sync [--fetch-only]` | `gml fetch`

**What it does:**

1. Shows a multiselect prompt — user picks which repos to process (all selected by default).
2. Shows a progress bar while processing repos in **parallel**.
3. For each repo:
   - `git fetch --all`
   - If not fetch-only:
     - Stashes local changes under a session-scoped name (`GML:sync:<sessionId>`)
     - `git pull`
     - If not on default branch: `git fetch origin <defaultBranch>:<defaultBranch>`
     - Re-applies stash; drops it if apply succeeded
4. Updates `~/.gml-state.json` per repo with success/failure + timestamp.
5. Prints a recap of any failed repos.

**Data returned per repo:**

```ts
{ repo: string; success: boolean; error?: string; buf: string }
```

**UI implications:**
- Needs a repo multiselect (checkboxes) before running.
- Progress bar (determinate, n repos).
- Per-repo status: success (green), failed (red) + error message.
- Streaming log output per repo (the `buf` string).
- A "fetch only" toggle.

---

### 2.2 `main` / `master`

**CLI:** `gml main [--force|-f]`

**What it does:**

1. Multiselect prompt to pick repos.
2. For each selected repo, determines the **default branch** (custom if set in state, otherwise reads `refs/remotes/origin/HEAD`, falls back to `main` / `master`).
3. If `--force`: skips all prompts, discards local changes, hard-resets to `origin/<defaultBranch>`.
4. Without force: interactive per-repo — handles stash, checkout, reset.

**UI implications:**
- Repo multiselect.
- Force toggle.
- Per-repo result: branch switched to, any errors.

---

### 2.3 `list` / `ls` / `sl`

**CLI:** `gml list`

**What it does:**

Iterates all repos and prints current branch with color coding:
- Green → `main` or `master`
- Red → starts with `release/`
- Yellow → anything else

**Data shape per repo:**

```ts
{ repo: string; branch: string; color: 'green' | 'red' | 'yellow' }
```

**UI implications:**
- Simple table/list: repo name | branch name | color-coded badge.
- This is the "dashboard" / home screen.

---

### 2.4 `branches`

**CLI:** `gml branches`

**What it does:**

Runs `git branch -vv --no-color` on each repo in parallel, parses output, returns stats:

```ts
type BranchStats = {
  total: number;
  stale: number;       // upstream is gone
  noUpstream: number;  // no tracking branch set
  withUpstream: number;
}
```

**UI implications:**
- Table: one row per repo.
- Columns: Repo | Total | With Upstream | No Upstream (warn if > 0) | Stale (error if > 0).

---

### 2.5 `branches cleanup`

**CLI:** `gml branches cleanup [--remote]`

**What it does (local mode):**

1. Select one repo (single select prompt).
2. `git fetch --all` (or `git fetch --all --prune` for remote mode).
3. Runs `git branch -vv --no-color` (or `git branch -r --no-color` for remote).
4. Shows multiselect of branches — current branch and default branch are disabled.
5. Confirmation prompt.
6. Deletes each selected branch:
   - Local: `git branch -d <name>` — if that fails and upstream is gone, forces with `-D`.
   - Remote: `git push <remote> --delete <branchName>`.

**Branch info shape (local):**

```ts
type BranchInfo = {
  name: string;
  isCurrent: boolean;
  hasUpstream: boolean;
  upstreamGone: boolean;
  upstreamName?: string;
  ahead?: number;
  behind?: number;
}
```

**UI implications:**
- Repo selector (dropdown/list).
- Local/Remote toggle.
- Branch list with checkboxes; disabled rows for protected branches (current, default).
- Badges: `current` (cyan), `no-upstream` (yellow), `gone` (red), `ahead N` (yellow), `behind N` (yellow).
- Confirmation modal before deletion.

---

### 2.6 `branches manage`

**CLI:** `gml branches manage`

**What it does:**

1. Select one repo.
2. Loop:
   - `git fetch` silently.
   - Shows autocomplete list of all branches (local + remote via `git branch -a -vv --no-color`).
   - User picks a branch, then picks an action:
     - **Switch** — `git checkout <branchName>`
     - **Set as default** — writes `customDefaultBranch` to `~/.gml-state.json`
     - **Delete** — creates backup ref at `refs/safe-delete/<sessionId>/<branchName>` first, then `git branch -D <name>`
   - On exit: if any branches were deleted this session, prompts user to restore any.
3. Back option returns to repo selection.

**Safety:** Before any delete, SHA is saved to `refs/safe-delete/<sessionId>/<branchName>`. On exit, user offered multiselect to restore. Backup refs are always cleaned up.

**UI implications:**
- Repo selector.
- Searchable branch list (all local + remote).
- Branch action panel: Switch | Set Default | Delete.
- "Deleted this session" sidebar/panel with restore option before navigating away.
- Current branch highlighted (cyan).
- Remote branches highlighted (yellow).

---

### 2.7 `stashes`

**CLI:** `gml stashes` | `gml stashes clean`

**What it does:**

- `stashes` — scans all repos for stashes whose subject contains `GML:sync:`. Lists them grouped by repo.
- `stashes clean` — same scan, shows list, prompts confirm, drops all in descending stash-index order (to avoid index shift bugs).

**Data shape:**

```ts
type GmlStash = { repo: string; ref: string; subject: string }
// ref example: "stash@{0}"
// subject example: "GML:sync:a3f8bc12"
```

**UI implications:**
- Table: repo | stash ref | subject (session ID).
- "Clean all" button with confirmation modal.

---

### 2.8 `schedule`

**CLI:** `gml schedule <setup|remove|run>`

**What it does:**

- `setup` — registers an OS-native daily sync task at 10:00 AM:
  - Windows: `schtasks` task named `GML_Daily_Sync`
  - macOS: `launchctl` LaunchAgent at `~/Library/LaunchAgents/com.gml.sync.plist`
  - Linux: `crontab` entry `0 10 * * * <gmlCommand> schedule run`
- `remove` — removes the above.
- `run` — internal; triggers `syncRepos({ all: true })` (no interactive prompts, runs on all repos).

**UI implications:**
- Settings screen: current OS, schedule status (registered / not registered).
- Setup / Remove buttons.
- Manual "Run Now" button (triggers `schedule run`).

---

### 2.9 `config`

**CLI:** `gml config <subcommand>`

**Subcommands:**

| Subcommand | Action |
|---|---|
| `config init` | Creates empty `.gml` in CWD if none exists |
| `config presets list [name]` | Lists all presets or one by name |
| `config presets add` | Interactive: name + repo multiselect → saves to `.gml` |
| `config presets edit` | Select preset → re-select repos → saves |
| `config presets delete` | Select preset → confirm → removes from `.gml` |
| `config presets default` | Select preset (or clear) → sets `defaultPreset` in `.gml` |

**UI implications:**
- Config screen:
  - Show `.gml` path and whether it exists.
  - "Init config" button (disabled if file already exists).
  - Presets list: name | repo count | default badge.
  - Add / Edit / Delete / Set Default actions per preset.
  - Edit opens a repo multiselect modal.

---

### 2.10 `version`

**CLI:** `gml version`

Reads `package.json` version and prints it. No complex state.

---

## 3. Daemon Architecture

### 3.1 Purpose

A new `gml serve` (or `gml daemon`) command starts an HTTP server that:
1. Exposes a JSON REST API (and optionally WebSocket) so the web UI can call all CLI operations.
2. Serves the static web UI files from `./ui/`.
3. Optionally streams live output via WebSocket (for sync progress, terminal emulator output).
4. Persists its own PID / port to `~/.gml-daemon.json` so other processes can detect it.

### 3.2 New Command: `gml serve`

**CLI:** `gml serve [--port <number>] [--no-open]`

**Options:**
- `--port <number>` — default `4321`
- `--no-open` — don't auto-open browser

**Behaviour:**
1. Reads `--port` (default `4321`).
2. Writes `~/.gml-daemon.json`: `{ pid, port, cwd, startedAt }`.
3. Starts HTTP server using Bun's built-in `Bun.serve`.
4. Serves `ui/index.html` for `GET /` and any non-API path.
5. API routes handled at `/api/*`.
6. WebSocket upgrade handled at `/ws`.
7. Optionally opens browser at `http://localhost:<port>`.
8. On SIGINT / SIGTERM: cleans up `~/.gml-daemon.json` and exits.

**Daemon state file `~/.gml-daemon.json`:**

```ts
type DaemonState = {
  pid: number;
  port: number;
  cwd: string;      // the directory where gml serve was launched (repo root dir)
  startedAt: string; // ISO 8601
}
```

### 3.3 REST API Endpoints

All endpoints return `Content-Type: application/json`. Non-streaming endpoints return immediately. Streaming operations (sync, switchToMain) should be upgraded to WebSocket or use SSE.

#### Repos

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/repos` | List all repos with `BranchStatus` for each |
| `GET` | `/api/repos/:repoId/status` | `BranchStatus` for one repo (`repoId` = base64url of abs path) |
| `GET` | `/api/repos/:repoId/branches` | All branches (`git branch -a -vv --no-color` parsed) |
| `GET` | `/api/repos/:repoId/stashes` | GML stashes in one repo |

#### Operations (fire-and-forget → result via WS)

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/sync` | `{ repos?: string[], fetchOnly?: boolean }` | Start sync; stream progress via WS |
| `POST` | `/api/main` | `{ repos?: string[], force?: boolean }` | Switch to main; stream via WS |
| `POST` | `/api/branches/cleanup` | `{ repo: string, branches: string[], remote?: boolean }` | Delete branches |
| `POST` | `/api/branches/switch` | `{ repo: string, branch: string }` | Switch branch |
| `POST` | `/api/branches/set-default` | `{ repo: string, branch: string }` | Set custom default |
| `POST` | `/api/branches/delete` | `{ repo: string, branch: string }` | Safe-delete branch (creates backup ref) |
| `POST` | `/api/stashes/clean` | `{}` | Drop all GML stashes |
| `POST` | `/api/schedule/setup` | `{}` | Register OS scheduler task |
| `POST` | `/api/schedule/remove` | `{}` | Remove OS scheduler task |
| `POST` | `/api/schedule/run` | `{}` | Manually trigger scheduled sync |

#### Config

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/api/config` | — | Read `.gml` config + path + exists flag |
| `POST` | `/api/config/init` | `{}` | Create empty `.gml` |
| `GET` | `/api/config/presets` | — | List all presets |
| `POST` | `/api/config/presets` | `{ name: string, repos: string[] }` | Add preset |
| `PUT` | `/api/config/presets/:name` | `{ repos: string[] }` | Edit preset |
| `DELETE` | `/api/config/presets/:name` | — | Delete preset |
| `PUT` | `/api/config/presets/default` | `{ name: string \| null }` | Set/clear default preset |

#### Daemon

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Returns `{ pid, port, cwd, startedAt, version }` |
| `POST` | `/api/terminal` | (see §3.5) Spawn a shell command and return via WS |

### 3.4 WebSocket Protocol

**URL:** `ws://localhost:<port>/ws`

Messages are JSON. Each message has a `type` field.

**Client → Server:**

```ts
// Subscribe to an operation's log stream
{ type: 'subscribe', operationId: string }

// Unsubscribe
{ type: 'unsubscribe', operationId: string }

// Terminal input (for embedded terminal)
{ type: 'terminal:input', sessionId: string, data: string }

// Resize terminal
{ type: 'terminal:resize', sessionId: string, cols: number, rows: number }

// Kill terminal session
{ type: 'terminal:kill', sessionId: string }
```

**Server → Client:**

```ts
// Log line for an operation
{ type: 'log', operationId: string, line: string }

// Operation completed
{ type: 'done', operationId: string, success: boolean, error?: string }

// Progress update
{ type: 'progress', operationId: string, current: number, total: number }

// Terminal output
{ type: 'terminal:output', sessionId: string, data: string }

// Terminal closed
{ type: 'terminal:exit', sessionId: string, code: number | null }

// Repo state changed (poll/push after operations)
{ type: 'repos:changed' }
```

### 3.5 Embedded Terminal

The daemon can optionally spawn a PTY (pseudo-terminal) session for the embedded browser terminal.

**Implementation options (in priority order):**
1. Use `node-pty` package — full PTY support, xterm.js compatible.
2. Fallback: pipe stdin/stdout of a child shell process over WebSocket (no PTY — limited but functional).

**Terminal API:**
- `POST /api/terminal/spawn` with `{ shell?: string, cwd?: string }` → returns `{ sessionId: string }`.
- Client connects WebSocket and sends `terminal:input` / `terminal:resize`, receives `terminal:output`.
- Server spawns `cmd.exe` (Windows), `bash` / `zsh` (Unix).

---

## 4. Web UI Screens

### 4.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  GML  [nav: Dashboard | Branches | Stashes | Schedule | Config]  │
│  ──────────────────────────────────── [version badge]   │
│                                                         │
│  [Main content area]                                    │
│                                                         │
│  ──────────────────────────────────────────────────     │
│  [Terminal panel — collapsible, bottom]                 │
└─────────────────────────────────────────────────────────┘
```

- Top nav with route links.
- Terminal panel is a collapsible drawer at the bottom (xterm.js embedded terminal).
- All screens have a "Preset" selector in the top bar (to filter repos, mirrors `--preset`).

### 4.2 Screen: Dashboard (list)

**Route:** `/`

Maps to `gml list`.

**Content:**
- Header: directory being managed (the CWD passed to daemon), last sync time.
- Quick actions: `Sync All`, `Fetch All`, `Switch All to Main`.
- Repo table:

| Repo | Branch | Status | Ahead | Behind | Uncommitted | Last Sync |
|---|---|---|---|---|---|---|
| my-repo | `main` 🟢 | OK | 0 | 0 | 2 files | 10 min ago |
| other | `feature/foo` 🟡 | OK | 3 | 0 | 0 | 2h ago |
| broken | `main` 🟢 | ❌ Sync error | — | — | — | 3h ago |

- Branch badge colors: green = main/master, red = release/*, yellow = other.
- Status column: last sync result from `~/.gml-state.json`.
- Click repo row → repo detail panel (branch status + quick actions for that repo).

### 4.3 Screen: Sync

**Route:** `/sync`

Maps to `gml sync` / `gml fetch`.

**Content:**
- Fetch Only toggle.
- Repo checklist (all checked by default, mirroring the CLI multiselect).
- "Run Sync" button.
- Progress bar (determinate).
- Live log output area per repo (collapsible accordion, streams via WebSocket).
- Recap section: failed repos in red, success message in green.

### 4.4 Screen: Switch to Main

**Route:** `/main`

Maps to `gml main`.

**Content:**
- Repo checklist.
- Force toggle (red warning label: "Discards local changes").
- "Switch to Main" button.
- Live output / per-repo result.

### 4.5 Screen: Branches Overview

**Route:** `/branches`

Maps to `gml branches`.

**Content:**
- Table: Repo | Total | With Upstream | No Upstream | Stale.
- "No Upstream" and "Stale" columns show warning/error badges if > 0.
- Row click → opens `branches manage` panel for that repo.

### 4.6 Screen: Branches Cleanup

**Route:** `/branches/cleanup`

Maps to `gml branches cleanup [--remote]`.

**Content:**
- Repo selector (dropdown).
- Local / Remote toggle.
- Branch list with checkboxes. Protected branches (current, default) disabled with tooltip.
- Branch metadata badges per row: `current` / `no-upstream` / `gone` / `ahead N` / `behind N`.
- "Delete Selected" button → confirmation modal → execute → per-branch result.

### 4.7 Screen: Branch Manager

**Route:** `/branches/manage`

Maps to `gml branches manage`.

**Content:**
- Repo selector (dropdown).
- Searchable branch list (all local + remote):
  - Current branch: cyan highlight
  - Remote branches: yellow
  - `[gone]` badge for stale upstream
  - `[ahead N]` / `[behind N]` badges
- Selected branch action panel (sidebar or inline):
  - **Switch** button
  - **Set as Default** button
  - **Delete** button (red, with confirmation)
- Deleted-this-session panel: list of deleted branches with "Restore" checkboxes, shown until user navigates away or explicitly acknowledges.

### 4.8 Screen: Stashes

**Route:** `/stashes`

Maps to `gml stashes`.

**Content:**
- Table: Repo | Stash Ref | Session ID (from subject).
- "Clean All GML Stashes" button → confirmation modal → execute → result.
- Empty state: "No GML auto-stashes found."

### 4.9 Screen: Schedule

**Route:** `/schedule`

Maps to `gml schedule`.

**Content:**
- Detected OS badge.
- Schedule status: Registered / Not Registered.
- "Setup Schedule" / "Remove Schedule" buttons.
- "Run Now" button (triggers `schedule run` immediately).
- Output log area (shows result of setup/remove/run).

### 4.10 Screen: Config

**Route:** `/config`

Maps to `gml config`.

**Content:**
- `.gml` file path + exists badge (green) or missing badge (red).
- "Init Config" button (disabled if file exists).
- **Presets table:**

| Name | Repos | Default |
|---|---|---|
| frontend | 4 repos | ✅ |
| backend | 3 repos | |

- Per-row actions: Edit | Delete | Set as Default.
- "Add Preset" button → modal: name field + repo checklist.
- Edit → same modal pre-filled.
- Delete → inline confirm.

### 4.11 Panel: Embedded Terminal

**Collapsible drawer at bottom of every screen.**

- Powered by [xterm.js](https://xtermjs.org/) in the browser.
- Connects to `ws://localhost:<port>/ws`.
- Sends `terminal:input` and `terminal:resize` messages.
- Receives `terminal:output`.
- Default shell: `cmd.exe` (Windows) / `bash` (Unix).
- CWD of the shell = the directory the daemon was started from (the managed repos parent dir).
- User can run any `gml` command here directly.
- Title: "Terminal — gml @ <cwd>".

---

## 5. State & Data Flow

```
Browser ──── REST GET ────────────────▶ Daemon ──── reads ──▶ git / .gml / ~/.gml-state.json
Browser ◀─── JSON response ─────────── Daemon

Browser ──── POST /api/sync ──────────▶ Daemon starts async operation
Browser ──── WS subscribe ────────────▶ Daemon streams log lines + progress
Browser ◀─── WS done event ─────────── Daemon

Browser ──── WS terminal:input ───────▶ Daemon ──── writes PTY stdin
Browser ◀─── WS terminal:output ────── Daemon ◀─── reads PTY stdout
```

- **Polling fallback:** if WebSocket is unavailable, clients may poll `GET /api/repos` every 5s.
- **Operation IDs:** each `POST` operation returns `{ operationId: string }` immediately; client subscribes via WS.

---

## 6. Presets

A preset is a named subset of repos stored in `.gml`:

```json
{
  "defaultPreset": "frontend",
  "presets": {
    "frontend": ["repo-a", "repo-b"],
    "backend": ["repo-c"]
  }
}
```

- `--preset *` bypasses `defaultPreset` and includes all repos.
- If `defaultPreset` is set, all commands use that subset unless overridden.
- UI top bar should have a preset selector dropdown with all preset names + "All Repos" option (maps to `--preset *`).

---

## 7. Key Implementation Notes for Daemon

### 7.1 Reusing Core Logic

All command implementations in `commands/*.ts` call `getRepos()` which reads `process.cwd()` at import time. For the daemon:

- Set `process.chdir(cwd)` once on startup to the directory passed to `gml serve`.
- All command functions can then be called directly as they already return structured data or stream to a logger.
- Replace the `console.log` logger in parallel processing with a WebSocket-broadcasting logger.

### 7.2 Making Commands Non-Interactive

Current commands use `prompts` for interactivity. Daemon API receives all decisions as JSON body params, so `prompts` must be bypassed. Approach:

- Create API-level wrappers that call internal helper functions directly (e.g., call `runGitAsync` directly rather than going through `cleanupBranches` which calls `prompts`).
- Or: refactor each command to accept an `options` object with all decisions pre-made, with `prompts` only called as a fallback when options are missing (CLI path).

### 7.3 Parallel Operation Safety

- Only one `sync` or `main` operation should run at a time (guard with a lock flag).
- Concurrent reads (list, status) are safe.
- Return `409 Conflict` if an exclusive operation is already running.

### 7.4 Bun HTTP Server

```ts
// Minimal skeleton
Bun.serve({
  port: 4321,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws' && server.upgrade(req)) return;
    // route to handlers
  },
  websocket: {
    message(ws, msg) { /* route WS messages */ },
    open(ws) { /* register client */ },
    close(ws) { /* unregister client */ },
  }
});
```

### 7.5 File Structure for Daemon Implementation

```
commands/
  serve.ts        ← new: daemon entry point (Bun.serve, API router)
  api/
    repos.ts      ← GET /api/repos, GET /api/repos/:id/status, /branches, /stashes
    sync.ts       ← POST /api/sync, POST /api/main
    branches.ts   ← POST /api/branches/*
    stashes.ts    ← POST /api/stashes/clean
    schedule.ts   ← POST /api/schedule/*
    config.ts     ← GET+POST /api/config, /api/config/presets/*
    terminal.ts   ← POST /api/terminal/spawn, WS terminal handling
  core.ts         ← unchanged (shared helpers)
ui/
  SPEC.md         ← this file
  index.html      ← single-page app (or bundled output)
  src/            ← UI source (if using a framework)
```

### 7.6 Adding `serve` to `index.ts`

Add to the `Command` enum:
```ts
Serve = 'serve',
Daemon = 'daemon', // alias
```

Add to the switch:
```ts
case Command.Serve:
case Command.Daemon:
  serveCommand(args.slice(1));
  break;
```

---

## 8. Tech Stack Recommendations

### Daemon
- **Runtime:** Bun (already used) — `Bun.serve` has built-in HTTP + WebSocket.
- **PTY:** `node-pty` (install: `bun add node-pty`) — required for embedded terminal.
- **No framework needed** for the API given the small surface area.

### Web UI
- **Framework:** Vue 3 (lightweight, no build step possible with CDN) or plain HTML/JS with a CDN import.
- **Terminal:** [xterm.js](https://cdn.jsdelivr.net/npm/xterm/) + `xterm-addon-fit` via CDN.
- **Styling:** Tailwind CSS via CDN play, or simple hand-written CSS with CSS variables.
- **No build step preferred** — single `ui/index.html` with `<script type="module">` importing from CDN. This keeps deployment trivial (daemon just serves the file).

### Suggested CDN imports (no build step):
```html
<!-- Vue 3 -->
<script src="https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js" type="module"></script>

<!-- xterm.js -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5/css/xterm.css" />
<script src="https://cdn.jsdelivr.net/npm/xterm@5/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8/lib/xterm-addon-fit.js"></script>
```

---

## 9. UI Color Conventions (matching CLI)

| Meaning | CLI (chalk) | UI CSS |
|---|---|---|
| main/master branch | `chalk.green` | `color: #22c55e` |
| release/* branch | `chalk.red` | `color: #ef4444` |
| other branch | `chalk.yellow` | `color: #eab308` |
| current branch tag | `chalk.cyan` | `color: #06b6d4` |
| remote branch | `chalk.yellow` | `color: #eab308` |
| stale/gone | `chalk.red` | `color: #ef4444` |
| no upstream | `chalk.yellow` | `color: #eab308` |
| success | `chalk.green` | `color: #22c55e` |
| error | `chalk.red` | `color: #ef4444` |
| dim/secondary | `chalk.gray` | `color: #6b7280` |

---

## 10. Security Notes

- Daemon binds to `127.0.0.1` only (never `0.0.0.0`) — local use only.
- No authentication required for localhost.
- All `git` commands run in the CWD set at daemon startup — no path traversal risk in repo IDs if validated against `getRepos()` output.
- Terminal access gives full shell — acceptable for a local developer tool, but document it clearly.
