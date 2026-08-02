import { orpcQuery } from "@/lib/orpc";
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

export function signupFormsQueryOptions() {
  return orpcQuery.website.listForms.queryOptions();
}

export function landingPagesQueryOptions() {
  return orpcQuery.website.listPages.queryOptions();
}

export function siteMessagesQueryOptions() {
  return orpcQuery.website.listMessages.queryOptions();
}

export function siteTrackingQueryOptions() {
  return orpcQuery.website.getTracking.queryOptions();
}
