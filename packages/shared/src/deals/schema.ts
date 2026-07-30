import * as z from "zod";

export const dealStatusSchema = z.enum(["open", "won", "lost"]);
export type DealStatus = z.infer<typeof dealStatusSchema>;

export const dealTaskTypeSchema = z.enum(["task", "call", "email", "meeting"]);
export type DealTaskType = z.infer<typeof dealTaskTypeSchema>;

export const dealTaskStatusSchema = z.enum(["open", "completed"]);
export type DealTaskStatus = z.infer<typeof dealTaskStatusSchema>;

const nullableIdSchema = z.string().min(1).nullable().optional();

const dealFieldsSchema = z.object({
  name: z.string().trim().min(1).max(191),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  status: dealStatusSchema,
  ownerUserId: nullableIdSchema,
  contactId: nullableIdSchema,
  accountId: nullableIdSchema,
  expectedCloseDate: z.iso.date().nullable().optional(),
  description: z.string().trim().max(10_000),
});

export const dealCreateSchema = dealFieldsSchema.extend({
  value: dealFieldsSchema.shape.value.default(0),
  currency: dealFieldsSchema.shape.currency.default("JPY"),
  status: dealFieldsSchema.shape.status.default("open"),
  description: dealFieldsSchema.shape.description.default(""),
});
export type DealCreate = z.infer<typeof dealCreateSchema>;

export const dealUpdateSchema = dealFieldsSchema.partial();
export type DealUpdate = z.infer<typeof dealUpdateSchema>;

export const dealMoveSchema = z.object({
  stageId: z.string().min(1),
});
export type DealMove = z.infer<typeof dealMoveSchema>;

const dealTaskFieldsSchema = z.object({
  title: z.string().trim().min(1).max(191),
  type: dealTaskTypeSchema,
  notes: z.string().trim().max(10_000),
  dueAt: z.iso.datetime().nullable().optional(),
  assignedUserId: nullableIdSchema,
});

export const dealTaskCreateSchema = dealTaskFieldsSchema.extend({
  type: dealTaskFieldsSchema.shape.type.default("task"),
  notes: dealTaskFieldsSchema.shape.notes.default(""),
});
export type DealTaskCreate = z.infer<typeof dealTaskCreateSchema>;

export const dealTaskUpdateSchema = dealTaskFieldsSchema.partial().extend({
  status: dealTaskStatusSchema.optional(),
});
export type DealTaskUpdate = z.infer<typeof dealTaskUpdateSchema>;
