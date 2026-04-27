import { app } from 'electron';
import { createRequire } from 'module';
import { join } from 'path';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';

type PackageCandidate = {
  label: string;
  packageJsonPath: string;
};

function getPackageCandidates(): PackageCandidate[] {
  const openclawPath = getOpenClawDir();
  const openclawResolvedPath = getOpenClawResolvedDir();
  const appPath = app.getAppPath();

  return [
    { label: 'openclaw-realpath', packageJsonPath: join(openclawResolvedPath, 'package.json') },
    { label: 'openclaw-path', packageJsonPath: join(openclawPath, 'package.json') },
    { label: 'app', packageJsonPath: join(appPath, 'package.json') },
  ];
}

export function resolveRuntimePackageJson(packageName: string): string {
  const specifier = `${packageName}/package.json`;
  const errors: string[] = [];
  const seenPackageJsonPaths = new Set<string>();

  for (const candidate of getPackageCandidates()) {
    if (seenPackageJsonPaths.has(candidate.packageJsonPath)) {
      continue;
    }
    seenPackageJsonPaths.add(candidate.packageJsonPath);

    try {
      return createRequire(candidate.packageJsonPath).resolve(specifier);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate.label}=${candidate.packageJsonPath}: ${reason}`);
    }
  }

  throw new Error(
    `Failed to resolve "${packageName}" from runtime package candidates. ${errors.join(' | ')}`,
  );
}
