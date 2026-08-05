import { describe, expect, it } from "vitest";

import { isBackendRequest } from "./server";

/**
 * This function decides whether a request reaches the API Worker or the
 * TanStack Start app. A prefix that is too greedy silently swallows a UI route;
 * one that is missing breaks a public endpoint on live installs. The `/a`
 * prefix (public assets) is the sharp edge - `/automations` starts with it.
 */
describe("isBackendRequest", () => {
  const backend = [
    "/a/acme/019f.../guide.pdf",
    "/a",
    "/api/rpc",
    "/api/assets/019f.../raw",
    "/f/acme/contact",
    "/p/acme/spring",
    "/t/token",
    "/u/token",
    "/preference/token",
  ];
  const frontend = [
    "/",
    "/automations",
    "/automations/019f...",
    "/analytics",
    "/apidocs",
    "/assets",
    "/website/assets",
    "/dashboard",
    "/preferences",
  ];

  it.each(backend)("routes %s to the API Worker", (path) => {
    expect(isBackendRequest(new Request(`http://localhost${path}`))).toBe(true);
  });

  it.each(frontend)("routes %s to the app", (path) => {
    expect(isBackendRequest(new Request(`http://localhost${path}`))).toBe(false);
  });
});
