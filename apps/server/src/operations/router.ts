import { CSV_MAX_BYTES } from "@kaenma/orpc";

import { authed, requireRole } from "../orpc/base";
import { getDashboard } from "./dashboard-service";
import {
  createApiKey,
  getContactExportFile,
  getDataJob,
  listDeadLetters,
  replayDeadLetter,
  startContactExport,
  startContactImport,
} from "./service";

export const dashboardProcedure = authed.operations.dashboard.handler(async ({ context }) => {
  return getDashboard(context.database, context.workspace.workspaceId);
});

export const createApiKeyProcedure = authed.operations.createApiKey.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    return createApiKey(context.database, context.workspace, input);
  },
);

export const importContactsProcedure = authed.operations.importContacts.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (input.file.size > CSV_MAX_BYTES) throw errors.CSV_TOO_LARGE();
    const csvText = await input.file.text();
    const outcome = await startContactImport(
      context.database,
      { bucket: context.env.ASSETS_BUCKET, queue: context.env.CAMPAIGN_QUEUE },
      context.workspace,
      csvText,
    );
    if (outcome.kind === "identifier_missing") throw errors.CSV_IDENTIFIER_MISSING();
    return { jobId: outcome.jobId, rows: outcome.rows, parts: outcome.parts };
  },
);

export const exportContactsProcedure = authed.operations.exportContacts.handler(
  async ({ context, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    return startContactExport(context.database, context.env.CAMPAIGN_QUEUE, context.workspace);
  },
);

export const getDataJobProcedure = authed.operations.getDataJob.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const job = await getDataJob(context.database, context.workspace.workspaceId, input.id);
    if (!job) throw errors.DATA_JOB_NOT_FOUND();
    return job;
  },
);

export const downloadContactExportProcedure = authed.operations.downloadContactExport.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const outcome = await getContactExportFile(
      context.database,
      context.env.ASSETS_BUCKET,
      context.workspace.workspaceId,
      input.id,
    );
    if (outcome.kind === "not_ready") throw errors.EXPORT_NOT_READY();
    if (outcome.kind === "missing") throw errors.EXPORT_MISSING();
    return outcome.file;
  },
);

export const listDeadLettersProcedure = authed.operations.listDeadLetters.handler(
  async ({ context, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    return listDeadLetters(context.database, context.workspace.workspaceId);
  },
);

export const replayDeadLetterProcedure = authed.operations.replayDeadLetter.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const outcome = await replayDeadLetter(
      context.database,
      { campaign: context.env.CAMPAIGN_QUEUE, delivery: context.env.DELIVERY_QUEUE },
      context.workspace.workspaceId,
      input.id,
    );
    if (outcome.kind === "not_found") throw errors.DEAD_LETTER_NOT_FOUND();
    return { replayed: true as const };
  },
);
