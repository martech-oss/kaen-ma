import type { FormEvent, ReactNode } from "react";
import { useState } from "react";

import {
  AppDialog,
  EmptyState,
  FormDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
} from "@/components/app-ui";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import type { ContactOption } from "@/features/companies/company-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/utils";

export function CompanyForm({
  open,
  onOpenChange,
  title,
  description,
  initialName = "",
  initialDomain = "",
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initialName?: string;
  initialDomain?: string;
  submitLabel: string;
  onSubmit: (values: { name: string; domain?: string }) => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("会社を保存できませんでした");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const domain = getFormString(form, "domain").trim().toLowerCase();
    await run(async () => {
      await onSubmit({
        name: getFormString(form, "name").trim(),
        ...(domain ? { domain } : {}),
      });
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={submitLabel}
    >
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
    </FormDialog>
  );
}

export function AddCompanyContactForm({
  open,
  onOpenChange,
  title,
  description,
  contacts,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  contacts: ContactOption[];
  onSubmit: (values: { contactId: string; title?: string; isPrimary: boolean }) => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("連絡先を追加できませんでした");
  const [isPrimary, setIsPrimary] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const titleValue = getFormString(form, "title").trim();
    await run(async () => {
      await onSubmit({
        contactId: getFormString(form, "contactId"),
        ...(titleValue ? { title: titleValue } : {}),
        isPrimary,
      });
    });
  }

  if (contacts.length === 0) {
    return (
      <AppDialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
        <EmptyState
          compact
          title="追加できる連絡先がありません"
          description="すべての連絡先がこの会社に所属しています。"
        />
      </AppDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="追加"
    >
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
    </FormDialog>
  );
}

function contactOptionLabel(contact: ContactOption): string {
  const name = [contact.lastName, contact.firstName].filter(Boolean).join(" ");
  return name
    ? `${name}${contact.email ? `（${contact.email}）` : ""}`
    : (contact.email ?? "名前未設定");
}
