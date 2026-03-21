import { join } from 'node:path';
import { getOpenClawConfigDir } from './paths';

type SessionDeleteResult = {
  success: boolean;
  error?: string;
};

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\\/.test(value);
}

export async function softDeleteOpenClawSession(sessionKey: string): Promise<SessionDeleteResult> {
  try {
    if (!sessionKey || !sessionKey.startsWith('agent:')) {
      return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
    }

    const parts = sessionKey.split(':');
    if (parts.length < 3) {
      return { success: false, error: `sessionKey has too few parts: ${sessionKey}` };
    }

    const agentId = parts[1];
    const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
    const sessionsJsonPath = join(sessionsDir, 'sessions.json');
    const fsP = await import('node:fs/promises');

    let sessionsJson: Record<string, unknown> = {};
    try {
      const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
      sessionsJson = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      return { success: false, error: `Could not read sessions.json: ${String(error)}` };
    }

    let uuidFileName: string | undefined;
    let resolvedSrcPath: string | undefined;

    if (Array.isArray(sessionsJson.sessions)) {
      const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
        .find((session) => session.key === sessionKey || session.sessionKey === sessionKey);
      if (entry) {
        uuidFileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
        if (!uuidFileName && typeof entry.id === 'string') {
          uuidFileName = `${entry.id}.jsonl`;
        }
      }
    }

    if (!uuidFileName && sessionsJson[sessionKey] != null) {
      const value = sessionsJson[sessionKey];
      if (typeof value === 'string') {
        uuidFileName = value;
      } else if (typeof value === 'object' && value !== null) {
        const entry = value as Record<string, unknown>;
        const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
        if (absFile) {
          if (isAbsolutePath(absFile)) {
            resolvedSrcPath = absFile;
          } else {
            uuidFileName = absFile;
          }
        } else {
          const uuidValue = (entry.id ?? entry.sessionId) as string | undefined;
          if (uuidValue) {
            uuidFileName = uuidValue.endsWith('.jsonl') ? uuidValue : `${uuidValue}.jsonl`;
          }
        }
      }
    }

    if (!uuidFileName && !resolvedSrcPath) {
      return { success: false, error: `Cannot resolve file for session: ${sessionKey}` };
    }

    if (!resolvedSrcPath) {
      if (!uuidFileName!.endsWith('.jsonl')) {
        uuidFileName = `${uuidFileName}.jsonl`;
      }
      resolvedSrcPath = join(sessionsDir, uuidFileName!);
    }

    const dstPath = resolvedSrcPath.replace(/\.jsonl$/, '.deleted.jsonl');

    try {
      await fsP.access(resolvedSrcPath);
      await fsP.rename(resolvedSrcPath, dstPath);
    } catch {
      // Non-fatal. Keep going so sessions.json is still updated.
    }

    try {
      const raw2 = await fsP.readFile(sessionsJsonPath, 'utf8');
      const json2 = JSON.parse(raw2) as Record<string, unknown>;

      if (Array.isArray(json2.sessions)) {
        json2.sessions = (json2.sessions as Array<Record<string, unknown>>)
          .filter((session) => session.key !== sessionKey && session.sessionKey !== sessionKey);
      } else if (json2[sessionKey]) {
        delete json2[sessionKey];
      }

      await fsP.writeFile(sessionsJsonPath, JSON.stringify(json2, null, 2), 'utf8');
    } catch {
      // Non-fatal. The transcript rename already hid the session from most readers.
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
