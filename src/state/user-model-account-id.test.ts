import { describe, expect, it } from "vitest";
import { hasUserModelAuthProfileId } from "./user-model-account-id.js";

describe("hasUserModelAuthProfileId", () => {
  it("finds a generated personal locator among optional account owners", () => {
    expect(
      hasUserModelAuthProfileId(
        undefined,
        "  personal:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222  ",
      ),
    ).toBe(true);
    expect(hasUserModelAuthProfileId(undefined, "personal:work", "shared-profile")).toBe(false);
  });
});
