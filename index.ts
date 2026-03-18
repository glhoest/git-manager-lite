#!/usr/bin/env bun
import chalk from 'chalk';
import {
  branches,
  cleanGmlStashes,
  cleanupBranches,
  initPreset,
  listGmlStashes,
  listRepos,
  listVersion,
  manageBranches,
  scheduleCommand,
  switchToMain,
  syncRepos,
} from './commands';

enum Command {
  Sync = 'sync',
  Fetch = 'fetch',
  Main = 'main',
  Master = 'master',
  List = 'list',
  Ls = 'ls',
  Sl = 'sl',
  Branches = 'branches',
  Cleanup = 'cleanup',
  Manage = 'manage',
  Stashes = 'stashes',
  Clean = 'clean',
  Schedule = 'schedule',
  Version = 'version',
  Help = 'help',
}

const CLI_NAME = 'gml';

const args = Bun.argv.slice(2);

// Parse --preset <name> (supports --preset=<name> and --preset <name>)
function parsePresetArg(rawArgs: string[]): string | undefined {
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a?.startsWith('--preset=')) return a.slice('--preset='.length);
    if (a === '--preset') return rawArgs[i + 1];
  }
  return undefined;
}

type ManPage = {
  description: string;
  usage: string;
  options?: string[];
};
const man: Record<Command, ManPage> & { default: ManPage } = {
  [Command.Sync]: {
    description:
      'Fetch and pull the latest changes for all repositories under the current directory (including CWD if it is a git repo).',
    usage: `${CLI_NAME} sync [--fetch-only]`,
    options: [
      '--fetch-only — only fetch, do not pull',
      'GML_VERBOSE=1 ... — show underlying git commands',
    ],
  },
  [Command.Fetch]: {
    description: "Alias of 'sync --fetch-only'.",
    usage: `${CLI_NAME} fetch`,
    options: [],
  },
  [Command.Main]: {
    description:
      'Interactively switch selected repositories to their default branch (main or master) and hard reset to origin/DEFAULT.',
    usage: `${CLI_NAME} main [--force|-f]`,
    options: [
      '--force, -f — skip prompts, discard local changes, and hard-reset every selected repo to origin/main',
    ],
  },
  [Command.Master]: {
    description: "Alias of 'main' — see help for main.",
    usage: `${CLI_NAME} master`,
    options: [],
  },
  [Command.List]: {
    description:
      'List repositories and show their current branches in color (green=main/master, red=release/*, yellow=other).',
    usage: `${CLI_NAME} list`,
    options: [],
  },
  [Command.Ls]: {
    description:
      "Alias of 'list' — list repositories and their current branch.",
    usage: `${CLI_NAME} ls`,
    options: [],
  },
  [Command.Sl]: {
    description: "Alias of 'list' (common typo).",
    usage: `${CLI_NAME} sl`,
    options: [],
  },
  [Command.Branches]: {
    description:
      'Show per-repository local branch statistics (total, stale, no upstream, with upstream).',
    usage: `${CLI_NAME} branches`,
    options: [
      `${Command.Cleanup.padEnd(10)} - virtual subcommand of 'branches' to interactively delete local branches.`,
      `${Command.Manage.padEnd(10)} - Interactively manage branches (list, filter, switch) for a repository.`,
    ],
  },
  [Command.Cleanup]: {
    description:
      "virtual subcommand of 'branches' to interactively delete local branches.",
    usage: `${CLI_NAME} branches cleanup [--remote]`,
    options: ['--remote — cleanup remote branches instead of local'],
  },
  [Command.Manage]: {
    description:
      'Interactively manage branches (list, filter, switch) for a repository.',
    usage: `${CLI_NAME} branches manage`,
    options: [],
  },
  [Command.Stashes]: {
    description:
      'List or clean up GML auto-stashes left behind by interrupted sync operations.',
    usage: `${CLI_NAME} stashes [clean]`,
    options: [
      `${Command.Clean.padEnd(10)} - Drop all GML auto-stashes (with confirmation)`,
    ],
  },
  [Command.Clean]: {
    description: 'Drop all GML auto-stashes across all repositories.',
    usage: `${CLI_NAME} stashes clean`,
    options: [],
  },
  [Command.Schedule]: {
    description:
      'Setup and manage a daily sync of all repositories using OS native schedulers.',
    usage: `${CLI_NAME} schedule <setup|remove|run>`,
    options: [
      'setup  — Register a daily sync task',
      'remove — Remove the sync task',
      'run    — Manually trigger the scheduled sync logic',
    ],
  },
  [Command.Version]: {
    description: 'Show the current CLI version.',
    usage: `${CLI_NAME} version`,
    options: [],
  },
  [Command.Help]: {
    description: 'Show help for the CLI or a specific command.',
    usage: `${CLI_NAME} help [command]`,
    options: ['-h, --help — show general help or help for a command'],
  },
  default: {
    description: 'Git Manager Lite — manage multiple repos quickly.',
    usage: `${CLI_NAME} <command> [--preset <name>] [options]`,
    options: [
      `Commands: ${Object.values(Command).join(', ')}`,
      '--preset <name> — filter repositories to those in the named preset (defined in .gml)',
      '--preset *      — bypass the defaultPreset and run against all repositories',
    ],
  },
};

function validateCommands(arg: (string | undefined)[]): Command[] | undefined {
  const commands = Object.values<Command>(Command);

  return arg
    .map((c) => c?.toLowerCase()?.trim())
    .filter((c) => c !== undefined || c !== '')
    .filter((c) => commands.includes(c as Command)) as Command[] | undefined;
}

const commands = validateCommands(args.map((c) => c?.toLowerCase().trim()));

function showHelp(cmds?: Command[]) {
  if (!cmds) {
    banner();
    listVersion();
    console.log(`\n${chalk.bold('Commands:')}`);
    const unique = [
      Command.Sync,
      Command.Fetch,
      Command.Main,
      Command.List,
      Command.Branches,
      Command.Stashes,
      Command.Schedule,
      Command.Version,
      Command.Help,
    ];
    for (const c of unique) {
      const p = man[c];
      console.log(`  ${c.padEnd(8)} - ${p.description}`);
      console.log(`    ${chalk.gray(p.usage)}`);
    }
    return;
  }

  listVersion();
  const page = cmds
    ? (man[cmds[cmds.length - 1]!] ?? man.default)
    : man.default;
  console.log(`\n${chalk.bold('Description:')} ${page.description}`);
  console.log(`${chalk.bold('Usage:')} ${page.usage}`);
  if (page.options?.length) {
    console.log(chalk.bold('Options:'));
    for (const opt of page.options) console.log(`  ${opt}`);
  }
}

function banner() {
  console.log(
    '\n' +
      '\n' +
      '   █████████   ███   █████                                                 \n' +
      '  ███░░░░░███ ░░░   ░░███                                                  \n' +
      ' ███     ░░░  ████  ███████                                                \n' +
      '░███         ░░███ ░░░███░                                                 \n' +
      '░███    █████ ░███   ░███                                                  \n' +
      '░░███  ░░███  ░███   ░███ ███                                              \n' +
      ' ░░█████████  █████  ░░█████                                               \n' +
      '  ░░░░░░░░░  ░░░░░    ░░░░░                                                \n' +
      '                                                                           \n' +
      '                                                                           \n' +
      '                                                                           \n' +
      ' ██████   ██████                                                           \n' +
      '░░██████ ██████                                                            \n' +
      ' ░███░█████░███   ██████   ████████    ██████    ███████  ██████  ████████ \n' +
      ' ░███░░███ ░███  ░░░░░███ ░░███░░███  ░░░░░███  ███░░███ ███░░███░░███░░███\n' +
      ' ░███ ░░░  ░███   ███████  ░███ ░███   ███████ ░███ ░███░███████  ░███ ░░░ \n' +
      ' ░███      ░███  ███░░███  ░███ ░███  ███░░███ ░███ ░███░███░░░   ░███     \n' +
      ' █████     █████░░████████ ████ █████░░████████░░███████░░██████  █████    \n' +
      '░░░░░     ░░░░░  ░░░░░░░░ ░░░░ ░░░░░  ░░░░░░░░  ░░░░░███ ░░░░░░  ░░░░░     \n' +
      '                                                ███ ░███                   \n' +
      '                                               ░░██████                    \n' +
      '                                                ░░░░░░                     \n' +
      ' █████        ███   █████                                                  \n' +
      '░░███        ░░░   ░░███                                                   \n' +
      ' ░███        ████  ███████    ██████                                       \n' +
      ' ░███       ░░███ ░░░███░    ███░░███                                      \n' +
      ' ░███        ░███   ░███    ░███████                                       \n' +
      ' ░███      █ ░███   ░███ ███░███░░░                                        \n' +
      ' ███████████ █████  ░░█████ ░░██████                                       \n' +
      '░░░░░░░░░░░ ░░░░░    ░░░░░   ░░░░░░                                        \n' +
      '\n',
  );
}

if (!commands || commands.length === 0) {
  showHelp();
  process.exit(1);
}

// Support: `gml <command> --help` or `-h`
if (
  args.includes('--help') ||
  args.includes('-h') ||
  commands.includes(Command.Help)
) {
  showHelp(commands);
  process.exit(0);
}

// Resolve preset from --preset arg (or defaultPreset from .gml config).
// Must run before any command so getRepos() is filtered correctly.
initPreset(parsePresetArg(args));

/**
 * Warning: THERE IS NO TOP LEVEL AWAIT, unhandled promises are expected but we must be careful
 */
switch (commands[0]) {
  case Command.Help: {
    const target = commands.length > 1 ? commands.slice(1) : undefined;
    showHelp(target);
    break;
  }
  case Command.Sync:
  case Command.Fetch:
    syncRepos({
      fetchOnly:
        commands.includes(Command.Fetch) || args.includes('--fetch-only'),
    });
    break;
  case Command.Main:
  case Command.Master:
    switchToMain({ force: args.includes('--force') || args.includes('-f') });
    break;
  case Command.List:
  case Command.Ls:
  case Command.Sl:
    listRepos();
    break;
  case Command.Branches: {
    const sub = args[1]?.toLowerCase().trim();
    if (sub === Command.Cleanup) {
      cleanupBranches({ remote: args.includes('--remote') });
    } else if (sub === Command.Manage) {
      manageBranches();
    } else {
      branches();
    }
    break;
  }
  case Command.Stashes: {
    const sub = args[1]?.toLowerCase().trim();
    if (sub === Command.Clean) {
      cleanGmlStashes();
    } else {
      listGmlStashes();
    }
    break;
  }
  case Command.Schedule:
    scheduleCommand(args.slice(1));
    break;
  case Command.Version:
    listVersion();
    break;
  default:
    console.error(`Unknown command: ${commands.join(' ')}`);
    process.exit(1);
}
