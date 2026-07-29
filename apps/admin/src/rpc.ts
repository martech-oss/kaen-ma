import type { AdminRequestInput } from "@kaenma/api-contract";
import { orpc } from "@/lib/orpc";

export class RpcClientError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "RpcClientError";
  }
}

interface Envelope<T> {
  data: T;
  meta?: { nextCursor?: string; total?: number; requestId?: string };
}

type AdminMethod = AdminRequestInput["method"];

function resolveMethod(method: string | undefined): AdminMethod {
  switch (method?.toUpperCase() ?? "GET") {
    case "GET":
      return "GET";
    case "POST":
      return "POST";
    case "PUT":
      return "PUT";
    case "PATCH":
      return "PATCH";
    case "DELETE":
      return "DELETE";
    default:
      throw new RpcClientError(
        `Unsupported request method (${method})`,
        0,
        "unsupported_method",
      );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readError(payload: unknown): {
  code?: string;
  message?: string;
} {
  if (!isRecord(payload) || !isRecord(payload.error)) return {};
  const code =
    typeof payload.error.code === "string"
      ? payload.error.code
      : undefined;
  const message =
    typeof payload.error.message === "string"
      ? payload.error.message
      : undefined;
  return {
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
  };
}

export async function rpc<T>(
  path: string,
  init?: RequestInit,
): Promise<Envelope<T>> {
  if (
    init?.body !== undefined &&
    init.body !== null &&
    typeof init.body !== "string"
  ) {
    throw new RpcClientError(
      "The admin RPC body must be JSON text",
      0,
      "unsupported_body",
    );
  }

  const result = await orpc.admin.request(
    {
      path,
      method: resolveMethod(init?.method),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    },
    init?.signal ? { signal: init.signal } : undefined,
  );

  if (result.status < 200 || result.status >= 300) {
    const error = readError(result.payload);
    throw new RpcClientError(
      error.message ?? `Request failed (${result.status})`,
      result.status,
      error.code ?? "request_failed",
    );
  }

  if (!isRecord(result.payload) || !("data" in result.payload)) {
    throw new RpcClientError(
      "Malformed admin RPC response",
      result.status,
      "invalid_response",
    );
  }

  return result.payload as unknown as Envelope<T>;
}
