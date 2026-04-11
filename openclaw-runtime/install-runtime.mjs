import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const lockfilePath = path.join(runtimeDir, 'package-lock.json');
const npmCacheDir = path.join(runtimeDir, '.npm-cache');

function createCommandSpec(command, args) {
  return {
    command: process.platform === 'win32' ? `${command}.cmd` : command,
    args,
  };
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: runtimeDir,
      env: {
        ...process.env,
        npm_config_cache: npmCacheDir,
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

export async function installRuntime() {
  const npmCommand = 'npm';
  const installArgs = ['--omit=peer', '--no-audit', '--no-fund'];

  if (fs.existsSync(lockfilePath)) {
    try {
      await run(npmCommand, ['ci', ...installArgs]);
      return;
    } catch (error) {
      console.warn('openclaw-runtime npm ci failed, falling back to npm install --prefer-offline.');
      console.warn(error instanceof Error ? error.message : String(error));
    }
  }

  await run(npmCommand, ['install', ...installArgs, '--prefer-offline']);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await installRuntime();
}
