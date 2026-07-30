import { accountsContract } from "./accounts/contract";
import { campaignsContract } from "./campaigns/contract";
import { contactResourcesContract } from "./contact-resources/contract";
import { contactsContract } from "./contacts/contract";
import { dealsContract } from "./deals/contract";
import { emailsContract } from "./emails/contract";
import { operationsContract } from "./operations/contract";
import { reportsContract } from "./reports/contract";
import { segmentsContract } from "./segments/contract";
import { websiteContract } from "./website/contract";
import { workspaceContract } from "./workspaces/contract";

export const contract = {
  accounts: accountsContract,
  workspace: workspaceContract,
  contacts: contactsContract,
  campaigns: campaignsContract,
  contactResources: contactResourcesContract,
  deals: dealsContract,
  emails: emailsContract,
  operations: operationsContract,
  reports: reportsContract,
  segments: segmentsContract,
  website: websiteContract,
};
