import { describe, expect, it } from "vitest";
import { Quantity, UomRegistry } from "./quantity.js";

describe("UoM", () => {
  const reg = new UomRegistry([
    { dimension: "count", unit: "EA", toBase: 1 },
    { dimension: "count", unit: "BOX", toBase: 12 }, // 1 box = 12 each
    { dimension: "count", unit: "PAL", toBase: 144 }, // 1 pallet = 12 boxes
  ]);
  it("converts across units within a dimension", () => {
    expect(reg.convert(Quantity.of("2", "BOX"), "EA").toString()).toBe("24");
    expect(reg.convert(Quantity.of("288", "EA"), "PAL").toString()).toBe("2");
  });
  it("round-trips exactly for terminating unit ratios", () => {
    const q = Quantity.of("7", "BOX");
    const back = reg.convert(reg.convert(q, "EA"), "BOX");
    expect(back.toString()).toBe("7");
  });
  it("rejects cross-dimension conversion", () => {
    const r2 = new UomRegistry([
      { dimension: "count", unit: "EA", toBase: 1 },
      { dimension: "mass", unit: "KG", toBase: 1 },
    ]);
    expect(() => r2.convert(Quantity.of("1", "EA"), "KG")).toThrow(/dimension/i);
  });
  it("is a decimal approximation: non-terminating unit ratios do NOT round-trip exactly", () => {
    const reg3 = new UomRegistry([
      { dimension: "count", unit: "EA", toBase: 1 },
      { dimension: "count", unit: "CASE", toBase: 3 }, // 1 CASE = 3 EA; 1/3 is non-terminating
    ]);
    const back = reg3.convert(reg3.convert(Quantity.of("1", "EA"), "CASE"), "EA");
    // documents the limitation: drifts in the last digits rather than returning exactly "1"
    expect(back.toString()).not.toBe("1");
    // ...but stays accurate to decimal.js precision
    expect(Number(back.toString())).toBeCloseTo(1, 15);
  });
  it("throws on an unknown source or target unit", () => {
    expect(() => reg.convert(Quantity.of("1", "EA"), "XX")).toThrow(/unknown unit/i);
    expect(() => reg.convert(Quantity.of("1", "ZZ"), "EA")).toThrow(/unknown unit/i);
  });
});
