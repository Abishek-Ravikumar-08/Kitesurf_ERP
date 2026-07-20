import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stableStringify } from "./stable-stringify.js";

describe("stableStringify", () => {
  it("is key-order independent", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
  it("honors toJSON: Date serializes as its ISO string, deterministically", () => {
    const iso = "2026-07-20T01:02:03.000Z";
    expect(stableStringify({ d: new Date(iso) })).toBe(`{"d":"${iso}"}`);
    expect(stableStringify({ d: new Date(iso) })).toBe(stableStringify({ d: new Date(iso) }));
  });
  it("maps undefined inside arrays to null (JSON semantics)", () => {
    expect(stableStringify([undefined])).toBe("[null]");
    expect(stableStringify([undefined])).not.toBe("[]");
  });
  it("throws on a root value that is not JSON-serializable", () => {
    expect(() => stableStringify(undefined)).toThrow(TypeError);
    expect(() => stableStringify(undefined)).toThrow(/not JSON-serializable/);
    expect(() => stableStringify(() => 1)).toThrow(TypeError);
  });
  it("property: any two objects with the same entries stringify identically", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        return stableStringify(obj) === stableStringify(reversed);
      }),
    );
  });
});
