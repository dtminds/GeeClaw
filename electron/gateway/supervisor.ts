import { utilityProcess } from 'electron';
import { existsSync } from 'fs';
import WebSocket from 'ws';
import { getConfiguredOpenClawRuntime } from '../utils/openclaw-runtime';
import { getOpenClawConfigDir } from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { isPythonReady, setupManagedPython } from '../utils/uv-setup';
import {
  buildManagedOpenClawArgs,
  getManagedOpenClawConfigPath,
} from '../utils/openclaw-managed-profile';
import { PORTS } from '../utils/config';
import { logger } from '../utils/logger';
import { setPathEnvValue } from '../utils/env-path';
import { getGeeClawRuntimePath, getGeeClawRuntimePathEntries } from '../utils/runtime-path';
import type { ManagedGatewayProcess } from './process-launcher';

export function warmupManagedPythonReadiness(): void {
  void isPythonReady().then((pythonReady) => {
    if (!pythonReady) {
      logger.info('Python environment missing or incomplete, attempting background repair...');
      void setupManagedPython().catch((err) => {
        logger.error('Background Python repair failed:', err);
      });
    }
  }).catch((err) => {
    logger.error('Failed to check Python environment:', err);
  });
}

export async function terminateOwnedGatewayProcess(child: ManagedGatewayProcess): Promise<void> {
  const terminateWindowsProcessTree = async (pid: number): Promise<void> => {
    const cp = await import('child_process');
    await new Promise<void>((resolve) => {
      cp.exec(`taskkill /F /PID ${pid} /T`, { timeout: 5000, windowsHide: true }, () => resolve());
    });
  };

  const getUnixDescendantProcessIds = async (pid: number): Promise<number[]> => {
    const cp = await import('child_process');
    const { stdout } = await new Promise<{ stdout: string }>((resolve) => {
      cp.exec('ps -axo pid=,ppid=', { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (err) {
          resolve({ stdout: '' });
        } else {
          resolve({ stdout });
        }
      });
    });

    if (!stdout.trim()) {
      return [];
    }

    const childrenByParent = new Map<number, number[]>();
    for (const line of stdout.trim().split(/\r?\n/)) {
      const [childPidRaw, parentPidRaw] = line.trim().split(/\s+/);
      const childPid = Number.parseInt(childPidRaw ?? '', 10);
      const parentPid = Number.parseInt(parentPidRaw ?? '', 10);
      if (!Number.isFinite(childPid) || !Number.isFinite(parentPid)) {
        continue;
      }
      const siblings = childrenByParent.get(parentPid) ?? [];
      siblings.push(childPid);
      childrenByParent.set(parentPid, siblings);
    }

    const descendants: number[] = [];
    const collect = (parentPid: number): void => {
      const childPids = childrenByParent.get(parentPid) ?? [];
      for (const childPid of childPids) {
        collect(childPid);
        descendants.push(childPid);
      }
    };

    collect(pid);
    return descendants;
  };

  const terminateUnixChildProcesses = async (pid: number, signal: NodeJS.Signals): Promise<void> => {
    const descendantPids = await getUnixDescendantProcessIds(pid);
    for (const descendantPid of descendantPids) {
      try {
        process.kill(descendantPid, signal);
      } catch {
        // ignore if the process already exited
      }
    }
  };

  await new Promise<void>((resolve) => {
    let exited = false;

    const exitListener = () => {
      exited = true;
      clearTimeout(timeout);
      resolve();
    };
    child.once('exit', exitListener);

    const pid = child.pid;
    logger.info(`Sending kill to Gateway process (pid=${pid ?? 'unknown'})`);

    void (async () => {
      if (process.platform === 'win32' && pid) {
        await terminateWindowsProcessTree(pid).catch((error) => {
          logger.warn(`Windows process-tree kill failed for Gateway pid=${pid}:`, error);
        });
        return;
      }

      try {
        child.kill();
      } catch {
        // ignore if already exited
      }

      if (pid) {
        await terminateUnixChildProcesses(pid, 'SIGTERM').catch((error) => {
          logger.warn(`Unix Gateway child-process termination failed for pid=${pid}:`, error);
        });
      }
    })();

    const timeout = setTimeout(() => {
      if (!exited) {
        logger.warn(`Gateway did not exit in time, force-killing (pid=${pid ?? 'unknown'})`);
        if (pid) {
          if (process.platform === 'win32') {
            void terminateWindowsProcessTree(pid).catch((error) => {
              logger.warn(`Forced Windows process-tree kill failed for Gateway pid=${pid}:`, error);
            });
          } else {
            void terminateUnixChildProcesses(pid, 'SIGKILL').catch((error) => {
              logger.warn(`Forced Unix child-process kill failed for Gateway pid=${pid}:`, error);
            });
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              // ignore
            }
          }
        }
      }
      child.off('exit', exitListener);
      resolve();
    }, 5000);
  });
}

export async function unloadLaunchctlGatewayService(): Promise<void> {
  if (process.platform !== 'darwin') return;
  logger.info('Skipping launchctl service unload; GeeClaw no longer modifies system-wide ai.openclaw.gateway launch agents');
}

export async function waitForPortFree(port: number, timeoutMs = 30000, signal?: AbortSignal): Promise<void> {
  const net = await import('net');
  const start = Date.now();
  const pollInterval = 500;
  let logged = false;

  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) {
      logger.debug(`waitForPortFree: aborted while waiting for port ${port}`);
      return;
    }

    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });

    if (available) {
      const elapsed = Date.now() - start;
      if (elapsed > pollInterval) {
        logger.info(`Port ${port} became available after ${elapsed}ms`);
      }
      return;
    }

    if (!logged) {
      logger.info(`Waiting for port ${port} to become available (Windows TCP TIME_WAIT)...`);
      logged = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  logger.error(`Port ${port} still occupied after ${timeoutMs}ms; aborting startup to avoid port conflict`);
  throw new Error(`Port ${port} still occupied after ${timeoutMs}ms`);
}

async function getListeningProcessIds(port: number): Promise<string[]> {
  const cmd = process.platform === 'win32'
    ? `netstat -ano | findstr :${port}`
    : `lsof -i :${port} -sTCP:LISTEN -t`;

  const cp = await import('child_process');
  const { stdout } = await new Promise<{ stdout: string }>((resolve) => {
    cp.exec(cmd, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ stdout: '' });
      } else {
        resolve({ stdout });
      }
    });
  });

  if (!stdout.trim()) {
    return [];
  }

  if (process.platform === 'win32') {
    const pids: string[] = [];
    for (const line of stdout.trim().split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[3] === 'LISTENING') {
        pids.push(parts[4]);
      }
    }
    return [...new Set(pids)];
  }

  return [...new Set(stdout.trim().split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
}

export async function getGatewayListenerProcessIds(port: number): Promise<string[]> {
  return await getListeningProcessIds(port);
}

async function getProcessCommandLine(pid: string): Promise<string> {
  const cp = await import('child_process');

  const command = process.platform === 'win32'
    ? `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId = ${pid}\\").CommandLine"`
    : `ps -o command= -p ${pid}`;

  const { stdout } = await new Promise<{ stdout: string }>((resolve) => {
    cp.exec(command, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ stdout: '' });
      } else {
        resolve({ stdout });
      }
    });
  });

  return stdout.trim();
}

function isLikelyGatewayRelatedCommand(commandLine: string): boolean {
  return /(openclaw|geeclaw|clawx|claw-x)/i.test(commandLine);
}

async function getGatewayRelatedResidualPids(pids: string[]): Promise<string[]> {
  const relatedPids: string[] = [];

  for (const pid of pids) {
    const commandLine = await getProcessCommandLine(pid);
    if (commandLine && isLikelyGatewayRelatedCommand(commandLine)) {
      relatedPids.push(pid);
    }
  }

  return relatedPids;
}

async function probeGatewayWebSocket(port: number): Promise<{ port: number; externalToken?: string } | null> {
  return await new Promise<{ port: number; externalToken?: string } | null>((resolve) => {
    const testWs = new WebSocket(`ws://localhost:${port}/ws`);
    const terminateAndResolve = (result: { port: number; externalToken?: string } | null) => {
      try {
        testWs.terminate();
      } catch {
        // ignore
      }
      resolve(result);
    };
    const timeout = setTimeout(() => {
      terminateAndResolve(null);
    }, 2000);

    testWs.on('open', () => {
      clearTimeout(timeout);
      terminateAndResolve({ port });
    });

    testWs.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

async function terminateOrphanedProcessIds(port: number, pids: string[]): Promise<void> {
  logger.info(`Found orphaned process listening on port ${port} (PIDs: ${pids.join(', ')}), attempting to kill...`);

  if (process.platform === 'darwin') {
    await unloadLaunchctlGatewayService();
  }

  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        const cp = await import('child_process');
        await new Promise<void>((resolve) => {
          cp.exec(
            `taskkill /F /PID ${pid} /T`,
            { timeout: 5000, windowsHide: true },
            () => resolve(),
          );
        });
      } else {
        process.kill(parseInt(pid, 10), 'SIGTERM');
      }
    } catch {
      // Ignore processes that have already exited.
    }
  }

  await new Promise((resolve) => setTimeout(resolve, process.platform === 'win32' ? 2000 : 3000));

  if (process.platform !== 'win32') {
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid, 10), 0);
        process.kill(parseInt(pid, 10), 'SIGKILL');
      } catch {
        // Already exited.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function terminateGatewayListenersOnPort(port: number): Promise<string[]> {
  const pids = await getListeningProcessIds(port);
  if (pids.length === 0) {
    return [];
  }

  await terminateOrphanedProcessIds(port, pids);
  return await getListeningProcessIds(port);
}

export async function findExistingGatewayProcess(options: {
  port: number;
  ownedPid?: number;
  terminateForeignProcess?: boolean;
  allowForeignAttach?: boolean;
  rejectForeignProcess?: boolean;
  reclaimLikelyGatewayResidue?: boolean;
}): Promise<{ port: number; externalToken?: string } | null> {
  const {
    port,
    ownedPid,
    terminateForeignProcess = true,
    allowForeignAttach = false,
    rejectForeignProcess = false,
    reclaimLikelyGatewayResidue = false,
  } = options;

  try {
    const pids = await getListeningProcessIds(port);
    const foreignPids = pids.filter((pid) => !ownedPid || pid !== String(ownedPid));

    if (foreignPids.length > 0) {
      if (terminateForeignProcess) {
        await terminateOrphanedProcessIds(port, foreignPids);
        if (process.platform === 'win32') {
          await waitForPortFree(port, 10000);
        }
        return null;
      }

      const existingGateway = await probeGatewayWebSocket(port);
      if (existingGateway) {
        if (rejectForeignProcess) {
          throw new Error(
            `Port ${port} is already in use by another OpenClaw-compatible process (PIDs: ${foreignPids.join(', ')}). GeeClaw will not attach to or terminate external OpenClaw runtimes.`,
          );
        }

        if (!allowForeignAttach) {
          return null;
        }

        return existingGateway;
      }

      if (reclaimLikelyGatewayResidue) {
        const residualGatewayPids = await getGatewayRelatedResidualPids(foreignPids);
        if (residualGatewayPids.length > 0) {
          logger.warn(
            `Port ${port} is occupied by likely stale GeeClaw/OpenClaw process(es) (PIDs: ${residualGatewayPids.join(', ')}); reclaiming listener before startup`,
          );
          await terminateOrphanedProcessIds(port, residualGatewayPids);
          if (process.platform === 'win32') {
            await waitForPortFree(port, 10000);
          }
          return null;
        }
      }

      if (rejectForeignProcess) {
        throw new Error(
          `Port ${port} is already in use by another process (PIDs: ${foreignPids.join(', ')}). GeeClaw will not attach to or terminate external OpenClaw runtimes.`,
        );
      }

      if (!allowForeignAttach) {
        return null;
      }
    }

    return await probeGatewayWebSocket(port);
  } catch (error) {
    if (error instanceof Error && rejectForeignProcess) {
      throw error;
    }
    logger.warn('Error checking for existing process on port:', error);
    return null;
  }
}

export async function runOpenClawDoctorRepair(): Promise<boolean> {
  const runtime = await getConfiguredOpenClawRuntime();
  const commandPath = runtime.commandPath ?? runtime.entryPath;
  const openclawDir = runtime.dir;
  if (!runtime.packageExists || !commandPath) {
    logger.error(`Cannot run OpenClaw doctor repair: ${runtime.error || 'runtime not found'}`);
    return false;
  }
  if (runtime.entryPath && !existsSync(runtime.entryPath)) {
    logger.error(`Cannot run OpenClaw doctor repair: entry script not found at ${runtime.entryPath}`);
    return false;
  }

  const baseProcessEnv = process.env as Record<string, string | undefined>;
  const pathEntries = getGeeClawRuntimePathEntries(baseProcessEnv);
  const binPathExists = pathEntries.length > 0;
  const baseEnvPatched = setPathEnvValue(baseProcessEnv, getGeeClawRuntimePath(baseProcessEnv));

  const uvEnv = await getUvMirrorEnv();
  const openclawConfigDir = getOpenClawConfigDir();
  const doctorArgs = buildManagedOpenClawArgs('doctor', ['--fix', '--yes', '--non-interactive']);
  logger.info(
    `Running OpenClaw doctor repair (runtime=${runtime.source}, command="${commandPath}", entry="${runtime.entryPath ?? 'n/a'}", args="${doctorArgs.join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'})`,
  );

  return await new Promise<boolean>((resolve) => {
    const forkEnv: Record<string, string | undefined> = {
      ...baseEnvPatched,
      ...uvEnv,
      OPENCLAW_STATE_DIR: openclawConfigDir,
      OPENCLAW_CONFIG_PATH: getManagedOpenClawConfigPath(openclawConfigDir),
      OPENCLAW_GATEWAY_PORT: String(PORTS.OPENCLAW_GATEWAY),
      OPENCLAW_DISABLE_BUNDLED_PLUGINS: '1',
      OPENCLAW_NO_RESPAWN: '1',
    };

    const child = utilityProcess.fork(runtime.entryPath!, doctorArgs, {
      cwd: openclawDir,
      stdio: 'pipe',
      env: forkEnv as NodeJS.ProcessEnv,
    });

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(ok);
    };

    const timeout = setTimeout(() => {
      logger.error('OpenClaw doctor repair timed out after 120000ms');
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish(false);
    }, 120000);

    child.on('error', (err) => {
      if (settled) {
        return;
      }
      logger.error('Failed to spawn OpenClaw doctor repair process:', err);
      finish(false);
    });

    child.stdout?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        const normalized = line.trim();
        if (!normalized) continue;
        logger.debug(`[Gateway doctor stdout] ${normalized}`);
      }
    });

    child.stderr?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        const normalized = line.trim();
        if (!normalized) continue;
        logger.warn(`[Gateway doctor stderr] ${normalized}`);
      }
    });

    child.on('exit', (code: number) => {
      if (settled) {
        logger.debug(`Ignoring late OpenClaw doctor repair exit after settle (code=${code})`);
        return;
      }
      if (code === 0) {
        logger.info('OpenClaw doctor repair completed successfully');
        finish(true);
        return;
      }
      logger.warn(`OpenClaw doctor repair exited (code=${code})`);
      finish(false);
    });
  });
}
