import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";

import { contract } from "@kaenma/orpc";

/**
 * The SDK is generated from the same oRPC contract that serves /api/rpc and
 * /api/v1, so request/response types can never drift from the server.
 * Calls go through the public OpenAPI surface at /api/v1.
 */
export interface KaenmaClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export type KaenmaClient = ContractRouterClient<typeof contract>;

export function createKaenmaClient(options: KaenmaClientOptions): KaenmaClient {
  const link = new OpenAPILink(contract, {
    url: new URL("/api/v1", options.baseUrl).toString(),
    headers: { authorization: `Bearer ${options.apiKey}` },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return createORPCClient(link);
}

// Error helpers for consumers: every declared contract error surfaces as a
// typed ORPCError with `defined: true` and its contract code.
export { isDefinedError, ORPCError, safe } from "@orpc/client";

// Contract value/type re-exports so SDK consumers need only this package.
export { contract } from "@kaenma/orpc";
export type {
  AssetSummary,
  CampaignRow,
  ContactListInput,
  ContactListResult,
  ContactSummary,
  ContactTimelineEvent,
  DataJob,
  Dashboard,
  DeadLetterRow,
  ProjectRow,
  SegmentRow,
  SubscriptionTopicRow,
  WebhookEndpointRow,
} from "@kaenma/orpc";
