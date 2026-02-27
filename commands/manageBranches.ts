import chalk from 'chalk';
import prompts from 'prompts';
import { fetchRepo, getRepos, runGit } from './core';

type DeletedBranchBackup = {
  branchName: string;
  sha: string;
  backupRef: string;
};

function makeSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeRefPart(value: string) {
  return value.replace(/[^A-Za-z0-9/_-]/g, '_');
}

function createBackupRef(
  repo: string,
  branchName: string,
  sessionId: string,
): DeletedBranchBackup | null {
  const revRes = runGit(repo, ['rev-parse', branchName], true);
  if (revRes.status !== 0) {
    console.log(chalk.red(`Failed to resolve ${branchName} for backup.`));
    return null;
  }

  const sha = revRes.stdout.trim();
  const backupRef = `refs/safe-delete/${sanitizeRefPart(sessionId)}/${sanitizeRefPart(branchName)}`;
  const backupRes = runGit(repo, ['update-ref', backupRef, sha], true);

  if (backupRes.status !== 0) {
    console.log(chalk.red(`Failed to create backup ref for ${branchName}.`));
    return null;
  }

  return { branchName, sha, backupRef };
}

function removeBackupRef(repo: string, backupRef: string) {
  const res = runGit(repo, ['update-ref', '-d', backupRef], true);
  return res.status === 0;
}

function restoreBranchFromBackup(repo: string, backup: DeletedBranchBackup) {
  const restoreRes = runGit(
    repo,
    ['branch', backup.branchName, backup.sha],
    true,
  );
  if (restoreRes.status !== 0) {
    console.log(chalk.red(`Failed to restore ${backup.branchName}.`));
    if (restoreRes.stderr) process.stderr.write(restoreRes.stderr);
    return false;
  }

  console.log(chalk.green(`Restored ${backup.branchName}.`));
  return true;
}

function switchToBranch(branchName: string, isRemote: boolean, repo: string) {
  console.log(`Switching to ${branchName}...`);
  let checkoutName = branchName;
  if (isRemote) {
    // if it's origin/feature-x, we want to checkout feature-x
    const parts = branchName.split('/');
    checkoutName = parts.slice(1).join('/');
  }

  const out = runGit(repo, ['checkout', checkoutName], true);
  if (out.status !== 0) {
    console.log(chalk.red(`Failed to switch to ${checkoutName}`));
    if (out.stderr) process.stderr.write(out.stderr);
  } else {
    console.log(chalk.green(`Switched to ${checkoutName}`));
  }
}

async function confirmAndDeleteBranch(
  branchName: string,
  repo: string,
  sessionId: string,
  deletedBackups: DeletedBranchBackup[],
) {
  const confirm = await prompts(
    {
      type: 'confirm',
      name: 'value',
      message: `Are you sure you want to delete ${chalk.bold(branchName)} in ${chalk.bold(repo)}?`,
      initial: false,
    },
    { onCancel: () => ({ value: false }) },
  );
  if (!confirm.value) {
    console.log(chalk.gray('Deletion cancelled.'));
    return;
  }

  const backup = createBackupRef(repo, branchName, sessionId);
  if (!backup) {
    return;
  }

  console.log(`Deleting ${branchName}...`);
  const deleteRes = runGit(repo, ['branch', '-D', branchName], true);
  if (deleteRes.status !== 0) {
    console.log(chalk.red(`Failed to delete ${branchName}`));
    removeBackupRef(repo, backup.backupRef);
  } else {
    deletedBackups.push(backup);
    console.log(chalk.green(`Deleted ${branchName}.`));
  }
}

async function handleExitForDeletedBranches(
  repo: string,
  deletedBackups: DeletedBranchBackup[],
) {
  if (!deletedBackups.length) return;

  console.log(chalk.yellow('Deleted the following branches:'));
  for (const record of deletedBackups) {
    console.log(`- ${record.branchName}`);
  }

  const response = await prompts(
    {
      type: 'select',
      name: 'action',
      message: 'Choose an option:',
      choices: [
        { title: 'Acknowledge', value: 'ack' },
        {
          title: 'Crap, I made an error, help me bring my branch back',
          value: 'restore',
        },
      ],
    },
    { onCancel: () => ({ action: 'ack' }) },
  );

  if (response.action === 'restore') {
    const restoreResp = await prompts(
      {
        type: 'multiselect',
        name: 'branches',
        message: 'Select branches to restore',
        choices: deletedBackups.map((b) => ({
          title: b.branchName,
          value: b.branchName,
        })),
        min: 1,
      },
      { onCancel: () => ({ branches: [] }) },
    );

    const selected = new Set<string>((restoreResp.branches as string[]) ?? []);
    for (const backup of deletedBackups) {
      if (selected.has(backup.branchName)) {
        restoreBranchFromBackup(repo, backup);
      }
    }
  }

  for (const backup of deletedBackups) {
    removeBackupRef(repo, backup.backupRef);
  }
}

export async function manageBranches() {
  const repos = getRepos();
  if (!repos.length) {
    console.log('No git repositories found.');
    return;
  }

  let repo: string | undefined;
  try {
    const resp = await prompts(
      {
        type: 'select',
        name: 'repo',
        message: 'Select repository to manage branches',
        choices: repos.map((r) => ({ title: r, value: r })),
      },
      {
        onCancel: () => true,
      },
    );
    repo = resp.repo as string | undefined;
  } catch {
    console.log('Prompt cancelled.');
    return;
  }

  if (!repo) {
    console.log('No repository selected. Aborting.');
    return;
  }

  const sessionId = makeSessionId();
  const deletedBackups: DeletedBranchBackup[] = [];

  // Main interaction loop for the selected repo
  while (true) {
    fetchRepo(repo, true);
    const currentBranchRes = runGit(repo, ['branch', '--show-current'], true);
    const currentBranch = currentBranchRes.stdout.trim();

    // Get all branches (local and remote)
    // -a shows both, -vv shows upstream info
    const branchRes = runGit(repo, ['branch', '-a', '-vv', '--no-color'], true);
    const lines = branchRes.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.includes('->'));

    const choices = lines.map((line) => {
      const isCurrent = line.startsWith('*');
      const cleanLine = line.replace(/^\*\s+/, '');
      // Extract branch name (first token)
      const name = cleanLine.split(/\s+/)[0] || '';

      let title = name;
      if (isCurrent) title = chalk.cyan(`* ${name}`);
      else if (name?.startsWith('remotes/')) title = chalk.yellow(name);

      // Add some metadata if available (like [ahead 1])
      const bracketMatch = cleanLine.match(/\[(.*?)\]/);
      if (bracketMatch) {
        title += ` ${chalk.gray(`[${bracketMatch[1]}]`)}`;
      }

      return {
        title: title || '',
        value: name || '',
        description: isCurrent ? '(current)' : undefined,
      };
    });

    const actionResp = await prompts(
      [
        {
          type: 'autocomplete',
          name: 'branch',
          message: `Manage branches in ${chalk.bold(repo)} (current: ${chalk.cyan(currentBranch)})`,
          choices: [
            {
              title: chalk.gray('<< Back to repo selection'),
              value: '__BACK__',
            },
            { title: chalk.gray('<< Exit'), value: '__EXIT__' },
            ...choices,
          ],
          suggest: (input, choices) => {
            return Promise.resolve(
              choices.filter(
                (c) =>
                  c.title.toLowerCase().includes(input.toLowerCase()) ||
                  c.value.toLowerCase().includes(input.toLowerCase()),
              ),
            );
          },
        },
      ],
      { onCancel: () => ({ branch: '__EXIT__' }) },
    );

    const selected = actionResp.branch as string;

    if (selected === '__EXIT__') {
      await handleExitForDeletedBranches(repo, deletedBackups);
      return;
    }

    if (selected === '__BACK__') {
      await handleExitForDeletedBranches(repo, deletedBackups);
      return manageBranches(); // Recursion to go back to repo selection
    }

    // Branch actions
    let branchName = selected;
    let isRemote = false;
    if (branchName.startsWith('remotes/')) {
      isRemote = true;
      // remotes/origin/main -> origin/main
      branchName = branchName.replace('remotes/', '');
    }

    const actions = [
      { title: 'Switch to this branch', value: 'switch' },
      { title: 'Delete this branch', value: 'delete' },
      { title: 'Cancel', value: 'cancel' },
    ];

    const actionChoice = await prompts(
      {
        type: 'select',
        name: 'action',
        message: `Action for ${chalk.bold(branchName)}`,
        choices: actions,
      },
      { onCancel: () => ({ action: 'cancel' }) },
    );

    // Important, keep this switch clean and implement the logic as separate functions
    switch (actionChoice.action) {
      case 'delete':
        await confirmAndDeleteBranch(
          branchName,
          repo,
          sessionId,
          deletedBackups,
        );
        break;
      case 'switch':
        switchToBranch(branchName, isRemote, repo);
        break;

      default:
        break;
    }
  }
}
