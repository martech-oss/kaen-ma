import * as z from "zod";

import { contentDocumentSchema } from "../index";

export const publishStatusSchema = z.enum(["draft", "published"]);
export type PublishStatus = z.infer<typeof publishStatusSchema>;

export const signupFormDefinitionSchema = z.object({
  style: z.enum(["inline", "floating-bar", "floating-box", "modal"]).optional(),
  fields: z
    .array(
      z.object({
        key: z.enum(["email", "firstName", "lastName", "phone"]),
        type: z.enum(["email", "text", "tel"]),
        required: z.boolean(),
      }),
    )
    .optional(),
});
export type SignupFormDefinition = z.infer<typeof signupFormDefinitionSchema>;

export const signupFormSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: publishStatusSchema,
  version: z.number().int(),
  definition: signupFormDefinitionSchema,
  allowedDomains: z.array(z.string()),
  turnstileEnabled: z.boolean(),
  successMessage: z.string(),
  submissionCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SignupForm = z.infer<typeof signupFormSchema>;

export const landingPageSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: publishStatusSchema,
  currentVersionId: z.string().nullable(),
  version: z.number().int().nullable(),
  contentDocument: contentDocumentSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LandingPage = z.infer<typeof landingPageSchema>;

export const siteMessageSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: publishStatusSchema,
  headline: z.string(),
  body: z.string(),
  ctaLabel: z.string(),
  ctaUrl: z.string().nullable(),
  pagePattern: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  impressionCount: z.number().int().nonnegative(),
  clickCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SiteMessage = z.infer<typeof siteMessageSchema>;

export const siteTrackingSchema = z.object({
  enabled: z.boolean(),
  allowedDomains: z.array(z.string()),
  consentMode: z.literal("required"),
  workspaceSlug: z.string(),
  summary: z.object({
    pageViews: z.number().int().nonnegative(),
    uniqueVisitors: z.number().int().nonnegative(),
    identifiedContacts: z.number().int().nonnegative(),
  }),
  topPages: z.array(z.object({ url: z.string(), views: z.number().int().nonnegative() })),
  recentEvents: z.array(
    z.object({
      visitorId: z.string(),
      contactId: z.string().nullable(),
      resourceId: z.string(),
      properties: z.record(z.string(), z.unknown()),
      occurredAt: z.string(),
    }),
  ),
  updatedAt: z.string().nullable(),
});
export type SiteTracking = z.infer<typeof siteTrackingSchema>;

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const signupFormWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  slug: slugSchema,
  status: publishStatusSchema.default("draft"),
  definition: signupFormDefinitionSchema,
  allowedDomains: z.array(z.string()).default([]),
  turnstileEnabled: z.boolean().default(true),
  successMessage: z.string().max(500).default("ありがとうございます。"),
});
export type SignupFormWrite = z.infer<typeof signupFormWriteSchema>;

export const landingPageWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  slug: slugSchema,
  status: publishStatusSchema.default("draft"),
  content: contentDocumentSchema,
});
export type LandingPageWrite = z.infer<typeof landingPageWriteSchema>;

export const siteMessageWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  status: publishStatusSchema.default("draft"),
  headline: z.string().trim().min(1).max(191),
  body: z.string().trim().max(2_000),
  ctaLabel: z.string().trim().max(120),
  ctaUrl: z.url().nullable(),
  pagePattern: z.string().trim().min(1).max(500),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
});
export type SiteMessageWrite = z.infer<typeof siteMessageWriteSchema>;

export const siteTrackingWriteSchema = z.object({
  enabled: z.boolean(),
  allowedDomains: z.array(z.string()),
});
export type SiteTrackingWrite = z.infer<typeof siteTrackingWriteSchema>;
