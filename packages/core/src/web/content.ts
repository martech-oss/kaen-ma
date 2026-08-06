import * as z from "zod";

export type EmailBlock =
  | { id: string; type: "text"; html: string }
  | { id: string; type: "image"; src: string; alt: string; href?: string | undefined }
  | { id: string; type: "button"; label: string; href: string; color: string }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; height: number }
  | {
      id: string;
      type: "conditional";
      field: string;
      equals: string | number | boolean;
      blocks: EmailBlock[];
    };

const emailBlockSchema: z.ZodType<EmailBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ id: z.string(), type: z.literal("text"), html: z.string().max(100_000) }),
    z.object({
      id: z.string(),
      type: z.literal("image"),
      src: z.url(),
      alt: z.string().max(500),
      href: z.url().optional(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("button"),
      label: z.string().max(200),
      href: z.string().max(2_000),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    z.object({ id: z.string(), type: z.literal("divider") }),
    z.object({
      id: z.string(),
      type: z.literal("spacer"),
      height: z.number().int().min(4).max(200),
    }),
    z.object({
      id: z.string(),
      type: z.literal("conditional"),
      field: z.string().max(191),
      equals: z.union([z.string(), z.number(), z.boolean()]),
      blocks: z.array(emailBlockSchema).max(50),
    }),
  ]),
);

export const contentDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  backgroundColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#f4f5f7"),
  contentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#ffffff"),
  width: z.number().int().min(320).max(720).default(600),
  blocks: z.array(emailBlockSchema).max(200),
});
export type ContentDocument = z.infer<typeof contentDocumentSchema>;
