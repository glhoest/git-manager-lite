import {getDefaultBranch, processReposParallel, runGitAsync} from "./core";

export async function syncRepos() {
    await processReposParallel(async (repo) => {
        let buf = `\n=== Syncing ${repo} ===\n`;
        const log = (line: string) => { /* buffer optional logs if verbose */ };
        await runGitAsync(repo, ["fetch", "--all"], { onLog: log });
        await runGitAsync(repo, ["pull"], { onLog: log });

        const mainBranch = getDefaultBranch(repo);
        const currentBranch = (await runGitAsync(repo, ["branch", "--show-current"], { silent: true })).stdout.trim();

        if (currentBranch !== mainBranch) {
            await runGitAsync(repo, ["fetch", "origin", `${mainBranch}:${mainBranch}`], { onLog: log });
        }

        return buf;
    }, { allowFilter: true, emptyMessage: "No git repositories found.", filterPromptTitle: "Select repositories to sync" });
}
