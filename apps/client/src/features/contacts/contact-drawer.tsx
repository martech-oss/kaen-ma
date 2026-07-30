import {
  Archive,
  Building2,
  Check,
  ListPlus,
  RotateCcw,
  Tag,
  Tags,
  UserRound,
  Zap,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import {
  ErrorAlert as ErrorNotice,
  FormInput as InputField,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type AccountOption,
  type ContactOptions,
  type ListOption,
  type TagOption,
} from "@/features/contacts/contact-api";
import { nullableString } from "@/lib/form-data";
import { formatLongDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rpc } from "@/rpc";
import { type Contact } from "@kaenma/shared/contacts";

import { ContactAvatar, contactName, ContactStatusBadge, Section, StatCard } from "./contact-bits";
import { AccountEditor, RelationEditor, SegmentEditor } from "./contact-editors";

export interface ContactProfile {
  contact: Contact;
  tags: TagOption[];
  lists: Array<ListOption & { status: string; updated_at: string }>;
  segments: Array<{
    id: string;
    name: string;
    kind: "static" | "dynamic";
    source: string;
    joined_at: string;
  }>;
  accounts: Array<
    AccountOption & {
      title: string | null;
      is_primary: boolean;
    }
  >;
  scoreEvents: Array<{
    id: string;
    delta: number;
    total: number;
    reason: string;
    created_at: string;
  }>;
  timeline: Array<{
    id: string;
    type: string;
    resource_type: string | null;
    resource_id: string | null;
    properties: Record<string, unknown>;
    occurred_at: string;
  }>;
}

export function ContactDrawer({
  contactId,
  options,
  onClose,
  onChanged,
}: {
  contactId: string;
  options: ContactOptions;
  onClose: () => void;
  onChanged: () => Promise<void>;
}): ReactNode {
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"details" | "activity">("details");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await rpc<ContactProfile>(`/contacts/${contactId}/profile`);
      setProfile(response.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "プロフィールを読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function changed() {
    await Promise.all([loadProfile(), onChanged()]);
  }

  async function mutate(path: string, init: RequestInit) {
    setError("");
    try {
      await rpc(path, init);
      await changed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新できませんでした");
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="!w-full overflow-y-auto p-0 sm:!max-w-2xl">
        {loading && !profile ? (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-14 w-64" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : profile ? (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as "details" | "activity")}
            className="gap-0"
          >
            <SheetHeader className="sticky top-0 z-10 border-b bg-background/95 px-6 py-5 backdrop-blur">
              <div className="flex items-start gap-4">
                <ContactAvatar contact={profile.contact} large />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="truncate text-xl">
                      {contactName(profile.contact)}
                    </SheetTitle>
                    <ContactStatusBadge status={profile.contact.status} />
                  </div>
                  <SheetDescription>
                    {profile.contact.email ?? profile.contact.phone ?? "連絡先情報なし"}
                  </SheetDescription>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <TabsList>
                  <TabsTrigger value="details">プロフィール</TabsTrigger>
                  <TabsTrigger value="activity">アクティビティ</TabsTrigger>
                </TabsList>
                {profile.contact.status === "archived" ? (
                  <Button
                    variant="outline"
                    className="ml-auto"
                    onClick={() =>
                      void mutate(`/contacts/${contactId}/restore`, {
                        method: "POST",
                      })
                    }
                  >
                    <RotateCcw data-icon="inline-start" />
                    復元
                  </Button>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={<Button variant="destructive" className="ml-auto" />}
                    >
                      <Archive data-icon="inline-start" />
                      アーカイブ
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogMedia>
                          <Archive />
                        </AlertDialogMedia>
                        <AlertDialogTitle>連絡先をアーカイブしますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                          配信対象から外れます。必要になった場合は後から復元できます。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() =>
                            void mutate(`/contacts/${contactId}`, {
                              method: "DELETE",
                            })
                          }
                        >
                          アーカイブ
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </SheetHeader>

            <TabsContent value="details" className="flex flex-col gap-5 p-6">
              {error && <ErrorNotice>{error}</ErrorNotice>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="スコア" value={profile.contact.score} icon={<Zap />} />
                <StatCard label="タグ" value={profile.tags.length} icon={<Tag />} />
                <StatCard label="リスト" value={profile.lists.length} icon={<ListPlus />} />
                <StatCard label="会社" value={profile.accounts.length} icon={<Building2 />} />
              </div>

              <ProfileEditForm
                profile={profile}
                disabled={profile.contact.status === "archived"}
                onSaved={changed}
              />

              <RelationEditor
                title="タグ"
                icon={<Tags className="size-4" />}
                items={profile.tags}
                options={options.tags}
                disabled={profile.contact.status === "archived"}
                onAdd={(id) =>
                  mutate(`/contacts/${contactId}/tags`, {
                    method: "POST",
                    body: JSON.stringify({ tagId: id }),
                  })
                }
                onRemove={(id) =>
                  mutate(`/contacts/${contactId}/tags/${id}`, {
                    method: "DELETE",
                  })
                }
              />

              <RelationEditor
                title="リスト"
                icon={<ListPlus className="size-4" />}
                items={profile.lists}
                options={options.lists}
                disabled={profile.contact.status === "archived"}
                onAdd={(id) =>
                  mutate(`/contacts/${contactId}/lists`, {
                    method: "POST",
                    body: JSON.stringify({ listId: id }),
                  })
                }
                onRemove={(id) =>
                  mutate(`/contacts/${contactId}/lists/${id}`, {
                    method: "DELETE",
                  })
                }
              />

              <AccountEditor
                contactId={contactId}
                accounts={profile.accounts}
                options={options.accounts}
                disabled={profile.contact.status === "archived"}
                onChanged={changed}
              />

              <SegmentEditor
                profile={profile}
                options={options.segments}
                disabled={profile.contact.status === "archived"}
                onAdd={(id) =>
                  mutate(`/contacts/${contactId}/segments`, {
                    method: "POST",
                    body: JSON.stringify({ segmentId: id }),
                  })
                }
                onRemove={(id) =>
                  mutate(`/contacts/${contactId}/segments/${id}`, {
                    method: "DELETE",
                  })
                }
              />

              <ScoreForm
                contactId={contactId}
                disabled={profile.contact.status === "archived"}
                onSaved={changed}
              />
            </TabsContent>
            <TabsContent value="activity" className="p-6">
              {error && <ErrorNotice>{error}</ErrorNotice>}
              <ActivityTimeline profile={profile} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="p-6">
            <ErrorNotice>{error}</ErrorNotice>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProfileEditForm({
  profile,
  disabled,
  onSaved,
}: {
  profile: ContactProfile;
  disabled: boolean;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contact = profile.contact;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await rpc(`/contacts/${contact.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: nullableString(form.get("firstName")),
          lastName: nullableString(form.get("lastName")),
          email: nullableString(form.get("email")),
          phone: nullableString(form.get("phone")),
          externalId: nullableString(form.get("externalId")),
          stage: form.get("stage"),
        }),
      });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="基本情報" icon={<UserRound className="size-4" />}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="名"
            name="firstName"
            defaultValue={contact.firstName ?? ""}
            disabled={disabled}
          />
          <InputField
            label="姓"
            name="lastName"
            defaultValue={contact.lastName ?? ""}
            disabled={disabled}
          />
        </div>
        <InputField
          label="メール"
          name="email"
          type="email"
          defaultValue={contact.email ?? ""}
          disabled={disabled}
        />
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="電話番号"
            name="phone"
            defaultValue={contact.phone ?? ""}
            disabled={disabled}
          />
          <InputField
            label="外部ID"
            name="externalId"
            defaultValue={contact.externalId ?? ""}
            disabled={disabled}
          />
        </div>
        <InputField
          label="ステージ"
          name="stage"
          defaultValue={contact.stage}
          disabled={disabled}
          required
        />
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {!disabled && (
          <LoadingButton busy={busy} variant="outline" type="submit">
            <Check data-icon="inline-start" />
            基本情報を保存
          </LoadingButton>
        )}
      </form>
    </Section>
  );
}

function ScoreForm({
  contactId,
  disabled,
  onSaved,
}: {
  contactId: string;
  disabled: boolean;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (disabled) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    try {
      await rpc(`/contacts/${contactId}/score`, {
        method: "POST",
        body: JSON.stringify({
          delta: Number(form.get("delta")),
          reason: form.get("reason"),
        }),
      });
      formElement.reset();
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "スコアを変更できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="スコアを調整" icon={<Zap className="size-4" />}>
      <form
        onSubmit={(event) => void submit(event)}
        className="grid gap-3 md:grid-cols-[120px_1fr_auto]"
      >
        <InputField label="加減点" name="delta" type="number" required />
        <InputField label="理由" name="reason" required />
        <div className="flex items-end">
          <LoadingButton busy={busy} variant="outline" type="submit">
            反映
          </LoadingButton>
        </div>
        {error && (
          <div className="md:col-span-3">
            <ErrorNotice>{error}</ErrorNotice>
          </div>
        )}
      </form>
    </Section>
  );
}

function ActivityTimeline({ profile }: { profile: ContactProfile }): ReactNode {
  const entries = useMemo(
    () =>
      [
        ...profile.timeline.map((event) => ({
          id: event.id,
          type: event.type,
          description: event.resource_type
            ? `${event.resource_type}${event.resource_id ? ` · ${event.resource_id}` : ""}`
            : "Contact activity",
          at: event.occurred_at,
          tone: "indigo",
        })),
        ...profile.scoreEvents.map((event) => ({
          id: event.id,
          type: event.delta > 0 ? `スコア +${event.delta}` : `スコア ${event.delta}`,
          description: `${event.reason} · 合計 ${event.total}`,
          at: event.created_at,
          tone: event.delta > 0 ? "emerald" : "amber",
        })),
      ].sort((left, right) => right.at.localeCompare(left.at)),
    [profile.scoreEvents, profile.timeline],
  );
  return (
    <Section title="アクティビティ" icon={<Zap className="size-4" />}>
      <div className="flex flex-col">
        {entries.map((entry) => (
          <div key={`${entry.type}-${entry.id}`} className="flex gap-3 border-b py-3 last:border-0">
            <span
              className={cn(
                "mt-1.5 size-2.5 shrink-0 rounded-full",
                entry.tone === "emerald"
                  ? "bg-success"
                  : entry.tone === "amber"
                    ? "bg-warning"
                    : "bg-primary",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{entry.type}</div>
              <div className="truncate text-xs text-muted-foreground">{entry.description}</div>
            </div>
            <time className="shrink-0 text-xs text-muted-foreground">
              {formatLongDateTime(entry.at)}
            </time>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            まだアクティビティがありません
          </div>
        )}
      </div>
    </Section>
  );
}
