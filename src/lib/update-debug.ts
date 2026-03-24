export const DEV_UPDATE_DEBUG_STORAGE_KEY = 'geeclaw:debug-update';

type DebugUpdateStatus = 'available' | 'downloading' | 'downloaded';

type DebugProgressInfo = {
  total: number;
  delta: number;
  transferred: number;
  percent: number;
  bytesPerSecond: number;
};

type DebugReleaseNoteInfo = {
  version?: string;
  note?: string | null;
};

type DebugUpdateInfo = {
  version: string;
  releaseDate?: string;
  releaseName?: string | null;
  releaseNotes?: string | DebugReleaseNoteInfo[] | null;
};

export interface DevDebugUpdateScenario {
  status: DebugUpdateStatus;
  updateInfo: DebugUpdateInfo;
  progress: DebugProgressInfo | null;
  autoInstallCountdown: number | null;
  dismissedAnnouncementVersion?: string | null;
  skippedVersions?: string[];
}

type DebugUpdatePayload = {
  status?: DebugUpdateStatus;
  version?: string;
  releaseDate?: string;
  releaseName?: string | null;
  releaseNotes?: string | DebugReleaseNoteInfo[] | null;
  progress?: Partial<DebugProgressInfo> | null;
  autoInstallCountdown?: number | null;
  dismissedAnnouncementVersion?: string | null;
  skippedVersions?: string[];
};

function defaultReleaseNotes(version: string): string {
  return `## DEV Update Preview

- Testing the startup update dialog UI
- Previewing release note rendering for ${version}
- Verifying skip / later / install actions`;
}

function buildDefaultScenario(status: DebugUpdateStatus): DevDebugUpdateScenario {
  const version = '9.9.9-dev.1';
  const releaseDate = new Date().toISOString();
  const updateInfo: DebugUpdateInfo = {
    version,
    releaseDate,
    releaseName: `GeeClaw ${version}`,
    releaseNotes: defaultReleaseNotes(version),
  };

  if (status === 'downloading') {
    return {
      status,
      updateInfo,
      progress: {
        total: 100 * 1024 * 1024,
        delta: 2 * 1024 * 1024,
        transferred: 42 * 1024 * 1024,
        percent: 42,
        bytesPerSecond: 3 * 1024 * 1024,
      },
      autoInstallCountdown: null,
    };
  }

  if (status === 'downloaded') {
    return {
      status,
      updateInfo,
      progress: null,
      autoInstallCountdown: 5,
    };
  }

  return {
    status,
    updateInfo,
    progress: null,
    autoInstallCountdown: null,
  };
}

function normalizeStatus(value: string | undefined): DebugUpdateStatus | null {
  if (!value) return null;
  if (value === '1' || value === 'true') return 'available';
  if (value === 'available' || value === 'downloading' || value === 'downloaded') return value;
  return null;
}

function normalizeProgress(
  status: DebugUpdateStatus,
  progress: Partial<DebugProgressInfo> | null | undefined,
): DebugProgressInfo | null {
  if (status !== 'downloading') return null;

  const fallback = buildDefaultScenario('downloading').progress;
  if (!fallback) return null;

  return {
    total: typeof progress?.total === 'number' ? progress.total : fallback.total,
    delta: typeof progress?.delta === 'number' ? progress.delta : fallback.delta,
    transferred: typeof progress?.transferred === 'number' ? progress.transferred : fallback.transferred,
    percent: typeof progress?.percent === 'number' ? progress.percent : fallback.percent,
    bytesPerSecond: typeof progress?.bytesPerSecond === 'number' ? progress.bytesPerSecond : fallback.bytesPerSecond,
  };
}

function parseObjectPayload(raw: string): DevDebugUpdateScenario | null {
  try {
    const payload = JSON.parse(raw) as DebugUpdatePayload;
    const status = normalizeStatus(payload.status);
    if (!status) return null;

    const fallback = buildDefaultScenario(status);
    const version = payload.version?.trim() || fallback.updateInfo.version;

    return {
      status,
      updateInfo: {
        version,
        releaseDate: payload.releaseDate || fallback.updateInfo.releaseDate,
        releaseName: payload.releaseName === undefined ? `GeeClaw ${version}` : payload.releaseName,
        releaseNotes: payload.releaseNotes === undefined ? defaultReleaseNotes(version) : payload.releaseNotes,
      },
      progress: normalizeProgress(status, payload.progress),
      autoInstallCountdown: status === 'downloaded'
        ? (typeof payload.autoInstallCountdown === 'number' ? payload.autoInstallCountdown : 5)
        : null,
      dismissedAnnouncementVersion: payload.dismissedAnnouncementVersion,
      skippedVersions: Array.isArray(payload.skippedVersions) ? payload.skippedVersions.filter(Boolean) : undefined,
    };
  } catch {
    return null;
  }
}

function parseRawScenario(raw: string | null): DevDebugUpdateScenario | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    return parseObjectPayload(trimmed);
  }

  const status = normalizeStatus(trimmed);
  return status ? buildDefaultScenario(status) : null;
}

export function getDevDebugUpdateScenario(): DevDebugUpdateScenario | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get('debugUpdate');
  const fromQuery = parseRawScenario(queryValue);
  if (fromQuery) {
    return fromQuery;
  }

  try {
    return parseRawScenario(window.localStorage.getItem(DEV_UPDATE_DEBUG_STORAGE_KEY));
  } catch {
    return null;
  }
}
