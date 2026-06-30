import {v4 as uuidv4} from "uuid";
import type {PresetLorebookModel} from "@/engines/lorebooks/models";
import type {PresetMacroModel} from "@/engines/macros/models";
import type {PresetScriptModel} from "@/engines/scripts/models";
import type {PresetRegexModel} from "@/engines/regexes/models";
import {
    type PresetExport, type StRegexScript, type StScript,
    sanitizeCode, extractStRegexes, extractStScripts, transformContent,
    type CollectedMacro, buildMacroEntries,
} from "./silly-tavern";


// ---- SillyTavern 角色卡 JSON 类型（chara_card_v3，驼峰命名） ----

interface StCharWorldEntry {
    id: number;
    keys: string[];
    secondary_keys: string[];
    comment: string;
    content: string;
    constant: boolean;
    selective: boolean;
    insertion_order: number;
    enabled: boolean;
    position: string;
    use_regex: boolean;
    extensions: {
        position: number;
        depth: number;
        role: number;          // 0=system, 1=user, 2=assistant
        [key: string]: any;
    };
}

interface StCharData {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    alternate_greetings: string[];
    tags: string[];
    creator: string;
    creator_notes: string;
    character_version: string;
    system_prompt: string;
    post_history_instructions: string;
    avatar: string;
    character_book?: {
        name: string;
        entries: StCharWorldEntry[];
    };
    extensions: {
        regex_scripts?: StRegexScript[];
        depth_prompt?: {
            prompt: string;
            depth: number;
            role: string;
        };
        tavern_helper?: {
            scripts?: StScript[];
            variables?: Record<string, any>;
        };
        [key: string]: any;
    };
}

export interface StCharCard {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    data: StCharData;
    spec: string;
    spec_version: string;
}

// ---- 映射工具 ----

const ROLE_MAP = ["system", "user", "assistant"] as const;

/**
 * ST 世界书 position → Secyud layer 基值
 *
 * ST WB 插入位置（来源: docs.sillytavern.app/usage/core-concepts/worldinfo）:
 *   before_char        — 角色定义前
 *   after_char         — 角色定义后
 *   before_example     — 示例对话前
 *   after_example      — 示例对话后
 *   top_an             — 作者注顶部
 *   bottom_an          — 作者注底部
 *   at_depth           — 对话中指定深度（用 depth 控制偏移）
 *   outlet             — 不自动注入，由 {{outlet::Name}} 手动放置
 *
 * Secyud layer: 越大越后插入
 */
function charLayer(position: string, depth: number): number {
    const posBase: Record<string, number> = {
        "before_char": 0,
        "after_char": 100,
        "before_example": 200,
        "after_example": 300,
        "top_an": 400,
        "bottom_an": 500,
        "at_depth": 600,
        "outlet": 700,
    };
    const base = posBase[position] ?? 0;
    const d = depth ?? 4;
    // at_depth 模式下 depth 0=最底部（靠近最新消息），Secyud 中更大 layer = 更后
    // 其他模式下 depth 不起作用，所有条目同层，靠 priority 排序
    if (position === "at_depth") {
        // ST depth 0=最靠近底部（最后），Secyud 越大越后
        // 默认 maxDepth=4，d=0 → 偏移最大(40)，d=4 → 偏移最小(0)
        return base + (4 - d) * 10;
    }
    return base;
}

function stRoleToString(role: number): string {
    return ROLE_MAP[role] ?? "system";
}

// ---- 角色卡 → Secyud preset ----

export function convertStCharCard(card: StCharCard, originalFilename: string): PresetExport {
    const baseName = originalFilename.replace(/\.json$/i, '');
    const data = card.data;
    const lorebooks: PresetLorebookModel[] = [];
    const collectedMacros: CollectedMacro[] = [];
    let entryId = 1;

    function addLorebook(
        name: string,
        content: string,
        layer: number,
        opts?: { role?: string; matchType?: string; disabled?: boolean },
    ): void {
        if (!content || !content.trim()) return;
        content = transformContent(content, collectedMacros, undefined, name);
        if (!content) return;

        const code = sanitizeCode(name);
        lorebooks.push({
            id: entryId++,
            code,
            name,
            matchType: opts?.matchType ?? "always",
            matchExpression: {lastMessage: false},
            content,
            priority: 100,
            layer,
            role: opts?.role ?? "system",
            disabled: opts?.disabled ?? false,
        });
    }

    // 角色核心字段
    addLorebook("角色描述", data.description, 0);
    addLorebook("性格设定", data.personality, 10);
    addLorebook("场景设定", data.scenario, 20);
    addLorebook("开场白", data.first_mes, 30, {role: "assistant"});
    addLorebook("示例对话", data.mes_example, 40);
    addLorebook("创作者备注", data.creator_notes, 50);
    addLorebook("系统提示词", data.system_prompt, 60);
    addLorebook("后置指令", data.post_history_instructions, 70);

    // 深度注入
    const dp = data.extensions?.depth_prompt;
    if (dp?.prompt) {
        addLorebook("深度注入", dp.prompt,
            charLayer("before_char", dp.depth ?? 4),
            {role: dp.role || "system"}
        );
    }

    // 世界书条目
    const worldEntries = data.character_book?.entries ?? [];
    for (const we of worldEntries) {
        let matchType: string;
        let matchExpression: Record<string, any>;

        if (we.constant) {
            matchType = "always";
            // 常驻条目中，处于对话末尾层级（at_depth / bottom_an）的才需要 lastMessage
            const lastPositions = new Set(["at_depth", "bottom_an"]);
            matchExpression = {lastMessage: lastPositions.has(we.position)};
        } else if (we.keys.length > 0) {
            matchType = "normal";
            const groups: string[][] = [we.keys];
            if (we.secondary_keys.length > 0) {
                groups.push(we.secondary_keys);
            }
            matchExpression = {
                keywords: groups,
                keywordsLength: groups.length,
                fitCount: groups.length,  // 所有组都必须匹配
            };
        } else {
            continue;
        }

        const content = transformContent(we.content, collectedMacros, we.enabled, we.comment);
        if (!content) continue;

        const layer = charLayer(we.position, we.extensions.depth);
        const role = stRoleToString(we.extensions.role);

        lorebooks.push({
            id: entryId++,
            code: sanitizeCode(we.comment) || `wb_entry_${we.id}`,
            name: we.comment,
            matchType,
            matchExpression,
            content,
            priority: we.insertion_order,
            layer,
            role,
            disabled: !we.enabled,
        });
    }

    // 变量 → 宏
    const macros: PresetMacroModel[] = buildMacroEntries(collectedMacros);

    // tavern_helper 变量 → 追加宏
    const rawVars = data.extensions?.tavern_helper?.variables ?? {};
    let varId = macros.length + 1;
    for (const [key, value] of Object.entries(rawVars)) {
        const strVal = typeof value === "string" ? value : JSON.stringify(value);
        macros.push({
            id: varId++,
            code: sanitizeCode(key),
            name: key,
            key,
            value: strVal,
            disabled: false,
        });
    }

    // 正则 & 脚本
    const regexes: PresetRegexModel[] = extractStRegexes(data.extensions?.regex_scripts);
    const scripts: PresetScriptModel[] = extractStScripts(data.extensions?.tavern_helper?.scripts);

    return {
        id: uuidv4(),
        name: baseName,
        version: "1.0.0",
        code: sanitizeCode(baseName) || "imported_char",
        tags: ["imported", "silly-tavern", "character"],
        requires: [],
        content: {
            author: data.creator || "",
            description: `从 SillyTavern 角色卡导入：${card.name}`,
            coverId: null,
            stLlmParams: {},
            stFormatStrings: {},
        },
        entries: {
            lorebooks,
            macros,
            scripts,
            regexes,
        },
    };
}
