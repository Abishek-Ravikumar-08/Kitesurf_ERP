import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildOpenApiDocument } from "./openapi.js";

describe("buildOpenApiDocument", () => {
  it("emits component schemas from Zod schemas", () => {
    const HealthResponse = z.object({ status: z.literal("ok") });
    const doc = buildOpenApiDocument("Kitesurf ERP API", "0.1.0", { HealthResponse });
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Kitesurf ERP API");
    expect(doc.info.version).toBe("0.1.0");
    expect(doc.components.schemas.HealthResponse).toMatchObject({
      type: "object",
      properties: { status: { const: "ok" } },
    });
  });
});
