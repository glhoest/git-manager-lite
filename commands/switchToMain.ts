import chalk from 'chalk';
import prompts from 'prompts';
import {
    getDefaultBranch,
    getLocalChanges,
    getRepos,
    hasChanges,
    runGit,
    stashApply,
    stashDrop,
    stashSave,
} from './core';

export async function switchToMain() {
  const repos = getRepos();
  if (repos.length === 0) {
    console.log('No git repositories found.');
    return;
  }

  const choices = repos.map((repo) => {
    const mainBranch = getDefaultBranch(repo);
    const currentBranch = runGit(
      repo,
      ['branch', '--show-current'],
      true,
    ).stdout.trim();
    const isOnMain = currentBranch === mainBranch;
    return {
      title: repo,
      value: repo,
      selected: !isOnMain,
      description: isOnMain
        ? chalk.gray('(already on ' + mainBranch + ')')
        : undefined,
    };
  });

  let selected: string[] = [];
  try {
    const response = await prompts(
      {
        type: 'multiselect',
        name: 'selected',
        message: 'Select repositories to switch to main/master',
        choices,
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
    selected = (response?.selected ?? []) as string[];
  } catch {
    console.error('Prompt failed. Aborting.');
    return;
  }

  if (!selected.length) {
    console.log('No repositories selected. Nothing to do.');
    return;
  }

  console.log(
    `\nProceeding to switch ${selected.length} repo(s) to main/master...`,
  );

  const unstashFailures: { repo: string; stashRef?: string }[] = [];
  let abortAll = false;

  for (const repo of selected) {
    if (abortAll) break;
    console.log(`\n\n\n\n=== Switching ${repo} to main/master ===`);
    const mainBranch = getDefaultBranch(repo);
    const currentBranch = runGit(
      repo,
      ['branch', '--show-current'],
      true,
    ).stdout.trim();

    console.log(
      `[${repo}] Current branch: `,
      currentBranch || '(detached)',
      '\n',
    );

    let mode: 'continue' | 'stash' | 'reset' = 'continue';
    let stashRef: string | undefined;

    if (hasChanges(repo)) {
      const changes = getLocalChanges(repo);
      if (changes.length) {
        console.log(`[${repo}] Local changes:`);
        for (const line of changes.slice(0, 50)) {
          console.log('  ' + line);
        }
        if (changes.length > 50)
          console.log(`  ... and ${changes.length - 50} more`);
      }

      try {
        const resp = await prompts(
          {
            type: 'select',
            name: 'action',
            message: `[${repo}] Pending changes detected. Choose action:`,
            choices: [
              { title: 'Abort switch (all repos)', value: 'abort' },
              {
                title: 'Stash changes, switch, then try to unstash (safe)',
                value: 'stash',
              },
              { title: 'Reset (discard) changes, then switch', value: 'reset' },
              { title: 'Skip this repo', value: 'skip' },
            ],
            initial: 1,
          },
          {
            onCancel: () => {
              console.log('Action selection cancelled. Aborting.');
              return true;
            },
          },
        );
        const action = (resp?.action ?? 'abort') as string;
        if (action === 'abort') {
          abortAll = true;
          break;
        }
        if (action === 'skip') {
          console.log(`[${repo}] Skipped.`);
          continue;
        }
        if (action === 'stash') mode = 'stash';
        if (action === 'reset') mode = 'reset';
      } catch {
        console.error('Prompt failed. Aborting.');
        return;
      }
    }

    // Prepare working tree per selected mode
    if (mode === 'stash') {
      const res = stashSave(
        repo,
        `gml: auto-stash before switching to ${mainBranch}`,
      );
      if (!res.ok) {
        console.error(
          `[${repo}] Failed to stash changes. Aborting for safety.`,
        );
        abortAll = true;
        break;
      }
      stashRef = res.ref;
      console.log(`[${repo}] Changes stashed as ${stashRef}.`);
    } else if (mode === 'reset') {
      runGit(repo, ['reset', '--hard'], false);
      runGit(repo, ['clean', '-fd'], false);
      console.log(`[${repo}] Working tree reset.`);
    }

    // Switch to main and hard reset to remote
    runGit(repo, ['fetch', '--all']);
    runGit(repo, ['checkout', mainBranch]);
    runGit(repo, ['reset', '--hard', `origin/${mainBranch}`]);

    // Try to unstash if needed
    if (mode === 'stash' && stashRef) {
      const applied = stashApply(repo, stashRef);
      if (applied.ok) {
        // drop the applied stash to avoid clutter
        stashDrop(repo, stashRef);
        console.log(`[${repo}] Stash ${stashRef} applied and dropped.`);
      } else {
        console.warn(
          `[${repo}] Failed to apply ${stashRef}. Your changes are safely kept in stash.`,
        );
        unstashFailures.push({ repo, stashRef });
      }
    }
  }

  if (unstashFailures.length) {
    console.log(
      '\nThe following repositories had issues applying stashed changes:',
    );
    for (const f of unstashFailures) {
      console.log(`- ${f.repo} — stash kept: ${f.stashRef ?? '(unknown)'}`);
    }
    console.log(
      "You can manually apply the stash later using 'git stash list' and 'git stash apply <ref>'.",
    );
  }
}
