export const jobStatuses = [
  "pending",
  "leased",
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "dead_letter",
] as const;

export type JobStatus = (typeof jobStatuses)[number];

const transitions: Record<JobStatus, ReadonlySet<JobStatus>> = {
  pending: new Set(["leased", "cancelled"]),
  leased: new Set(["queued", "pending", "cancelled"]),
  queued: new Set(["processing", "pending", "cancelled", "dead_letter"]),
  processing: new Set(["completed", "pending", "failed", "cancelled", "dead_letter"]),
  completed: new Set(),
  failed: new Set(["pending", "dead_letter"]),
  cancelled: new Set(),
  dead_letter: new Set(["pending", "cancelled"]),
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return transitions[from].has(to);
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new Error(`Invalid job transition: ${from} -> ${to}`);
  }
}

export function retryDelaySeconds(attempt: number, maxSeconds = 3_600): number {
  const safeAttempt = Math.max(1, Math.min(attempt, 20));
  return Math.min(maxSeconds, 2 ** safeAttempt * 5);
}

