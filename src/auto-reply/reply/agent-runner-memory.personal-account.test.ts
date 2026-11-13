import { describe, expect, it, vi } from "vitest";
import type { InternalSessionEntry as SessionEntry } from "../../config/sessions.js";
import { runMemoryFlushIfNeeded, runSessionCompactionIfNeeded } from "./agent-runner-memory.js";
import { createTestFollowupRun, withTestModelContextTokens } from "./agent-runner.test-fixtures.js";

const PERSONAL_PROFILE_ID =
  "personal:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222";

type MemoryFlushParams = Parameters<typeof runMemoryFlushIfNeeded>[0];

function personalMemoryFlushParams(source: "run" | "entry" | "latest-store"): MemoryFlushParams {
  const sessionEntry = {
    sessionId: "personal-memory-session",
    updatedAt: 1,
    ...(source === "entry" ? { authProfileOverride: PERSONAL_PROFILE_ID } : {}),
  } satisfies SessionEntry;
  return {
    cfg: {},
    followupRun: {
      run: {
        authProfileId: source === "run" ? PERSONAL_PROFILE_ID : undefined,
      },
    },
    defaultModel: "test-model",
    resolvedVerboseLevel: "off",
    sessionEntry,
    sessionStore: {
      main:
        source === "latest-store"
          ? { ...sessionEntry, authProfileOverride: PERSONAL_PROFILE_ID }
          : sessionEntry,
    },
    sessionKey: "main",
    isHeartbeat: false,
  } as unknown as MemoryFlushParams;
}

describe("personal-account memory maintenance", () => {
  it.each(["run", "entry", "latest-store"] as const)(
    "skips detached memory inference selected by the %s owner",
    async (source) => {
      const params = personalMemoryFlushParams(source);
      await expect(runMemoryFlushIfNeeded(params)).resolves.toEqual({
        sessionEntry: params.sessionEntry,
        outcome: "skipped",
      });
    },
  );

  it("rejects required preflight before detached memory checkpointing", async () => {
    const sessionEntry = {
      sessionId: "personal-preflight-session",
      updatedAt: 1,
      totalTokens: 90_000,
      totalTokensFresh: true,
      totalTokensVersion: 1,
      authProfileOverride: PERSONAL_PROFILE_ID,
    } satisfies SessionEntry;
    const followupRun = createTestFollowupRun({
      sessionId: sessionEntry.sessionId,
      sessionKey: "main",
    });
    const beforeCompaction = vi.fn(async (entry: SessionEntry) => entry);
    const baseConfig = { agents: { defaults: { compaction: { memoryFlush: {} } } } };
    const cfg = withTestModelContextTokens({
      cfg: baseConfig,
      followupRun,
      defaultModel: "anthropic/claude-opus-4-6",
      contextTokens: 100_000,
    });

    await expect(
      runSessionCompactionIfNeeded({
        cfg,
        followupRun,
        defaultModel: "anthropic/claude-opus-4-6",
        sessionEntry,
        sessionStore: { main: sessionEntry },
        sessionKey: "main",
        isHeartbeat: false,
        beforeCompaction,
      }),
    ).rejects.toThrow(
      "Preflight compaction required but failed: Compaction is unavailable for a personal model account",
    );
    expect(beforeCompaction).not.toHaveBeenCalled();
  });
});
