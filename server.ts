import {pluginRouteManager} from "@/plugins/server/plugin-route";
import {NextRequest, NextResponse} from "next/server";

// 定义导入api
const route = {
    "silly-tavern": {
        "import": {
            "preset": {
                async POST(request: NextRequest, records: Record<string, any>): Promise<NextResponse> {
                    return NextResponse.json(null);
                }
            }
        }
    }

};

export default async function init() {
    pluginRouteManager.registerRouteTree(route);
}