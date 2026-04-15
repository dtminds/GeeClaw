export type ManagedPluginDefinition = {
  pluginId: string;
  packageName: string;
  targetVersion: string;
  displayName: string;
  installMessage: string;
  requiredForStartup: boolean;
  syncConfigOnStartup: boolean;
};

export const MANAGED_PLUGINS: ManagedPluginDefinition[] = [
  {
    pluginId: 'lossless-claw',
    packageName: '@martian-engineering/lossless-claw',
    targetVersion: '0.5.2',
    displayName: 'lossless-claw',
    installMessage: '正在安装 lossless-claw 插件…',
    requiredForStartup: true,
    syncConfigOnStartup: true,
  },
];

export function getManagedPlugins(): ManagedPluginDefinition[] {
  return [...MANAGED_PLUGINS];
}

export function getManagedPlugin(pluginId: string): ManagedPluginDefinition | undefined {
  return MANAGED_PLUGINS.find((plugin) => plugin.pluginId === pluginId);
}
