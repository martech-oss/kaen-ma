import { type AutomationEdge, type AutomationNode } from "@openengage/orpc";
import { Trash2 } from "lucide-react";
import { type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import { connectionBranches, sourceConfig } from "./automation-graph";
import { formatDuration, nodeLabel, nodeTypeLabel } from "./automation-labels";
import { type AutomationOptions } from "./automation-types";

export function NodeSettings({
  node,
  nodes,
  edges,
  options,
  onUpdate,
  onConnectionChange,
  onDelete,
}: {
  node: AutomationNode | null;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  options: AutomationOptions;
  onUpdate: (update: (node: AutomationNode) => AutomationNode) => void;
  onConnectionChange: (
    sourceId: string,
    branch: AutomationEdge["branch"],
    targetId: string,
  ) => void;
  onDelete: () => void;
}): ReactNode {
  if (!node) {
    return (
      <div className="p-6 text-sm leading-6 text-muted-foreground">
        キャンバス上のステップを選択すると、ここで開始条件や実行内容を設定できます。
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {nodeTypeLabel(node.type)}
          </div>
          <h2 className="mt-1 font-medium">{nodeLabel(node)}</h2>
        </div>
        {node.type !== "source" ? (
          <Button size="icon-sm" variant="ghost" aria-label="ステップを削除" onClick={onDelete}>
            <Trash2 />
          </Button>
        ) : null}
      </div>
      {node.type === "source" ? (
        <SourceSettings node={node} options={options} onUpdate={onUpdate} />
      ) : null}
      {node.type === "action" ? (
        <ActionSettings node={node} options={options} onUpdate={onUpdate} />
      ) : null}
      {node.type === "delay" ? <DelaySettings node={node} onUpdate={onUpdate} /> : null}
      {node.type === "decision" ? <DecisionSettings node={node} onUpdate={onUpdate} /> : null}
      {node.type === "condition" ? <ConditionSettings node={node} onUpdate={onUpdate} /> : null}
      <ConnectionSettings
        node={node}
        nodes={nodes}
        edges={edges}
        onConnectionChange={onConnectionChange}
      />
    </div>
  );
}

export function ConnectionSettings({
  node,
  nodes,
  edges,
  onConnectionChange,
}: {
  node: AutomationNode;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  onConnectionChange: (
    sourceId: string,
    branch: AutomationEdge["branch"],
    targetId: string,
  ) => void;
}): ReactNode {
  const targets = nodes.filter((target) => target.id !== node.id && target.type !== "source");
  const branches = connectionBranches(node);
  return (
    <>
      <FieldSeparator>接続</FieldSeparator>
      <FieldDescription>
        キャンバス上で丸をドラッグするか、ここで次に実行するステップを選択できます。
      </FieldDescription>
      {branches.map(([branch, label]) => (
        <SettingSelect
          key={branch}
          label={branches.length === 1 ? "接続先" : `${label}の接続先`}
          value={
            edges.find((edge) => edge.source === node.id && edge.branch === branch)?.target ?? ""
          }
          onChange={(targetId) => onConnectionChange(node.id, branch, targetId)}
          options={[
            ["", "未接続"],
            ...targets.map(
              (target) =>
                [
                  target.id,
                  `${nodes.findIndex((candidate) => candidate.id === target.id) + 1}. ${nodeLabel(target)}`,
                ] as const,
            ),
          ]}
        />
      ))}
    </>
  );
}

function SourceSettings({
  node,
  options,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "source" }>;
  options: AutomationOptions;
  onUpdate: (update: (node: AutomationNode) => AutomationNode) => void;
}): ReactNode {
  const source = node.config.source;
  return (
    <>
      <SettingSelect
        label="開始条件"
        value={source}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "source"
              ? {
                  ...current,
                  config: sourceConfig(
                    value,
                    options.forms[0]?.id ?? "",
                    options.segments[0]?.id ?? "",
                  ),
                }
              : current,
          )
        }
        options={[
          ["contact_created", "連絡先が登録された"],
          ["form_submitted", "フォームが送信された"],
          ["segment_joined", "セグメントに参加した"],
          ["api_event", "APIイベントを受け取った"],
          ["webhook_event", "Webhookイベントを受け取った"],
          ["contact_inactive", "一定期間行動がない"],
        ]}
      />
      {source === "form_submitted" ? (
        <SettingSelect
          label="フォーム"
          value={node.config.formId}
          onChange={(value) =>
            onUpdate((current) =>
              current.type === "source"
                ? { ...current, config: { ...node.config, formId: value } }
                : current,
            )
          }
          options={options.forms.map((form) => [form.id, form.name])}
        />
      ) : null}
      {source === "segment_joined" ? (
        <SettingSelect
          label="セグメント"
          value={node.config.segmentId}
          onChange={(value) =>
            onUpdate((current) =>
              current.type === "source"
                ? { ...current, config: { ...node.config, segmentId: value } }
                : current,
            )
          }
          options={options.segments.map((segment) => [segment.id, segment.name])}
        />
      ) : null}
      {source === "api_event" || source === "webhook_event" ? (
        <SettingInput
          label="イベント名"
          value={node.config.eventName}
          placeholder="cart_abandoned"
          description="連絡先イベントAPIまたはサイトトラッキングから送る名前です。"
          onChange={(value) =>
            onUpdate((current) =>
              current.type === "source" &&
              (current.config.source === "api_event" || current.config.source === "webhook_event")
                ? { ...current, config: { ...current.config, eventName: value } }
                : current,
            )
          }
        />
      ) : null}
      {source === "contact_inactive" ? (
        <SettingInput
          label="行動がない日数"
          type="number"
          min={1}
          max={3650}
          value={String(node.config.days)}
          onChange={(value) =>
            onUpdate((current) =>
              current.type === "source" && current.config.source === "contact_inactive"
                ? {
                    ...current,
                    config: { ...current.config, days: Math.max(1, Number(value) || 1) },
                  }
                : current,
            )
          }
        />
      ) : null}
      {"reentry" in node.config &&
      node.config.source !== "contact_created" &&
      node.config.source !== "contact_inactive" ? (
        <SettingSelect
          label="再登録"
          value={node.config.reentry}
          onChange={(value) =>
            onUpdate((current) => {
              if (
                current.type !== "source" ||
                current.config.source === "contact_created" ||
                current.config.source === "contact_inactive"
              )
                return current;
              return {
                ...current,
                config: {
                  ...current.config,
                  reentry: value === "every_time" ? "every_time" : "once",
                },
              };
            })
          }
          options={[
            ["once", "連絡先ごとに1回"],
            ["every_time", "イベントのたびに登録"],
          ]}
        />
      ) : null}
    </>
  );
}

function ActionSettings({
  node,
  options,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "action" }>;
  options: AutomationOptions;
  onUpdate: (update: (node: AutomationNode) => AutomationNode) => void;
}): ReactNode {
  if (node.config.action === "send_email") {
    return (
      <SettingSelect
        label="メールテンプレート"
        value={node.config.templateId}
        onChange={(value) => {
          const template = options.templates.find((item) => item.id === value);
          if (!template) return;
          onUpdate((current) =>
            current.type === "action" && current.config.action === "send_email"
              ? {
                  ...current,
                  config: {
                    ...current.config,
                    templateId: value,
                  },
                }
              : current,
          );
        }}
        options={options.templates.map((template) => [template.id, template.name])}
      />
    );
  }
  if (node.config.action === "change_score") {
    return (
      <SettingInput
        label="スコア変更量"
        type="number"
        value={String(node.config.amount)}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "action" && current.config.action === "change_score"
              ? { ...current, config: { ...current.config, amount: Number(value) || 0 } }
              : current,
          )
        }
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground">このアクションはJSON定義で設定されています。</p>
  );
}

function DelaySettings({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "delay" }>;
  onUpdate: (update: (node: AutomationNode) => AutomationNode) => void;
}): ReactNode {
  if (node.config.mode !== "relative") {
    return (
      <p className="text-sm text-muted-foreground">相対待機へ変更すると画面で編集できます。</p>
    );
  }
  return (
    <SettingInput
      label="待機時間（分）"
      type="number"
      min={1}
      max={525600}
      value={String(node.config.minutes)}
      description={`${formatDuration(node.config.minutes)} 待ってから次へ進みます。`}
      onChange={(value) =>
        onUpdate((current) =>
          current.type === "delay" && current.config.mode === "relative"
            ? {
                ...current,
                config: { ...current.config, minutes: Math.max(1, Number(value) || 1) },
              }
            : current,
        )
      }
    />
  );
}

function DecisionSettings({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "decision" }>;
  onUpdate: (update: (node: AutomationNode) => AutomationNode) => void;
}): ReactNode {
  return (
    <>
      <SettingSelect
        label="待つ行動"
        value={node.config.event}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "decision"
              ? {
                  ...current,
                  config: {
                    ...current.config,
                    event: value as typeof current.config.event,
                  },
                }
              : current,
          )
        }
        options={[
          ["opened", "メール開封"],
          ["clicked", "メールクリック"],
          ["replied", "メール返信"],
          ["page_viewed", "ページ閲覧"],
          ["form_submitted", "フォーム送信"],
          ["custom_event", "カスタムイベント"],
        ]}
      />
      <SettingInput
        label={node.config.event === "custom_event" ? "イベント名" : "対象ID（任意）"}
        value={node.config.resourceId ?? ""}
        placeholder={node.config.event === "custom_event" ? "purchase_completed" : "未指定"}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "decision"
              ? {
                  ...current,
                  config: { ...current.config, resourceId: value || undefined },
                }
              : current,
          )
        }
      />
      <SettingInput
        label="待機上限（分）"
        type="number"
        min={1}
        max={525600}
        value={String(node.config.withinMinutes)}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "decision"
              ? {
                  ...current,
                  config: {
                    ...current.config,
                    withinMinutes: Math.max(1, Number(value) || 1),
                  },
                }
              : current,
          )
        }
      />
      <p className="text-xs leading-5 text-muted-foreground">
        行動ありは「はい」、上限到達は「時間切れ」の接続先へ進みます。
      </p>
    </>
  );
}

function ConditionSettings({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "condition" }>;
  onUpdate: (update: (node: AutomationNode) => AutomationNode) => void;
}): ReactNode {
  return (
    <>
      <SettingInput
        label="連絡先フィールド"
        value={node.config.field}
        placeholder="stage"
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "condition"
              ? { ...current, config: { ...current.config, field: value } }
              : current,
          )
        }
      />
      <SettingSelect
        label="比較"
        value={node.config.operator}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "condition"
              ? {
                  ...current,
                  config: {
                    ...current.config,
                    operator: value as typeof current.config.operator,
                  },
                }
              : current,
          )
        }
        options={[
          ["eq", "等しい"],
          ["neq", "等しくない"],
          ["contains", "含む"],
          ["gt", "より大きい"],
          ["gte", "以上"],
          ["lt", "より小さい"],
          ["lte", "以下"],
          ["exists", "値がある"],
          ["not_exists", "値がない"],
        ]}
      />
      <SettingInput
        label="比較する値"
        value={
          typeof node.config.value === "string"
            ? node.config.value
            : String(node.config.value ?? "")
        }
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "condition"
              ? { ...current, config: { ...current.config, value } }
              : current,
          )
        }
      />
      <p className="text-xs leading-5 text-muted-foreground">
        条件一致は「はい」、不一致は「いいえ」の接続先へ進みます。
      </p>
    </>
  );
}

function SettingInput({
  label,
  description,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "onChange"> & {
  label: string;
  description?: string;
  onChange: (value: string) => void;
}): ReactNode {
  const id = `setting-${label}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} onChange={(event) => onChange(event.target.value)} />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

function SettingSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<readonly [string, string]>;
}): ReactNode {
  const id = `setting-${label}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        className="w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.length === 0 ? (
          <NativeSelectOption value="">選択肢がありません</NativeSelectOption>
        ) : null}
        {options.map(([optionValue, optionLabel]) => (
          <NativeSelectOption key={optionValue} value={optionValue}>
            {optionLabel}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
