export interface WorkerConfigInput {
  projectName: string;
  appUrl: string;
  databaseId: string;
  server: string;
  agent: string;
  client: string;
}

export function rewriteWorkerConfigs(input: WorkerConfigInput): {
  server: string;
  agent: string;
  client: string;
} {
  const { projectName } = input;
  return {
    server: input.server
      .replaceAll('"name": "openengage-server"', `"name": "${projectName}-server"`)
      .replaceAll('"service": "openengage-agent"', `"service": "${projectName}-agent"`)
      .replaceAll('"database_name": "openengage-db"', `"database_name": "${projectName}-db"`)
      .replaceAll("00000000-0000-0000-0000-000000000000", input.databaseId)
      .replaceAll("openengage-assets", `${projectName}-assets`)
      .replaceAll("openengage-campaign", `${projectName}-campaign`)
      .replaceAll("openengage-delivery", `${projectName}-delivery`)
      .replaceAll("openengage-dead-letter", `${projectName}-dead-letter`)
      .replaceAll('"APP_URL": "http://localhost:5173"', `"APP_URL": "${input.appUrl}"`),
    agent: input.agent
      .replaceAll('"name": "openengage-agent"', `"name": "${projectName}-agent"`)
      .replaceAll('"service": "openengage-server"', `"service": "${projectName}-server"`),
    client: input.client
      .replaceAll('"name": "openengage"', `"name": "${projectName}"`)
      .replaceAll('"service": "openengage-server"', `"service": "${projectName}-server"`),
  };
}

export const initialWorkerDeployCommands = [
  ["--filter", "@openengage/agent", "deploy:bootstrap"],
  ["deploy"],
] as const;
