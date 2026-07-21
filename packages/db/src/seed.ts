import type { Db } from "./client.js";
import { fiscalPeriods } from "./schema/fiscal.js";
import { materials } from "./schema/masterdata.js";
import { numberRanges } from "./schema/numbering.js";
import { stockItems } from "./schema/stock.js";
import { tenants } from "./schema/tenancy.js";

/** The fixed DEV tenant every dev/demo environment shares. */
export const DEV_TENANT_ID = "00000000-0000-7000-8000-000000000001";

// UUID suffix blocks: 001=tenant, 1xx=materials, 2xx=stock items, 3xx=fiscal periods; next free block: 4xx.
/** Fixed UUID literals so demos, tests, and docs can reference stable ids. */
export const DEV_MATERIAL_IDS = {
  "KITE-12M": "00000000-0000-7000-8000-000000000101",
  "BAR-55": "00000000-0000-7000-8000-000000000102",
  "BOARD-136": "00000000-0000-7000-8000-000000000103",
} as const;

export const DEV_STOCK_ITEM_IDS = {
  "KITE-12M": "00000000-0000-7000-8000-000000000201",
  "BAR-55": "00000000-0000-7000-8000-000000000202",
  "BOARD-136": "00000000-0000-7000-8000-000000000203",
} as const;

/** Fiscal period ids: ...0301 (Jan 2026) through ...030c (Dec 2026). */
const fiscalPeriodId = (month: number) =>
  `00000000-0000-7000-8000-00000000030${month.toString(16)}`;

/**
 * Deterministic dev/demo baseline seed. Idempotent: every insert is
 * `onConflictDoNothing()` against the table's PK/unique key, so running it any number of
 * times yields the identical state (fixed UUID literals, no random ids, no timestamps in
 * conflict targets). Existing rows are NEVER updated — live edits (allocated numbers,
 * closed periods, stock movements) survive a re-seed.
 *
 * Not transactional; a partial failure is healed by re-running (every statement is
 * idempotent and FK-ordered). The seed assumes it owns the dev-tenant seed SKUs: a
 * hand-created material with the same SKU but a different id makes the material insert
 * silently skip and surfaces as an FK error on stock_items.
 *
 * DELIBERATE RLS BYPASS: this is the bootstrap/superuser path (same as tenant bootstrap
 * in the integration tests) — it runs as the pool's superuser and does NOT go through
 * `withTenantTx`. Never call it from application request paths.
 */
export async function seedBaseline(db: Db): Promise<void> {
  await db.insert(tenants).values({ id: DEV_TENANT_ID, name: "dev" }).onConflictDoNothing();

  await db
    .insert(materials)
    .values([
      {
        id: DEV_MATERIAL_IDS["KITE-12M"],
        tenantId: DEV_TENANT_ID,
        sku: "KITE-12M",
        name: "Kite 12m Freeride",
        baseUom: "EA",
      },
      {
        id: DEV_MATERIAL_IDS["BAR-55"],
        tenantId: DEV_TENANT_ID,
        sku: "BAR-55",
        name: "Control Bar 55cm",
        baseUom: "EA",
      },
      {
        id: DEV_MATERIAL_IDS["BOARD-136"],
        tenantId: DEV_TENANT_ID,
        sku: "BOARD-136",
        name: "Twintip Board 136cm",
        baseUom: "EA",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(stockItems)
    .values(
      (Object.keys(DEV_MATERIAL_IDS) as (keyof typeof DEV_MATERIAL_IDS)[]).map((sku) => ({
        id: DEV_STOCK_ITEM_IDS[sku],
        tenantId: DEV_TENANT_ID,
        materialId: DEV_MATERIAL_IDS[sku],
        onHand: "100",
        reserved: "0",
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(numberRanges)
    .values([
      {
        tenantId: DEV_TENANT_ID,
        rangeKey: "SO",
        period: "2026",
        prefix: "SO-2026-",
        padTo: 6,
        currentValue: 0,
      },
      {
        tenantId: DEV_TENANT_ID,
        rangeKey: "INV",
        period: "2026",
        prefix: "INV-2026-",
        padTo: 6,
        currentValue: 0,
      },
    ])
    .onConflictDoNothing();

  const lastDayOfMonth = (month: number) => new Date(Date.UTC(2026, month, 0)).getUTCDate();
  await db
    .insert(fiscalPeriods)
    .values(
      Array.from({ length: 12 }, (_, i) => {
        const month = i + 1;
        const mm = month.toString().padStart(2, "0");
        return {
          id: fiscalPeriodId(month),
          tenantId: DEV_TENANT_ID,
          year: 2026,
          period: month,
          startsOn: `2026-${mm}-01`,
          endsOn: `2026-${mm}-${lastDayOfMonth(month)}`,
          status: "open",
        };
      }),
    )
    .onConflictDoNothing();
}
