import { rpc } from "@/rpc";
import type { ContentDocument } from "@kaenma/shared";

export type PublishStatus = "draft" | "published";

export interface SignupFormDefinition {
  style?: "inline" | "floating-bar" | "floating-box" | "modal";
  fields?: Array<{
    key: "email" | "firstName" | "lastName" | "phone";
    type: "email" | "text" | "tel";
    required: boolean;
  }>;
}

export interface SignupFormRow {
  id: string;
  name: string;
  slug: string;
  status: PublishStatus;
  version: number;
  definition: SignupFormDefinition;
  allowed_domains: string[];
  turnstile_enabled: number;
  success_message: string;
  submission_count: number;
  created_at: string;
  updated_at: string;
}

export interface LandingPageRow {
  id: string;
  name: string;
  slug: string;
  status: PublishStatus;
  current_version_id: string;
  version: number;
  content_document: ContentDocument;
  created_at: string;
  updated_at: string;
}

export interface SiteMessageRow {
  id: string;
  name: string;
  status: PublishStatus;
  headline: string;
  body: string;
  cta_label: string;
  cta_url: string | null;
  page_pattern: string;
  starts_at: string | null;
  ends_at: string | null;
  impression_count: number;
  click_count: number;
  created_at: string;
  updated_at: string;
}

export interface TrackingTopPage {
  url: string;
  views: number;
}

export interface TrackingEvent {
  visitor_id: string;
  contact_id: string | null;
  resource_id: string;
  properties: Record<string, unknown>;
  occurred_at: string;
}

export interface SiteTrackingData {
  enabled: boolean;
  allowedDomains: string[];
  consentMode: "required";
  workspaceSlug: string;
  summary: {
    pageViews: number;
    uniqueVisitors: number;
    identifiedContacts: number;
  };
  topPages: TrackingTopPage[];
  recentEvents: TrackingEvent[];
  updatedAt: string | null;
}

export async function loadSignupForms(
  signal?: AbortSignal,
): Promise<SignupFormRow[]> {
  return (
    await rpc<SignupFormRow[]>("/forms", {
      signal: signal ?? null,
    })
  ).data;
}

export async function loadLandingPages(
  signal?: AbortSignal,
): Promise<LandingPageRow[]> {
  return (
    await rpc<LandingPageRow[]>("/pages", {
      signal: signal ?? null,
    })
  ).data;
}

export async function loadSiteMessages(
  signal?: AbortSignal,
): Promise<SiteMessageRow[]> {
  return (
    await rpc<SiteMessageRow[]>("/site-messages", {
      signal: signal ?? null,
    })
  ).data;
}

export async function loadSiteTracking(
  signal?: AbortSignal,
): Promise<SiteTrackingData> {
  return (
    await rpc<SiteTrackingData>("/site-tracking", {
      signal: signal ?? null,
    })
  ).data;
}
