import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { FormDialog, FormInput, FormTextarea } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import {
  ContentDocumentEditor,
  defaultContentDocument,
} from "@/features/content/content-document-editor";
import { type EmailTemplateRow, type MessageVariableRow } from "@/features/emails/email-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { orpcQuery } from "@/lib/orpc";
import { getFormString } from "@/lib/utils";
import type { ContentDocument } from "@openengage/orpc";

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
  const queryClient = useQueryClient();
  const createTemplate = useMutation(orpcQuery.emails.createTemplate.mutationOptions());
  const updateTemplate = useMutation(orpcQuery.emails.updateTemplate.mutationOptions());
  const previewTemplate = useMutation(orpcQuery.emails.previewTemplate.mutationOptions());
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
    await run(async () => {
      const payload = readPayload(form);
      await (template
        ? updateTemplate.mutateAsync({ id: template.id, ...payload })
        : createTemplate.mutateAsync(payload));
      await queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listTemplates.key() });
      toast.success(template ? "テンプレートを更新しました" : "テンプレートを作成しました");
      onSaved();
    });
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
              toast.error(
                caught instanceof Error ? caught.message : "プレビューを生成できませんでした",
              ),
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
  const queryClient = useQueryClient();
  const createVariable = useMutation(orpcQuery.emails.createVariable.mutationOptions());
  const updateVariable = useMutation(orpcQuery.emails.updateVariable.mutationOptions());
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
    await run(async () => {
      await (variable
        ? updateVariable.mutateAsync({ id: variable.id, ...payload })
        : createVariable.mutateAsync(payload));
      await queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listVariables.key() });
      toast.success(variable ? "メッセージ変数を更新しました" : "メッセージ変数を作成しました");
      onSaved();
    });
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
