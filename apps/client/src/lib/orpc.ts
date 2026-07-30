import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders, getRequestUrl } from "@tanstack/react-start/server";

import { contract } from "@kaenma/orpc";

const getRpcUrl = createIsomorphicFn()
  .client(() => new URL("/api/rpc", window.location.origin))
  .server(() => new URL("/api/rpc", getRequestUrl()));

const getRpcHeaders = createIsomorphicFn()
  .client(() => new Headers())
  .server(() => getRequestHeaders());

const link = new RPCLink({
  url: () => getRpcUrl(),
  headers: () => getRpcHeaders(),
});

export const orpc: ContractRouterClient<typeof contract> = createORPCClient(link);

export const orpcQuery = createTanstackQueryUtils(orpc);
