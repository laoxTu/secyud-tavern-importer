/**
 * Secyud Tavern Importer 插件
 * 构建: npm run build-plugin secyud-tavern-importer
 */
import React, {useState} from 'react';
import {useTranslations} from "next-intl";
import {businessNavigationManager} from '@/business/client/navigation';
import {ModelTabHeader} from "@/business/client/template/tab-header";
import {handleResponse} from "@/client";
import {useErrorHandler} from "@/handler/client/error";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Field, FieldLabel} from "@/components/ui/field";
import {Input} from "@/components/ui/input";


interface ImportAction {
    key: string;
    path: string;
    accept: string;       // 接受的文件类型
}

const importActions: ImportAction[] = [
    {key: 'sillyTavernPreset',    path: '/silly-tavern/import/preset',    accept: '.json'},
    {key: 'sillyTavernCharacter', path: '/silly-tavern/import/character', accept: '.json,.png'},
];

function Content() {
    const t = useTranslations();
    const {handleError, handleSuccess} = useErrorHandler();
    const [open, setOpen] = useState(false);

    const createImportHandler = (action: ImportAction) => async (formData: FormData) => {
        try {
            await handleResponse(
                await fetch(`/plugins/api${action.path}`, {
                    method: 'POST',
                    body: formData,
                })
            );
            handleSuccess(t('importer.importSuccess'));
        } catch (err) {
            handleError(err);
        }
    };

    return (
        <div className="flex flex-col h-full items-center justify-center min-h-[60vh] gap-8 p-8">
            {/* 说明文字 */}
            <p className="text-sm text-muted-foreground max-w-sm text-center leading-relaxed">
                {t('importer.description')}
            </p>

            {/* 导入 Dialog */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button onClick={() => setOpen(true)}>
                        {t('default.import')}
                    </Button>
                </DialogTrigger>

                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t('importer.title')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('importer.description')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-4">
                        {importActions.map(action => (
                            <form key={action.key}
                                  action={createImportHandler(action)}
                                  className="form-reset flex items-end gap-3">
                                <Field>
                                    <FieldLabel htmlFor={`import-${action.key}`}>
                                        {t(`importer.${action.key}`)}
                                    </FieldLabel>
                                    <Input
                                        id={`import-${action.key}`}
                                        name="file"
                                        type="file"
                                        accept={action.accept}
                                        required
                                    />
                                </Field>
                                <Button type="submit" size="sm">
                                    {t('default.import')}
                                </Button>
                            </form>
                        ))}
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">{t('default.cancel')}</Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function init() {
    businessNavigationManager.register({
        id: "importer",
        label: () => <ModelTabHeader modelType={'importer'}/>,
        component: Content,
    });
}
