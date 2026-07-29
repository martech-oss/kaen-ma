import type { MessagePurpose } from "@kaenma/shared";

export interface ConsentSnapshot {
  contactStatus?: "active" | "archived" | "anonymous";
  globalStatus: "subscribed" | "unsubscribed";
  topicStatus?: "subscribed" | "unsubscribed" | "pending";
  suppressed: boolean;
  frequency: {
    sentInWindow: number;
    limit: number | null;
  };
}

export type SendBlockReason =
  | "global_unsubscribed"
  | "topic_unsubscribed"
  | "topic_pending"
  | "suppressed"
  | "contact_archived"
  | "frequency_cap";

export type SendEligibility =
  | { allowed: true }
  | { allowed: false; reason: SendBlockReason };

export function evaluateSendEligibility(
  purpose: MessagePurpose,
  snapshot: ConsentSnapshot,
): SendEligibility {
  if (snapshot.contactStatus === "archived") {
    return { allowed: false, reason: "contact_archived" };
  }
  if (snapshot.suppressed) return { allowed: false, reason: "suppressed" };
  if (purpose === "transactional") return { allowed: true };
  if (snapshot.globalStatus === "unsubscribed") {
    return { allowed: false, reason: "global_unsubscribed" };
  }
  if (snapshot.topicStatus === "unsubscribed") {
    return { allowed: false, reason: "topic_unsubscribed" };
  }
  if (snapshot.topicStatus === "pending") {
    return { allowed: false, reason: "topic_pending" };
  }
  if (
    snapshot.frequency.limit !== null &&
    snapshot.frequency.sentInWindow >= snapshot.frequency.limit
  ) {
    return { allowed: false, reason: "frequency_cap" };
  }
  return { allowed: true };
}
