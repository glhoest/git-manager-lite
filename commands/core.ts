import {spawn, spawnSync} from "node:child_process";
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import prompts from "prompts";

const GML_VERBOSE = ((): boolean => {
    const v = String(process.env.GML_VERBOSE ?? "").toLowerCase();
    return v === "1" || v === "true" || v === "yes";
})();
const ROOT_DIR = process.cwd();

export function runGit(repoPath: string, gitArgs: string[], silent: boolean = false) {
    if (GML_VERBOSE) {
        console.debug(`[${repoPath}] git ${gitArgs.join(" ")}`);
    }

    const result = spawnSync("git", gitArgs, {
        cwd: repoPath,
        stdio: silent ? "pipe" : "inherit",
        encoding: "utf-8",
    });
    if (result.status !== 0 && !silent) {
        console.error(`\n[Error] ${repoPath} — git ${gitArgs.join(" ")} failed\n`);
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
    options?: { silent?: boolean; onLog?: (line: string) => void }
): Promise<GitResult> {
    const silent = options?.silent ?? false;
    const onLog = options?.onLog;

    if (GML_VERBOSE) {
        const msg = `[${repoPath}] git ${gitArgs.join(" ")}`;
        if (onLog) onLog(msg); else console.debug(msg);
    }

    return await new Promise<GitResult>((resolve) => {
        const child = spawn("git", gitArgs, {
            cwd: repoPath,
            stdio: silent ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
            env: process.env,
        });

        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d) => {
            stdout += d.toString();
            if (!silent && onLog) onLog(d.toString());
        });
        child.stderr?.on("data", (d) => {
            stderr += d.toString();
            if (!silent && onLog) onLog(d.toString());
        });
        child.on("close", (code) => {
            if (code !== 0 && !silent) {
                const msg = `\n[Error] ${repoPath} — git ${gitArgs.join(" ")} failed\n`;
                if (onLog) onLog(msg); else console.error(msg);
            }
            resolve({status: code, stdout, stderr});
        });
    });
}

export function getRepos(): string[] {
    const repos = readdirSync(ROOT_DIR)
        .map((name) => join(ROOT_DIR, name))
        .filter((p) => existsSync(join(p, ".git")));

    if (existsSync(join(ROOT_DIR, ".git"))) {
        repos.unshift(ROOT_DIR);
    }

    // Always order alphabetically for stable output
    return repos.sort((a, b) => a.localeCompare(b));
}

/**
 * Generic helper to process repositories in parallel while keeping output ordered.
 * - Always prints in alphabetical order (as returned by getRepos()).
 * - Optionally lets the user pre-filter the repositories via an interactive multiselect.
 * - Each per-repo handler returns a fully formatted string buffer to be printed.
 */
export async function processReposParallel(
    perRepo: (repo: string) => Promise<string>,
    options?: {
        allowFilter?: boolean;
        emptyMessage?: string;
        filterPromptTitle?: string;
    }
): Promise<void> {
    console.log('Reading repositories... (this may take a while if there are many')
    const emptyMessage = options?.emptyMessage ?? "No git repositories found.";
    const allowFilter = options?.allowFilter ?? false;
    const filterPromptTitle = options?.filterPromptTitle ?? "Select repositories to process";

    const repos = getRepos();
    if (!repos.length) {
        console.log(emptyMessage);
        return;
    }

    let selected = repos;
    if (allowFilter) {
        try {
            const response = await prompts({
                type: "multiselect",
                name: "repos",
                message: filterPromptTitle,
                choices: repos.map((r) => ({title: r, value: r, selected: true})),
                instructions: false,
                hint: "- Space to select. Enter to confirm",
            }, {
                onCancel: () => {
                    console.log("Selection cancelled. No changes made.");
                    return true;
                }
            });
            const picked = (response?.repos ?? []) as string[];
            if (!picked.length) {
                console.log("No repositories selected. Nothing to do.");
                return;
            }
            // Ensure alphabetical order regardless of selection order
            selected = picked.sort((a, b) => a.localeCompare(b));
        } catch {
            console.error("Prompt failed. Aborting.");
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

    const outputs = selected.map(perRepo)

    for (const outputPromise of outputs) {
        const output = await outputPromise;
        console.log(output)
    }
}

export function getDefaultBranch(repoPath: string): string {
    const res = spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
        cwd: repoPath,
        encoding: "utf-8",
    });
    if (res.status === 0 && res.stdout) {
        const match = res.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
        if (match && match[1]) return match[1];
    }
    // fallback
    return existsSync(join(repoPath, ".git", "refs", "heads", "main"))
        ? "main"
        : "master";
}

export function hasChanges(repoPath: string): boolean {
    const result = runGit(repoPath, ["status", "--porcelain"], true);
    return result.stdout.length > 0;
}

export function createTempCommit(repoPath: string) {
    runGit(repoPath, ["add", "--all"]);
    runGit(repoPath, ["reset", "--", ":(glob)**/node_modules/**"]);
    runGit(repoPath, ["commit", "-m", "TEMP: Auto-commit pending changes"]);
}

export type BranchStatus = {
    branch: string;
    upstream?: string;
    ahead: number;
    behind: number;
    uncommitted: number;
};

export function getLocalChanges(repoPath: string): string[] {
    const res = runGit(repoPath, ["status", "--porcelain"], true);
    return res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
}

export function getBranchStatus(repoPath: string): BranchStatus {
    const branch = runGit(repoPath, ["branch", "--show-current"], true).stdout.trim() || "(detached)";

    let upstream = runGit(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], true);
    const hasUpstream = upstream.status === 0 && upstream.stdout.trim().length > 0;
    const upstreamName = hasUpstream ? upstream.stdout.trim() : undefined;

    let ahead = 0, behind = 0;
    if (hasUpstream) {
        const lr = runGit(repoPath, ["rev-list", "--left-right", "--count", `${upstreamName}...HEAD`], true);
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

    return {branch, upstream: upstreamName, ahead, behind, uncommitted};
}

export async function getBranchStatusAsync(repoPath: string): Promise<BranchStatus> {
    const branch = (await runGitAsync(repoPath, ["branch", "--show-current"], {silent: true})).stdout.trim() || "(detached)";

    const upstream = await runGitAsync(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {silent: true});
    const hasUpstream = upstream.status === 0 && upstream.stdout.trim().length > 0;
    const upstreamName = hasUpstream ? upstream.stdout.trim() : undefined;

    let ahead = 0, behind = 0;
    if (hasUpstream) {
        const lr = await runGitAsync(repoPath, ["rev-list", "--left-right", "--count", `${upstreamName}...HEAD`], {silent: true});
        if (lr.status === 0) {
            const parts = lr.stdout.trim().split(/\s+/);
            if (parts.length >= 2) {
                behind = Number(parts[0]) || 0;
                ahead = Number(parts[1]) || 0;
            }
        }
    }

    const uncommitted = (await runGitAsync(repoPath, ["status", "--porcelain"], {silent: true})).stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean).length;

    return {branch, upstream: upstreamName, ahead, behind, uncommitted};
}

export function stashSave(repoPath: string, message: string): { ok: boolean; ref?: string } {
    const save = runGit(repoPath, ["stash", "push", "-u", "-m", message], true);
    if (save.status !== 0) return {ok: false};
    const latest = runGit(repoPath, ["stash", "list", "--format=%gd", "-n", "1"], true);
    const ref = latest.status === 0 ? latest.stdout.trim() : undefined;
    return {ok: Boolean(ref), ref};
}

export function stashApply(repoPath: string, stashRef?: string): { ok: boolean } {
    const target = stashRef && stashRef.length ? stashRef : undefined;
    const apply = runGit(repoPath, target ? ["stash", "apply", target] : ["stash", "apply"], true);
    return {ok: apply.status === 0};
}

export function stashDrop(repoPath: string, stashRef?: string) {
    if (stashRef && stashRef.length) runGit(repoPath, ["stash", "drop", stashRef], true);
    else runGit(repoPath, ["stash", "drop"], true);
}
