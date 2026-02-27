import chalk from 'chalk';
import prompts from 'prompts';
import {getDefaultBranch, getRepos, runGit} from './core';

type BranchInfo = {
  name: string;
  raw: string;
  isCurrent: boolean;
  hasUpstream: boolean;
  upstreamGone: boolean;
  upstreamName?: string;
  ahead?: number;
  behind?: number;
};

function parseBranchVV(output: string): BranchInfo[] {
  const lines = output
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  return lines.map((line) => {
    const isCurrent = line.startsWith('*');
    const content = line.replace(/^\*\s+/, '').trimStart();
    const [maybeName, ...rest] = content.split(/\s+/);
    const name = maybeName || content; // ensure concrete string
    const restStr = rest.join(' ');
    const bracket = restStr.match(/\[(.+?)\]/);
    let hasUpstream = false;
    let upstreamGone = false;
    let upstreamName: string | undefined;
    let ahead: number | undefined;
    let behind: number | undefined;
    if (bracket && typeof bracket[1] === 'string') {
      const inner = bracket[1] as string;
      if (inner.includes('gone')) {
        upstreamGone = true;
        hasUpstream = true;
      } else {
        hasUpstream = true;
        // example: origin/feature/foo: ahead 2, behind 1
        const m = inner.match(/([^:]+)(?::\s*(.*))?/);
        if (m) {
          upstreamName = m[1];
          const status = m[2] || '';
          const a = status.match(/ahead\s+(\d+)/);
          const b = status.match(/behind\s+(\d+)/);
          if (a) ahead = Number(a[1]);
          if (b) behind = Number(b[1]);
        }
      }
    }
    return {
      name,
      raw: line,
      isCurrent,
      hasUpstream,
      upstreamGone,
      upstreamName,
      ahead,
      behind,
    };
  });
}

function formatInfo(b: BranchInfo): string {
  const tags: string[] = [];
  if (b.isCurrent) tags.push(chalk.cyan('current'));
  if (!b.hasUpstream) tags.push(chalk.yellow('no-upstream'));
  if (b.upstreamGone) tags.push(chalk.red('gone'));
  if ((b.ahead ?? 0) > 0) tags.push(chalk.yellow(`ahead ${b.ahead}`));
  if ((b.behind ?? 0) > 0) tags.push(chalk.yellow(`behind ${b.behind}`));
  const up = b.upstreamName ? ` -> ${chalk.gray(b.upstreamName)}` : '';
  const tagStr = tags.length ? ` [${tags.join(', ')}]` : '';
  return `${b.name}${up}${tagStr}`;
}

export async function cleanupBranches(options: { remote?: boolean } = {}) {
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
        message: `Select repository to cleanup ${options.remote ? 'remote' : 'local'} branches`,
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

  // Fetch for updated info
  if (options.remote) {
    console.log(chalk.gray(`Fetching all and pruning for ${repo}...`));
    runGit(repo, ['fetch', '--all', '--prune'], true);
  } else {
    runGit(repo, ['fetch', '--all'], true);
  }

  const mainBranch = getDefaultBranch(repo);
  let toDelete: string[] = [];
  let parsed: BranchInfo[] = [];

  if (options.remote) {
    const res = runGit(repo, ['branch', '-r', '--no-color'], true);
    const lines = res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.includes('->'));

    console.log(`\nRemote branches for ${repo}:\n`);
    lines.forEach((l) => console.log(`  - ${l}`));

    const choices = lines.map((name) => {
      const isMain =
        name.endsWith(`/${mainBranch}`) || name === `origin/${mainBranch}`;
      return {
        title: name,
        value: name,
        disabled: isMain,
        description: isMain ? `protected (${mainBranch})` : undefined,
      };
    });

    try {
      const resp = await prompts(
        {
          type: 'multiselect',
          name: 'branches',
          message: 'Select REMOTE branches to delete',
          choices,
          hint: '- Space to select. Enter to confirm',
          instructions: false,
        },
        { onCancel: () => true },
      );
      toDelete = (resp.branches ?? []) as string[];
    } catch {
      console.log('Prompt cancelled.');
      return;
    }
  } else {
    const res = runGit(repo, ['branch', '-vv', '--no-color'], true);
    parsed = parseBranchVV(res.stdout);

    console.log(`\nLocal branches for ${repo}:\n`);
    for (const b of parsed) {
      console.log('  - ' + formatInfo(b));
    }

    const choices = parsed.map((b) => {
      const disabled = b.isCurrent || b.name === mainBranch;
      const disableMsg = b.isCurrent
        ? 'cannot delete current'
        : b.name === mainBranch
          ? `protected (${mainBranch})`
          : undefined;
      return {
        title: formatInfo(b),
        value: b.name,
        disabled,
        description: disableMsg,
      } as const;
    });

    try {
      const resp = await prompts(
        {
          type: 'multiselect',
          name: 'branches',
          message: 'Select local branches to delete',
          choices,
          hint: '- Space to select. Enter to confirm',
          instructions: false,
        },
        { onCancel: () => true },
      );
      toDelete = (resp.branches ?? []) as string[];
    } catch {
      console.log('Prompt cancelled.');
      return;
    }
  }

  if (!toDelete.length) {
    console.log('No branches selected. Nothing to do.');
    return;
  }

  const confirm = await prompts(
    {
      type: 'confirm',
      name: 'ok',
      message: options.remote
        ? chalk.red(
            `CRITICAL: Delete ${toDelete.length} REMOTE branch(es) from origin? This cannot be easily undone.`,
          )
        : `Delete ${toDelete.length} local branch(es) in ${repo}?`,
      initial: false,
    },
    { onCancel: () => true },
  );

  if (!confirm.ok) {
    console.log('Cancelled. No changes made.');
    return;
  }

  for (const b of toDelete) {
    if (options.remote) {
      // b is like "origin/feature/foo"
      const parts = b.split('/');
      const remote = parts[0];
      const branchName = parts.slice(1).join('/');
      console.log(`Deleting remote branch ${branchName} from ${remote}...`);
      const out = runGit(repo, ['push', remote, '--delete', branchName], true);
      if (out.status !== 0) {
        console.log(chalk.red(`Failed to delete remote branch '${b}'.`));
        if (out.stderr) process.stderr.write(out.stderr);
      } else {
        console.log(chalk.green(`Deleted remote branch '${b}'.`));
      }
    } else {
      console.log(`Deleting ${b} ...`);
      const out = runGit(repo, ['branch', '-d', b], true);
      if (out.status !== 0) {
        const meta = parsed.find((x) => x.name === b);
        if (meta?.upstreamGone) {
          console.log(chalk.yellow(`Force deleting '${b}' (upstream gone).`));
          runGit(repo, ['branch', '-D', b]);
        } else {
          console.log(
            chalk.red(`Failed to delete '${b}'. It may be unmerged.`),
          );
          if (out.stderr) process.stderr.write(out.stderr);
        }
      } else {
        process.stdout.write(out.stdout);
      }
    }
  }

  console.log(chalk.green('Cleanup complete.'));
}
