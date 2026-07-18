import { z } from "zod";

export function buildOpenApiDocument(
  title: string,
  version: string,
  schemas: Record<string, z.ZodType>,
) {
  const components: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    // Default target emits JSON Schema draft-2020-12 (aligns with OpenAPI 3.1, preserves `const`).
    components[name] = z.toJSONSchema(schema);
  }
  return {
    openapi: "3.1.0",
    info: { title, version },
    paths: {},
    components: { schemas: components },
  };
}
