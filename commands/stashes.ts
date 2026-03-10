import chalk from 'chalk';
import prompts from 'prompts';
import { GML_STASH_PREFIX, getRepos, runGit } from './core';

type GmlStash = { repo: string; ref: string; subject: string };

function findGmlStashesInRepo(repo: string): GmlStash[] {
  const list = runGit(repo, ['stash', 'list', '--format=%gd\t%s'], true);
  if (list.status !== 0 || !list.stdout.trim()) return [];
  return list.stdout
    .split(/\r?\n/)
    .filter((l) => l.includes(GML_STASH_PREFIX))
    .map((l) => {
      const [ref, ...rest] = l.split('\t');
      return { repo, ref: ref?.trim() ?? '', subject: rest.join('\t') };
    })
    .filter((s) => s.ref);
}

export function listGmlStashes() {
  const repos = getRepos();
  let found = 0;
  for (const repo of repos) {
    const stashes = findGmlStashesInRepo(repo);
    if (!stashes.length) continue;
    found += stashes.length;
    console.log(chalk.bold(repo));
    for (const s of stashes) {
      console.log(`  ${chalk.yellow(s.ref)}  ${chalk.gray(s.subject)}`);
    }
  }
  if (!found) {
    console.log(chalk.gray('No GML auto-stashes found.'));
  }
}

export async function cleanGmlStashes() {
  const repos = getRepos();
  const all: GmlStash[] = repos.flatMap(findGmlStashesInRepo);

  if (!all.length) {
    console.log(chalk.gray('No GML auto-stashes to clean up.'));
    return;
  }

  console.log(chalk.bold(`Found ${all.length} GML auto-stash(es):`));
  for (const s of all) {
    console.log(
      `  ${chalk.yellow(s.ref)}  ${chalk.gray(s.subject)}  ${chalk.dim(`(${s.repo})`)}`,
    );
  }

  const { confirmed } = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: `Drop all ${all.length} GML auto-stash(es)?`,
    initial: false,
  });

  if (!confirmed) {
    console.log('Aborted. No stashes dropped.');
    return;
  }

  // Drop from highest stash index to lowest within each repo.
  // If we drop stash@{1} before stash@{2}, stash@{2} becomes stash@{1} and the ref is wrong.
  const stashIndex = (ref: string) => Number(ref.match(/\{(\d+)\}/)?.[1] ?? 0);
  const sorted = [...all].sort((a, b) => {
    if (a.repo !== b.repo) return 0;
    return stashIndex(b.ref) - stashIndex(a.ref);
  });

  for (const s of sorted) {
    runGit(s.repo, ['stash', 'drop', s.ref], true);
    console.log(`Dropped ${chalk.yellow(s.ref)} in ${chalk.dim(s.repo)}`);
  }
  console.log(chalk.green('Done.'));
}
