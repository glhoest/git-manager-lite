import { existsSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import chalk from 'chalk';
import prompts from 'prompts';
import { type GmlConfig, getRepos, loadConfig, saveConfig } from './core';

const CONFIG_FILE_PATH = join(process.cwd(), '.gml');

function configMan() {
  console.log(chalk.bold('Usage: gml config <subcommand>'));
  console.log('\nAvailable subcommands:');
  console.log('  init              Create a new .gml config file');
  console.log('  presets           Manage repository presets');
  console.log('\nRun "gml config presets" for preset management options.');
}

function presetsMan() {
  console.log(chalk.bold('Usage: gml config presets <subcommand>'));
  console.log('\nAvailable subcommands:');
  console.log(
    '  list [name]       List all presets or details of a specific preset',
  );
  console.log('  add               Add a new preset');
  console.log('  edit              Edit an existing preset');
  console.log('  delete            Delete a preset');
  console.log('  default           Set or clear the default preset');
}

export async function configCommand(args: string[]) {
  const subcommand = args[0] ?? '';
  const subsubcommand = args[1] ?? '';

  switch (subcommand) {
    case '':
      configMan();
      break;
    case 'init':
      await initConfig();
      break;
    case 'presets':
      switch (subsubcommand) {
        case '':
          presetsMan();
          break;
        case 'list':
          listPresets(args[2]);
          break;
        case 'add':
          await addPreset();
          break;
        case 'edit':
          await editPreset();
          break;
        case 'delete':
          await deletePreset();
          break;
        case 'default':
          await setDefaultPreset();
          break;
        default:
          console.error(
            chalk.red(`Unknown preset subcommand: ${subsubcommand}`),
          );
          process.exit(1);
      }
      break;
    default:
      console.error(chalk.red(`Unknown config subcommand: ${subcommand}`));
      process.exit(1);
  }
}

async function initConfig() {
  if (existsSync(CONFIG_FILE_PATH)) {
    console.warn(
      chalk.yellow(
        `Warning: .gml file already exists at ${CONFIG_FILE_PATH}. No changes made.`,
      ),
    );
    return;
  }
  const newConfig: GmlConfig = { presets: {} };
  writeFileSync(CONFIG_FILE_PATH, JSON.stringify(newConfig, null, 2), 'utf-8');
  console.log(
    chalk.green(`Created empty .gml config file at ${CONFIG_FILE_PATH}.`),
  );
}

function listPresets(presetName?: string) {
  const config = loadConfig();
  if (!config || Object.keys(config.presets).length === 0) {
    console.log('No presets defined in .gml.');
    return;
  }

  if (presetName) {
    if (!(presetName in config.presets)) {
      console.error(chalk.red(`Preset "${presetName}" not found.`));
      process.exit(1);
    }
    console.log(
      chalk.bold(
        `Preset: ${presetName}${config.defaultPreset === presetName ? ' (default)' : ''}`,
      ),
    );
    config.presets[presetName]?.forEach((repo) => {
      console.log(`  - ${repo}`);
    });
  } else {
    console.log(chalk.bold('Presets in .gml:'));
    for (const name in config.presets) {
      const isDefault = config.defaultPreset === name ? ' (default)' : '';
      console.log(
        `  ${name}${isDefault} (${config.presets[name]?.length ?? 0} repos)`,
      );
    }
  }
}

async function addPreset() {
  const config = loadConfig() || { presets: {} };
  const { name } = await prompts({
    type: 'text',
    name: 'name',
    message: 'Enter new preset name:',
    validate: (value) =>
      value && !(value in config.presets)
        ? true
        : 'Preset name is required and must be unique.',
  });

  if (!name) return;

  const repos = getRepos();
  if (!repos.length) {
    console.log(
      chalk.yellow('No git repositories found to add to the preset.'),
    );
    return;
  }

  const { selectedRepos } = await prompts({
    type: 'multiselect',
    name: 'selectedRepos',
    message: 'Select repositories for this preset:',
    choices: repos.map((repo) => ({
      title: basename(repo),
      value: basename(repo),
      selected: false,
    })),
    instructions: false,
    hint: '- Space to select. Enter to confirm',
  });

  if (!selectedRepos) return;

  config.presets[name] = selectedRepos;
  saveConfig(config);
  console.log(
    chalk.green(
      `Preset "${name}" added with ${selectedRepos.length} repositories.`,
    ),
  );
}

async function editPreset() {
  const config = loadConfig();
  if (!config || Object.keys(config.presets).length === 0) {
    console.log('No presets defined to edit.');
    return;
  }

  const { presetToEdit } = await prompts({
    type: 'select',
    name: 'presetToEdit',
    message: 'Select preset to edit:',
    choices: Object.keys(config.presets).map((name) => ({
      title: name,
      value: name,
    })),
  });

  if (!presetToEdit) return;

  const allRepos = getRepos();
  if (!allRepos.length) {
    console.log(chalk.yellow('No git repositories found.'));
    return;
  }

  const currentPresetRepos = new Set(config.presets[presetToEdit]);

  const { selectedRepos } = await prompts({
    type: 'multiselect',
    name: 'selectedRepos',
    message: `Edit repositories for preset "${presetToEdit}":`,
    choices: allRepos.map((repo) => ({
      title: basename(repo),
      value: basename(repo),
      selected: currentPresetRepos.has(basename(repo)),
    })),
    instructions: false,
    hint: '- Space to select. Enter to confirm',
  });

  if (!selectedRepos) return;

  config.presets[presetToEdit] = selectedRepos;
  saveConfig(config);
  console.log(
    chalk.green(
      `Preset "${presetToEdit}" updated with ${selectedRepos.length} repositories.`,
    ),
  );
}

async function deletePreset() {
  const config = loadConfig();
  if (!config || Object.keys(config.presets).length === 0) {
    console.log('No presets defined to delete.');
    return;
  }

  const { presetToDelete } = await prompts({
    type: 'select',
    name: 'presetToDelete',
    message: 'Select preset to delete:',
    choices: Object.keys(config.presets).map((name) => ({
      title: name,
      value: name,
    })),
  });

  if (!presetToDelete) return;

  const { confirmDelete } = await prompts({
    type: 'confirm',
    name: 'confirmDelete',
    message: `Are you sure you want to delete preset "${presetToDelete}"?`,
    initial: false,
  });

  if (!confirmDelete) return;

  delete config.presets[presetToDelete];
  if (config.defaultPreset === presetToDelete) {
    delete config.defaultPreset;
  }
  saveConfig(config);
  console.log(chalk.green(`Preset "${presetToDelete}" deleted.`));
}

async function setDefaultPreset() {
  const config = loadConfig();
  if (!config || Object.keys(config.presets).length === 0) {
    console.log('No presets defined to set as default.');
    return;
  }

  const choices = Object.keys(config.presets).map((name) => ({
    title: name,
    value: name,
  }));
  choices.unshift({ title: '(clear default)', value: '' }); // Option to clear default

  const { defaultPresetName } = await prompts({
    type: 'select',
    name: 'defaultPresetName',
    message: 'Select default preset:',
    choices: choices,
    initial: config.defaultPreset
      ? choices.findIndex((c) => c.value === config.defaultPreset)
      : 0,
  });

  if (defaultPresetName === undefined) return; // User cancelled

  if (defaultPresetName === '') {
    delete config.defaultPreset;
    console.log(chalk.green('Default preset cleared.'));
  } else {
    config.defaultPreset = defaultPresetName;
    console.log(chalk.green(`Default preset set to "${defaultPresetName}".`));
  }
  saveConfig(config);
}
