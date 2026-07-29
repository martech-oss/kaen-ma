import { ORPCError } from "@orpc/client";
import { StandardRPCJsonSerializer } from "@orpc/client/standard";
import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query";

const serializer = new StandardRPCJsonSerializer();

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) =>
          error instanceof ORPCError && error.status < 500 ? false : failureCount < 1,
        queryKeyHashFn(queryKey) {
          const [json, meta] = serializer.serialize(queryKey);
          return JSON.stringify({ json, meta });
        },
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
        serializeData(data) {
          const [json, meta] = serializer.serialize(data);
          return { json, meta };
        },
      },
      hydrate: {
        deserializeData(data) {
          const serialized = data as {
            json: unknown;
            meta: readonly (readonly [number, ...Array<string | number>])[];
          };
          return serializer.deserialize(serialized.json, serialized.meta);
        },
      },
    },
  });
}
