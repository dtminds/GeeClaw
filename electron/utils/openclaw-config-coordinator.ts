import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';

export type OpenClawConfigDocument = Record<string, unknown>;

export interface OpenClawMutationResult<T> {
  changed: boolean;
  result: T;
}

const OPENCLAW_CONFIG_PATH = join(getOpenClawConfigDir(), 'openclaw.json');

let openClawConfigMutationQueue: Promise<unknown> = Promise.resolve();

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureConfigDir(): Promise<void> {
  await mkdir(getOpenClawConfigDir(), { recursive: true });
}

function ensureCommandsRestart(config: OpenClawConfigDocument): void {
  const commands = (
    config.commands && typeof config.commands === 'object'
      ? { ...(config.commands as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  commands.restart = false;
  config.commands = commands;
}

export async function readOpenClawConfigDocument(): Promise<OpenClawConfigDocument> {
  await ensureConfigDir();

  if (!(await fileExists(OPENCLAW_CONFIG_PATH))) {
    return {};
  }

  try {
    const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as OpenClawConfigDocument;
  } catch {
    return {};
  }
}

export async function writeOpenClawConfigDocument(config: OpenClawConfigDocument): Promise<void> {
  await ensureConfigDir();
  ensureCommandsRestart(config);
  await writeFile(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function mutateOpenClawConfigDocument<T>(
  mutate: (config: OpenClawConfigDocument) => Promise<OpenClawMutationResult<T>> | OpenClawMutationResult<T>,
): Promise<T> {
  const runMutation = async () => {
    const config = await readOpenClawConfigDocument();
    const { changed, result } = await mutate(config);

    if (changed) {
      await writeOpenClawConfigDocument(config);
    }

    return result;
  };

  const queuedMutation = openClawConfigMutationQueue.then(runMutation, runMutation);
  openClawConfigMutationQueue = queuedMutation.then(() => undefined, () => undefined);
  return queuedMutation;
}
