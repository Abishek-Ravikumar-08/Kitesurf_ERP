import { Decimal } from "decimal.js";

export class Quantity {
  private constructor(
    private readonly value: Decimal,
    public readonly unit: string,
  ) {}
  static of(value: string | number, unit: string): Quantity {
    return new Quantity(new Decimal(value), unit);
  }
  raw(): Decimal {
    return this.value;
  }
  toString(): string {
    return this.value.toString();
  }
}

export interface UomDef {
  dimension: string;
  unit: string;
  toBase: number | string; // factor to the dimension's base unit
}

export class UomRegistry {
  private readonly byUnit = new Map<string, UomDef>();
  constructor(defs: UomDef[]) {
    for (const d of defs) this.byUnit.set(d.unit, d);
  }
  /**
   * Converts a quantity to another unit within the same dimension via each unit's
   * `toBase` factor. This is a DECIMAL APPROXIMATION, not exact rational arithmetic:
   * decimal.js caps at its default precision (20 significant digits), so conversions
   * whose unit ratio is a non-terminating decimal (e.g. a /3 or /7 factor) can drift in
   * the last digits and are NOT guaranteed to round-trip exactly. Ratios that are
   * terminating decimals (products of 2 and 5, e.g. 12, 144, 1000) round-trip exactly.
   */
  convert(q: Quantity, toUnit: string): Quantity {
    const from = this.byUnit.get(q.unit);
    const to = this.byUnit.get(toUnit);
    if (!from) throw new Error(`unknown unit: ${q.unit}`);
    if (!to) throw new Error(`unknown unit: ${toUnit}`);
    if (from.dimension !== to.dimension) {
      throw new Error(`cannot convert across dimension: ${from.dimension} -> ${to.dimension}`);
    }
    const base = q.raw().times(new Decimal(from.toBase));
    return Quantity.of(base.dividedBy(new Decimal(to.toBase)).toString(), toUnit);
  }
}
