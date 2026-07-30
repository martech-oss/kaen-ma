import { authSchema } from "./auth/schema";
import * as campaignsSchema from "./campaigns/schema";
import * as consentSchema from "./consent/schema";
import * as contactsSchema from "./contacts/schema";
import * as contentSchema from "./content/schema";
import * as dealsSchema from "./deals/schema";
import * as integrationsSchema from "./integrations/schema";
import * as operationsSchema from "./operations/schema";
import * as websiteSchema from "./website/schema";

export * from "./auth/schema";
export * from "./contacts/schema";
export * from "./deals/schema";
export * from "./consent/schema";
export * from "./content/schema";
export * from "./campaigns/schema";
export * from "./integrations/schema";
export * from "./operations/schema";
export * from "./website/schema";

/** Every table in the application, keyed by export name, for `drizzle()` registration. */
export const schema = {
  ...authSchema,
  ...contactsSchema,
  ...dealsSchema,
  ...consentSchema,
  ...contentSchema,
  ...campaignsSchema,
  ...integrationsSchema,
  ...operationsSchema,
  ...websiteSchema,
};
