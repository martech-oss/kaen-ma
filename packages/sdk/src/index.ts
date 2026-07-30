import type { ApiResponse, CampaignDefinition, WorkspaceRole } from "@kaenma/shared";
import type { Contact, ContactCreate, ContactUpdate } from "@kaenma/shared/contacts";
import type { SegmentFilter } from "@kaenma/shared/segments";

export interface KaenmaClientOptions {
  baseUrl: string;
  apiKey: string;
  fetcher?: typeof fetch;
}

export interface Page<T> {
  data: T[];
  nextCursor?: string;
}

export class KaenmaApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "KaenmaApiError";
  }
}

export class KaenmaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  public constructor(options: KaenmaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
  }

  public readonly contacts = {
    list: async (input: { cursor?: string; limit?: number; query?: string } = {}) => {
      const query = new URLSearchParams();
      if (input.cursor) query.set("cursor", input.cursor);
      if (input.limit) query.set("limit", String(input.limit));
      if (input.query) query.set("q", input.query);
      const response = await this.request<Contact[]>(
        `/contacts${query.size > 0 ? `?${query}` : ""}`,
      );
      return {
        data: response.data,
        ...(response.meta?.nextCursor ? { nextCursor: response.meta.nextCursor } : {}),
      } satisfies Page<Contact>;
    },
    get: (id: string) => this.request<Contact>(`/contacts/${encodeURIComponent(id)}`),
    create: (input: ContactCreate, idempotencyKey = crypto.randomUUID()) =>
      this.request<Contact>("/contacts", {
        method: "POST",
        idempotencyKey,
        body: input,
      }),
    update: (id: string, input: ContactUpdate) =>
      this.request<Contact>(`/contacts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: input,
      }),
    archive: (id: string) =>
      this.request<{ archived: boolean }>(`/contacts/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
  };

  public readonly segments = {
    list: () => this.request<unknown[]>("/segments"),
    preview: (filter: SegmentFilter) =>
      this.request<unknown[]>("/segments/preview", { method: "POST", body: filter }),
    create: (input: {
      name: string;
      slug: string;
      kind: "static" | "dynamic";
      filter?: SegmentFilter;
    }) => this.request<{ id: string }>("/segments", { method: "POST", body: input }),
  };

  public readonly campaigns = {
    list: () => this.request<unknown[]>("/campaigns"),
    create: (definition: CampaignDefinition) =>
      this.request<{ id: string; draftVersionId: string }>("/campaigns", {
        method: "POST",
        body: definition,
      }),
    getDraft: (id: string) =>
      this.request<{ id: string; version: number; graph: CampaignDefinition }>(
        `/campaigns/${encodeURIComponent(id)}/draft`,
      ),
    updateDraft: (id: string, definition: CampaignDefinition) =>
      this.request<{ updated: boolean }>(`/campaigns/${encodeURIComponent(id)}/draft`, {
        method: "PUT",
        body: definition,
      }),
    publish: (id: string) =>
      this.request<{ publishedVersionId: string; draftVersionId: string }>(
        `/campaigns/${encodeURIComponent(id)}/publish`,
        { method: "POST" },
      ),
    enroll: (
      id: string,
      contactId: string,
      input: { sourceEventId?: string; idempotencyKey?: string } = {},
    ) =>
      this.request<{ enrollmentId: string; jobId: string }>(
        `/campaigns/${encodeURIComponent(id)}/enroll`,
        {
          method: "POST",
          idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
          body: {
            contactId,
            ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
          },
        },
      ),
  };

  public readonly dashboard = {
    get: () => this.request<Record<string, unknown>>("/dashboard"),
  };

  public readonly apiKeys = {
    create: (input: { name: string; role: WorkspaceRole; expiresAt?: string }) =>
      this.request<{ id: string; token: string; prefix: string }>("/api-keys", {
        method: "POST",
        body: input,
      }),
  };

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ): Promise<ApiResponse<T>> {
    const response = await this.fetcher(`${this.baseUrl}/api/v1${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const payload = (await response.json().catch(() => null)) as
      | ApiResponse<T>
      | {
          error?: {
            code?: string;
            message?: string;
            requestId?: string;
          };
        }
      | null;
    if (!response.ok) {
      const error = payload && "error" in payload ? payload.error : undefined;
      throw new KaenmaApiError(
        error?.message ?? `Kaenma API returned ${response.status}`,
        response.status,
        error?.code ?? "request_failed",
        error?.requestId,
      );
    }
    return payload as ApiResponse<T>;
  }
}
