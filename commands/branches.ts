import chalk from 'chalk';
import {processReposParallel, runGitAsync} from './core';

type BranchStats = {
  total: number;
  stale: number; // upstream gone
  noUpstream: number;
  withUpstream: number;
};

function parseBranchVV(
  output: string,
): {
  name: string;
  raw: string;
  isCurrent: boolean;
  hasUpstream: boolean;
  isGone: boolean;
}[] {
  const lines = output
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  return lines.map((line) => {
    const isCurrent = line.startsWith('*');
    const raw = line.replace(/^\*\s+/, '').replace(/^\s+/, '');
    // branch name is first token
    const name = raw.split(/\s+/)[0] || raw; // ensure a concrete string
    const hasBracket = raw.includes('[');
    const isGone = raw.includes('[gone]');
    return {
      name,
      raw: line,
      isCurrent,
      hasUpstream:
        hasBracket && !isGone ? true : hasBracket && isGone ? true : hasBracket,
      isGone,
    };
  });
}

function computeStats(parsed: ReturnType<typeof parseBranchVV>): BranchStats {
  const total = parsed.length;
  const stale = parsed.filter((b) => b.isGone).length;
  const noUpstream = parsed.filter((b) => !b.hasUpstream).length;
  const withUpstream = total - noUpstream;
  return { total, stale, noUpstream, withUpstream };
}

export async function branches() {
  await processReposParallel(
    async (repo) => {
      const res = await runGitAsync(repo, ['branch', '-vv', '--no-color'], {
        silent: true,
      });
      const parsed = parseBranchVV(res.stdout);
      const stats = computeStats(parsed);

      const parts = [
        `${chalk.bold('total')}: ${stats.total}`,
        `${chalk.bold('with upstream')}: ${stats.withUpstream}`,
        `${chalk.bold('no upstream')}: ${stats.noUpstream > 0 ? chalk.yellow(stats.noUpstream) : stats.noUpstream}`,
        `${chalk.bold('stale')}: ${stats.stale > 0 ? chalk.red(stats.stale) : stats.stale}`,
      ];

      return `\n=== ${repo} ===\n${parts.join('  |  ')}`;
    },
    { allowFilter: false, emptyMessage: 'No git repositories found.' },
  );
}

export type { BranchStats };
