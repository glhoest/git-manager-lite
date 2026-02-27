import chalk from 'chalk';
import {getBranchStatusAsync, processReposParallel, readState} from './core';

export async function listRepos() {
  const state = readState();
  await processReposParallel(
    async (repo) => {
      const status = await getBranchStatusAsync(repo);
      const repoState = state.repos[repo];

      const currentBranch = status.branch;
      const isMain = currentBranch === 'main' || currentBranch === 'master';
      const isRelease =
        currentBranch.startsWith('release/') ||
        currentBranch.startsWith('releases/');
      const colorized = isMain
        ? chalk.green(currentBranch)
        : isRelease
          ? chalk.red(currentBranch)
          : chalk.yellow(currentBranch);

      const divergence = status.upstream
        ? `${chalk.blue(`↑${status.ahead}`)} ${chalk.red(`↓${status.behind}`)}`
        : chalk.gray('no upstream');
      const uncommitted =
        status.uncommitted > 0
          ? chalk.yellow(`+${status.uncommitted}`)
          : chalk.gray(`+0`);

      let syncStatus = '';
      if (repoState) {
        if (repoState.lastSyncSuccess === false) {
          syncStatus = `  ${chalk.bgRed.white(' SYNC FAIL ')} ${chalk.red(repoState.lastSyncError || 'unknown error')}`;
        }
      }

      return `\n\n=== ${repo} ===\n${colorized}  ${divergence}  ${uncommitted}${syncStatus}`;
    },
    { allowFilter: false, emptyMessage: 'No git repositories found.' },
  );
}
