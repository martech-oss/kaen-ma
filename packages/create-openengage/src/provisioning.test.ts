import { describe, expect, it } from "vitest";

import { initialWorkerDeployCommands, rewriteWorkerConfigs } from "./provisioning";

describe("three Worker provisioning", () => {
  it("rewrites both sides of every service binding", () => {
    const result = rewriteWorkerConfigs({
      projectName: "acme-engage",
      appUrl: "https://ma.acme.example",
      databaseId: "database-id",
      server:
        '{"name": "openengage-server", "service": "openengage-agent", "database_name": "openengage-db", "database_id": "00000000-0000-0000-0000-000000000000", "APP_URL": "http://localhost:5173", "bucket": "openengage-assets", "queues": ["openengage-campaign", "openengage-delivery", "openengage-dead-letter"]}',
      agent:
        '{"name": "openengage-agent", "env": {"bootstrap": {"name": "openengage-agent"}}, "service": "openengage-server"}',
      client: '{"name": "openengage", "service": "openengage-server"}',
    });

    expect(result.server).toContain('"name": "acme-engage-server"');
    expect(result.server).toContain('"service": "acme-engage-agent"');
    expect(result.server).toContain('"database_id": "database-id"');
    expect(result.agent).toContain('"name": "acme-engage-agent"');
    expect(result.agent).toContain('"service": "acme-engage-server"');
    expect(result.client).toBe('{"name": "acme-engage", "service": "acme-engage-server"}');
  });

  it("deploys bootstrap before the normal server-agent-client sequence", () => {
    expect(initialWorkerDeployCommands).toEqual([
      ["--filter", "@openengage/agent", "deploy:bootstrap"],
      ["deploy"],
    ]);
  });
});
