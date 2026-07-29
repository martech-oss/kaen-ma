import { api } from "@/api";
import {
  AppDialog,
  FormInput,
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
import { LayoutTemplate, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

export interface FormRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  updated_at: string;
}

export function FormsPage({ items }: { items: FormRow[] }): ReactNode {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  return (
    <PageLayout
      title="フォーム"
      description="Turnstile、honeypot、許可ドメイン、二重送信防止を組み込んだ獲得面です。"
      action={
        <Button onClick={() => setShowForm(true)}>
          <Plus data-icon="inline-start" />
          フォーム
        </Button>
      }
    >
      <ResourceGrid>
        {items.map((item) => (
          <ResourceCard
            key={item.id}
            icon={<LayoutTemplate />}
            title={item.name}
            subtitle={`${item.status} · /${item.slug}`}
            footer={formatDateTime(item.updated_at)}
          />
        ))}
      </ResourceGrid>
      {items.length === 0 ? <SimpleEmpty label="フォームがありません" /> : null}
      <AppDialog
        open={showForm}
        onOpenChange={setShowForm}
        title="フォームを作成"
        description="連絡先を獲得する公開フォームを作成します。"
      >
        <CreateForm
          onSaved={async () => {
            setShowForm(false);
            await router.invalidate({ sync: true });
          }}
        />
      </AppDialog>
    </PageLayout>
  );
}

function CreateForm({ onSaved }: { onSaved: () => Promise<void> }): ReactNode {
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name"));
    setBusy(true);
    try {
      await api("/forms", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug: slugify(name),
          status: "published",
          definition: {
            fields: [
              { key: "email", type: "email", required: true },
              { key: "firstName", type: "text", required: false },
            ],
          },
          allowedDomains: [],
          turnstileEnabled: true,
        }),
      });
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => void submit(event)}
    >
      <FormInput label="名前" name="name" required />
      <LoadingButton busy={busy} className="w-full" type="submit">
        フォームを公開
      </LoadingButton>
    </form>
  );
}
