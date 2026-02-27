import chalk from "chalk";
import {
    getDefaultBranch,
    processReposParallel,
    runGitAsync,
    stashApply,
    stashDrop,
    stashSave,
    updateRepoState
} from "./core";

export async function syncRepos(options: { all?: boolean, fetchOnly?: boolean } = {}) {
    const results = await processReposParallel(async (repo) => {
        let buf = `\n=== ${options.fetchOnly ? "Fetching" : "Syncing"} ${repo} ===\n`;
        const log = (line: string) => {
            if (line.trim()) buf += line + (line.endsWith("\n") ? "" : "\n");
        };

        try {
            // 1. Fetch
            await runGitAsync(repo, ["fetch", "--all"], { onLog: log });

            if (options.fetchOnly) {
                updateRepoState(repo, {
                    lastSyncSuccess: true,
                    lastSyncError: undefined,
                    lastSyncTime: new Date().toISOString()
                });
                return { repo, success: true, buf };
            }

            // 2. Stash local changes
            const stash = stashSave(repo, "GML Auto-stash before sync");
            let stashed = false;
            if (stash.ok && stash.ref) {
                stashed = true;
                log(`Stashed local changes: ${stash.ref}`);
            }

            // 3. Pull
            const pullRes = await runGitAsync(repo, ["pull"], { onLog: log });

            // 4. Update default branch if not on it
            const mainBranch = getDefaultBranch(repo);
            const currentBranch = (await runGitAsync(repo, ["branch", "--show-current"], { silent: true })).stdout.trim();
            if (currentBranch !== mainBranch) {
                await runGitAsync(repo, ["fetch", "origin", `${mainBranch}:${mainBranch}`], { onLog: log });
            }

            // 5. Re-apply stash
            let stashError = "";
            if (stashed) {
                const apply = stashApply(repo, stash.ref);
                if (apply.ok) {
                    log("Re-applied stashed changes.");
                    stashDrop(repo, stash.ref);
                } else {
                    stashError = "Conflict while re-applying stashed changes.";
                    log(`\n[ERROR] ${stashError}`);
                }
            }

            const success = pullRes.status === 0 && !stashError;
            if (success) {
                updateRepoState(repo, {
                    lastSyncSuccess: true,
                    lastSyncError: undefined,
                    lastSyncTime: new Date().toISOString()
                });
            } else {
                const error = stashError || `Pull failed with status ${pullRes.status}`;
                updateRepoState(repo, {
                    lastSyncSuccess: false,
                    lastSyncError: error,
                    lastSyncTime: new Date().toISOString()
                });
                return { repo, success: false, error, buf };
            }
            return { repo, success: true, buf };
        } catch (e: any) {
            const msg = e.message || String(e);
            log(`\n[EXCEPTION] ${msg}`);
            updateRepoState(repo, {
                lastSyncSuccess: false,
                lastSyncError: msg,
                lastSyncTime: new Date().toISOString()
            });
            return { repo, success: false, error: msg, buf };
        }
    }, {
        allowFilter: !options.all,
        emptyMessage: "No git repositories found.",
        filterPromptTitle: options.fetchOnly ? "Select repositories to fetch" : "Select repositories to sync"
    });

    if (results && results.length) {
        const failures = results.filter(r => r && !r.success);
        if (failures.length) {
            console.log("\n" + chalk.red.bold("Recap of failed repositories:"));
            for (const f of failures) {
                console.log(chalk.red(`- ${f.repo}: ${f.error}`));
            }
        } else {
            console.log("\n" + chalk.green.bold(`All repositories ${options.fetchOnly ? "fetched" : "synced"} successfully!`));
        }
    }
}
