import * as z from "zod";

export const reportCategorySchema = z.enum(["contacts", "automations", "emails", "deals", "site"]);
export type ReportCategory = z.infer<typeof reportCategorySchema>;

export const reportDateRangeSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .superRefine((range, context) => {
    const from = new Date(`${range.from}T00:00:00.000Z`);
    const to = new Date(`${range.to}T00:00:00.000Z`);
    if (from > to) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "終了日は開始日以降にしてください",
      });
      return;
    }
    const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 366) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "レポート期間は366日以内にしてください",
      });
    }
  });
export type ReportDateRange = z.infer<typeof reportDateRangeSchema>;

export const reportQuerySchema = reportDateRangeSchema.safeExtend({
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;
