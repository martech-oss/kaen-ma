import {
  contactCreateSchema,
  contactSchema,
  workspaceRoleSchema,
} from "@kaenma/shared";
import { oc } from "@orpc/contract";
import { z } from "zod";

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  timezone: z.string(),
  created_at: z.number(),
  role: workspaceRoleSchema,
});

export type Workspace = z.infer<typeof workspaceSchema>;

export const contactTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  color: z.string(),
});

export const contactListSchema = contactTagSchema;

export const contactAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  title: z.string().nullable(),
  is_primary: z.boolean(),
});

export const contactSummarySchema = contactSchema.extend({
  tags: z.array(contactTagSchema),
  lists: z.array(contactListSchema),
  accounts: z.array(contactAccountSchema),
});

export type ContactSummary = z.infer<typeof contactSummarySchema>;

export const contactListInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  query: z.string().trim().optional(),
  status: z
    .enum(["active", "archived", "anonymous", "all"])
    .optional(),
  stage: z.string().optional(),
  tagId: z.string().optional(),
  listId: z.string().optional(),
  accountId: z.string().optional(),
  segmentId: z.string().optional(),
  scoreMin: z.number().optional(),
  scoreMax: z.number().optional(),
  sort: z
    .enum(["createdAt", "updatedAt", "score", "name", "email"])
    .optional(),
  direction: z.enum(["asc", "desc"]).optional(),
});

export type ContactListInput = z.infer<typeof contactListInputSchema>;

export const contactListResultSchema = z.object({
  items: z.array(contactSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().optional(),
});

export type ContactListResult = z.infer<typeof contactListResultSchema>;

function isAdminRequestPath(path: string): boolean {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\")
  ) {
    return false;
  }
  try {
    const url = new URL(path, "http://kaenma.internal");
    return (
      url.origin === "http://kaenma.internal" &&
      !url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/auth")
    );
  } catch {
    return false;
  }
}

const adminRequestPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(isAdminRequestPath, "管理画面APIの相対パスを指定してください");

export const adminRequestInputSchema = z.object({
  path: adminRequestPathSchema,
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  body: z.string().optional(),
});

export type AdminRequestInput = z.infer<typeof adminRequestInputSchema>;

export const adminRequestOutputSchema = z.object({
  status: z.number().int().min(100).max(599),
  payload: z.unknown(),
});

export type AdminRequestOutput = z.infer<typeof adminRequestOutputSchema>;

const workspaceErrors = {
  UNAUTHORIZED: {
    status: 401,
    message: "ログインが必要です",
  },
  INVALID_API_KEY: {
    status: 401,
    message: "APIキーが無効です",
  },
  WORKSPACE_REQUIRED: {
    status: 403,
    message: "利用可能なワークスペースがありません",
  },
  ORIGIN_MISMATCH: {
    status: 403,
    message: "許可されていないOriginです",
  },
} as const;

export const contract = {
  admin: {
    request: oc
      .route({ method: "POST", path: "/admin/request" })
      .errors(workspaceErrors)
      .input(adminRequestInputSchema)
      .output(adminRequestOutputSchema),
  },
  workspace: {
    get: oc
      .route({ method: "GET", path: "/workspace" })
      .errors(workspaceErrors)
      .output(workspaceSchema),
  },
  contacts: {
    list: oc
      .route({ method: "GET", path: "/contacts" })
      .errors(workspaceErrors)
      .input(contactListInputSchema)
      .output(contactListResultSchema),
    create: oc
      .route({ method: "POST", path: "/contacts", successStatus: 201 })
      .errors({
        ...workspaceErrors,
        FORBIDDEN: {
          status: 403,
          message: "この操作を行う権限がありません",
        },
        CONTACT_CONFLICT: {
          status: 409,
          message:
            "同じメールアドレスまたは外部IDの連絡先が既に存在します",
        },
      })
      .input(contactCreateSchema)
      .output(contactSchema),
  },
};
