export type ManagedPluginStartupInstallPolicy = 'missing-or-outdated' | 'outdated-only';

export type ManagedPluginDefinition = {
  pluginId: string;
  packageName: string;
  targetVersion: string;
  displayName: string;
  installMessage: string;
  requiredForStartup: boolean;
  startupInstallPolicy: ManagedPluginStartupInstallPolicy;
  syncConfigOnStartup: boolean;
};

export const MANAGED_PLUGINS: ManagedPluginDefinition[] = [
  {
    pluginId: 'lossless-claw',
    packageName: '@martian-engineering/lossless-claw',
    targetVersion: '0.9.2',
    displayName: 'lossless-claw',
    installMessage: '正在安装记忆增强插件',
    requiredForStartup: false,
    startupInstallPolicy: 'outdated-only',
    syncConfigOnStartup: true,
  },
];

export function getManagedPlugins(): ManagedPluginDefinition[] {
  return [...MANAGED_PLUGINS];
}

export function getManagedPlugin(pluginId: string): ManagedPluginDefinition | undefined {
  return MANAGED_PLUGINS.find((plugin) => plugin.pluginId === pluginId);
}
