import { resolveModelFallbackError } from "../agents/failover-error.js";
import { findErrorProperty } from "../agents/failover/error.js";
import {
  hasLongWindowRateLimitEvidence,
  resolveRetryAfterMs,
} from "../agents/failover/retry-evidence.js";
import { formatErrorMessage } from "../infra/errors.js";
import { hasUserModelAuthProfileId } from "../state/user-model-account-id.js";

export class ActivitySummaryCancelledError extends Error {
  constructor() {
    super("Activity recap lifecycle or utility model changed");
  }
}

export function resolveActivitySummaryCancellationState(
  error: unknown,
  authProfileId?: string,
): "unavailable" | "stale" | undefined {
  return error instanceof ActivitySummaryCancelledError
    ? hasUserModelAuthProfileId(authProfileId)
      ? "unavailable"
      : "stale"
    : undefined;
}

export function activitySummaryFailureIsTransient(error: unknown): boolean {
  const failure = resolveModelFallbackError(error);
  const reason = failure.kind === "failover" ? failure.error.reason : undefined;
  return (
    (reason === "overloaded" ||
      reason === "server_error" ||
      reason === "timeout" ||
      reason === "rate_limit") &&
    !findErrorProperty(error, (candidate) =>
      hasLongWindowRateLimitEvidence(formatErrorMessage(candidate)) ? true : undefined,
    )
  );
}

export function resolveActivitySummaryRetryAfterMs(error: unknown, now: number): number {
  return (
    findErrorProperty(error, (candidate) => {
      const direct =
        candidate && typeof candidate === "object"
          ? Object.getOwnPropertyDescriptor(candidate, "retryAfterMs")?.value
          : undefined;
      const parsed = resolveRetryAfterMs(formatErrorMessage(candidate), now, candidate);
      return typeof direct === "number" && direct >= 0 ? Math.max(direct, parsed ?? 0) : parsed;
    }) ?? 0
  );
}
