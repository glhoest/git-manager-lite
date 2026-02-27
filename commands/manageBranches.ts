import chalk from 'chalk';
import prompts from 'prompts';
import { fetchRepo, getRepos, runGit } from './core';

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

async function confirmAndDeleteBranch(branchName: string, repo: string) {
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

  console.log(`Deleting ${branchName}...`);
  const deleteRes = runGit(repo, ['branch', '-D', branchName], true);
  if (deleteRes.status !== 0) {
    console.log(chalk.red(`Failed to delete ${branchName}`));
  } else {
    console.log(chalk.green(`Deleted ${branchName}`));
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

    if (selected === '__EXIT__') return;
    if (selected === '__BACK__') {
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
        await confirmAndDeleteBranch(branchName, repo);
        break;
      case 'switch':
        switchToBranch(branchName, isRemote, repo);
        break;

      default:
        break;
    }
  }
}
