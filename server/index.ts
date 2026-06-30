import {pluginRouteManager} from "@/plugins/server/plugin-route";
import {NextRequest, NextResponse} from "next/server";
import {BusinessError} from "@/handler/models";
import {convertStPreset, type StPreset} from "./silly-tavern";
import {presetRepository} from "@/presets/server/repository";
import {eq} from "drizzle-orm";


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
                        throw new BusinessError(
                            'Invalid JSON file',
                            'plugin.invalid_json'
                        );
                    }

                    if (!stPreset.prompts || !Array.isArray(stPreset.prompts)) {
                        throw new BusinessError(
                            'Not a valid SillyTavern preset (missing prompts array)',
                            'plugin.invalid_st_preset'
                        );
                    }

                    const model = convertStPreset(stPreset, file.name);

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
            },
            "character": {
                async POST(_request: NextRequest, _records: Record<string, any>): Promise<NextResponse> {
                    return NextResponse.json(null);
                }
            }
        }
    }
};

export default async function init() {
    pluginRouteManager.registerRouteTree(route);
}
