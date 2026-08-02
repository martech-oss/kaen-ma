import { authSchema } from "./auth/schema";
import * as automationsSchema from "./automations/schema";
import * as broadcastsSchema from "./broadcasts/schema";
import * as consentSchema from "./consent/schema";
import * as contactsSchema from "./contacts/schema";
import * as dealsSchema from "./deals/schema";
import * as messagingSchema from "./messaging/schema";
import * as platformSchema from "./platform/schema";
import * as relationsSchema from "./relations";
import * as reportsSchema from "./reports/schema";
import * as segmentsSchema from "./segments/schema";
import * as webSchema from "./web/schema";
import * as workspacesSchema from "./workspaces/schema";

export * from "./auth/schema";
export * from "./contacts/schema";
export * from "./segments/schema";
export * from "./deals/schema";
export * from "./consent/schema";
export * from "./automations/schema";
export * from "./messaging/schema";
export * from "./broadcasts/schema";
export * from "./web/schema";
export * from "./workspaces/schema";
export * from "./platform/schema";
export * from "./reports/schema";

/**
 * Every table in the application, keyed by export name, for `drizzle()`
 * registration - plus every `relations()` definition (see relations.ts),
 * which `drizzle()` needs in the same object to enable `db.query.*`.
 */
export const schema = {
  ...authSchema,
  ...contactsSchema,
  ...segmentsSchema,
  ...dealsSchema,
  ...consentSchema,
  ...automationsSchema,
  ...messagingSchema,
  ...broadcastsSchema,
  ...webSchema,
  ...workspacesSchema,
  ...platformSchema,
  ...reportsSchema,
  ...relationsSchema,
};
