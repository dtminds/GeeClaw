import { homedir } from 'os';
import { join } from 'path';

const WINDOWS_HOME_TOKEN = '%USERPROFILE%';
const UNIX_HOME_TOKEN = '~';
const MANAGED_WORKSPACE_ROOT_NAME = 'geeclaw';
const MAIN_AGENT_ID = 'main';

function getManagedWorkspaceHomeToken(): string {
  return process.platform === 'win32' ? WINDOWS_HOME_TOKEN : UNIX_HOME_TOKEN;
}

export function getManagedAgentWorkspaceRootPath(): string {
  const homeToken = getManagedWorkspaceHomeToken();
  const separator = process.platform === 'win32' ? '\\' : '/';
  return `${homeToken}${separator}${MANAGED_WORKSPACE_ROOT_NAME}`;
}

export function getManagedAgentWorkspacePath(agentId: string): string {
  const root = getManagedAgentWorkspaceRootPath();
  const separator = process.platform === 'win32' ? '\\' : '/';
  const workspaceName = agentId === MAIN_AGENT_ID ? 'workspace' : `workspace-${agentId}`;
  return `${root}${separator}${workspaceName}`;
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
