import {pluginRouteManager} from "@/plugins/server/plugin-route";
import {NextRequest, NextResponse} from "next/server";
import {BusinessError} from "@/handler/models";
import {type PresetExport} from "./silly-tavern";
import {convertStPreset, type StPreset} from "./silly-tavern-preset";
import {convertStCharCard} from "./silly-tavern-char";
import {parseStPng} from "./png-reader";
import {presetRepository} from "@/presets/server/repository";
import {imageRepository} from "@/business/server/image-repository";
import {eq} from "drizzle-orm";


async function importPreset(model: PresetExport): Promise<NextResponse> {
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


async function readFileJson(file: File): Promise<any> {
    const t = await file.text();
    return JSON.parse(t);
}

const PNG_MIME = 'image/png';

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
                        stPreset = await readFileJson(file);
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
                    let coverId: string | null = null;

                    // PNG 角色卡：从 tEXt 块提取 base64 数据
                    if (file.type === PNG_MIME || file.name.endsWith('.png')) {
                        const pngBuf = Buffer.from(await file.arrayBuffer());
                        const result = parseStPng(pngBuf);
                        if (!result) {
                            throw new BusinessError(
                                'No character data found in PNG (missing ccv3/chara chunk)',
                                'plugin.invalid_st_char'
                            );
                        }
                        json = result.json;

                        // 去元数据后保存封面图
                        coverId = await imageRepository.create(result.cleanPng, PNG_MIME);
                    } else {
                        try {
                            json = await readFileJson(file);
                        } catch {
                            throw new BusinessError('Invalid file', 'plugin.invalid_json');
                        }
                    }

                    if (json.spec !== "chara_card_v3" || !json.data) {
                        throw new BusinessError(
                            'Not a valid SillyTavern character card (expected chara_card_v3)',
                            'plugin.invalid_st_char'
                        );
                    }

                    const model = convertStCharCard(json, file.name);
                    if (coverId) {
                        model.content.coverId = coverId;
                    }

                    return importPreset(model);
                }
            }
        }
    }
};

export default async function init() {
    pluginRouteManager.registerRouteTree(route);
}
