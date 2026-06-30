import {v4 as uuidv4} from "uuid";


// ---- SillyTavern preset JSON 类型 ----

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
    // ST 模板格式字符串
    scenario_format?: string;
    personality_format?: string;
    wi_format?: string;
    impersonation_prompt?: string;
    new_chat_prompt?: string;
    continue_nudge_prompt?: string;
    group_nudge_prompt?: string;
}

// ---- Secyud Tavern 导出类型 ----

export interface LorebookEntry {
    id?: number;
    code: string;
    name: string;
    matchType: string;
    matchExpression: Record<string, any>;
    content: string;
    priority: number;
    layer: number;
    role: string;
    disabled: boolean;
}

export interface MacroEntry {
    id?: number;
    code: string;
    name: string;
    key: string;
    value: string;
    disabled?: boolean;
}

export interface PresetExport {
    id: string;
    name: string;
    version: string;
    code: string;
    tags: string[];
    requires: { code: string; version: string }[];
    content: {
        author: string;
        description: string;
        coverId: null | string;
        stLlmParams?: {
            temperature?: number;
            top_p?: number;
            top_k?: number;
            frequency_penalty?: number;
            presence_penalty?: number;
            repetition_penalty?: number;
            min_p?: number;
            top_a?: number;
        };
        stFormatStrings?: {
            scenario_format?: string;
            personality_format?: string;
            wi_format?: string;
        };
    };
    entries: {
        lorebooks: LorebookEntry[];
        macros: MacroEntry[];
    };
}

// ---- 常规工具 ----

function sanitizeCode(name: string): string {
    return name
        .replace(/[^a-zA-Z0-9一-鿿_]/gu, '_')
        .replace(/_+/gu, '_')
        .replace(/^_|_$/gu, '')
        .toLowerCase()
        .slice(0, 64) || 'entry';
}

/**
 * ST injection_position + injection_depth → Secyud layer
 *
 * ST pos:  0=主提示前  1=主提示后  2=对话顶部  3=对话底部
 * ST depth: 0=最靠近底部（最后插入） 4=最远离底部（最先插入）
 *
 * Secyud layer: 越大越后插入
 */
export function mapLayer(pos: number | undefined, depth: number | undefined): number {
    const p = pos ?? 0;
    const d = depth ?? 4;
    // depth 0 (底部) → offset 4; depth 4 (顶部) → offset 0
    return p * 100 + (4 - d) * 20;
}

// ---- ST 宏 → Secyud Eta 模板转换 ----

interface CollectedMacro {
    key: string;
    value: string;
    /** 所属 ST prompt 的名称（用作宏的 name） */
    promptName: string;
    /** 对应 ST prompt 的 enabled 状态：enabled=false → disabled=true */
    disabled: boolean;
}

/**
 * 转换一段内容中的 ST 宏：
 * - {{setglobalvar::name::value}} / {{setvar::name::value}}
 *   非空 value → 收集到 collectedMacros；空 value → 丢弃
 *   同一变量名多次出现时保留全部（不同取值互斥，靠 disabled 切换）
 * - {{getglobalvar::name}} / {{getvar::name}} → `<%~ it.name %>`
 * - {{user}} / {{char}} / {{lastUserMessage}} → Eta 占位符
 * - {{// comment}} → 移除
 * - 其余函数宏 (random, roll, trim 等) → 移除
 */
function transformContent(
    content: string,
    collectedMacros: CollectedMacro[],
    promptEnabled: boolean | undefined,
    promptName: string,
): string {
    let result = content;

    // 1. 注释 {{// ...}}
    result = result.replace(/\{\{\/\/[\s\S]*?}}/g, '');

    // 2. setglobalvar / setvar — 提取变量
    //    格式: {{setglobalvar::NAME::VALUE}} 或 {{setvar::NAME::VALUE}}
    const macroDisabled = promptEnabled === false;  // undefined → false（默认启用）
    result = result.replace(
        /\{\{(?:setglobalvar|setvar)::([^:]+)::([\s\S]*?)}}/g,
        (_full: string, name: string, value: string) => {
            const trimmed = value.trim();
            if (trimmed) {
                collectedMacros.push({key: name, value: trimmed, disabled: macroDisabled, promptName});
            }
            return '';
        }
    );

    // 3. getglobalvar / getvar → Eta 模板
    result = result.replace(
        /\{\{(?:getglobalvar|getvar)::([^}]+)}}/g,
        (_full: string, name: string) => `<%~ it.${name.trim()} %>`
    );

    // 4. ST 内置占位符
    result = result.replace(/\{\{user}}/g, '<%~ it.user %>');
    result = result.replace(/\{\{char}}/g, '<%~ it.char %>');
    result = result.replace(/\{\{charIfNotGroup}}/g, '<%~ it.char %>');
    result = result.replace(/\{\{lastUserMessage}}/gi, '<%~ it.lastUserMessage %>');

    // 5. 残余的函数宏 (random, roll, trim, 等) — 移除
    result = result.replace(/\{\{[^}]+}}/g, '');

    // 6. 清理多余空行
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.trim();

    return result;
}

// ---- 主要转换流程 ----

export function stPromptToLorebook(p: StPrompt, index: number): LorebookEntry | null {
    // 跳过 ST 标记型占位 Prompt（Secyud 有自己的注入体系）
    if (p.system_prompt && p.marker) return null;

    // 跳过空内容
    if (!p.content || p.content.trim().length === 0) return null;

    const code = sanitizeCode(p.name) || `st_prompt_${index}`;

    return {
        code,
        name: p.name,
        matchType: 'always',
        matchExpression: {lastMessage: false},
        content: p.content,  // 暂存原始内容，后续统一做宏转换
        priority: index,
        layer: mapLayer(p.injection_position, p.injection_depth),
        role: p.role || 'system',
        disabled: p.enabled === false,
    };
}

export function convertStPreset(st: StPreset, originalFilename: string): PresetExport {
    const baseName = originalFilename.replace(/\.json$/i, '');

    // 转换 prompts → lorebooks
    const prompts = st.prompts ?? [];
    const lorebooks: LorebookEntry[] = [];
    const usedCodes = new Set<string>();

    // 收集所有 ST 变量 → 宏（允许同名、不同取值，靠 disabled 切换）
    const collectedMacros: CollectedMacro[] = [];

    for (let i = 0; i < prompts.length; i++) {
        const p = prompts[i];
        const entry = stPromptToLorebook(p, i);
        if (!entry) continue;

        // 去重 code
        let code = entry.code;
        let suffix = 1;
        while (usedCodes.has(code)) {
            code = `${entry.code}_${suffix++}`;
        }
        usedCodes.add(code);
        entry.code = code;

        // 转换 ST 宏 → Eta 模板（传入 prompt 的 enabled 状态和名称）
        entry.content = transformContent(entry.content, collectedMacros, p.enabled, p.name);

        // 转换后内容为空则丢弃（纯变量初始化/注释型 prompt）
        if (!entry.content) continue;

        // entryId 使用递增整数
        entry.id = lorebooks.length + 1;
        lorebooks.push(entry);
    }

    // 变量 → 宏条目（用 promptName 作为可读名称，同名 code 加 _2, _3 后缀）
    const macros: MacroEntry[] = [];
    const macroCodeCount = new Map<string, number>();
    let macroId = 1;
    for (const m of collectedMacros) {
        const baseCode = sanitizeCode(m.promptName) || sanitizeCode(m.key);
        const count = (macroCodeCount.get(baseCode) ?? 0) + 1;
        macroCodeCount.set(baseCode, count);

        macros.push({
            id: macroId++,
            code: count === 1 ? baseCode : `${baseCode}_${count}`,
            name: m.promptName,
            key: m.key,
            value: m.value,
            disabled: m.disabled,
        });
    }

    return {
        id: uuidv4(),
        name: baseName,
        version: '1.0.0',
        code: baseName.replace(/[^a-zA-Z0-9一-鿿_]/gu, '_').replace(/_+/gu, '_').replace(/^_|_$/gu, '').toLowerCase().slice(0, 64) || 'imported_preset',
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
        },
    };
}
