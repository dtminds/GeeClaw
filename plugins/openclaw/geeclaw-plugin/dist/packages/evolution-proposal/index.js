const TOOL_NAME = 'evolution_proposal';
const EXTERNAL_CHANNEL_SESSION_RE = /:(feishu|telegram|discord|slack|whatsapp|signal|imessage|googlechat|mattermost|msteams|wecom|openclaw-weixin|dingtalk|dingtalk-connector|qqbot):/i;
const evolutionProposalSchema = {
    type: 'object',
    properties: {
        proposalId: {
            type: 'string',
            description: 'Unique proposal ID, e.g. "evo-2026-04-14-memory-reply-briefly"',
        },
        signature: {
            type: 'string',
            description: 'Stable dedup signature, e.g. "memory-reply-briefly"',
        },
        description: {
            type: 'string',
            description: 'One-sentence description of why this evolution is needed',
        },
        tabs: {
            type: 'array',
            description: 'Evolution modules with proposed changes',
            items: {
                type: 'object',
                properties: {
                    kind: {
                        type: 'string',
                        enum: ['memory', 'behavior', 'skill', 'tool'],
                        description: 'Tab category: memory=MEMORY.md, behavior=AGENTS.md, skill=SKILL.md, tool=TOOLS.md',
                    },
                    label: {
                        type: 'string',
                        description: 'Display label for this tab',
                    },
                    content: {
                        type: 'string',
                        description: 'Markdown content of the proposed change',
                    },
                },
                required: ['kind', 'label', 'content'],
            },
        },
        draftPath: {
            type: 'string',
            description: 'Relative path to the draft file in workspace, e.g. "evolution-drafts/pending/xxx.md"',
        },
    },
    required: ['proposalId', 'signature', 'description', 'tabs', 'draftPath'],
};
function createEvolutionProposalTool(context) {
    const rawChannel = typeof context?.messageChannel === 'string'
        ? context.messageChannel.trim().toLowerCase()
        : '';
    const sessionKey = typeof context?.sessionKey === 'string'
        ? context.sessionKey.trim()
        : '';
    const isExternalSession = Boolean(sessionKey && EXTERNAL_CHANNEL_SESSION_RE.test(sessionKey));
    const deliveryMode = rawChannel && rawChannel !== 'webchat'
        ? 'text'
        : isExternalSession
            ? 'text'
            : 'card';
    return {
        name: TOOL_NAME,
        label: 'Evolution Proposal',
        description: 'Present a structured self-evolution proposal to the user. ' +
            'This tool reports whether the current session should use an interactive approval card ' +
            'or plain-text approval instructions.',
        parameters: evolutionProposalSchema,
        async execute(_toolCallId, params) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            ok: true,
                            proposalId: params.proposalId,
                            deliveryMode,
                            channel: rawChannel || (isExternalSession ? 'external' : 'webchat'),
                            followUp: deliveryMode === 'card'
                                ? 'Interactive card is available in this session. Do not repeat approval commands in plain text.'
                                : 'Interactive card is not available in this session. Send a short plain-text approval prompt with approve/reject/revise commands.',
                            message: deliveryMode === 'card'
                                ? 'Proposal registered for interactive card approval.'
                                : 'Proposal registered for text approval on this channel.',
                        }),
                    }],
            };
        },
    };
}
const evolutionProposal = {
    id: 'evolution-proposal',
    name: 'Evolution Proposal',
    description: 'Structured self-evolution proposal tool for hermes-evolution skill.',
    configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
    },
    setup(ctx) {
        ctx.registerTool(createEvolutionProposalTool, { name: TOOL_NAME });
        ctx.logger.info('registered evolution_proposal tool with original factory semantics');
    },
};
export { TOOL_NAME, EXTERNAL_CHANNEL_SESSION_RE, evolutionProposalSchema, createEvolutionProposalTool };
export default evolutionProposal;
