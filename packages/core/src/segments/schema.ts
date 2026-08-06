import * as z from "zod";

import {
  getSegmentFieldDefinition,
  isSegmentOperatorAllowed,
  segmentFieldValues,
  segmentOperatorValues,
} from "./fields";

export const segmentFieldSchema = z.enum(segmentFieldValues);
export const segmentOperatorSchema = z.enum(segmentOperatorValues);
export const segmentValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
  z.null(),
]);

export const segmentConditionSchema = z
  .object({
    kind: z.literal("condition"),
    field: segmentFieldSchema,
    key: z.string().max(191).optional(),
    operator: segmentOperatorSchema,
    value: segmentValueSchema,
  })
  .superRefine((condition, context) => {
    if (!isSegmentOperatorAllowed(condition.field, condition.operator)) {
      context.addIssue({
        code: "custom",
        path: ["operator"],
        message: `${condition.operator} is not supported for ${condition.field}`,
      });
    }

    const definition = getSegmentFieldDefinition(condition.field);
    if (definition.keyRequirement === "required" && !condition.key?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["key"],
        message: `${condition.field} requires key`,
      });
    }
  });
export type SegmentCondition = z.infer<typeof segmentConditionSchema>;

export interface SegmentGroup {
  kind: "group";
  combinator: "and" | "or";
  children: SegmentFilter[];
}

export type SegmentFilter = SegmentCondition | SegmentGroup;

export const segmentFilterSchema: z.ZodType<SegmentFilter> = z.lazy(() =>
  z.union([
    segmentConditionSchema,
    z.object({
      kind: z.literal("group"),
      combinator: z.enum(["and", "or"]),
      children: z.array(segmentFilterSchema).min(1).max(25),
    }),
  ]),
);

export const segmentRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z.enum(["static", "dynamic"]),
  filterAst: segmentFilterSchema.nullable(),
  memberCount: z.number().int().nonnegative(),
  evaluatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SegmentRow = z.infer<typeof segmentRowSchema>;
