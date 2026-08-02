import { useMutation } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";

import {
  ErrorAlert as ErrorNotice,
  FormInput as InputField,
  LoadingButton,
  FormNativeSelect as SelectInput,
} from "@/components/app-ui";
import { NativeSelectOption } from "@/components/ui/native-select";
import { type ContactOptions } from "@/features/contacts/contact-api";
import { optionalString } from "@/lib/form-data";
import { orpcQuery } from "@/lib/orpc";
import { orpc } from "@/lib/orpc";
import { getFormString } from "@/lib/utils";
import { type SegmentFilter } from "@kaenma/orpc";

import { slugify } from "./contact-bits";

export function ContactCreateForm({
  options,
  onSaved,
}: {
  options: ContactOptions;
  onSaved: () => Promise<void>;
}): ReactNode {
  const createContact = useMutation(orpcQuery.contacts.create.mutationOptions());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
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
      const accountId = optionalString(form.get("accountId"));
      await Promise.all([
        tagId
          ? orpc.contactResources.addTag({ contactId: contact.id, resourceId: tagId })
          : Promise.resolve(),
        segmentId
          ? orpc.contactResources.addSegment({ contactId: contact.id, resourceId: segmentId })
          : Promise.resolve(),
        accountId
          ? orpc.companies.assignContact({
              id: accountId,
              contactId: contact.id,
              isPrimary: true,
            })
          : Promise.resolve(),
      ]);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex max-h-[75vh] flex-col gap-5 overflow-y-auto pr-1"
    >
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
        <SelectInput label="アカウント" name="accountId">
          <NativeSelectOption value="">指定なし</NativeSelectOption>
          {options.companies.map((account) => (
            <NativeSelectOption key={account.id} value={account.id}>
              {account.name}
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
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <LoadingButton busy={busy} busyLabel="保存中…" className="w-full" type="submit">
        保存
      </LoadingButton>
    </form>
  );
}

export function SegmentSaveForm({
  filter,
  onSaved,
}: {
  filter: SegmentFilter | null;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!filter) return;
    const name = getFormString(new FormData(event.currentTarget), "name");
    setBusy(true);
    try {
      await orpc.segments.create({
        name,
        slug: slugify(name),
        kind: "dynamic",
        filter,
      });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "セグメントを保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
      <InputField label="セグメント名" name="name" required />
      <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        現在の検索条件を動的セグメントとして保存します。連絡先の状態が変わったら再評価できます。
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <LoadingButton busy={busy} className="w-full" type="submit" disabled={!filter}>
        保存
      </LoadingButton>
    </form>
  );
}
