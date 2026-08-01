import { accountsContract } from "./accounts/contract";
import { assetsContract } from "./assets/contract";
import { campaignsContract } from "./campaigns/contract";
import { consentContract } from "./consent/contract";
import { contactResourcesContract } from "./contact-resources/contract";
import { contactsContract } from "./contacts/contract";
import { dealsContract } from "./deals/contract";
import { emailsContract } from "./emails/contract";
import { operationsContract } from "./operations/contract";
import { projectsContract } from "./projects/contract";
import { reportsContract } from "./reports/contract";
import { segmentsContract } from "./segments/contract";
import { websiteContract } from "./website/contract";
import { workspaceContract } from "./workspaces/contract";

export const contract = {
  accounts: accountsContract,
  assets: assetsContract,
  workspace: workspaceContract,
  consent: consentContract,
  contacts: contactsContract,
  campaigns: campaignsContract,
  contactResources: contactResourcesContract,
  deals: dealsContract,
  emails: emailsContract,
  operations: operationsContract,
  projects: projectsContract,
  reports: reportsContract,
  segments: segmentsContract,
  website: websiteContract,
};
