import { accountsContract } from "./accounts/contract";
import { adminContract } from "./admin/contract";
import { contactResourcesContract } from "./contact-resources/contract";
import { contactsContract } from "./contacts/contract";
import { emailsContract } from "./emails/contract";
import { reportsContract } from "./reports/contract";
import { segmentsContract } from "./segments/contract";
import { websiteContract } from "./website/contract";
import { workspaceContract } from "./workspaces/contract";

export const contract = {
  admin: adminContract,
  accounts: accountsContract,
  workspace: workspaceContract,
  contacts: contactsContract,
  contactResources: contactResourcesContract,
  emails: emailsContract,
  reports: reportsContract,
  segments: segmentsContract,
  website: websiteContract,
};
