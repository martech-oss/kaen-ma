import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { FormDialog, FormInput, FormTextarea } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import {
  ContentDocumentEditor,
  defaultContentDocument,
} from "@/features/content/content-document-editor";
import {
  type EmailTemplateRow,
  type MessageVariableRow,
  useCreateEmailTemplate,
  useCreateEmailVariable,
  usePreviewEmailTemplate,
  useUpdateEmailTemplate,
  useUpdateEmailVariable,
} from "@/features/emails/email-api";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { saveResource } from "@/hooks/use-resource-editor";
import { getFormString } from "@/lib/form-data";
import type { ContentDocument } from "@openengage/core/web";

export function TemplateForm({
  open,
  onOpenChange,
  template,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: EmailTemplateRow | null;
  onSaved: () => void;
}): ReactNode {
  const createTemplate = useCreateEmailTemplate();
  const updateTemplate = useUpdateEmailTemplate();
  const previewTemplate = usePreviewEmailTemplate();
  const [content, setContent] = useState<ContentDocument>(
    template?.content ?? defaultContentDocument(),
  );
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(
    null,
  );
  const { busy, error, run } = useFormSubmission("テンプレートを保存できませんでした");

  function readPayload(form: FormData) {
    return {
      name: getFormString(form, "name"),
      subject: getFormString(form, "subject"),
      content,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = readPayload(form);
    await run(() =>
      saveResource({
        editing: template,
        payload,
        create: (data) => createTemplate.mutateAsync(data),
        update: (id, data) => updateTemplate.mutateAsync({ id, ...data }),
        createdMessage: "テンプレートを作成しました",
        updatedMessage: "テンプレートを更新しました",
        onSaved,
      }),
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={template ? "Transactionalテンプレートを編集" : "Transactionalテンプレートを作成"}
      description="OpenEngageが安全なHTMLとplain textを生成します。公開するまでAutomationには反映されません。"
      className="sm:max-w-3xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={template ? "下書きを保存" : "テンプレートを作成"}
    >
      <FormInput
        label="管理名"
        name="name"
        defaultValue={template?.name}
        placeholder="申込確認"
        required
      />
      <FormInput
        label="件名"
        name="subject"
        defaultValue={template?.subject}
        placeholder="{{ contact.first_name }}さん、お申し込みありがとうございます"
        maxLength={998}
        required
      />
      <ContentDocumentEditor value={content} onChange={setContent} />
      <Button
        type="button"
        variant="outline"
        onClick={(event) => {
          const form = event.currentTarget.form;
          if (!form) return;
          void previewTemplate
            .mutateAsync(readPayload(new FormData(form)))
            .then(setPreview)
            .catch((caught: unknown) =>
              toast.error(getErrorMessage(caught, "プレビューを生成できませんでした")),
            );
        }}
      >
        プレビューを生成
      </Button>
      {preview ? (
        <div className="grid gap-3 rounded-lg border p-3">
          <p className="text-sm font-medium">{preview.subject}</p>
          <iframe
            title="メールHTMLプレビュー"
            srcDoc={preview.html}
            className="h-72 w-full rounded border"
          />
          <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">{preview.text}</pre>
        </div>
      ) : null}
    </FormDialog>
  );
}

export function VariableForm({
  open,
  onOpenChange,
  variable,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variable: MessageVariableRow | null;
  onSaved: () => void;
}): ReactNode {
  const createVariable = useCreateEmailVariable();
  const updateVariable = useUpdateEmailVariable();
  const { busy, error, run } = useFormSubmission("メッセージ変数を保存できませんでした");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      key: getFormString(form, "key"),
      name: getFormString(form, "name"),
      value: getFormString(form, "value"),
      description: getFormString(form, "description"),
    };
    await run(() =>
      saveResource({
        editing: variable,
        payload,
        create: (data) => createVariable.mutateAsync(data),
        update: (id, data) => updateVariable.mutateAsync({ id, ...data }),
        createdMessage: "メッセージ変数を作成しました",
        updatedMessage: "メッセージ変数を更新しました",
        onSaved,
      }),
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={variable ? "メッセージ変数を編集" : "メッセージ変数を作成"}
      description="テンプレート内では {{ message.key }} の形式で利用します。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={variable ? "変更を保存" : "変数を作成"}
    >
      <FormInput
        label="表示名"
        name="name"
        defaultValue={variable?.name}
        placeholder="ブランド名"
        required
      />
      <FormInput
        label="キー"
        name="key"
        defaultValue={variable?.key}
        placeholder="brand_name"
        pattern="[a-z][a-z0-9_]*"
        description="英小文字で始まり、英小文字・数字・_のみ使用できます。"
        required
      />
      <FormTextarea label="値" name="value" defaultValue={variable?.value} rows={5} required />
      <FormTextarea label="説明" name="description" defaultValue={variable?.description} rows={2} />
    </FormDialog>
  );
}
