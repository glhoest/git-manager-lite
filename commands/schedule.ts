import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { syncRepos } from './syncRepos';

export async function scheduleCommand(args: string[]) {
  const sub = args[0]?.toLowerCase();

  switch (sub) {
    case 'setup':
      await setupSchedule();
      break;
    case 'remove':
      await removeSchedule();
      break;
    case 'run':
      // This is the internal entry point for the scheduled task
      await syncRepos({ all: true });
      break;
    default:
      console.log('Usage: gml schedule <setup|remove|run>');
      console.log(
        '\n  setup  - Register a daily/bi-daily sync task with the OS',
      );
      console.log('  remove - Remove the registered sync task');
      console.log(
        '  run    - Manually trigger the sync logic (used by the scheduler)',
      );
      break;
  }
}

async function setupSchedule() {
  const os = platform();
  const exePath = process.argv[0]; // bun
  const scriptPath = process.argv[1]; // index.ts or gml.exe

  // If we're running as a compiled bun exe, scriptPath is the exe.
  // If we're running via `bun index.ts`, scriptPath is index.ts.
  // We want the command that can be executed.
  const command = scriptPath.endsWith('.ts')
    ? `"${exePath}" "${scriptPath}" schedule run`
    : `"${scriptPath}" schedule run`;

  console.log(`Setting up daily sync for: ${command}`);

  if (os === 'win32') {
    setupWindows(command);
  } else if (os === 'darwin') {
    setupMacOS(command);
  } else {
    setupLinux(command);
  }
}

function setupWindows(command: string) {
  const taskName = 'GML_Daily_Sync';
  // Daily at 10:00 AM
  // Using schtasks
  // Escape quotes for CMD/Powershell context
  const escapedCommand = command.replace(/"/g, '\\"');
  const _cmd = `schtasks /create /tn "${taskName}" /tr "${escapedCommand}" /sc daily /st 10:00 /f`;
  const res = spawnSync(
    'schtasks',
    [
      '/create',
      '/tn',
      taskName,
      '/tr',
      command,
      '/sc',
      'daily',
      '/st',
      '10:00',
      '/f',
    ],
    { encoding: 'utf-8' },
  );
  if (res.status === 0) {
    console.log(
      '✅ Windows Task Scheduler entry created successfully (Daily at 10:00 AM).',
    );
  } else {
    console.error('❌ Failed to create Windows Task:', res.stderr);
  }
}

function setupMacOS(command: string) {
  const label = 'com.gml.sync';
  const plistPath = join(
    homedir(),
    'Library',
    'LaunchAgents',
    `${label}.plist`,
  );
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        ${command
          .split(' ')
          .map((arg) => `<string>${arg.replace(/"/g, '')}</string>`)
          .join('\n        ')}
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>10</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`;

  try {
    writeFileSync(plistPath, plist);
    spawnSync('launchctl', ['unload', plistPath]);
    const res = spawnSync('launchctl', ['load', plistPath]);
    if (res.status === 0) {
      console.log(
        '✅ macOS LaunchAgent created successfully (Daily at 10:00 AM).',
      );
    } else {
      console.error('❌ Failed to load LaunchAgent:', res.stderr);
    }
  } catch (e) {
    console.error('❌ Failed to write plist file:', e);
  }
}

function setupLinux(command: string) {
  // Try crontab first
  const cronJob = `0 10 * * * ${command} >> /tmp/gml-sync.log 2>&1`;
  const tempCron = '/tmp/gml_cron';

  try {
    const existing = spawnSync('crontab', ['-l'], { encoding: 'utf-8' });
    let newCron = '';
    if (existing.status === 0) {
      newCron = existing.stdout
        .split('\n')
        .filter((line) => !line.includes('gml schedule run'))
        .join('\n');
    }
    newCron += `${(newCron.endsWith('\n') || newCron === '' ? '' : '\n') + cronJob}\n`;

    writeFileSync(tempCron, newCron);
    const res = spawnSync('crontab', [tempCron]);
    if (res.status === 0) {
      console.log(
        '✅ Linux crontab entry created successfully (Daily at 10:00 AM).',
      );
    } else {
      console.error('❌ Failed to update crontab:', res.stderr);
    }
  } catch (e) {
    console.error('❌ Failed to setup crontab:', e);
  }
}

async function removeSchedule() {
  const os = platform();
  if (os === 'win32') {
    const res = spawnSync(
      'schtasks',
      ['/delete', '/tn', 'GML_Daily_Sync', '/f'],
      { encoding: 'utf-8' },
    );
    if (res.status === 0) console.log('✅ Windows Task removed.');
    else console.error('❌ Failed to remove Windows Task:', res.stderr);
  } else if (os === 'darwin') {
    const label = 'com.gml.sync';
    const plistPath = join(
      homedir(),
      'Library',
      'LaunchAgents',
      `${label}.plist`,
    );
    spawnSync('launchctl', ['unload', plistPath]);
    console.log('✅ macOS LaunchAgent removed.');
  } else {
    const existing = spawnSync('crontab', ['-l'], { encoding: 'utf-8' });
    if (existing.status === 0) {
      const newCron = existing.stdout
        .split('\n')
        .filter((line) => !line.includes('gml schedule run'))
        .join('\n');
      writeFileSync('/tmp/gml_cron_rem', `${newCron}\n`);
      spawnSync('crontab', ['/tmp/gml_cron_rem']);
      console.log('✅ Linux crontab entry removed.');
    }
  }
}
