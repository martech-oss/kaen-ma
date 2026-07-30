import { Building2, Filter, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { ErrorAlert as ErrorNotice } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type AccountOption, type SegmentOption } from "@/features/contacts/contact-api";
import { orpc } from "@/lib/orpc";

import { ControlledSelect, Section } from "./contact-bits";
import { type ContactProfile } from "./contact-drawer";

export function RelationEditor({
  title,
  icon,
  items,
  options,
  disabled,
  onAdd,
  onRemove,
}: {
  title: string;
  icon: ReactNode;
  items: Array<{ id: string; name: string; color: string }>;
  options: Array<{ id: string; name: string; color: string }>;
  disabled: boolean;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}): ReactNode {
  const [selectedId, setSelectedId] = useState("");
  const assigned = new Set(items.map((item) => item.id));
  return (
    <Section title={title} icon={icon}>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Badge key={item.id} variant="outline" className="gap-1">
            <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.name}
            {!disabled && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void onRemove(item.id)}
                aria-label={`${item.name}を削除`}
              >
                <X />
              </Button>
            )}
          </Badge>
        ))}
        {items.length === 0 && <span className="text-sm text-muted-foreground">未設定</span>}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <ControlledSelect
            value={selectedId}
            onValueChange={setSelectedId}
            placeholder={`追加する${title}を選択`}
            className="flex-1"
            options={options
              .filter((item) => !assigned.has(item.id))
              .map((item) => ({ value: item.id, label: item.name }))}
          />
          <Button
            variant="outline"
            className="shrink-0"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return;
              void onAdd(selectedId).then(() => setSelectedId(""));
            }}
          >
            追加
          </Button>
        </div>
      )}
    </Section>
  );
}

export function AccountEditor({
  contactId,
  accounts,
  options,
  disabled,
  onChanged,
}: {
  contactId: string;
  accounts: ContactProfile["accounts"];
  options: AccountOption[];
  disabled: boolean;
  onChanged: () => Promise<void>;
}): ReactNode {
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const assigned = new Set(accounts.map((account) => account.id));

  async function addAccount() {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await orpc.accounts.assignContact({
        id: selectedId,
        contactId,
        isPrimary: accounts.length === 0,
      });
      setSelectedId("");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "アカウントへ追加できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(accountId: string) {
    setBusy(true);
    setError("");
    try {
      await orpc.accounts.removeContact({ id: accountId, contactId });
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "アカウントとの関連を解除できませんでした",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="アカウント" icon={<Building2 />}>
      <div className="flex flex-wrap gap-2">
        {accounts.map((account) => (
          <Badge key={account.id} variant="outline">
            <Building2 />
            {account.name}
            {account.isPrimary ? " · 主担当" : ""}
            {!disabled ? (
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={busy}
                onClick={() => void removeAccount(account.id)}
                aria-label={`${account.name}との関連を解除`}
              >
                <X />
              </Button>
            ) : null}
          </Badge>
        ))}
        {accounts.length === 0 ? (
          <span className="text-sm text-muted-foreground">未所属</span>
        ) : null}
      </div>
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {!disabled ? (
        <div className="flex gap-2">
          <ControlledSelect
            value={selectedId}
            onValueChange={setSelectedId}
            placeholder="追加するアカウントを選択"
            className="flex-1"
            options={options
              .filter((account) => !assigned.has(account.id))
              .map((account) => ({
                value: account.id,
                label: account.name,
              }))}
          />
          <Button
            variant="outline"
            className="shrink-0"
            disabled={!selectedId || busy}
            onClick={() => void addAccount()}
          >
            追加
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

export function SegmentEditor({
  profile,
  options,
  disabled,
  onAdd,
  onRemove,
}: {
  profile: ContactProfile;
  options: SegmentOption[];
  disabled: boolean;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}): ReactNode {
  const [selectedId, setSelectedId] = useState("");
  const assigned = new Set(profile.segments.map((segment) => segment.id));
  return (
    <Section title="セグメント" icon={<Filter className="size-4" />}>
      <div className="flex flex-col gap-2">
        {profile.segments.map((segment) => (
          <div
            key={segment.id}
            className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm"
          >
            <span>{segment.name}</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{segment.kind}</Badge>
              {!disabled && segment.source === "static" && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void onRemove(segment.id)}
                  aria-label={`${segment.name}から削除`}
                >
                  <X />
                </Button>
              )}
            </div>
          </div>
        ))}
        {profile.segments.length === 0 && (
          <span className="text-sm text-muted-foreground">未所属</span>
        )}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <ControlledSelect
            value={selectedId}
            onValueChange={setSelectedId}
            placeholder="静的セグメントを選択"
            className="flex-1"
            options={options
              .filter((segment) => segment.kind === "static" && !assigned.has(segment.id))
              .map((segment) => ({ value: segment.id, label: segment.name }))}
          />
          <Button
            variant="outline"
            className="shrink-0"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return;
              void onAdd(selectedId).then(() => setSelectedId(""));
            }}
          >
            追加
          </Button>
        </div>
      )}
    </Section>
  );
}
