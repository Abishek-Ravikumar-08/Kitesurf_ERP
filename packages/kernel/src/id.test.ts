import { describe, expect, it } from "vitest";
import { type TenantId, asTenantId, newId } from "./id.js";

describe("id", () => {
  it("newId returns a v7 uuid string", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("branding is a compile-time-only wrapper (runtime is the string)", () => {
    const t: TenantId = asTenantId(newId());
    expect(typeof t).toBe("string");
  });
});
