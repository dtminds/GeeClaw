import { useCallback, useEffect, useMemo, useState } from 'react';
import { hostApiFetch } from '@/lib/host-api';
import { toUserMessage } from '@/lib/api-client';

export type PersonaFileKey = 'identity' | 'master' | 'soul' | 'memory';
export type PersonaDrafts = Record<PersonaFileKey, string>;
export type PersonaFileContents = {
  exists: boolean;
  content: string;
};

export type PersonaResponse = {
  agentId: string;
  workspace: string;
  editable: boolean;
  lockedFiles: PersonaFileKey[];
  message?: string;
  files: Record<PersonaFileKey, PersonaFileContents>;
  success?: boolean;
};

export type SoulTemplateId = 'assistant' | 'companion' | 'mentor' | 'custom';

export type SoulTemplate = {
  id: SoulTemplateId;
  emoji: string;
  name: string;
  description: string;
  content: string;
};

export const PERSONA_FILE_ORDER: PersonaFileKey[] = ['identity', 'master', 'soul', 'memory'];

const EMPTY_DRAFTS: PersonaDrafts = {
  identity: '',
  master: '',
  soul: '',
  memory: '',
};

export const SOUL_TEMPLATES: SoulTemplate[] = [
  {
    id: 'assistant',
    emoji: '💡',
    name: '全能助手',
    description: '理性、客观、高效的得力干将',
    content: `[核心驱动]
你是一个理性、可靠、高执行力的全能助手。

[行为原则]
- 先给结论，再补充必要背景
- 优先提供可执行方案，不说空话
- 主动拆解复杂问题，帮助用户推进下一步
- 保持客观、专业、稳定，不情绪化表演

[表达风格]
- 简洁清楚
- 重点明确
- 遇到不确定信息时直说不确定`,
  },
  {
    id: 'companion',
    emoji: '🌸',
    name: '贴心伴侣',
    description: '温柔倾听，提供满满的情绪价值',
    content: `[核心驱动]
你是一个温柔、细腻、善于共情的贴心陪伴型助手。

[行为原则]
- 先理解用户感受，再给建议
- 关注情绪、氛围和陪伴感
- 用轻柔但不敷衍的方式表达支持
- 在给方案时保持温暖、耐心和鼓励

[表达风格]
- 自然亲近
- 柔和真诚
- 让用户感到被理解和被接住`,
  },
  {
    id: 'mentor',
    emoji: '🎓',
    name: '严厉导师',
    description: '直击痛点，鞭策你不断突破自我',
    content: `[核心驱动]
你是一个标准极高、判断直接、以成长为导向的导师型助手。

[行为原则]
- 不回避问题，敢于指出真正的卡点
- 少安慰，多推动用户行动和复盘
- 强调目标、节奏、纪律和结果
- 对模糊、拖延、借口保持敏锐

[表达风格]
- 直接有力
- 逻辑清晰
- 尖锐但不羞辱，严格但以成长为目的`,
  },
  {
    id: 'custom',
    emoji: '⚙️',
    name: '自定义',
    description: '亲手编写 Prompt，为 TA 注入独一无二的灵魂',
    content: '',
  },
];

function normalizeTemplateSource(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

type SavePersonaResult = { response: PersonaResponse } | { error: string };

export function useAgentPersona(agentId: string, open: boolean) {
  const [snapshot, setSnapshot] = useState<PersonaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<PersonaDrafts>(() => ({ ...EMPTY_DRAFTS }));
  const [soulTemplateId, setSoulTemplateId] = useState<SoulTemplateId>('assistant');
  const [customSoulDraft, setCustomSoulDraft] = useState('');

  const lockedFileSet = useMemo(
    () => new Set(snapshot?.lockedFiles ?? []),
    [snapshot?.lockedFiles],
  );

  const applyPersonaResponse = useCallback((response: PersonaResponse) => {
    const normalizedSoul = normalizeTemplateSource(response.files.soul.content);
    const matchedTemplate = SOUL_TEMPLATES.find((template) => (
      template.id !== 'custom' && normalizeTemplateSource(template.content) === normalizedSoul
    ));

    setSnapshot(response);
    setDrafts({
      identity: response.files.identity.content,
      master: response.files.master.content,
      soul: response.files.soul.content,
      memory: response.files.memory.content,
    });
    setSoulTemplateId(matchedTemplate?.id ?? 'custom');
    setCustomSoulDraft(matchedTemplate ? '' : response.files.soul.content);
  }, []);

  const fetchPersonaSnapshot = useCallback(async () => {
    if (!agentId) {
      throw new Error('Agent ID is required to load persona data');
    }
    return hostApiFetch<PersonaResponse>(
      `/api/agents/${encodeURIComponent(agentId)}/persona`,
    );
  }, [agentId]);

  useEffect(() => {
    if (!open || !agentId) return;

    let cancelled = false;
    setError(null);

    if (snapshot?.agentId === agentId) {
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);

    const frameId = window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const response = await fetchPersonaSnapshot();
          if (cancelled) return;
          applyPersonaResponse(response);
        } catch (err) {
          if (cancelled) return;
          setError(toUserMessage(err));
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [agentId, applyPersonaResponse, fetchPersonaSnapshot, open, snapshot?.agentId]);

  const hasChanges = useMemo(() => {
    if (!snapshot) return false;
    return PERSONA_FILE_ORDER.some((key) => !lockedFileSet.has(key) && drafts[key] !== snapshot.files[key].content);
  }, [drafts, lockedFileSet, snapshot]);

  const hasSectionChanges = useCallback((section: PersonaFileKey) => {
    if (!snapshot) return false;
    if (lockedFileSet.has(section)) return false;
    return drafts[section] !== snapshot.files[section].content;
  }, [drafts, lockedFileSet, snapshot]);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchPersonaSnapshot();
      applyPersonaResponse(response);
      return response;
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setLoading(false);
    }
  }, [agentId, applyPersonaResponse, fetchPersonaSnapshot]);

  const savePersona = useCallback(async (keys?: PersonaFileKey[]): Promise<SavePersonaResult | undefined> => {
    if (!agentId || !snapshot || !snapshot.editable) return;
    const targetKeys = keys ?? PERSONA_FILE_ORDER;
    const payload: Partial<Record<PersonaFileKey, string>> = {};

    for (const key of targetKeys) {
      if (lockedFileSet.has(key)) {
        continue;
      }
      if (drafts[key] === snapshot.files[key].content) {
        continue;
      }
      payload[key] = drafts[key];
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await hostApiFetch<PersonaResponse>(
        `/api/agents/${encodeURIComponent(agentId)}/persona`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
      );
      applyPersonaResponse(response);
      return { response };
    } catch (err) {
      const message = toUserMessage(err);
      setError(message);
      return { error: message };
    } finally {
      setSaving(false);
    }
  }, [agentId, applyPersonaResponse, drafts, lockedFileSet, snapshot]);

  const saveSection = useCallback(
    (section: PersonaFileKey) => savePersona([section]),
    [savePersona],
  );

  const selectSoulTemplate = useCallback((nextTemplateId: SoulTemplateId) => {
    if (lockedFileSet.has('soul')) {
      return;
    }

    if (nextTemplateId === 'custom') {
      if (soulTemplateId !== 'custom') {
        setCustomSoulDraft((current) => current || '');
      }
      setSoulTemplateId('custom');
      setDrafts((current) => ({
        ...current,
        soul: customSoulDraft,
      }));
      return;
    }

    if (soulTemplateId === 'custom') {
      setCustomSoulDraft(drafts.soul);
    }

    const template = SOUL_TEMPLATES.find((item) => item.id === nextTemplateId);
    if (!template) return;

    setSoulTemplateId(nextTemplateId);
    setDrafts((current) => ({
      ...current,
      soul: template.content,
    }));
  }, [customSoulDraft, drafts.soul, lockedFileSet, soulTemplateId]);

  const updateDraft = useCallback(
    (fileKey: PersonaFileKey, value: string) => {
      setDrafts((current) => ({
        ...current,
        [fileKey]: value,
      }));
      if (fileKey === 'soul' && soulTemplateId === 'custom') {
        setCustomSoulDraft(value);
      }
    },
    [soulTemplateId],
  );

  return {
    snapshot,
    loading,
    saving,
    error,
    drafts,
    updateDraft,
    soulTemplateId,
    lockedFileSet,
    hasChanges,
    hasSectionChanges,
    selectSoulTemplate,
    load,
    savePersona,
    saveSection,
  };
}
