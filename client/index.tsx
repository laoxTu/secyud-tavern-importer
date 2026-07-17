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
    accept: string;
}

const importActions: ImportAction[] = [
    {key: 'sillyTavernPreset', path: '/silly-tavern/import/preset', accept: '.json'},
    {key: 'sillyTavernCharacter', path: '/silly-tavern/import/character', accept: '.json,.png'},
];

function ImportDialog({action}: { action: ImportAction }) {
    const t = useTranslations();
    const {handleError, handleSuccess} = useErrorHandler();
    const [open, setOpen] = useState(false);

    const handleImport = async (formData: FormData) => {
        try {
            await handleResponse(
                await fetch(`/plugins/api${action.path}`, {
                    method: 'POST',
                    body: formData,
                })
            );

            setOpen(false);
            handleSuccess(t('importer.importSuccess'));
        } catch (err) {
            handleError(err);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger onClick={() => setOpen(true)}
                           render={<Button/>}>
                {t(`importer.${action.key}`)}
            </DialogTrigger>
            <DialogContent>
                <form action={handleImport} className="form-reset">
                    <DialogHeader>
                        <DialogTitle>
                            {t(`importer.${action.key}`)}
                        </DialogTitle>
                        <DialogDescription>
                            {t('importer.description')}
                        </DialogDescription>
                    </DialogHeader>

                    <Field>
                        <FieldLabel htmlFor={`import-${action.key}`}>
                            {t('importer.file')}
                        </FieldLabel>
                        <Input
                            id={`import-${action.key}`}
                            name="file"
                            type="file"
                            accept={action.accept}
                            required
                        />
                    </Field>

                    <DialogFooter>
                        <DialogClose render={<Button variant="outline"/>}>
                            {t('default.cancel')}
                        </DialogClose>
                        <Button type="submit">{t('default.import')}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function Content() {
    const t = useTranslations();

    return (
        <div className="flex flex-col h-full items-center justify-center min-h-[60vh] gap-8 p-8">
            <p className="text-sm text-muted-foreground max-w-sm text-center leading-relaxed">
                {t('importer.description')}
            </p>

            <div className="flex flex-col items-center gap-3">
                {importActions.map(action => (
                    <ImportDialog key={action.key} action={action}/>
                ))}
            </div>
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
