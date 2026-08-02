import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import {
  FormDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  FormTextarea,
} from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import {
  type EmailCampaignRow,
  type EmailTemplateRow,
  type MessageVariableRow,
  type SegmentOption,
  type TopicOption,
} from "@/features/emails/email-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { nullableString } from "@/lib/form-data";
import { toDateTimeLocal } from "@/lib/format";
import { orpcQuery } from "@/lib/orpc";
import { getFormString } from "@/lib/utils";

export function CampaignForm({
  open,
  onOpenChange,
  campaign,
  segments,
  templates,
  topics,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: EmailCampaignRow | null;
  segments: SegmentOption[];
  templates: EmailTemplateRow[];
  topics: TopicOption[];
  onSaved: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const createCampaign = useMutation(orpcQuery.emails.createCampaign.mutationOptions());
  const updateCampaign = useMutation(orpcQuery.emails.updateCampaign.mutationOptions());
  const { busy, error, run } = useFormSubmission("メールキャンペーンを保存できませんでした");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scheduledAt = getFormString(form, "scheduledAt").trim();
    const payload = {
      name: getFormString(form, "name"),
      segmentId: getFormString(form, "segmentId"),
      templateId: getFormString(form, "templateId"),
      topicId: nullableString(form.get("topicId")),
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    };
    await run(async () => {
      await (campaign
        ? updateCampaign.mutateAsync({ id: campaign.id, ...payload })
        : createCampaign.mutateAsync(payload));
      await queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listCampaigns.key() });
      toast.success(
        campaign ? "メールキャンペーンを更新しました" : "メールキャンペーンを作成しました",
      );
      onSaved();
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={campaign ? "メールキャンペーンを編集" : "メールキャンペーンを作成"}
      description="配信対象、テンプレート、送信タイミングを設定します。"
      className="sm:max-w-xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={campaign ? "変更を保存" : "キャンペーンを作成"}
    >
      <FormInput
        label="キャンペーン名"
        name="name"
        defaultValue={campaign?.name}
        placeholder="8月のプロダクトアップデート"
        required
      />
      <FormNativeSelect
        label="配信対象セグメント"
        name="segmentId"
        defaultValue={campaign?.segmentId}
        required
      >
        <FormSelectOption value="">選択してください</FormSelectOption>
        {segments.map((segment) => (
          <FormSelectOption key={segment.id} value={segment.id}>
            {segment.name}（{segment.memberCount.toLocaleString()}件）
          </FormSelectOption>
        ))}
      </FormNativeSelect>
      <FormNativeSelect
        label="メールテンプレート"
        name="templateId"
        defaultValue={campaign?.templateId}
        required
      >
        <FormSelectOption value="">選択してください</FormSelectOption>
        {templates.map((template) => (
          <FormSelectOption key={template.id} value={template.id}>
            {template.name}
          </FormSelectOption>
        ))}
      </FormNativeSelect>
      <FormNativeSelect
        label="配信トピック"
        name="topicId"
        defaultValue={campaign?.topicId ?? ""}
        description="未設定の場合はグローバルな配信停止設定を使用します。"
      >
        <FormSelectOption value="">グローバル</FormSelectOption>
        {topics.map((topic) => (
          <FormSelectOption key={topic.id} value={topic.id}>
            {topic.name}
            {topic.isDefault ? "（既定）" : ""}
          </FormSelectOption>
        ))}
      </FormNativeSelect>
      <FormInput
        label="予約配信"
        name="scheduledAt"
        type="datetime-local"
        defaultValue={toDateTimeLocal(campaign?.scheduledAt)}
        description="空欄で保存すると下書きになります。"
      />
    </FormDialog>
  );
}

export function TemplateForm({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const importTemplate = useMutation(orpcQuery.emails.importTemplate.mutationOptions());
  const { busy, error, run } = useFormSubmission("Resend Templateを登録できませんでした");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await importTemplate.mutateAsync({
        resendTemplateId: getFormString(form, "resendTemplateId"),
        purpose: getFormString(form, "purpose") === "transactional" ? "transactional" : "marketing",
      });
      await queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listTemplates.key() });
      toast.success("Resend Templateを登録しました");
      onSaved();
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Resend Templateを登録"
      description="Resendで作成・公開したテンプレートをKaenmaから利用できるようにします。"
      className="sm:max-w-xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="テンプレートを登録"
    >
      <FormInput
        label="Resend Template IDまたはAlias"
        name="resendTemplateId"
        placeholder="welcome-email"
        description="ResendのTemplates画面で公開済みのTemplate IDまたはAliasを入力します。"
        required
      />
      <FormNativeSelect label="用途" name="purpose" defaultValue="marketing">
        <FormSelectOption value="marketing">Marketing（Resend）</FormSelectOption>
        <FormSelectOption value="transactional">Transactional（Resend）</FormSelectOption>
      </FormNativeSelect>
      <Button
        type="button"
        variant="outline"
        render={
          <a
            href="https://resend.com/templates"
            target="_blank"
            rel="noreferrer"
            aria-label="Resend Templatesを開く"
          />
        }
      >
        <ExternalLink data-icon="inline-start" />
        Resend Templatesを開く
      </Button>
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
      description="Resend Template内では MESSAGE_KEY の形式で登録します。"
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
