import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('cli marketplace bundled catalog', () => {
  it('includes Dreamina CLI with the upstream curl installer command', () => {
    const catalogPath = join(process.cwd(), 'resources', 'cli-marketplace', 'catalog.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Array<Record<string, unknown>>;

    expect(catalog).toContainEqual(expect.objectContaining({
      id: 'dreamina',
      title: '即梦 CLI',
      binNames: ['dreamina'],
      docsUrl: 'https://jimeng.jianying.com/cli',
      installMethods: [
        expect.objectContaining({
          type: 'manual',
          label: 'curl',
          command: 'curl -s https://jimeng.jianying.com/cli | bash',
          requiresCommands: ['curl', 'bash'],
        }),
      ],
    }));
  });
});
