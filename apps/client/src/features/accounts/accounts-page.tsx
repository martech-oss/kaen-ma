import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  UserMinus,
  UsersRound,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AppDialog, EmptyState, ErrorAlert, PageLayout } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  loadAccountDetail,
  type AccountContact,
  type AccountDetail,
  type AccountDetailData,
  type AccountSummary,
  type ContactOption,
} from "@/features/accounts/account-api";
import { formatDate } from "@/lib/format";
import { orpc } from "@/lib/orpc";

import { AccountForm, AddAccountContactForm } from "./account-forms";

export function AccountsPage({
  accounts,
  initialQuery,
}: {
  accounts: AccountSummary[];
  initialQuery: string;
}): ReactNode {
  const [query, setQuery] = useState(initialQuery);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (query === initialQuery) return;
    const timer = window.setTimeout(() => {
      void navigate({
        to: "/contacts/accounts",
        search: { q: query },
        replace: true,
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [initialQuery, navigate, query]);

  return (
    <PageLayout
      title="アカウント"
      action={
        <Button onClick={() => setShowCreate(true)}>
          <Plus data-icon="inline-start" />
          アカウントを作成
        </Button>
      }
    >
      <div className="max-w-md">
        <InputGroup>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="会社名またはドメインで検索"
            aria-label="アカウントを検索"
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
      </div>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>すべてのアカウント</CardTitle>
          <CardDescription>会社情報と所属する連絡先数を確認できます。</CardDescription>
          <CardAction>
            <Badge variant="secondary">{accounts.length}社</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableCaption className="sr-only">アカウント一覧</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">会社名</TableHead>
                <TableHead>ドメイン</TableHead>
                <TableHead>連絡先</TableHead>
                <TableHead className="px-4 text-right">更新日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="px-4 font-medium">
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      nativeButton={false}
                      render={<Link to="/contacts/accounts/$id" params={{ id: account.id }} />}
                    >
                      {account.name}
                    </Button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {account.domain ?? "未設定"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {Number(account.contactCount).toLocaleString()}人
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 text-right text-muted-foreground">
                    {formatDate(account.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {accounts.length === 0 ? (
            <EmptyState
              compact
              title={query ? "条件に一致する会社がありません" : "会社がまだありません"}
              description={
                query
                  ? "検索条件を変更してください。"
                  : "最初のアカウントを作成し、連絡先を会社単位で整理しましょう。"
              }
              action={
                query ? undefined : (
                  <Button variant="outline" onClick={() => setShowCreate(true)}>
                    <Building2 data-icon="inline-start" />
                    アカウントを作成
                  </Button>
                )
              }
            />
          ) : null}
        </CardContent>
      </Card>
      <AppDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        title="アカウントを作成"
        description="会社名とメールドメインを登録します。"
      >
        <AccountForm
          submitLabel="作成"
          onSubmit={async (values) => {
            const account = await orpc.accounts.create(values);
            toast.success("アカウントを作成しました");
            setShowCreate(false);
            await navigate({
              to: "/contacts/accounts/$id",
              params: { id: account.id },
            });
          }}
        />
      </AppDialog>
    </PageLayout>
  );
}

export function AccountDetailPage({
  accountId,
  initialData,
}: {
  accountId: string;
  initialData: AccountDetailData;
}): ReactNode {
  const [account, setAccount] = useState<AccountDetail | null>(initialData.account);
  const [contacts, setContacts] = useState<ContactOption[]>(initialData.contacts);
  const [error, setError] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await loadAccountDetail(accountId);
      setAccount(result.account);
      setContacts(result.contacts);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "アカウントを読み込めませんでした");
    }
  }, [accountId]);

  if (!account) {
    return (
      <PageLayout title="アカウント">
        <ErrorAlert>{error || "アカウントが見つかりません"}</ErrorAlert>
        <Button
          variant="outline"
          className="self-start"
          nativeButton={false}
          render={<Link to="/contacts/accounts" />}
        >
          <ArrowLeft data-icon="inline-start" />
          一覧へ戻る
        </Button>
      </PageLayout>
    );
  }

  const assignedIds = new Set(account.contacts.map((contact) => contact.id));
  return (
    <PageLayout
      title={account.name}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/contacts/accounts" />}>
            <ArrowLeft data-icon="inline-start" />
            一覧
          </Button>
          <Button variant="outline" onClick={() => setShowEdit(true)}>
            <Pencil data-icon="inline-start" />
            編集
          </Button>
          <Button onClick={() => setShowAddContact(true)}>
            <Plus data-icon="inline-start" />
            連絡先を追加
          </Button>
        </div>
      }
    >
      {error ? <ErrorAlert>{error}</ErrorAlert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>会社ドメイン</CardDescription>
            <CardTitle>{account.domain ?? "未設定"}</CardTitle>
            {account.domain ? (
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon"
                  nativeButton={false}
                  render={
                    <a
                      href={`https://${account.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${account.domain}を開く`}
                    />
                  }
                >
                  <ExternalLink />
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>所属する連絡先</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {account.contacts.length.toLocaleString()}人
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>連絡先</CardTitle>
          <CardDescription>
            この会社に所属する担当者と役職、主担当関係を管理します。
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{account.contacts.length}人</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableCaption className="sr-only">{account.name}に所属する連絡先</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">連絡先</TableHead>
                <TableHead>役職</TableHead>
                <TableHead>ステージ</TableHead>
                <TableHead>スコア</TableHead>
                <TableHead className="px-4 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="px-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {contactName(contact)}
                        {contact.isPrimary ? (
                          <Badge variant="outline" className="ml-2">
                            主担当
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {contact.email ?? "メール未設定"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {contact.title ?? "未設定"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{contact.stage}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{contact.score}</TableCell>
                  <TableCell className="px-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void orpc.accounts
                          .removeContact({ id: account.id, contactId: contact.id })
                          .then(async () => {
                            toast.success("アカウントとの関連を解除しました");
                            await load();
                          });
                      }}
                    >
                      <UserMinus data-icon="inline-start" />
                      解除
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {account.contacts.length === 0 ? (
            <EmptyState
              compact
              title="所属する連絡先がありません"
              description="既存の連絡先をこの会社へ関連付けてください。"
              action={
                <Button variant="outline" onClick={() => setShowAddContact(true)}>
                  <UsersRound data-icon="inline-start" />
                  連絡先を追加
                </Button>
              }
            />
          ) : null}
        </CardContent>
      </Card>
      <AppDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        title="アカウントを編集"
        description="会社名とドメインを更新します。"
      >
        <AccountForm
          initialName={account.name}
          initialDomain={account.domain ?? ""}
          submitLabel="変更を保存"
          onSubmit={async (values) => {
            await orpc.accounts.update({
              id: account.id,
              name: values.name,
              domain: values.domain || null,
            });
            toast.success("アカウントを更新しました");
            setShowEdit(false);
            await load();
          }}
        />
      </AppDialog>
      <AppDialog
        open={showAddContact}
        onOpenChange={setShowAddContact}
        title="連絡先を追加"
        description={`${account.name}へ既存の連絡先を関連付けます。`}
      >
        <AddAccountContactForm
          contacts={contacts.filter((contact) => !assignedIds.has(contact.id))}
          onSubmit={async (values) => {
            await orpc.accounts.assignContact({ id: account.id, ...values });
            toast.success("連絡先をアカウントへ追加しました");
            setShowAddContact(false);
            await load();
          }}
        />
      </AppDialog>
    </PageLayout>
  );
}

function contactName(contact: AccountContact): string {
  const name = [contact.lastName, contact.firstName].filter(Boolean).join(" ");
  return name || contact.email || "名前未設定";
}
