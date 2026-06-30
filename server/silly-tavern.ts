import type {PresetLorebookModel} from "@/engines/lorebooks/models";
import type {PresetMacroModel} from "@/engines/macros/models";
import type {PresetScriptModel} from "@/engines/scripts/models";
import type {PresetRegexModel} from "@/engines/regexes/models";


// ---- 共享导出类型（引擎 models 别名） ----

export type LorebookEntry = PresetLorebookModel;
export type MacroEntry = PresetMacroModel;
export type ScriptEntry = PresetScriptModel;
export type RegexEntry = PresetRegexModel;

// ---- Secyud Tavern 预设导出结构 ----

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
        lorebooks: PresetLorebookModel[];
        macros: PresetMacroModel[];
        scripts: PresetScriptModel[];
        regexes: PresetRegexModel[];
    };
}

// ---- ST 公共类型（预设和角色卡通用） ----

export interface StRegexScript {
    scriptName: string;
    findRegex: string;
    replaceString: string;
    placement: number[];
    disabled: boolean;
}

export interface StScript {
    name: string;
    content: string;
    enabled: boolean;
    type?: string;
}

// ---- 公共工具 ----

export function sanitizeCode(name: string): string {
    return name
        .replace(/[^a-zA-Z0-9一-鿿_]/gu, '_')
        .replace(/_+/gu, '_')
        .replace(/^_|_$/gu, '')
        .toLowerCase()
        .slice(0, 64) || 'entry';
}

/**
 * ST 预设 Prompt Manager 的 injection_position + injection_depth → Secyud layer
 *
 * ST Prompt Manager（来源: docs.sillytavern.app/usage/prompts/prompt-manager）:
 *   injection_position: 0=RELATIVE（相对聊天末尾）, 1=ABSOLUTE（绝对固定位置）
 *   injection_depth:    在 RELATIVE 模式下，距底部消息数（0=紧贴最新消息）
 *   injection_order:    同深度内的排序（先按 role 分组，再按 order 排列）
 *
 * Secyud layer: 越大越后插入
 */
export function mapLayer(pos: number | undefined, depth: number | undefined): number {
    const p = pos ?? 0;
    const d = depth ?? 4;
    if (p === 0) {
        // RELATIVE 模式：对话区内按深度偏移
        // 基值 200（对话区），depth 0（底部）→ 偏移大，depth 4（顶部）→ 偏移小
        return 200 + (4 - d) * 10;
    }
    // ABSOLUTE 模式：按深度固定定位
    return d * 10;
}

/** 解析 ST 正则格式 /pattern/flags → 纯 pattern 字符串 */
export function parseStRegex(findRegex: string): string {
    const m = findRegex.match(/^\/(.+)\/([a-z]*)$/);
    if (!m) return findRegex;
    return m[1];
}

export function stPlacementToTarget(placement: number[]): string {
    if (placement.includes(0) && placement.includes(1)) return "both";
    if (placement.includes(1)) return "input";
    return "output";
}

// ---- ST 宏 → Secyud Eta 模板转换 ----

export interface CollectedMacro {
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
export function transformContent(
    content: string,
    collectedMacros: CollectedMacro[],
    promptEnabled: boolean | undefined,
    promptName: string,
): string {
    let result = content;

    // 1. 注释 {{// ...}}
    result = result.replace(/\{\{\/\/[\s\S]*?}}/g, '');

    // 2. setglobalvar / setvar — 提取变量
    const macroDisabled = promptEnabled === false;
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

    // 5. 残余的函数宏 — 移除
    result = result.replace(/\{\{[^}]+}}/g, '');

    // 6. 清理多余空行
    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim();
}

/** 将收集到的宏列表转为 PresetMacroModel[]（处理同名 code 去重） */
export function buildMacroEntries(collected: CollectedMacro[]): PresetMacroModel[] {
    const macros: PresetMacroModel[] = [];
    const codeCount = new Map<string, number>();
    let id = 1;
    for (const m of collected) {
        const baseCode = sanitizeCode(m.promptName) || sanitizeCode(m.key);
        const count = (codeCount.get(baseCode) ?? 0) + 1;
        codeCount.set(baseCode, count);

        macros.push({
            id: id++,
            code: count === 1 ? baseCode : `${baseCode}_${count}`,
            name: m.promptName,
            key: m.key,
            value: m.value,
            disabled: m.disabled,
        });
    }
    return macros;
}

/** 从 ST extensions 中提取正则条目 */
export function extractStRegexes(rawRegexes: StRegexScript[] | undefined): PresetRegexModel[] {
    const regexes: PresetRegexModel[] = [];
    if (!rawRegexes) return regexes;
    for (let i = 0; i < rawRegexes.length; i++) {
        const r = rawRegexes[i];
        const pattern = parseStRegex(r.findRegex);
        if (!pattern) continue;
        regexes.push({
            id: i + 1,
            code: sanitizeCode(r.scriptName) || `regex_${i + 1}`,
            name: r.scriptName,
            pattern,
            replacement: r.replaceString,
            target: stPlacementToTarget(r.placement),
            disabled: r.disabled,
        });
    }
    return regexes;
}

/** 从 ST extensions 中提取脚本条目 */
export function extractStScripts(rawScripts: StScript[] | undefined): PresetScriptModel[] {
    const scripts: PresetScriptModel[] = [];
    if (!rawScripts) return scripts;
    for (let i = 0; i < rawScripts.length; i++) {
        const s = rawScripts[i];
        scripts.push({
            id: i + 1,
            code: sanitizeCode(s.name) || `script_${i + 1}`,
            name: s.name,
            content: s.content,
            priority: 100 + i,
            type: s.type || "js",
            disabled: !s.enabled,
        });
    }
    return scripts;
}
