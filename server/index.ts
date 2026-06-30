import {pluginRouteManager} from "@/plugins/server/plugin-route";
import {NextRequest, NextResponse} from "next/server";
import {BusinessError} from "@/handler/models";
import {type PresetExport} from "./silly-tavern";
import {convertStPreset, type StPreset} from "./silly-tavern-preset";
import {convertStCharCard} from "./silly-tavern-char";
import {presetRepository} from "@/presets/server/repository";
import {eq} from "drizzle-orm";


async function importPreset(model: PresetExport): Promise<NextResponse> {
    // 同名 code 已存在则先删除再导入
    const existing = await presetRepository.getList(
        {page: 0, pageSize: 1},
        t => eq(t.code, model.code)
    );
    if (existing.data.length > 0) {
        await presetRepository.delete(existing.data[0].id);
    }

    const result = await presetRepository.create(model as any);
    return NextResponse.json({id: result.id, name: result.name});
}

const route = {
    "silly-tavern": {
        "import": {
            "preset": {
                async POST(request: NextRequest, _records: Record<string, any>): Promise<NextResponse> {
                    const formData = await request.formData();
                    const file = formData.get('file') as File | null;

                    if (!file) {
                        throw new BusinessError('No file uploaded', 'plugin.no_file');
                    }

                    let stPreset: StPreset;
                    try {
                        const text = await file.text();
                        stPreset = JSON.parse(text);
                    } catch {
                        throw new BusinessError('Invalid JSON file', 'plugin.invalid_json');
                    }

                    if (!stPreset.prompts || !Array.isArray(stPreset.prompts)) {
                        throw new BusinessError(
                            'Not a valid SillyTavern preset (missing prompts array)',
                            'plugin.invalid_st_preset'
                        );
                    }

                    return importPreset(convertStPreset(stPreset, file.name));
                }
            },
            "character": {
                async POST(request: NextRequest, _records: Record<string, any>): Promise<NextResponse> {
                    const formData = await request.formData();
                    const file = formData.get('file') as File | null;

                    if (!file) {
                        throw new BusinessError('No file uploaded', 'plugin.no_file');
                    }

                    let json: any;
                    try {
                        const text = await file.text();
                        json = JSON.parse(text);
                    } catch {
                        throw new BusinessError('Invalid JSON file', 'plugin.invalid_json');
                    }

                    // 检测 ST 角色卡格式 (chara_card_v3)
                    if (json.spec !== "chara_card_v3" || !json.data) {
                        throw new BusinessError(
                            'Not a valid SillyTavern character card (expected chara_card_v3)',
                            'plugin.invalid_st_char'
                        );
                    }

                    return importPreset(convertStCharCard(json, file.name));
                }
            }
        }
    }
};

export default async function init() {
    pluginRouteManager.registerRouteTree(route);
}
