import type { FormEvent, ReactNode } from "react";
import { useState } from "react";

import {
  EmptyState,
  ErrorAlert,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  LoadingButton,
} from "@/components/app-ui";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import type { ContactOption } from "@/features/companies/company-api";
import { getFormString } from "@/lib/utils";

export function CompanyForm({
  initialName = "",
  initialDomain = "",
  submitLabel,
  onSubmit,
}: {
  initialName?: string;
  initialDomain?: string;
  submitLabel: string;
  onSubmit: (values: { name: string; domain?: string }) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const domain = getFormString(form, "domain").trim().toLowerCase();
      await onSubmit({
        name: getFormString(form, "name").trim(),
        ...(domain ? { domain } : {}),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "会社を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        <FormInput
          label="会社名"
          name="name"
          defaultValue={initialName}
          placeholder="例：Acme株式会社"
          required
        />
        <FormInput
          label="ドメイン"
          name="domain"
          defaultValue={initialDomain}
          placeholder="例：acme.co.jp"
          description="URLではなくメールドメインを入力してください。"
          pattern="(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}"
        />
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} busyLabel="保存中…" type="submit">
          {submitLabel}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

export function AddCompanyContactForm({
  contacts,
  onSubmit,
}: {
  contacts: ContactOption[];
  onSubmit: (values: { contactId: string; title?: string; isPrimary: boolean }) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const title = getFormString(form, "title").trim();
      await onSubmit({
        contactId: getFormString(form, "contactId"),
        ...(title ? { title } : {}),
        isPrimary,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "連絡先を追加できませんでした");
    } finally {
      setBusy(false);
    }
  }

  if (contacts.length === 0) {
    return (
      <EmptyState
        compact
        title="追加できる連絡先がありません"
        description="すべての連絡先がこの会社に所属しています。"
      />
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        <FormNativeSelect label="連絡先" name="contactId" required>
          <FormSelectOption value="">選択してください</FormSelectOption>
          {contacts.map((contact) => (
            <FormSelectOption key={contact.id} value={contact.id}>
              {contactOptionLabel(contact)}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormInput label="役職" name="title" placeholder="例：マーケティング責任者" />
        <Field orientation="horizontal">
          <Checkbox
            id="company-primary-contact"
            checked={isPrimary}
            onCheckedChange={(checked) => setIsPrimary(Boolean(checked))}
          />
          <FieldContent>
            <FieldLabel htmlFor="company-primary-contact">
              <FieldTitle>主担当にする</FieldTitle>
              <FieldDescription>この連絡先に設定済みの主担当は解除されます。</FieldDescription>
            </FieldLabel>
          </FieldContent>
        </Field>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} busyLabel="追加中…" type="submit">
          追加
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

function contactOptionLabel(contact: ContactOption): string {
  const name = [contact.lastName, contact.firstName].filter(Boolean).join(" ");
  return name
    ? `${name}${contact.email ? `（${contact.email}）` : ""}`
    : (contact.email ?? "名前未設定");
}
