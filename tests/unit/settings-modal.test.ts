import { describe, expect, it } from 'vitest';
import { getSettingsModalPath, resolveSettingsSection } from '@/lib/settings-modal';

describe('settings modal paths', () => {
  it('builds the opencli settings path', () => {
    expect(getSettingsModalPath('opencli')).toBe('/settings/opencli');
  });

  it('builds the mcp settings path', () => {
    expect(getSettingsModalPath('mcp')).toBe('/settings/mcp');
  });

  it('builds the environment settings path', () => {
    expect(getSettingsModalPath('environment')).toBe('/settings/environment');
  });

  it('builds the web search settings path', () => {
    expect(getSettingsModalPath('webSearch')).toBe('/settings/web-search');
  });

  it('builds the model provider settings path', () => {
    expect(getSettingsModalPath('modelProviders')).toBe('/settings/model-providers');
  });

  it('builds the model config settings path', () => {
    expect(getSettingsModalPath('modelConfig')).toBe('/settings/model-config');
  });

  it('builds the cli marketplace settings path', () => {
    expect(getSettingsModalPath('cliMarketplace')).toBe('/settings/cli-marketplace');
  });

  it('resolves the opencli settings section from the route', () => {
    expect(resolveSettingsSection('/settings/opencli')).toBe('opencli');
    expect(resolveSettingsSection('/settings/opencli/status')).toBe('opencli');
  });

  it('resolves the mcp settings section from the route', () => {
    expect(resolveSettingsSection('/settings/mcp')).toBe('mcp');
    expect(resolveSettingsSection('/settings/mcp/status')).toBe('mcp');
  });

  it('resolves the environment settings section from the route', () => {
    expect(resolveSettingsSection('/settings/environment')).toBe('environment');
    expect(resolveSettingsSection('/settings/environment/runtime')).toBe('environment');
  });

  it('resolves the web search settings section from the route', () => {
    expect(resolveSettingsSection('/settings/web-search')).toBe('webSearch');
    expect(resolveSettingsSection('/settings/web-search/providers')).toBe('webSearch');
  });

  it('resolves the model provider settings section from the route', () => {
    expect(resolveSettingsSection('/settings/model-providers')).toBe('modelProviders');
    expect(resolveSettingsSection('/settings/models')).toBe('modelProviders');
  });

  it('resolves the model config settings section from the route', () => {
    expect(resolveSettingsSection('/settings/model-config')).toBe('modelConfig');
  });

  it('resolves the cli marketplace settings section from the route', () => {
    expect(resolveSettingsSection('/settings/cli-marketplace')).toBe('cliMarketplace');
    expect(resolveSettingsSection('/settings/cli-marketplace/feishu')).toBe('cliMarketplace');
  });
});
