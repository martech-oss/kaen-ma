import { adminContract } from "./admin/contract";
import { contactsContract } from "./contacts/contract";
import { workspaceContract } from "./workspaces/contract";

export const contract = {
  admin: adminContract,
  workspace: workspaceContract,
  contacts: contactsContract,
};
