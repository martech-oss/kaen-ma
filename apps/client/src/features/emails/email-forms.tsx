import { Archive, ExternalLink } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import {
  ErrorAlert,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  FormTextarea,
  LoadingButton,
} from "@/components/app-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import {
  type EmailCampaignRow,
  type EmailTemplateRow,
  type MessageVariableRow,
  type SegmentOption,
  type TopicOption,
} from "@/features/emails/email-api";
import { nullableString } from "@/lib/form-data";
import { toDateTimeLocal } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import { getFormString } from "@/lib/utils";

export function CampaignForm({
  campaign,
  segments,
  templates,
  topics,
  onSaved,
}: {
  campaign: EmailCampaignRow | null;
  segments: SegmentOption[];
  templates: EmailTemplateRow[];
  topics: TopicOption[];
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const scheduledAt = getFormString(form, "scheduledAt").trim();
    try {
      const payload = {
        name: getFormString(form, "name"),
        segmentId: getFormString(form, "segmentId"),
        templateId: getFormString(form, "templateId"),
        topicId: nullableString(form.get("topicId")),
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      };
      await (campaign
        ? orpc.emails.updateCampaign({ id: campaign.id, ...payload })
        : orpc.emails.createCampaign(payload));
      toast.success(
        campaign ? "メールキャンペーンを更新しました" : "メールキャンペーンを作成しました",
      );
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "メールキャンペーンを保存できませんでした",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
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
        <LoadingButton busy={busy} type="submit" className="w-full">
          {campaign ? "変更を保存" : "キャンペーンを作成"}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

export function TemplateForm({ onSaved }: { onSaved: () => Promise<void> }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await orpc.emails.importTemplate({
        resendTemplateId: getFormString(form, "resendTemplateId"),
        purpose: getFormString(form, "purpose") === "transactional" ? "transactional" : "marketing",
      });
      toast.success("Resend Templateを登録しました");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Resend Templateを登録できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
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
        <LoadingButton busy={busy} type="submit" className="w-full">
          テンプレートを登録
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

export function VariableForm({
  variable,
  onSaved,
}: {
  variable: MessageVariableRow | null;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const payload = {
        key: getFormString(form, "key"),
        name: getFormString(form, "name"),
        value: getFormString(form, "value"),
        description: getFormString(form, "description"),
      };
      await (variable
        ? orpc.emails.updateVariable({ id: variable.id, ...payload })
        : orpc.emails.createVariable(payload));
      toast.success(variable ? "メッセージ変数を更新しました" : "メッセージ変数を作成しました");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "メッセージ変数を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
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
        <FormTextarea
          label="説明"
          name="description"
          defaultValue={variable?.description}
          rows={2}
        />
        <LoadingButton busy={busy} type="submit" className="w-full">
          {variable ? "変更を保存" : "変数を作成"}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

export function ArchiveConfirm({
  label,
  onConfirm,
}: {
  label: string;
  onConfirm: () => void;
}): ReactNode {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button size="sm" variant="ghost" aria-label={`${label}をアーカイブ`} />}
      >
        <Archive />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Archive />
          </AlertDialogMedia>
          <AlertDialogTitle>アーカイブしますか？</AlertDialogTitle>
          <AlertDialogDescription>
            「{label}」を通常の一覧から非表示にします。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            アーカイブ
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
