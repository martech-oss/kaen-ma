import { orpc } from "@/lib/orpc";
import type {
  LandingPage,
  PublishStatus,
  SignupForm,
  SignupFormDefinition,
  SiteMessage,
  SiteTracking,
} from "@kaenma/orpc";

export type { LandingPage, PublishStatus, SignupForm, SignupFormDefinition, SiteMessage };

/** Retained aliases so the page components read the same as before the migration. */
export type SignupFormRow = SignupForm;
export type LandingPageRow = LandingPage;
export type SiteMessageRow = SiteMessage;
export type SiteTrackingData = SiteTracking;
export type TrackingTopPage = SiteTracking["topPages"][number];
export type TrackingEvent = SiteTracking["recentEvents"][number];

export function loadSignupForms(signal?: AbortSignal): Promise<SignupForm[]> {
  return orpc.website.listForms(undefined, signal ? { signal } : undefined);
}

export function loadLandingPages(signal?: AbortSignal): Promise<LandingPage[]> {
  return orpc.website.listPages(undefined, signal ? { signal } : undefined);
}

export function loadSiteMessages(signal?: AbortSignal): Promise<SiteMessage[]> {
  return orpc.website.listMessages(undefined, signal ? { signal } : undefined);
}

export function loadSiteTracking(signal?: AbortSignal): Promise<SiteTracking> {
  return orpc.website.getTracking(undefined, signal ? { signal } : undefined);
}
