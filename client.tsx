/**
 * Project Info 插件
 * 构建: npm run build-plugin project-info
 */
import {businessNavigationManager} from '@/business/client/navigation';
import React from 'react';
import {ModelTabHeader} from "@/business/client/template/tab-header";
import {useTranslations} from "next-intl";

function Content() {
    const t = useTranslations();
    return (<div></div>);
}

export default function init() {
    businessNavigationManager.register({
        id: "importer",
        label: () => <ModelTabHeader modelType={'importer'}/>,
        component: Content,
    });
}
