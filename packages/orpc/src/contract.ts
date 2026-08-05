import { agentConversationsContract } from "./agents/contract";
import { assetsContract } from "./assets/contract";
import { automationsContract } from "./automations/contract";
import { consentContract } from "./consent/contract";
import { companiesContract } from "./contacts/company-contract";
import { contactsContract } from "./contacts/contract";
import { contactResourcesContract } from "./contacts/resource-contract";
import { dealsContract } from "./deals/contract";
import { emailsContract } from "./messaging/contract";
import { operationsContract } from "./operations/contract";
import { projectsContract } from "./projects/contract";
import { reportsContract } from "./reports/contract";
import { segmentsContract } from "./segments/contract";
import { websiteContract } from "./web/contract";
import { workspaceContract } from "./workspaces/contract";

export const contract = {
  agentConversations: agentConversationsContract,
  companies: companiesContract,
  assets: assetsContract,
  workspace: workspaceContract,
  consent: consentContract,
  contacts: contactsContract,
  automations: automationsContract,
  contactResources: contactResourcesContract,
  deals: dealsContract,
  emails: emailsContract,
  operations: operationsContract,
  projects: projectsContract,
  reports: reportsContract,
  segments: segmentsContract,
  website: websiteContract,
};
