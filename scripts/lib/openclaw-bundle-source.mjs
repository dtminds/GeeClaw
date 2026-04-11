import fs from 'node:fs';
import path from 'node:path';

export function getOpenClawRuntimeRoot(rootDir) {
  return path.join(rootDir, 'openclaw-runtime');
}

export function getOpenClawRuntimeNodeModulesDir(rootDir) {
  return path.join(getOpenClawRuntimeRoot(rootDir), 'node_modules');
}

export function getOpenClawRuntimeOpenClawDir(rootDir) {
  return path.join(getOpenClawRuntimeNodeModulesDir(rootDir), 'openclaw');
}

function hasPackageJson(dir, fsImpl) {
  return fsImpl.existsSync(path.join(dir, 'package.json'));
}

export function resolveOpenClawBundleSource(rootDir, fsImpl = fs) {
  const runtimeRoot = getOpenClawRuntimeRoot(rootDir);
  const runtimeNodeModulesDir = getOpenClawRuntimeNodeModulesDir(rootDir);
  const runtimeOpenClawDir = getOpenClawRuntimeOpenClawDir(rootDir);

  if (hasPackageJson(runtimeOpenClawDir, fsImpl)) {
    return {
      mode: 'runtime-install',
      label: 'repo-local openclaw-runtime install',
      openclawDir: runtimeOpenClawDir,
      nodeModulesDir: runtimeNodeModulesDir,
      runtimeRoot,
    };
  }

  const workspaceNodeModulesDir = path.join(rootDir, 'node_modules');
  const workspaceOpenClawDir = path.join(workspaceNodeModulesDir, 'openclaw');
  if (fsImpl.existsSync(workspaceOpenClawDir)) {
    return {
      mode: 'workspace-node_modules',
      label: 'workspace node_modules/openclaw',
      openclawDir: workspaceOpenClawDir,
      nodeModulesDir: workspaceNodeModulesDir,
      runtimeRoot: null,
    };
  }

  return null;
}
