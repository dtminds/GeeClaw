import { homedir } from 'os';
import { join, posix, win32 } from 'path';

const WINDOWS_HOME_TOKEN = '%USERPROFILE%';
const UNIX_HOME_TOKEN = '~';
const MANAGED_WORKSPACE_ROOT_NAME = 'geeclaw';
const MAIN_AGENT_ID = 'main';

function getManagedWorkspaceHomeToken(): string {
  return process.platform === 'win32' ? WINDOWS_HOME_TOKEN : UNIX_HOME_TOKEN;
}

function getManagedWorkspaceSeparator(): string {
  return process.platform === 'win32' ? win32.sep : posix.sep;
}

export function getManagedAgentWorkspaceRootPath(): string {
  const homeToken = getManagedWorkspaceHomeToken();
  return `${homeToken}${getManagedWorkspaceSeparator()}${MANAGED_WORKSPACE_ROOT_NAME}`;
}

export function getManagedAgentWorkspacePath(agentId: string): string {
  const root = getManagedAgentWorkspaceRootPath();
  const workspaceName = agentId === MAIN_AGENT_ID ? 'workspace' : `workspace-${agentId}`;
  return `${root}${getManagedWorkspaceSeparator()}${workspaceName}`;
}

export function getManagedAgentWorkspaceRootDir(): string {
  return join(homedir(), MANAGED_WORKSPACE_ROOT_NAME);
}

export function resolveManagedAgentWorkspacePath(agentId: string): string {
  const workspaceName = agentId === MAIN_AGENT_ID ? 'workspace' : `workspace-${agentId}`;
  return join(getManagedAgentWorkspaceRootDir(), workspaceName);
}

export function getManagedAgentDirPath(agentId: string): string {
  return `~/.openclaw-geeclaw/agents/${agentId}/agent`;
}
