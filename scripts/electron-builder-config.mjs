import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_CONFIG_PATH = path.join(ROOT_DIR, 'electron-builder.yml');

function normalizeResourceFrom(value) {
  return typeof value === 'string'
    ? value.replace(/\\/g, '/').replace(/\/+$/, '')
    : '';
}

export function shouldUsePrebuiltOpenClawSidecar(env = process.env) {
  if (env.GEECLAW_USE_PREBUILT_OPENCLAW_SIDECAR === '1') {
    return true;
  }

  const lifecycleEvent = typeof env.npm_lifecycle_event === 'string'
    ? env.npm_lifecycle_event
    : '';
  return lifecycleEvent.startsWith('package:release:');
}

export function buildElectronBuilderConfig(baseConfig, { usePrebuiltOpenClawSidecar = false } = {}) {
  if (!usePrebuiltOpenClawSidecar) {
    return baseConfig;
  }

  const extraResources = Array.isArray(baseConfig?.extraResources)
    ? baseConfig.extraResources.filter((entry) => normalizeResourceFrom(entry?.from) !== 'build/openclaw')
    : baseConfig?.extraResources;

  return {
    ...baseConfig,
    extraResources,
  };
}

export function loadBaseElectronBuilderConfig(configPath = BASE_CONFIG_PATH) {
  return yaml.load(fs.readFileSync(configPath, 'utf8'));
}

export default function electronBuilderConfig(request = {}) {
  const projectDir = typeof request.projectDir === 'string' && request.projectDir.length > 0
    ? request.projectDir
    : ROOT_DIR;
  const configPath = path.join(projectDir, 'electron-builder.yml');
  const baseConfig = loadBaseElectronBuilderConfig(configPath);

  return buildElectronBuilderConfig(baseConfig, {
    usePrebuiltOpenClawSidecar: shouldUsePrebuiltOpenClawSidecar(),
  });
}
