import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

describe("loadConfig", () => {
  it("parses a valid environment", () => {
    const cfg = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgresql://x",
      INTEGRATION_MODE: "standalone",
      DATA_EGRESS: "deny",
    });
    expect(cfg.PORT).toBe(3000);
    expect(cfg.INTEGRATION_MODE).toBe("standalone");
  });
  it("throws a descriptive error on invalid env", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PORT: "not-a-number",
        DATABASE_URL: "",
        INTEGRATION_MODE: "banana",
        DATA_EGRESS: "deny",
      }),
    ).toThrow(/PORT|DATABASE_URL|INTEGRATION_MODE/);
  });
  it("applies defaults when only DATABASE_URL is provided", () => {
    const cfg = loadConfig({ DATABASE_URL: "postgresql://x" });
    expect(cfg.NODE_ENV).toBe("development");
    expect(cfg.PORT).toBe(3000);
    expect(cfg.INTEGRATION_MODE).toBe("standalone");
    expect(cfg.DATA_EGRESS).toBe("deny");
  });
});
