#!/usr/bin/env bun
import chalk from 'chalk';
import {
  branches,
  cleanGmlStashes,
  cleanupBranches,
  configCommand,
  initPreset,
  listGmlStashes,
  listRepos,
  listVersion,
  manageBranches,
  scheduleCommand,
  serveCommand,
  switchToMain,
  syncRepos,
} from './commands';

enum Command {
  Sync = 'sync',
  Fetch = 'fetch',
  Main = 'main',
  List = 'list',
  Branches = 'branches',
  Stashes = 'stashes',
  Schedule = 'schedule',
  Config = 'config',
  Serve = 'serve',
  Version = 'version',
  Help = 'help',
}

enum BranchesSubcommand {
  Cleanup = 'cleanup',
  Manage = 'manage',
}

enum StashesSubcommand {
  Clean = 'clean',
}

enum ScheduleSubcommand {
  Setup = 'setup',
  Remove = 'remove',
  Run = 'run',
}

enum ConfigSubcommand {
  Init = 'init',
  Presets = 'presets',
}

// Aliases shown in help output
const ALIASES: Record<string, Command> = {
  master: Command.Main,
  ls: Command.List,
  daemon: Command.Serve,
}

// Typo tolerance — silently accepted, never shown in help
const HIDDEN_ALIASES: Record<string, Command> = {
  sl: Command.List,
  sevre: Command.Serve,
  deamon: Command.Serve,
  demon: Command.Serve,
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
    description: "Shorthand for 'sync --fetch-only'. Fetches all remotes without pulling.",
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
  [Command.List]: {
    description:
      'List repositories and show their current branches in color (green=main/master, red=release/*, yellow=other).',
    usage: `${CLI_NAME} list`,
    options: [],
  },
  [Command.Branches]: {
    description:
      'Show per-repository local branch statistics (total, stale, no upstream, with upstream).',
    usage: `${CLI_NAME} branches [cleanup|manage]`,
    options: [
      'cleanup [--remote] — interactively delete local branches (use --remote for remote branches)',
      'manage             — interactively manage branches (list, filter, switch)',
    ],
  },
  [Command.Stashes]: {
    description:
      'List or clean up GML auto-stashes left behind by interrupted sync operations.',
    usage: `${CLI_NAME} stashes [clean]`,
    options: [
      'clean — Drop all GML auto-stashes (with confirmation)',
    ],
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
  [Command.Serve]: {
    description: 'Start the GML web UI daemon and open it in the browser.',
    usage: `${CLI_NAME} serve [--port <number>] [--no-open]`,
    options: [
      '--port <number> — port to listen on (default: 4321)',
      '--no-open      — do not auto-open browser',
    ],
  },
  [Command.Config]: {
    description: 'Manage GML configuration (.gml file) and presets.',
    usage: `${CLI_NAME} config <subcommand>`,
    options: [
      'init            — create an empty .gml config file if none exists',
      'presets list [name] — list all (or a specific) defined presets',
      'presets add       — interactively create a new preset',
      'presets edit      — interactively edit an existing preset',
      'presets delete    — interactively delete a preset',
      'presets default   — interactively set or clear the default preset',
    ],
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

function resolveCommand(raw: string): Command | undefined {
  const lower = raw.toLowerCase().trim()
  const canonicals = Object.values(Command) as string[]
  if (canonicals.includes(lower)) return lower as Command
  return ALIASES[lower] ?? HIDDEN_ALIASES[lower]
}

function getAliasesForCommand(cmd: Command): string[] {
  return Object.entries(ALIASES)
    .filter(([, target]) => target === cmd)
    .map(([alias]) => alias)
}

const resolvedCommand = resolveCommand(args[0] ?? '')

function showHelp(cmd?: Command) {
  if (!cmd) {
    banner();
    listVersion();
    console.log(`\n${chalk.bold('Commands:')}`);
    const canonicals = Object.values(Command) as Command[]
    for (const c of canonicals) {
      const p = man[c];
      const aliases = getAliasesForCommand(c)
      const aliasStr = aliases.length > 0 ? chalk.gray(` [aliases: ${aliases.join(', ')}]`) : ''
      console.log(`  ${c.padEnd(8)} - ${p.description}${aliasStr}`);
      console.log(`    ${chalk.gray(p.usage)}`);
    }
    return;
  }

  listVersion();
  const page = man[cmd] ?? man.default;
  console.log(`\n${chalk.bold('Description:')} ${page.description}`);
  console.log(`${chalk.bold('Usage:')} ${page.usage}`);
  if (page.options?.length) {
    console.log(chalk.bold('Options:'));
    for (const opt of page.options) console.log(`  ${opt}`);
  }
  const aliases = getAliasesForCommand(cmd)
  if (aliases.length > 0) {
    console.log(`${chalk.bold('Aliases:')} ${aliases.join(', ')}`);
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

if (!resolvedCommand) {
  showHelp();
  process.exit(1);
}

// Support: `gml <command> --help` or `-h`
if (args.includes('--help') || args.includes('-h')) {
  showHelp(resolvedCommand ?? undefined);
  process.exit(0);
}

// Resolve preset from --preset arg (or defaultPreset from .gml config).
// Must run before any command so getRepos() is filtered correctly.
initPreset(parsePresetArg(args));

/**
 * Warning: THERE IS NO TOP LEVEL AWAIT, unhandled promises are expected but we must be careful
 */
switch (resolvedCommand!) {
  case Command.Help:
    showHelp();
    break;

  case Command.Sync:
  case Command.Fetch:
    syncRepos({
      fetchOnly:
        resolvedCommand === Command.Fetch || args.includes('--fetch-only'),
    });
    break;

  case Command.Main:
    switchToMain({ force: args.includes('--force') || args.includes('-f') });
    break;

  case Command.List:
    listRepos();
    break;

  case Command.Branches: {
    const sub = args[1]?.toLowerCase().trim();
    if (sub === BranchesSubcommand.Cleanup) {
      cleanupBranches({ remote: args.includes('--remote') });
    } else if (sub === BranchesSubcommand.Manage) {
      manageBranches();
    } else {
      branches();
    }
    break;
  }

  case Command.Stashes: {
    const sub = args[1]?.toLowerCase().trim();
    if (sub === StashesSubcommand.Clean) {
      cleanGmlStashes();
    } else {
      listGmlStashes();
    }
    break;
  }

  case Command.Schedule:
    scheduleCommand(args.slice(1));
    break;

  case Command.Config:
    configCommand(args.slice(1));
    break;

  case Command.Serve:
    serveCommand(args.slice(1));
    break;

  case Command.Version:
    listVersion();
    break;

  default:
    console.error(`Unknown command: ${args[0]}`);
    process.exit(1);
}
