import type { GeeClawPackage, NativeToolDefinition, NativeToolFactoryContext } from '../../core/types.js';
declare const TOOL_NAME = "evolution_proposal";
declare const EXTERNAL_CHANNEL_SESSION_RE: RegExp;
declare const evolutionProposalSchema: {
    readonly type: "object";
    readonly properties: {
        readonly proposalId: {
            readonly type: "string";
            readonly description: "Unique proposal ID, e.g. \"evo-2026-04-14-memory-reply-briefly\"";
        };
        readonly signature: {
            readonly type: "string";
            readonly description: "Stable dedup signature, e.g. \"memory-reply-briefly\"";
        };
        readonly description: {
            readonly type: "string";
            readonly description: "One-sentence description of why this evolution is needed";
        };
        readonly tabs: {
            readonly type: "array";
            readonly description: "Evolution modules with proposed changes";
            readonly items: {
                readonly type: "object";
                readonly properties: {
                    readonly kind: {
                        readonly type: "string";
                        readonly enum: readonly ["memory", "behavior", "skill", "tool"];
                        readonly description: "Tab category: memory=MEMORY.md, behavior=AGENTS.md, skill=SKILL.md, tool=TOOLS.md";
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly description: "Display label for this tab";
                    };
                    readonly content: {
                        readonly type: "string";
                        readonly description: "Markdown content of the proposed change";
                    };
                };
                readonly required: readonly ["kind", "label", "content"];
            };
        };
        readonly draftPath: {
            readonly type: "string";
            readonly description: "Relative path to the draft file in workspace, e.g. \"evolution-drafts/pending/xxx.md\"";
        };
    };
    readonly required: readonly ["proposalId", "signature", "description", "tabs", "draftPath"];
};
declare function createEvolutionProposalTool(context: NativeToolFactoryContext): NativeToolDefinition;
declare const evolutionProposal: GeeClawPackage;
export { TOOL_NAME, EXTERNAL_CHANNEL_SESSION_RE, evolutionProposalSchema, createEvolutionProposalTool };
export default evolutionProposal;
