import type { IncomingMessage, ServerResponse } from 'http';
import {
  ensureSkillEntriesDefaultDisabled,
  getAllSkillConfigs,
  getHiddenPreinstalledSkillKeys,
  updateSkillConfig,
} from '../../utils/skill-config';
import { getAlwaysEnabledSkillKeys } from '../../utils/skills-policy';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/skills/configs' && req.method === 'GET') {
    sendJson(res, 200, await getAllSkillConfigs());
    return true;
  }

  if (url.pathname === '/api/skills/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{
        skillKey: string;
        apiKey?: string;
        env?: Record<string, string>;
        enabled?: boolean;
      }>(req);
      sendJson(res, 200, await updateSkillConfig(body.skillKey, {
        apiKey: body.apiKey,
        env: body.env,
        enabled: body.enabled,
      }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/ensure-entries' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        skillKeys?: string[];
        skills?: Array<{ skillKey?: string; source?: string }>;
      }>(req);
      const discoveredSkills = Array.isArray(body.skills)
        ? body.skills
        : Array.isArray(body.skillKeys)
          ? body.skillKeys
          : [];
      sendJson(res, 200, await ensureSkillEntriesDefaultDisabled(discoveredSkills));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/policy' && req.method === 'GET') {
    sendJson(res, 200, {
      alwaysEnabledSkillKeys: getAlwaysEnabledSkillKeys(),
      hiddenSkillKeys: await getHiddenPreinstalledSkillKeys(),
    });
    return true;
  }

  if (url.pathname === '/api/clawhub/search' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ query: string; limit?: number }>(req);
      sendJson(res, 200, {
        success: true,
        results: await ctx.clawHubService.search(body),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/catalog' && req.method === 'GET') {
    try {
      sendJson(res, 200, {
        success: true,
        result: await ctx.clawHubService.getCatalog(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/marketplace/featured' && req.method === 'GET') {
    try {
      sendJson(res, 200, {
        success: true,
        result: await ctx.clawHubService.getFeaturedSkills(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/marketplace/categories' && req.method === 'GET') {
    try {
      sendJson(res, 200, {
        success: true,
        result: await ctx.clawHubService.getCategoryList(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/marketplace/category-skills' && req.method === 'GET') {
    try {
      const category = url.searchParams.get('category') || '';
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const pageSize = parseInt(url.searchParams.get('pageSize') || '24', 10);
      const keyword = url.searchParams.get('keyword') || '';
      const sortBy = url.searchParams.get('sortBy') || 'score';
      const order = url.searchParams.get('order') || 'desc';

      sendJson(res, 200, {
        success: true,
        result: await ctx.clawHubService.fetchCategorySkills({
          category,
          page,
          pageSize,
          keyword,
          sortBy,
          order,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug: string; version?: string; force?: boolean }>(req);
      await ctx.clawHubService.install(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/uninstall' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.uninstall(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/list' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, results: await ctx.clawHubService.listInstalled() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-readme' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillReadme(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-path' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillPath(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skillhub/status' && req.method === 'GET') {
    try {
      sendJson(res, 200, {
        success: true,
        result: await ctx.clawHubService.getSkillHubStatus(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skillhub/install' && req.method === 'POST') {
    try {
      sendJson(res, 200, {
        success: true,
        result: await ctx.clawHubService.installSkillHub(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
