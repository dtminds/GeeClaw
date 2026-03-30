import type { Skill } from '@/types/skill';

export interface SkillKeywordRecommendationRule {
  id: string;
  skillMatchers: string[];
  keywords: string[];
}

export interface SkillKeywordRecommendation {
  recommendationKey: string;
  ruleId: string;
  skill: Skill;
  matchedKeyword: string;
}

interface FindSkillKeywordRecommendationOptions {
  text: string;
  skills: Skill[];
  editorFocused?: boolean;
  hasInlineSkillToken?: boolean;
  slashPickerActive?: boolean;
  agentPickerActive?: boolean;
}

// Keep the first pass deliberately conservative. This table is meant to be
// hand-maintained so we can expand it with real usage data instead of guessing.
const SKILL_KEYWORD_RECOMMENDATION_RULES: SkillKeywordRecommendationRule[] = [
  {
    id: 'browser',
    skillMatchers: ['agent-browser', 'browser', 'playwright-commander'],
    keywords: ['browser', 'playwright', '浏览器', '网页', '网站'],
  },
  {
    id: 'weather',
    skillMatchers: ['weather'],
    keywords: ['weather', '天气'],
  },
  {
    id: 'gmail',
    skillMatchers: ['gmail'],
    keywords: ['gmail', 'email', '邮件'],
  },
  {
    id: 'pdf',
    skillMatchers: ['pdf', 'nano-pdf'],
    keywords: ['pdf'],
  },
  {
    id: 'ppt',
    skillMatchers: ['pptx', 'ppt-generator', 'ai-ppt-generator', 'google-slides'],
    keywords: ['ppt', '幻灯片', '演示文稿', 'slides'],
  },
  {
    id: 'word',
    skillMatchers: ['docx', 'word-docx', 'google-docs'],
    keywords: ['word', 'docx'],
  },
  {
    id: 'excel',
    skillMatchers: ['xlsx', 'google-docs'],
    keywords: ['excel', 'xlsx'],
  },
  {
    id: 'xiaohongshu-cli',
    skillMatchers: ['xiaohongshu-cli'],
    keywords: ['小红书', 'xhs'],
  },
];

function normalizeRecommendationText(value: string): string {
  return value.normalize('NFKD').trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getKeywordMatchIndex(text: string, keyword: string): number | null {
  const normalizedKeyword = normalizeRecommendationText(keyword);
  if (!normalizedKeyword) {
    return null;
  }

  if (/^[a-z0-9._-]+$/i.test(normalizedKeyword)) {
    // Treat CJK neighbors as separators so "做个PPT" and "生成word文档" can match,
    // while still avoiding ASCII substrings like "password" triggering "word".
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(normalizedKeyword)}(?=$|[^A-Za-z0-9_])`, 'i');
    const match = pattern.exec(text);
    return typeof match?.index === 'number' ? match.index : null;
  }

  const index = text.indexOf(normalizedKeyword);
  return index >= 0 ? index : null;
}

function matchesSkill(rule: SkillKeywordRecommendationRule, skill: Skill): boolean {
  const candidates = [
    skill.id,
    skill.slug,
    skill.name,
  ]
    .map((value) => normalizeRecommendationText(value ?? ''))
    .filter(Boolean);

  return rule.skillMatchers
    .map((matcher) => normalizeRecommendationText(matcher))
    .some((matcher) => candidates.includes(matcher));
}

export function findSkillKeywordRecommendation({
  text,
  skills,
  editorFocused = false,
  hasInlineSkillToken = false,
  slashPickerActive = false,
  agentPickerActive = false,
}: FindSkillKeywordRecommendationOptions): SkillKeywordRecommendation | null {
  if (
    !editorFocused
    || hasInlineSkillToken
    || slashPickerActive
    || agentPickerActive
  ) {
    return null;
  }

  const normalizedText = normalizeRecommendationText(text);
  if (!normalizedText) {
    return null;
  }

  let bestMatch: SkillKeywordRecommendation | null = null;
  let bestIndex = Number.POSITIVE_INFINITY;
  let bestKeywordLength = -1;

  for (const rule of SKILL_KEYWORD_RECOMMENDATION_RULES) {
    const matchedSkill = skills.find((skill) => matchesSkill(rule, skill));
    if (!matchedSkill) {
      continue;
    }

    for (const keyword of rule.keywords) {
      const matchIndex = getKeywordMatchIndex(normalizedText, keyword);
      if (matchIndex === null) {
        continue;
      }

      if (matchIndex > bestIndex) {
        continue;
      }

      if (matchIndex === bestIndex && keyword.length <= bestKeywordLength) {
        continue;
      }

      bestIndex = matchIndex;
      bestKeywordLength = keyword.length;
      bestMatch = {
        recommendationKey: `${rule.id}:${matchedSkill.id}:${normalizeRecommendationText(keyword)}`,
        ruleId: rule.id,
        skill: matchedSkill,
        matchedKeyword: keyword,
      };
    }
  }

  return bestMatch;
}
