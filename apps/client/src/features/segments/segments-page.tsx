import { useRouter } from "@tanstack/react-router";
import { Plus, Shapes } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import {
  AppDialog,
  ErrorAlert,
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
import {
  createSegmentCondition,
  getSegmentOperatorOptions,
  normalizeSegmentOperator,
  segmentConditionNeedsValue,
  segmentFieldOptions,
} from "@/features/segments/segment-fields";
import { formatDateTime } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import { getFormString, slugify } from "@/lib/utils";
import type { SegmentRow } from "@kaenma/orpc";
import type { SegmentFilter } from "@kaenma/orpc";

export type { SegmentRow };
import { getSegmentFieldDefinition, type SegmentField, type SegmentOperator } from "@kaenma/orpc";

export function SegmentsPage({ segments }: { segments: SegmentRow[] }): ReactNode {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  return (
    <PageLayout
      title="セグメント"
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
            subtitle={`${segment.kind} · ${segment.memberCount} contacts`}
            footer={formatDateTime(segment.updatedAt)}
          />
        ))}
      </ResourceGrid>
      {segments.length === 0 ? <SimpleEmpty label="最初のセグメントを作成しましょう" /> : null}
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
  const [field, setField] = useState<SegmentField>("stage");
  const [operator, setOperator] = useState<SegmentOperator>("eq");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fieldDefinition = getSegmentFieldDefinition(field);
  const operatorOptions = getSegmentOperatorOptions(field);
  const needsValue = segmentConditionNeedsValue(field, operator);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = getFormString(form, "name");
    const filter: SegmentFilter = createSegmentCondition(
      field,
      operator,
      getFormString(form, "value"),
    );
    setBusy(true);
    setError("");
    try {
      await orpc.segments.create({
        name,
        slug: slugify(name),
        kind: "dynamic",
        filter,
      });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "セグメントを作成できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
      <FormInput label="名前" name="name" required />
      <div className="grid grid-cols-2 gap-3">
        <FormNativeSelect
          label="フィールド"
          name="field"
          value={field}
          onChange={(event) => {
            const nextField = event.target.value as SegmentField;
            setField(nextField);
            setOperator((current) => normalizeSegmentOperator(nextField, current));
          }}
        >
          {segmentFieldOptions.map((option) => (
            <FormSelectOption key={option.field} value={option.field}>
              {option.label}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormNativeSelect
          label="演算子"
          name="operator"
          value={operator}
          onChange={(event) => setOperator(event.target.value as SegmentOperator)}
        >
          {operatorOptions.map((option) => (
            <FormSelectOption key={option.operator} value={option.operator}>
              {option.label}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </div>
      {needsValue ? (
        <FormInput
          label="値"
          name="value"
          type={
            operator === "in"
              ? "text"
              : fieldDefinition.valueType === "number"
                ? "number"
                : fieldDefinition.valueType === "date"
                  ? "datetime-local"
                  : "text"
          }
          {...(operator === "in" ? { description: "複数の値はカンマで区切って入力します。" } : {})}
          required
        />
      ) : (
        <input type="hidden" name="value" value="" />
      )}
      {error ? <ErrorAlert>{error}</ErrorAlert> : null}
      <LoadingButton busy={busy} className="w-full" type="submit">
        作成
      </LoadingButton>
    </form>
  );
}
