import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
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
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { AppDialog, EmptyState, PageLayout } from "@/components/app-ui";
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
  companiesQueryOptions,
  companyContactOptionsQueryOptions,
  companyQueryOptions,
  type CompanyContactDto,
} from "@/features/companies/company-api";
import { formatDate } from "@/lib/format";
import { orpcQuery } from "@/lib/orpc";

import { AddCompanyContactForm, CompanyForm } from "./company-forms";

export function CompaniesPage({ initialQuery }: { initialQuery: string }): ReactNode {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: companies } = useSuspenseQuery(companiesQueryOptions(initialQuery));
  const [query, setQuery] = useState(initialQuery);
  const [showCreate, setShowCreate] = useState(false);
  const createCompany = useMutation(orpcQuery.companies.create.mutationOptions());

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (query === initialQuery) return;
    const timer = window.setTimeout(() => {
      void navigate({
        to: "/contacts/companies",
        search: { q: query },
        replace: true,
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [initialQuery, navigate, query]);

  return (
    <PageLayout
      title="会社"
      action={
        <Button onClick={() => setShowCreate(true)}>
          <Plus data-icon="inline-start" />
          会社を作成
        </Button>
      }
    >
      <div className="max-w-md">
        <InputGroup>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="会社名またはドメインで検索"
            aria-label="会社を検索"
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
      </div>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>すべての会社</CardTitle>
          <CardDescription>会社情報と所属する連絡先数を確認できます。</CardDescription>
          <CardAction>
            <Badge variant="secondary">{companies.length}社</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableCaption className="sr-only">会社一覧</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">会社名</TableHead>
                <TableHead>ドメイン</TableHead>
                <TableHead>連絡先</TableHead>
                <TableHead className="px-4 text-right">更新日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell className="px-4 font-medium">
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      nativeButton={false}
                      render={<Link to="/contacts/companies/$id" params={{ id: company.id }} />}
                    >
                      {company.name}
                    </Button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {company.domain ?? "未設定"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {Number(company.contactCount).toLocaleString()}人
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 text-right text-muted-foreground">
                    {formatDate(company.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {companies.length === 0 ? (
            <EmptyState
              compact
              title={query ? "条件に一致する会社がありません" : "会社がまだありません"}
              description={
                query
                  ? "検索条件を変更してください。"
                  : "最初の会社を作成し、連絡先を会社単位で整理しましょう。"
              }
              action={
                query ? undefined : (
                  <Button variant="outline" onClick={() => setShowCreate(true)}>
                    <Building2 data-icon="inline-start" />
                    会社を作成
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
        title="会社を作成"
        description="会社名とメールドメインを登録します。"
      >
        <CompanyForm
          submitLabel="作成"
          onSubmit={async (values) => {
            const company = await createCompany.mutateAsync(values);
            await queryClient.invalidateQueries({ queryKey: orpcQuery.companies.list.key() });
            toast.success("会社を作成しました");
            setShowCreate(false);
            await navigate({
              to: "/contacts/companies/$id",
              params: { id: company.id },
            });
          }}
        />
      </AppDialog>
    </PageLayout>
  );
}

export function CompanyDetailPage({ companyId }: { companyId: string }): ReactNode {
  const queryClient = useQueryClient();
  const { data: company } = useSuspenseQuery(companyQueryOptions(companyId));
  const { data: contactOptions } = useSuspenseQuery(companyContactOptionsQueryOptions());
  const [showEdit, setShowEdit] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const updateCompany = useMutation(orpcQuery.companies.update.mutationOptions());
  const removeContact = useMutation(orpcQuery.companies.removeContact.mutationOptions());
  const assignContact = useMutation(orpcQuery.companies.assignContact.mutationOptions());

  const assignedIds = new Set(company.contacts.map((contact) => contact.id));
  return (
    <PageLayout
      title={company.name}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/contacts/companies" />}>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>会社ドメイン</CardDescription>
            <CardTitle>{company.domain ?? "未設定"}</CardTitle>
            {company.domain ? (
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon"
                  nativeButton={false}
                  render={
                    <a
                      href={`https://${company.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${company.domain}を開く`}
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
              {company.contacts.length.toLocaleString()}人
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
            <Badge variant="secondary">{company.contacts.length}人</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableCaption className="sr-only">{company.name}に所属する連絡先</TableCaption>
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
              {company.contacts.map((contact) => (
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
                        void removeContact
                          .mutateAsync({ id: company.id, contactId: contact.id })
                          .then(async () => {
                            toast.success("会社との関連を解除しました");
                            await queryClient.invalidateQueries({
                              queryKey: orpcQuery.companies.get.key({ input: { id: companyId } }),
                            });
                            await queryClient.invalidateQueries({
                              queryKey: orpcQuery.companies.list.key(),
                            });
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
          {company.contacts.length === 0 ? (
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
        title="会社を編集"
        description="会社名とドメインを更新します。"
      >
        <CompanyForm
          initialName={company.name}
          initialDomain={company.domain ?? ""}
          submitLabel="変更を保存"
          onSubmit={async (values) => {
            await updateCompany.mutateAsync({
              id: company.id,
              name: values.name,
              domain: values.domain || null,
            });
            await queryClient.invalidateQueries({
              queryKey: orpcQuery.companies.get.key({ input: { id: companyId } }),
            });
            await queryClient.invalidateQueries({ queryKey: orpcQuery.companies.list.key() });
            toast.success("会社を更新しました");
            setShowEdit(false);
          }}
        />
      </AppDialog>
      <AppDialog
        open={showAddContact}
        onOpenChange={setShowAddContact}
        title="連絡先を追加"
        description={`${company.name}へ既存の連絡先を関連付けます。`}
      >
        <AddCompanyContactForm
          contacts={contactOptions.items.filter((contact) => !assignedIds.has(contact.id))}
          onSubmit={async (values) => {
            await assignContact.mutateAsync({ id: company.id, ...values });
            await queryClient.invalidateQueries({
              queryKey: orpcQuery.companies.get.key({ input: { id: companyId } }),
            });
            await queryClient.invalidateQueries({ queryKey: orpcQuery.companies.list.key() });
            toast.success("連絡先を会社へ追加しました");
            setShowAddContact(false);
          }}
        />
      </AppDialog>
    </PageLayout>
  );
}

function contactName(contact: CompanyContactDto): string {
  const name = [contact.lastName, contact.firstName].filter(Boolean).join(" ");
  return name || contact.email || "名前未設定";
}
