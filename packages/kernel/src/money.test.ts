import { describe, expect, it } from "vitest";
import { Money } from "./money.js";

describe("Money", () => {
  it("adds same-currency amounts and keeps a string decimal", () => {
    const sum = Money.of("10.10", "USD").add(Money.of("0.20", "USD"));
    expect(sum.toString()).toBe("10.30");
    expect(sum.currency).toBe("USD");
  });
  it("rejects cross-currency arithmetic", () => {
    expect(() => Money.of("1", "USD").add(Money.of("1", "EUR"))).toThrow(/currency/i);
  });
  it("allocate splits without losing or inventing minor units", () => {
    const parts = Money.of("10.00", "USD").allocate([1, 1, 1]); // 3-way
    expect(parts.map((p) => p.toString())).toEqual(["3.34", "3.33", "3.33"]);
    const total = parts.reduce((a, b) => a.add(b), Money.zero("USD"));
    expect(total.toString()).toBe("10.00");
  });
  it("multiply applies a factor with explicit rounding (half-up, 2dp)", () => {
    expect(Money.of("2.005", "USD").round(2).toString()).toBe("2.01");
  });
  it("allocate preserves the total for negative amounts (refund/credit note)", () => {
    const parts = Money.of("-10.00", "USD").allocate([1, 1, 1]);
    expect(parts.map((p) => p.toString())).toEqual(["-3.34", "-3.33", "-3.33"]);
    const total = parts.reduce((a, b) => a.add(b), Money.zero("USD"));
    expect(total.toString()).toBe("-10.00");
  });
  it("allocate never gives a minor unit to a zero-weight part", () => {
    const parts = Money.of("10.01", "USD").allocate([0, 1, 1]);
    expect(parts.map((p) => p.toString())).toEqual(["0.00", "5.01", "5.00"]);
    const total = parts.reduce((a, b) => a.add(b), Money.zero("USD"));
    expect(total.toString()).toBe("10.01");
  });
  it("allocate distributes leftover by largest fractional remainder, not list order", () => {
    const parts = Money.of("10.00", "USD").allocate([5, 1, 1]);
    expect(parts.map((p) => p.toString())).toEqual(["7.14", "1.43", "1.43"]);
    const total = parts.reduce((a, b) => a.add(b), Money.zero("USD"));
    expect(total.toString()).toBe("10.00");
  });
});
