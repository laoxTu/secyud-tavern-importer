import {v4 as uuidv4} from "uuid";
import type {PresetLorebookModel} from "@/engines/lorebooks/models";
import {
    type PresetExport, type StRegexScript, type StScript,
    type CollectedMacro,
    sanitizeCode, mapLayer,
    transformContent, buildMacroEntries, extractStRegexes, extractStScripts,
} from "./silly-tavern";


// ---- SillyTavern 预设 JSON 类型（snake_case） ----

export interface StPrompt {
    name: string;
    enabled?: boolean;
    injection_position?: number;
    injection_depth?: number;
    injection_order?: number;
    role: string;
    content: string;
    system_prompt?: boolean;
    marker?: boolean;
    identifier?: string;
}

export interface StPreset {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    min_p?: number;
    top_a?: number;
    openai_max_context?: number;
    openai_max_tokens?: number;
    stream_openai?: boolean;
    prompts?: StPrompt[];
    prompt_order?: { identifier: string; enabled: boolean }[];
    scenario_format?: string;
    personality_format?: string;
    wi_format?: string;
    impersonation_prompt?: string;
    new_chat_prompt?: string;
    continue_nudge_prompt?: string;
    group_nudge_prompt?: string;
    extensions?: {
        regex_scripts?: StRegexScript[];
        tavern_helper?: {
            scripts?: StScript[];
            variables?: Record<string, any>;
        };
    };
}

// ---- 转换逻辑 ----

export function stPromptToLorebook(p: StPrompt, index: number): PresetLorebookModel | null {
    if (p.system_prompt && p.marker) return null;
    if (!p.content || p.content.trim().length === 0) return null;

    const code = sanitizeCode(p.name) || `st_prompt_${index}`;

    return {
        id: 0,  // placeholder，convertStPreset 中覆写
        code,
        name: p.name,
        matchType: 'always',
        matchExpression: {lastMessage: false},
        content: p.content,
        priority: index,
        layer: mapLayer(p.injection_position, p.injection_depth),
        role: p.role || 'system',
        disabled: p.enabled === false,
    };
}

export function convertStPreset(st: StPreset, originalFilename: string): PresetExport {
    const baseName = originalFilename.replace(/\.json$/i, '');

    const prompts = st.prompts ?? [];
    const lorebooks: PresetLorebookModel[] = [];
    const usedCodes = new Set<string>();
    const collectedMacros: CollectedMacro[] = [];

    for (let i = 0; i < prompts.length; i++) {
        const p = prompts[i];
        const entry = stPromptToLorebook(p, i);
        if (!entry) continue;

        let code = entry.code;
        let suffix = 1;
        while (usedCodes.has(code)) {
            code = `${entry.code}_${suffix++}`;
        }
        usedCodes.add(code);
        entry.code = code;

        entry.content = transformContent(entry.content, collectedMacros, p.enabled, p.name);

        if (!entry.content) continue;

        entry.id = lorebooks.length + 1;
        lorebooks.push(entry);
    }

    const macros = buildMacroEntries(collectedMacros);
    const regexes = extractStRegexes(st.extensions?.regex_scripts);
    const scripts = extractStScripts(st.extensions?.tavern_helper?.scripts);

    return {
        id: uuidv4(),
        name: baseName,
        version: '1.0.0',
        code: sanitizeCode(baseName) || 'imported_preset',
        tags: ['imported', 'silly-tavern'],
        requires: [],
        content: {
            author: '',
            description: `从 SillyTavern 导入：${baseName}`,
            coverId: null,
            stLlmParams: {
                temperature: st.temperature,
                top_p: st.top_p,
                top_k: st.top_k,
                frequency_penalty: st.frequency_penalty,
                presence_penalty: st.presence_penalty,
                repetition_penalty: st.repetition_penalty,
                min_p: st.min_p,
                top_a: st.top_a,
            },
            stFormatStrings: {
                scenario_format: st.scenario_format,
                personality_format: st.personality_format,
                wi_format: st.wi_format,
            },
        },
        entries: {
            lorebooks,
            macros,
            scripts,
            regexes,
        },
    };
}
