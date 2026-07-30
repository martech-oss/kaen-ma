import { accountsContract } from "./accounts/contract";
import { adminContract } from "./admin/contract";
import { contactResourcesContract } from "./contact-resources/contract";
import { contactsContract } from "./contacts/contract";
import { segmentsContract } from "./segments/contract";
import { workspaceContract } from "./workspaces/contract";

export const contract = {
  admin: adminContract,
  accounts: accountsContract,
  workspace: workspaceContract,
  contacts: contactsContract,
  contactResources: contactResourcesContract,
  segments: segmentsContract,
};
