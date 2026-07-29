import type { SegmentFilter } from "@kaenma/shared";
import { contactAttributeDefinitions } from "@kaenma/shared";
import { api } from "@/api";
import {
  AppDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  LoadingButton,
  PageLayout,
  ResourceCard,
  ResourceGrid,
  SimpleEmpty,
} from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { slugify } from "@/lib/utils";
import { useRouter } from "@tanstack/react-router";
import { Plus, Shapes } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

export interface SegmentRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  member_count: number;
  updated_at: string;
}

export function SegmentsPage({
  segments,
}: {
  segments: SegmentRow[];
}): ReactNode {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  return (
    <PageLayout
      title="セグメント"
      description="属性・タグ・行動・同意を組み合わせた安全な動的条件です。"
      action={
        <Button onClick={() => setShowForm(true)}>
          <Plus data-icon="inline-start" />
          セグメントを作成
        </Button>
      }
    >
      <ResourceGrid>
        {segments.map((segment) => (
          <ResourceCard
            key={segment.id}
            icon={<Shapes />}
            title={segment.name}
            subtitle={`${segment.kind} · ${segment.member_count} contacts`}
            footer={formatDateTime(segment.updated_at)}
          />
        ))}
      </ResourceGrid>
      {segments.length === 0 ? (
        <SimpleEmpty label="最初のセグメントを作成しましょう" />
      ) : null}
      <AppDialog
        open={showForm}
        onOpenChange={setShowForm}
        title="動的セグメント"
        description="属性や行動条件から更新されるセグメントを作成します。"
      >
        <SegmentForm
          onSaved={async () => {
            setShowForm(false);
            await router.invalidate({ sync: true });
          }}
        />
      </AppDialog>
    </PageLayout>
  );
}

function SegmentForm({ onSaved }: { onSaved: () => Promise<void> }): ReactNode {
  const [field, setField] = useState("stage");
  const [operator, setOperator] = useState("eq");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name"));
    const filter: SegmentFilter = {
      kind: "condition",
      field: field as Extract<SegmentFilter, { kind: "condition" }>["field"],
      operator: operator as Extract<
        SegmentFilter,
        { kind: "condition" }
      >["operator"],
      value: String(form.get("value")),
    };
    setBusy(true);
    await api("/segments", {
      method: "POST",
      body: JSON.stringify({
        name,
        slug: slugify(name),
        kind: "dynamic",
        filter,
      }),
    });
    setBusy(false);
    await onSaved();
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-5"
    >
      <FormInput label="名前" name="name" required />
      <div className="grid grid-cols-2 gap-3">
        <FormNativeSelect
          label="フィールド"
          name="field"
          value={field}
          onChange={(event) => setField(event.target.value)}
        >
          {contactAttributeDefinitions.map((attribute) => (
            <FormSelectOption key={attribute.key} value={attribute.key}>
              {attribute.label}
            </FormSelectOption>
          ))}
          <FormSelectOption value="company">アカウント</FormSelectOption>
          <FormSelectOption value="tag">タグ</FormSelectOption>
          <FormSelectOption value="event">イベント</FormSelectOption>
        </FormNativeSelect>
        <FormNativeSelect
          label="演算子"
          name="operator"
          value={operator}
          onChange={(event) => setOperator(event.target.value)}
        >
          <FormSelectOption value="eq">等しい</FormSelectOption>
          <FormSelectOption value="neq">等しくない</FormSelectOption>
          <FormSelectOption value="contains">含む</FormSelectOption>
          <FormSelectOption value="gte">以上</FormSelectOption>
        </FormNativeSelect>
      </div>
      <FormInput label="値" name="value" required />
      <LoadingButton busy={busy} className="w-full" type="submit">
        作成
      </LoadingButton>
    </form>
  );
}
