import {
  assignAccountContactProcedure,
  createAccountProcedure,
  getAccountProcedure,
  listAccountsProcedure,
  removeAccountContactProcedure,
  updateAccountProcedure,
} from "../accounts/router";
import { adminRequestProcedure } from "../admin/router";
import {
  addListProcedure,
  addSegmentProcedure,
  addTagProcedure,
  adjustScoreProcedure,
  bulkActionProcedure,
  contactOptionsProcedure,
  contactProfileProcedure,
  createListProcedure,
  createTagProcedure,
  removeListProcedure,
  removeSegmentProcedure,
  removeTagProcedure,
  restoreContactProcedure,
} from "../contacts/resource-router";
import {
  archiveContactProcedure,
  createContactProcedure,
  listContactsProcedure,
  updateContactProcedure,
} from "../contacts/router";
import { createSegmentProcedure, refreshSegmentProcedure } from "../segments/router";
import { getWorkspaceProcedure } from "../workspaces/router";
import { os } from "./base";

export type { OrpcContext, OrpcInitialContext } from "./context";

export const orpcRouter = os.router({
  admin: {
    request: adminRequestProcedure,
  },
  workspace: {
    get: getWorkspaceProcedure,
  },
  contacts: {
    list: listContactsProcedure,
    create: createContactProcedure,
    update: updateContactProcedure,
    archive: archiveContactProcedure,
  },
  segments: {
    create: createSegmentProcedure,
    refresh: refreshSegmentProcedure,
  },
  contactResources: {
    options: contactOptionsProcedure,
    profile: contactProfileProcedure,
    createTag: createTagProcedure,
    createList: createListProcedure,
    addTag: addTagProcedure,
    removeTag: removeTagProcedure,
    addList: addListProcedure,
    removeList: removeListProcedure,
    addSegment: addSegmentProcedure,
    removeSegment: removeSegmentProcedure,
    adjustScore: adjustScoreProcedure,
    restore: restoreContactProcedure,
    bulkAction: bulkActionProcedure,
  },
  accounts: {
    list: listAccountsProcedure,
    get: getAccountProcedure,
    create: createAccountProcedure,
    update: updateAccountProcedure,
    assignContact: assignAccountContactProcedure,
    removeContact: removeAccountContactProcedure,
  },
});
