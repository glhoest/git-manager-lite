#!/usr/bin/env bun
import chalk from "chalk";
import {branches, cleanupBranches, listRepos, listVersion, manageBranches, scheduleCommand, switchToMain, syncRepos} from "./commands";


enum Commands {
    Sync = "sync",
    Fetch = "fetch",
    Main = "main",
    Master = "master",
    List = "list",
    Ls = 'ls',
    Sl = 'sl',
    Branches = "branches",
    Cleanup = "cleanup",
    Manage = "manage",
    Schedule = "schedule",
    Version = "version",
    Help = "help"
}

const CLI_NAME = "gml";

const args = Bun.argv.slice(2);

type ManPage = {
    description: string;
    usage: string;
    options?: string[];
}
const man: Record<Commands, ManPage> & { default: ManPage } = {
    [Commands.Sync]: {
        description: "Fetch and pull the latest changes for all repositories under the current directory (including CWD if it is a git repo).",
        usage: `${CLI_NAME} sync [--fetch-only]`,
        options: [
            "--fetch-only — only fetch, do not pull",
            "GML_VERBOSE=1 ... — show underlying git commands"
        ]
    },
    [Commands.Fetch]: {
        description: "Alias of 'sync --fetch-only'.",
        usage: `${CLI_NAME} fetch`,
        options: []
    },
    [Commands.Main]: {
        description: "Interactively switch selected repositories to their default branch (main or master) and hard reset to origin/DEFAULT.",
        usage: `${CLI_NAME} main [--help]`,
        options: [
            "--help, -h — show help for this command"
        ]
    },
    [Commands.Master]: {
        description: "Alias of 'main' — see help for main.",
        usage: `${CLI_NAME} master`,
        options: []
    },
    [Commands.List]: {
        description: "List repositories and show their current branches in color (green=main/master, red=release/*, yellow=other).",
        usage: `${CLI_NAME} list`,
        options: []
    },
    [Commands.Ls]: {
        description: "Alias of 'list' — list repositories and their current branch.",
        usage: `${CLI_NAME} ls`,
        options: []
    },
    [Commands.Sl]: {
        description: "Alias of 'list' (common typo).",
        usage: `${CLI_NAME} sl`,
        options: []
    },
    [Commands.Branches]: {
        description: "Show per-repository local branch statistics (total, stale, no upstream, with upstream).",
        usage: `${CLI_NAME} branches`,
        options: []
    },
    [Commands.Cleanup]: {
        description: "virtual subcommand of 'branches' to interactively delete local branches.",
        usage: `${CLI_NAME} branches cleanup [--remote]`,
        options: [
            "--remote — cleanup remote branches instead of local"
        ]
    },
    [Commands.Manage]: {
        description: "Interactively manage branches (list, filter, switch) for a repository.",
        usage: `${CLI_NAME} branches manage`,
        options: []
    },
    [Commands.Schedule]: {
        description: "Setup and manage a daily sync of all repositories using OS native schedulers.",
        usage: `${CLI_NAME} schedule <setup|remove|run>`,
        options: [
            "setup  — Register a daily sync task",
            "remove — Remove the sync task",
            "run    — Manually trigger the scheduled sync logic"
        ]
    },
    [Commands.Version]: {
        description: "Show the current CLI version.",
        usage: `${CLI_NAME} version`,
        options: []
    },
    [Commands.Help]: {
        description: "Show help for the CLI or a specific command.",
        usage: `${CLI_NAME} help [command]`,
        options: [
            "-h, --help — show general help or help for a command"
        ]
    },
    default: {
        description: "Git Manager Lite — manage multiple repos quickly.",
        usage: `${CLI_NAME} <command> [options]`,
        options: [
            `Commands: ${Object.values(Commands).join(', ')}`
        ]
    }
}

function validateCommand(arg: string | undefined): Commands | undefined {
    return Object.values<Commands>(Commands).find(value => value === arg);
}

const command = validateCommand(args[0]?.toLowerCase().trim());

function showHelp(cmd?: Commands) {
    banner();
    listVersion();
    const page = cmd ? man[cmd] ?? man.default : man.default;
    console.log("\n" + chalk.bold("Description:") + ` ${page.description}`);
    console.log(chalk.bold("Usage:") + ` ${page.usage}`);
    if (page.options && page.options.length) {
        console.log(chalk.bold("Options:"));
        for (const opt of page.options) console.log("  " + opt);
    }
    if (!cmd) {
        console.log("\n" + chalk.bold("Commands:"));
        const unique = [Commands.Sync, Commands.Fetch, Commands.Main, Commands.List, Commands.Branches, Commands.Schedule, Commands.Version, Commands.Help];
        for (const c of unique) {
            const p = man[c];
            console.log(`  ${c.padEnd(8)} - ${p.description}`);
            console.log(`    ${chalk.gray(p.usage)}`);
        }
    }
}

function banner() {
    console.log("\n" +
        "\n" +
        "   █████████   ███   █████                                                 \n" +
        "  ███░░░░░███ ░░░   ░░███                                                  \n" +
        " ███     ░░░  ████  ███████                                                \n" +
        "░███         ░░███ ░░░███░                                                 \n" +
        "░███    █████ ░███   ░███                                                  \n" +
        "░░███  ░░███  ░███   ░███ ███                                              \n" +
        " ░░█████████  █████  ░░█████                                               \n" +
        "  ░░░░░░░░░  ░░░░░    ░░░░░                                                \n" +
        "                                                                           \n" +
        "                                                                           \n" +
        "                                                                           \n" +
        " ██████   ██████                                                           \n" +
        "░░██████ ██████                                                            \n" +
        " ░███░█████░███   ██████   ████████    ██████    ███████  ██████  ████████ \n" +
        " ░███░░███ ░███  ░░░░░███ ░░███░░███  ░░░░░███  ███░░███ ███░░███░░███░░███\n" +
        " ░███ ░░░  ░███   ███████  ░███ ░███   ███████ ░███ ░███░███████  ░███ ░░░ \n" +
        " ░███      ░███  ███░░███  ░███ ░███  ███░░███ ░███ ░███░███░░░   ░███     \n" +
        " █████     █████░░████████ ████ █████░░████████░░███████░░██████  █████    \n" +
        "░░░░░     ░░░░░  ░░░░░░░░ ░░░░ ░░░░░  ░░░░░░░░  ░░░░░███ ░░░░░░  ░░░░░     \n" +
        "                                                ███ ░███                   \n" +
        "                                               ░░██████                    \n" +
        "                                                ░░░░░░                     \n" +
        " █████        ███   █████                                                  \n" +
        "░░███        ░░░   ░░███                                                   \n" +
        " ░███        ████  ███████    ██████                                       \n" +
        " ░███       ░░███ ░░░███░    ███░░███                                      \n" +
        " ░███        ░███   ░███    ░███████                                       \n" +
        " ░███      █ ░███   ░███ ███░███░░░                                        \n" +
        " ███████████ █████  ░░█████ ░░██████                                       \n" +
        "░░░░░░░░░░░ ░░░░░    ░░░░░   ░░░░░░                                        \n" +
        "\n")
}

if (!command) {
    showHelp();
    process.exit(1);
}

// Support: `gml <command> --help` or `-h`
if (args.includes('--help') || args.includes('-h')) {
    showHelp(command);
    process.exit(0);
}


/**
 * Warning: THERE IS NO TOP LEVEL AWAIT, unhandled promises are expected but we must be careful
 */
switch (command) {
    case Commands.Help: {
        const target = validateCommand(args[1]?.toLowerCase().trim());
        showHelp(target);
        break;
    }
    case Commands.Sync:
    case Commands.Fetch:
        syncRepos({
            fetchOnly: command === Commands.Fetch || args.includes("--fetch-only")
        });
        break;
    case Commands.Main:
    case Commands.Master:
        switchToMain();
        break;
    case Commands.List:
    case Commands.Ls:
    case Commands.Sl:
        listRepos();
        break;
    case Commands.Branches:
        const sub = args[1]?.toLowerCase().trim();
        if (sub === Commands.Cleanup) {
            cleanupBranches({ remote: args.includes("--remote") });
        } else if (sub === Commands.Manage) {
            manageBranches();
        } else {
            branches();
        }
        break;
    case Commands.Schedule:
        scheduleCommand(args.slice(1));
        break;
    case Commands.Version:
        listVersion();
        break;
    default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
}
