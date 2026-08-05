import { type SegmentFilter } from "@openengage/orpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode } from "react";

import {
  FormDialog,
  FormInput as InputField,
  FormNativeSelect as SelectInput,
} from "@/components/app-ui";
import { NativeSelectOption } from "@/components/ui/native-select";
import { type ContactOptions } from "@/features/contacts/contact-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { optionalString } from "@/lib/form-data";
import { orpcQuery } from "@/lib/orpc";
import { orpc } from "@/lib/orpc";
import { getFormString } from "@/lib/utils";

import { slugify } from "./contact-bits";

export function ContactCreateForm({
  open,
  onOpenChange,
  options,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ContactOptions;
  onSaved: () => Promise<void>;
}): ReactNode {
  const createContact = useMutation(orpcQuery.contacts.create.mutationOptions());
  const queryClient = useQueryClient();
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const contact = await createContact.mutateAsync({
        email: optionalString(form.get("email")),
        firstName: optionalString(form.get("firstName")),
        lastName: optionalString(form.get("lastName")),
        phone: optionalString(form.get("phone")),
        externalId: optionalString(form.get("externalId")),
        stage: optionalString(form.get("stage")) ?? "lead",
        customFields: {},
      });
      const tagId = optionalString(form.get("tagId"));
      const segmentId = optionalString(form.get("segmentId"));
      const companyId = optionalString(form.get("companyId"));
      await Promise.all([
        tagId
          ? orpc.contacts.assignTag({ contactId: contact.id, resourceId: tagId })
          : Promise.resolve(),
        segmentId
          ? orpc.contacts.addToSegment({ contactId: contact.id, resourceId: segmentId })
          : Promise.resolve(),
        companyId
          ? orpc.companies.assignContact({
              id: companyId,
              contactId: contact.id,
              isPrimary: true,
            })
          : Promise.resolve(),
      ]);
      if (companyId) {
        await queryClient.invalidateQueries({
          queryKey: orpcQuery.companies.get.key({ input: { id: companyId } }),
        });
        await queryClient.invalidateQueries({ queryKey: orpcQuery.companies.list.key() });
      }
      await onSaved();
    });
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="連絡先を追加"
      description="プロフィール、会社、タグ、セグメントを登録します。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="保存"
      className="sm:max-w-2xl"
    >
      <div className="flex max-h-[75vh] flex-col gap-5 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3">
          <InputField label="名" name="firstName" />
          <InputField label="姓" name="lastName" />
        </div>
        <InputField label="メールアドレス" name="email" type="email" />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="電話番号" name="phone" />
          <InputField label="外部ID" name="externalId" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <InputField label="ステージ" name="stage" defaultValue="lead" />
          <SelectInput label="会社" name="companyId">
            <NativeSelectOption value="">指定なし</NativeSelectOption>
            {options.companies.map((company) => (
              <NativeSelectOption key={company.id} value={company.id}>
                {company.name}
              </NativeSelectOption>
            ))}
          </SelectInput>
          <SelectInput label="タグ" name="tagId">
            <NativeSelectOption value="">指定なし</NativeSelectOption>
            {options.tags.map((tag) => (
              <NativeSelectOption key={tag.id} value={tag.id}>
                {tag.name}
              </NativeSelectOption>
            ))}
          </SelectInput>
          <SelectInput label="セグメント" name="segmentId">
            <NativeSelectOption value="">指定なし</NativeSelectOption>
            {options.segments
              .filter((segment) => segment.kind === "static")
              .map((segment) => (
                <NativeSelectOption key={segment.id} value={segment.id}>
                  {segment.name}
                </NativeSelectOption>
              ))}
          </SelectInput>
        </div>
        <p className="text-xs text-muted-foreground">
          メールアドレスまたは外部IDのどちらかを入力してください。
        </p>
      </div>
    </FormDialog>
  );
}

export function SegmentSaveForm({
  open,
  onOpenChange,
  filter,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter: SegmentFilter | null;
  onSaved: () => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("セグメントを保存できませんでした");
  const queryClient = useQueryClient();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!filter) return;
    const name = getFormString(new FormData(event.currentTarget), "name");
    await run(async () => {
      await orpc.segments.create({
        name,
        slug: slugify(name),
        kind: "dynamic",
        filter,
      });
      await queryClient.invalidateQueries({ queryKey: orpcQuery.segments.list.key() });
      await onSaved();
    });
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="検索条件をセグメントとして保存"
      description="現在の検索条件を動的セグメントに変換します。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="保存"
    >
      <InputField label="セグメント名" name="name" required />
      <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        現在の検索条件を動的セグメントとして保存します。連絡先の状態が変わったら再評価できます。
      </p>
    </FormDialog>
  );
}
