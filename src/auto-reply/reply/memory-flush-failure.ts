import type { InternalSessionEntry as SessionEntry } from "../../config/sessions.js";
import { updateSessionEntry } from "../../config/sessions/session-accessor.js";
import { logVerbose } from "../../globals.js";
import { isAbortError } from "../../infra/abort-signal.js";
import { truncateMemoryFlushErrorMessage } from "./memory-flush-errors.js";
import type { ReplyOperation } from "./reply-run-registry.js";

const MAX_FLUSH_FAILURES = 3;

export type MemoryFlushOutcome = "skipped" | "completed" | "failed" | "exhausted";
export type MemoryFlushResult = {
  sessionEntry?: SessionEntry;
  outcome: MemoryFlushOutcome;
};

type MemoryFlushFailureRun = {
  replyOperation?: ReplyOperation;
  abortSignal?: AbortSignal;
  sessionKey?: string;
  storePath?: string;
  sessionStore?: Record<string, SessionEntry>;
};

export async function recordMemoryFlushFailure(
  error: unknown,
  run: MemoryFlushFailureRun,
  initialSessionEntry?: SessionEntry,
): Promise<MemoryFlushResult> {
  let sessionEntry = initialSessionEntry;
  let outcome: MemoryFlushOutcome = "failed";
  // Caller cancellation may use any reason, not only an AbortError instance.
  if ((run.replyOperation?.abortSignal ?? run.abortSignal)?.aborted) {
    logVerbose("memory flush cancelled by its owner");
    return { sessionEntry, outcome };
  }
  const truncatedError = truncateMemoryFlushErrorMessage(error);
  const { sessionKey, storePath } = run;
  if (!isAbortError(error) && storePath && sessionKey) {
    try {
      let failureCount = 0;
      const updatedEntry = await updateSessionEntry(
        { storePath, sessionKey },
        (currentEntry) => {
          failureCount =
            (currentEntry.memoryFlush?.kind === "failed"
              ? currentEntry.memoryFlush.failureCount
              : 0) + 1;
          return {
            memoryFlush:
              failureCount >= MAX_FLUSH_FAILURES
                ? { kind: "succeeded", compactionCount: currentEntry.compactionCount ?? 0 }
                : {
                    kind: "failed",
                    ...(currentEntry.memoryFlush?.compactionCount !== undefined
                      ? { compactionCount: currentEntry.memoryFlush.compactionCount }
                      : {}),
                    failureCount,
                  },
          };
        },
        { skipMaintenance: true, takeCacheOwnership: true },
      );
      if (updatedEntry) {
        sessionEntry = updatedEntry;
        if (run.sessionStore) {
          run.sessionStore[sessionKey] = updatedEntry;
        }
      } else {
        failureCount = 0;
      }
      logVerbose(
        `memory flush failed (attempt ${failureCount}/${MAX_FLUSH_FAILURES}): ${truncatedError}`,
      );
      if (updatedEntry && failureCount >= MAX_FLUSH_FAILURES) {
        outcome = "exhausted";
        logVerbose(
          `memory flush exhausted: skipping flush for this compaction cycle after ${failureCount} consecutive failures`,
        );
      }
    } catch (persistError) {
      logVerbose(`failed to persist memory flush failure metadata: ${String(persistError)}`);
    }
  } else {
    logVerbose(`memory flush run failed: ${String(error)}`);
  }
  return { sessionEntry, outcome };
}
