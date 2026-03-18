import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { Presets, SingleBar } from 'cli-progress';
import prompts from 'prompts';

export const GML_STASH_PREFIX = 'GML:sync:';

const GML_VERBOSE = ((): boolean => {
  const v = String(process.env.GML_VERBOSE ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
})();
const ROOT_DIR = process.cwd();
const STATE_FILE = join(homedir(), '.gml-state.json');
const CONFIG_FILE = join(ROOT_DIR, '.gml');

// --- Config types ---

export type GmlConfig = {
  defaultPreset?: string;
  presets: Record<string, string[]>;
};

// --- Config loading ---

export function loadConfig(): GmlConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as GmlConfig;
  } catch {
    console.error(
      `[gml] Failed to parse .gml config file. Ensure it is valid JSON.`,
    );
    process.exit(1);
  }
}

// --- Preset resolution (module-level, set once by index.ts via initPreset) ---

let _activePreset: string | null = null; // null = no preset, '*' = bypass default

/**
 * Called once from index.ts after parsing --preset.
 * presetArg: the value of --preset, or undefined if not provided.
 */
export function initPreset(presetArg: string | undefined): void {
  const config = loadConfig();

  // --preset * => explicitly bypass any defaultPreset
  if (presetArg === '*') {
    _activePreset = null;
    return;
  }

  if (presetArg !== undefined) {
    // Explicit --preset <name>
    if (!config) {
      console.error(
        '[gml] --preset was specified but no .gml config file was found in the current directory.',
      );
      process.exit(1);
    }
    if (!(presetArg in config.presets)) {
      const available = Object.keys(config.presets);
      console.error(
        `[gml] Unknown preset "${presetArg}".` +
          (available.length
            ? ` Available presets: ${available.map((p) => `"${p}"`).join(', ')}.`
            : ' No presets are defined in .gml.'),
      );
      process.exit(1);
    }
    _activePreset = presetArg;
    return;
  }

  // No --preset arg — fall back to defaultPreset if defined
  if (config?.defaultPreset) {
    if (!(config.defaultPreset in config.presets)) {
      const available = Object.keys(config.presets);
      console.error(
        `[gml] defaultPreset "${config.defaultPreset}" is not defined in presets.` +
          (available.length
            ? ` Available presets: ${available.map((p) => `"${p}"`).join(', ')}.`
            : ' No presets are defined in .gml.'),
      );
      process.exit(1);
    }
    _activePreset = config.defaultPreset;
  }
}

export type RepoState = {
  lastSyncSuccess?: boolean;
  lastSyncError?: string;
  lastSyncTime?: string;
};

export type GmlState = {
  repos: Record<string, RepoState>;
};

export function readState(): GmlState {
  if (!existsSync(STATE_FILE)) return { repos: {} };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { repos: {} };
  }
}

export function writeState(state: GmlState) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function updateRepoState(repoPath: string, update: Partial<RepoState>) {
  const state = readState();
  state.repos[repoPath] = {
    ...state.repos[repoPath],
    ...update,
  };
  writeState(state);
}

export function fetchRepo(repo: string, silent: boolean = false) {
  const args = ['fetch', '--all'];
  return runGit(repo, args, silent);
}
export function runGit(
  repoPath: string,
  gitArgs: string[],
  silent: boolean = false,
) {
  if (GML_VERBOSE) {
    console.debug(`[${repoPath}] git ${gitArgs.join(' ')}`);
  }

  const result = spawnSync('git', gitArgs, {
    cwd: repoPath,
    stdio: silent ? 'pipe' : 'inherit',
    encoding: 'utf-8',
  });
  if (result.status !== 0 && !silent) {
    console.error(`\n[Error] ${repoPath} — git ${gitArgs.join(' ')} failed\n`);
  }
  return result;
}

export type GitResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export async function runGitAsync(
  repoPath: string,
  gitArgs: string[],
  options?: { silent?: boolean; onLog?: (line: string) => void },
): Promise<GitResult> {
  const silent = options?.silent ?? false;
  const onLog = options?.onLog;

  if (GML_VERBOSE) {
    const msg = `[${repoPath}] git ${gitArgs.join(' ')}`;
    if (onLog) onLog(msg);
    else console.debug(msg);
  }

  return await new Promise<GitResult>((resolve) => {
    const child = spawn('git', gitArgs, {
      cwd: repoPath,
      stdio: silent ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (!silent && onLog) onLog(d.toString());
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
      if (!silent && onLog) onLog(d.toString());
    });
    child.on('close', (code) => {
      if (code !== 0 && !silent) {
        const msg = `\n[Error] ${repoPath} — git ${gitArgs.join(' ')} failed\n`;
        if (onLog) onLog(msg);
        else console.error(msg);
      }
      resolve({ status: code, stdout, stderr });
    });
  });
}

export function getRepos(): string[] {
  const repos = readdirSync(ROOT_DIR)
    .map((name) => join(ROOT_DIR, name))
    .filter((p) => existsSync(join(p, '.git')));

  if (existsSync(join(ROOT_DIR, '.git'))) {
    repos.unshift(ROOT_DIR);
  }

  // Always order alphabetically for stable output
  const sorted = repos.sort((a, b) => a.localeCompare(b));

  if (_activePreset === null) return sorted;

  // Apply preset filter — config is guaranteed to exist because initPreset validated it
  const config = loadConfig();
  const allowed = new Set(config?.presets[_activePreset] ?? []);
  const filtered = sorted.filter((p) => allowed.has(basename(p)));

  console.log(
    `[preset: ${_activePreset}] Filtering to ${filtered.length} of ${sorted.length} repositories.`,
  );

  return filtered;
}

/**
 * Generic helper to process repositories in parallel while keeping output ordered.
 * - Always prints in alphabetical order (as returned by getRepos()).
 * - Optionally lets the user pre-filter the repositories via an interactive multiselect.
 * - Each per-repo handler returns a fully formatted string buffer to be printed.
 */
export async function processReposParallel<TResult = string>(
  perRepo: (repo: string) => Promise<TResult>,
  options?: {
    allowFilter?: boolean;
    emptyMessage?: string;
    filterPromptTitle?: string;
    skipLogOutput?: boolean;
    progress?: boolean;
  },
): Promise<TResult[] | undefined> {
  console.log(
    'Reading repositories... (this may take a while if there are many',
  );
  const emptyMessage = options?.emptyMessage ?? 'No git repositories found.';
  const allowFilter = options?.allowFilter ?? false;
  const filterPromptTitle =
    options?.filterPromptTitle ?? 'Select repositories to process';

  const repos = getRepos();
  if (!repos.length) {
    console.log(emptyMessage);
    return;
  }

  let selected = repos;
  if (allowFilter) {
    try {
      const response = await prompts(
        {
          type: 'multiselect',
          name: 'repos',
          message: filterPromptTitle,
          choices: repos.map((r) => ({ title: r, value: r, selected: true })),
          instructions: false,
          hint: '- Space to select. Enter to confirm',
        },
        {
          onCancel: () => {
            console.log('Selection cancelled. No changes made.');
            return true;
          },
        },
      );
      const picked = (response?.repos ?? []) as string[];
      if (!picked.length) {
        console.log('No repositories selected. Nothing to do.');
        return;
      }
      // Ensure alphabetical order regardless of selection order
      selected = picked.sort((a, b) => a.localeCompare(b));
    } catch {
      console.error('Prompt failed. Aborting.');
      return;
    }
  }

  // const outputs: (string | undefined)[] = new Array(selected.length);
  // let nextToLog = 0;
  // const flushLogs = () => {
  //     while (
  //         nextToLog < outputs.length &&
  //         outputs[nextToLog] !== undefined
  //         ) {
  //         console.log(outputs[nextToLog]);
  //         nextToLog += 1;
  //     }
  // };

  let finished = 0;

  let progress: SingleBar | undefined;
  if (options?.progress) {
    progress = new SingleBar({}, Presets.shades_classic);
    progress.start(repos.length, 0);
  }

  const outputs = selected.map((repo) =>
    perRepo(repo).finally(() => {
      finished++;
      progress?.update(finished);
    }),
  );

  const results: TResult[] = [];
  for (const outputPromise of outputs) {
    const output = await outputPromise;
    results.push(output);

    if (!options?.skipLogOutput) {
      console.log(output);
    }
  }
  progress?.stop();
  return results;
}

export function getDefaultBranch(repoPath: string): string {
  const res = spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
    cwd: repoPath,
    encoding: 'utf-8',
  });
  if (res.status === 0 && res.stdout) {
    const match = res.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
    if (match?.[1]) return match[1];
  }
  // fallback
  return existsSync(join(repoPath, '.git', 'refs', 'heads', 'main'))
    ? 'main'
    : 'master';
}

export function hasChanges(repoPath: string): boolean {
  const result = runGit(repoPath, ['status', '--porcelain'], true);
  return result.stdout.length > 0;
}

export function createTempCommit(repoPath: string) {
  runGit(repoPath, ['add', '--all']);
  runGit(repoPath, ['reset', '--', ':(glob)**/node_modules/**']);
  runGit(repoPath, ['commit', '-m', 'TEMP: Auto-commit pending changes']);
}

export type BranchStatus = {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  uncommitted: number;
};

export function getLocalChanges(repoPath: string): string[] {
  const res = runGit(repoPath, ['status', '--porcelain'], true);
  return res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function getBranchStatus(repoPath: string): BranchStatus {
  const branch =
    runGit(repoPath, ['branch', '--show-current'], true).stdout.trim() ||
    '(detached)';

  const upstream = runGit(
    repoPath,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    true,
  );
  const hasUpstream =
    upstream.status === 0 && upstream.stdout.trim().length > 0;
  const upstreamName = hasUpstream ? upstream.stdout.trim() : undefined;

  let ahead = 0,
    behind = 0;
  if (hasUpstream) {
    const lr = runGit(
      repoPath,
      ['rev-list', '--left-right', '--count', `${upstreamName}...HEAD`],
      true,
    );
    if (lr.status === 0) {
      const parts = lr.stdout.trim().split(/\s+/);
      if (parts.length >= 2) {
        // For "upstream...HEAD": parts[0] = behind, parts[1] = ahead
        behind = Number(parts[0]) || 0;
        ahead = Number(parts[1]) || 0;
      }
    }
  }

  const uncommitted = getLocalChanges(repoPath).length;

  return { branch, upstream: upstreamName, ahead, behind, uncommitted };
}

export async function getBranchStatusAsync(
  repoPath: string,
): Promise<BranchStatus> {
  const branch =
    (
      await runGitAsync(repoPath, ['branch', '--show-current'], {
        silent: true,
      })
    ).stdout.trim() || '(detached)';

  const upstream = await runGitAsync(
    repoPath,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { silent: true },
  );
  const hasUpstream =
    upstream.status === 0 && upstream.stdout.trim().length > 0;
  const upstreamName = hasUpstream ? upstream.stdout.trim() : undefined;

  let ahead = 0,
    behind = 0;
  if (hasUpstream) {
    const lr = await runGitAsync(
      repoPath,
      ['rev-list', '--left-right', '--count', `${upstreamName}...HEAD`],
      { silent: true },
    );
    if (lr.status === 0) {
      const parts = lr.stdout.trim().split(/\s+/);
      if (parts.length >= 2) {
        behind = Number(parts[0]) || 0;
        ahead = Number(parts[1]) || 0;
      }
    }
  }

  const uncommitted = (
    await runGitAsync(repoPath, ['status', '--porcelain'], { silent: true })
  ).stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;

  return { branch, upstream: upstreamName, ahead, behind, uncommitted };
}

export function stashSave(
  repoPath: string,
  message: string,
): { ok: boolean; ref?: string } {
  const save = runGit(repoPath, ['stash', 'push', '-u', '-m', message], true);
  if (save.status !== 0) return { ok: false };
  // When there is nothing to stash, git exits 0 but outputs "No local changes to save".
  // In that case we must not touch any pre-existing stash the user may have.
  const combined = save.stdout + save.stderr;
  if (combined.includes('No local changes to save')) return { ok: true };
  // Find the stash by searching for our exact message in the stash list,
  // rather than blindly grabbing stash@{0} which could be the user's own stash.
  const list = runGit(repoPath, ['stash', 'list', '--format=%gd\t%s'], true);
  const ref =
    list.status === 0
      ? list.stdout
          .split(/\r?\n/)
          .find((l) => l.includes(message))
          ?.split('\t')[0]
          ?.trim()
      : undefined;
  return { ok: true, ref };
}

export function stashApply(
  repoPath: string,
  stashRef?: string,
): { ok: boolean } {
  const target = stashRef?.length ? stashRef : undefined;
  const apply = runGit(
    repoPath,
    target ? ['stash', 'apply', target] : ['stash', 'apply'],
    true,
  );
  return { ok: apply.status === 0 };
}

export function stashDrop(repoPath: string, stashRef?: string) {
  if (stashRef?.length) runGit(repoPath, ['stash', 'drop', stashRef], true);
  else runGit(repoPath, ['stash', 'drop'], true);
}
