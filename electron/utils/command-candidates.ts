import path from 'node:path';

const WINDOWS_EXTENSION_PRIORITY = new Map<string, number>([
  ['.exe', 0],
  ['.cmd', 1],
  ['.bat', 2],
  ['.ps1', 3],
]);

function getWindowsCandidatePriority(candidate: string): number {
  const extension = path.win32.extname(candidate).toLowerCase();
  return WINDOWS_EXTENSION_PRIORITY.get(extension) ?? Number.MAX_SAFE_INTEGER;
}

export function sortCommandCandidatesForExecution(
  candidates: string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== 'win32') {
    return [...candidates];
  }

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      priority: getWindowsCandidatePriority(candidate),
    }))
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.index - right.index;
    })
    .map(({ candidate }) => candidate);
}
