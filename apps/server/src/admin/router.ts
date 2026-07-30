import { os } from "../orpc/base";

export const adminRequestProcedure = os.admin.request.handler(async ({ context, input }) => {
  const headers = new Headers();
  for (const name of ["authorization", "cf-ray", "cookie", "origin", "x-kaenma-workspace"]) {
    const value = context.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await context.adminApiFetch(
    new Request(new URL(input.path, "http://kaenma.internal"), {
      method: input.method,
      headers,
      ...(input.body === undefined ? {} : { body: input.body }),
    }),
  );
  const payload = await response.json().catch(() => null);
  return {
    status: response.status,
    payload,
  };
});
