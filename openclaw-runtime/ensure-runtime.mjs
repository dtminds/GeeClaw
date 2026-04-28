import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntime } from './install-runtime.mjs';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const runtimePkgPath = path.join(runtimeDir, 'package.json');
const runtimeNodeModulesDir = path.join(runtimeDir, 'node_modules');
const installedOpenClawPkg = path.join(runtimeDir, 'node_modules', 'openclaw', 'package.json');

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isExactVersionSpec(versionSpec) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(versionSpec);
}

function getRequestedOpenClawVersion() {
  const runtimePkg = readJsonFile(runtimePkgPath);
  const versionSpec = runtimePkg?.dependencies?.openclaw;
  return typeof versionSpec === 'string' && isExactVersionSpec(versionSpec)
    ? versionSpec
    : null;
}

function getPackageJsonPath(nodeModulesDir, packageName) {
  return path.join(nodeModulesDir, ...packageName.split('/'), 'package.json');
}

function isDependencyPackageInstalled(packageName) {
  return fs.existsSync(getPackageJsonPath(runtimeNodeModulesDir, packageName))
    || fs.existsSync(getPackageJsonPath(path.join(runtimeNodeModulesDir, 'openclaw', 'node_modules'), packageName));
}

function hasMissingOpenClawDependency(openClawPkg) {
  const dependencies = openClawPkg?.dependencies;
  if (!dependencies || typeof dependencies !== 'object') {
    return false;
  }

  return Object.keys(dependencies).some((packageName) => !isDependencyPackageInstalled(packageName));
}

function isRuntimeCurrent() {
  if (!fs.existsSync(installedOpenClawPkg)) {
    return false;
  }

  const installedOpenClawPkgJson = readJsonFile(installedOpenClawPkg);
  const requestedVersion = getRequestedOpenClawVersion();
  if (requestedVersion && installedOpenClawPkgJson?.version !== requestedVersion) {
    return false;
  }

  return !hasMissingOpenClawDependency(installedOpenClawPkgJson);
}

export async function ensureRuntime() {
  if (isRuntimeCurrent()) {
    return;
  }

  await installRuntime();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await ensureRuntime();
}
