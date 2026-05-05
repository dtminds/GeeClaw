type ParsedVersion = {
  core: number[];
  prerelease: Array<number | string> | null;
};

function parseVersion(version: string): ParsedVersion | null {
  const withoutBuildMetadata = version.trim().replace(/^v/i, '').split('+', 1)[0] ?? '';
  const prereleaseSeparatorIndex = withoutBuildMetadata.indexOf('-');
  const core = prereleaseSeparatorIndex >= 0
    ? withoutBuildMetadata.slice(0, prereleaseSeparatorIndex)
    : withoutBuildMetadata;
  const prerelease = prereleaseSeparatorIndex >= 0
    ? withoutBuildMetadata.slice(prereleaseSeparatorIndex + 1)
    : undefined;
  const parts = core.split('.');
  if (!core || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  return {
    core: parts.map((part) => Number(part)),
    prerelease: prerelease
      ? prerelease.split('.').map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment))
      : null,
  };
}

function comparePrereleaseIdentifiers(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (typeof left === 'number') {
    return -1;
  }
  if (typeof right === 'number') {
    return 1;
  }
  return left.localeCompare(right);
}

function compareParsedVersions(left: ParsedVersion, right: ParsedVersion): number {
  const coreLength = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const leftPart = left.core[index] ?? 0;
    const rightPart = right.core[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  if (!left.prerelease && !right.prerelease) {
    return 0;
  }
  if (!left.prerelease) {
    return 1;
  }
  if (!right.prerelease) {
    return -1;
  }

  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }

    const comparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export function isVersionAtLeast(installedVersion: string | null | undefined, minimumVersion: string): boolean {
  if (!installedVersion) {
    return false;
  }

  const installedParts = parseVersion(installedVersion);
  const minimumParts = parseVersion(minimumVersion);
  if (!installedParts || !minimumParts) {
    return installedVersion.trim() === minimumVersion.trim();
  }

  return compareParsedVersions(installedParts, minimumParts) >= 0;
}
