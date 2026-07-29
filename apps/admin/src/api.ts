export class ApiClientError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface Envelope<T> {
  data: T;
  meta?: { nextCursor?: string; total?: number; requestId?: string };
}

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<Envelope<T>> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const payload = (await response.json().catch(() => null)) as
    | Envelope<T>
    | { error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    const error = payload && "error" in payload ? payload.error : undefined;
    throw new ApiClientError(
      error?.message ?? `Request failed (${response.status})`,
      response.status,
      error?.code ?? "request_failed",
    );
  }
  return payload as Envelope<T>;
}
