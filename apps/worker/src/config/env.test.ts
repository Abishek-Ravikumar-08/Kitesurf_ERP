import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

describe("loadConfig (worker)", () => {
  it("parses a valid environment", () => {
    const cfg = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://x",
      RELAY_INTERVAL_MS: "250",
    });
    expect(cfg.NODE_ENV).toBe("test");
    expect(cfg.RELAY_INTERVAL_MS).toBe(250);
  });
  it("throws a descriptive error on invalid env", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "",
        RELAY_INTERVAL_MS: "not-a-number",
      }),
    ).toThrow(/DATABASE_URL|RELAY_INTERVAL_MS/);
  });
  it("applies defaults when only DATABASE_URL is provided", () => {
    const cfg = loadConfig({ DATABASE_URL: "postgresql://x" });
    expect(cfg.NODE_ENV).toBe("development");
    expect(cfg.RELAY_INTERVAL_MS).toBe(1000);
  });
});
