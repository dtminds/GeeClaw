export interface EnvironmentEntryLike {
  key: string;
  value: string;
}

export interface EnvironmentEntryValidationResult {
  emptyRows: number[];
  incompleteRows: number[];
  duplicateKeys: string[];
}

export function validateEnvironmentEntries(
  entries: EnvironmentEntryLike[],
): EnvironmentEntryValidationResult {
  const emptyRows: number[] = [];
  const incompleteRows: number[] = [];
  const seenKeys = new Set<string>();
  const duplicateKeys = new Set<string>();

  entries.forEach((entry, index) => {
    const key = entry.key.trim();
    const value = entry.value.trim();
    const hasKey = key.length > 0;
    const hasValue = value.length > 0;

    if (!hasKey && !hasValue) {
      emptyRows.push(index + 1);
      return;
    }

    if (hasKey !== hasValue) {
      incompleteRows.push(index + 1);
      return;
    }

    if (seenKeys.has(key)) {
      duplicateKeys.add(key);
      return;
    }

    seenKeys.add(key);
  });

  return {
    emptyRows,
    incompleteRows,
    duplicateKeys: [...duplicateKeys],
  };
}
