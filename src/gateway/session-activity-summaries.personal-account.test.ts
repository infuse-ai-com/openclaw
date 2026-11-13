import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../config/sessions/types.js";
import { createTestGatewayScheduler } from "../test-utils/gateway-scheduler-clock.js";
import { createSessionActivitySummaries } from "./session-activity-summaries.js";

const PERSONAL_PROFILE_ID =
  "personal:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222";

describe("personal-account activity summaries", () => {
  it("does not admit detached recap inference", async () => {
    const prepareModel = vi.fn();
    const completeModel = vi.fn();
    const service = createSessionActivitySummaries({
      scheduler: createTestGatewayScheduler(),
      getConfig: () => ({ agents: { defaults: { utilityModel: "test/utility" } } }),
      onChanged: vi.fn(),
      prepareModel,
      completeModel,
    });
    const entry = {
      sessionId: "personal-activity-session",
      authProfileOverride: PERSONAL_PROFILE_ID,
      updatedAt: 1,
    } satisfies SessionEntry;
    await expect(
      service.ensure({ key: "agent:main:personal-activity", agentId: "main" }, entry),
    ).resolves.toEqual({ state: "unavailable" });
    expect(prepareModel).not.toHaveBeenCalled();
    expect(completeModel).not.toHaveBeenCalled();
    await service.dispose();
  });
});
