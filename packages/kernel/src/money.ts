import { Decimal } from "decimal.js";

export type CurrencyCode = string; // ISO-4217; validated at the boundary, not here

export class Money {
  private constructor(
    private readonly amount: Decimal,
    public readonly currency: CurrencyCode,
  ) {}

  static of(amount: string | number, currency: CurrencyCode): Money {
    return new Money(new Decimal(amount), currency);
  }
  static zero(currency: CurrencyCode): Money {
    return new Money(new Decimal(0), currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }
  multiply(factor: string | number): Money {
    return new Money(this.amount.times(new Decimal(factor)), this.currency);
  }
  /** Half-up rounding to `dp` decimal places. */
  round(dp: number): Money {
    return new Money(this.amount.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP), this.currency);
  }
  compare(other: Money): number {
    this.assertSameCurrency(other);
    return this.amount.comparedTo(other.amount);
  }
  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }
  toString(): string {
    return this.amount.toFixed(2, Decimal.ROUND_HALF_UP);
  }

  /**
   * Largest-remainder (Hamilton) allocation: distributes this amount across the given
   * non-negative integer weights, losing or inventing zero minor units. The sum of the
   * parts always equals the original to the cent — including for negative amounts.
   * Leftover minor units go to the parts with the largest fractional remainders (ties
   * broken by position), so a zero-weight part never receives a unit.
   */
  allocate(ratios: number[]): Money[] {
    if (ratios.length === 0) throw new Error("allocate requires at least one ratio");
    if (ratios.some((r) => r < 0)) throw new Error("allocate ratios must be non-negative");
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error("allocate ratios must sum to a positive value");

    const cents = this.amount.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const sign = cents.isNegative() ? -1 : 1;
    const absCents = cents.abs();
    const totalD = new Decimal(total);

    // Exact integer floor share + integer remainder numerator ((absCents * r) mod total) per bucket.
    const shares = ratios.map((r) => {
      const numer = absCents.times(new Decimal(r));
      const floor = numer.dividedToIntegerBy(totalD);
      const rem = numer.minus(floor.times(totalD));
      return { floor, rem };
    });

    const distributed = shares.reduce((acc, s) => acc.plus(s.floor), new Decimal(0));
    let leftover = absCents.minus(distributed).toNumber(); // >= 0 and < ratios.length

    // Rank buckets by fractional remainder desc, tie-break by original position asc.
    const order = shares
      .map((s, idx) => ({ idx, rem: s.rem }))
      .sort((a, b) => {
        const c = b.rem.comparedTo(a.rem);
        return c !== 0 ? c : a.idx - b.idx;
      });

    const bump = new Set<number>();
    for (const { idx } of order) {
      if (leftover <= 0) break;
      bump.add(idx);
      leftover -= 1;
    }

    return shares.map((s, idx) => {
      const minor = bump.has(idx) ? s.floor.plus(1) : s.floor;
      return new Money(minor.times(sign).dividedBy(100), this.currency);
    });
  }
}
