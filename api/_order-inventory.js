const { randomUUID } = require('crypto');

function positive(value) {
  return Math.max(Number(value) || 0, 0);
}

function mergeUsage(entries) {
  const usage = new Map();
  for (const entry of entries) {
    const filamentId = String(entry?.filamentId ?? entry?.id ?? '').trim();
    const grams = positive(entry?.grams);
    if (!filamentId || grams <= 0) continue;
    usage.set(filamentId, (usage.get(filamentId) || 0) + grams);
  }
  return [...usage].map(([filamentId, grams]) => ({ filamentId, grams }));
}

function completedUsage(product, quantity) {
  const count = Math.max(Number(quantity) || 1, 1);
  const entries = (product?.materials || []).map((material) => ({
    filamentId: material.filamentId,
    grams: positive(material.grams) * count,
  }));
  if (product?.materials?.[0]?.filamentId) {
    entries.push({
      filamentId: product.materials[0].filamentId,
      grams: positive(product.purge_grams ?? product.purgeGrams) * count,
    });
  }
  return mergeUsage(entries);
}

function outstandingWaste(totalWasted, alreadyDeducted) {
  return Math.max(positive(totalWasted) - positive(alreadyDeducted), 0);
}

async function deductCompletedMaterial(sql, order, product) {
  const usage = completedUsage(product, order.quantity);
  if (!usage.length) return [];
  const usageJson = JSON.stringify(usage.map((item) => ({
    filament_id: item.filamentId,
    grams: item.grams,
  })));
  return sql`
    WITH usage AS (
      SELECT item.filament_id, item.grams
      FROM jsonb_to_recordset(${usageJson}::jsonb)
        AS item(filament_id TEXT, grams NUMERIC)
    ), eligible AS (
      SELECT orders.id
      FROM orders
      WHERE orders.id = ${order.id}
        AND orders.inventory_deducted = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM usage
          LEFT JOIN filaments ON filaments.id = usage.filament_id
          WHERE filaments.id IS NULL
        )
      FOR UPDATE
    ), claimed AS (
      UPDATE orders
      SET inventory_deducted = TRUE
      FROM eligible
      WHERE orders.id = eligible.id
        AND orders.inventory_deducted = FALSE
      RETURNING orders.id
    )
    UPDATE filaments
    SET remaining_grams = GREATEST(
      COALESCE(filaments.remaining_grams, filaments.spool_grams) - usage.grams,
      0
    )
    FROM usage, claimed
    WHERE filaments.id = usage.filament_id
    RETURNING filaments.id
  `;
}

async function deductOutstandingWaste(sql, order, product) {
  const filamentId = String(product?.materials?.[0]?.filamentId || '').trim();
  const target = positive(order.wasted_grams ?? order.wastedGrams);
  if (!filamentId || outstandingWaste(target, order.waste_deducted_grams) <= 0) return [];
  return sql`
    WITH current_order AS (
      SELECT orders.id, orders.waste_deducted_grams
      FROM orders
      WHERE orders.id = ${order.id}
        AND orders.waste_deducted_grams < ${target}
        AND EXISTS (SELECT 1 FROM filaments WHERE id = ${filamentId})
      FOR UPDATE
    ), claimed AS (
      UPDATE orders
      SET waste_deducted_grams = ${target}
      FROM current_order
      WHERE orders.id = current_order.id
        AND orders.waste_deducted_grams < ${target}
      RETURNING (${target} - current_order.waste_deducted_grams)::NUMERIC AS grams
    )
    UPDATE filaments
    SET remaining_grams = GREATEST(
      COALESCE(filaments.remaining_grams, filaments.spool_grams) - claimed.grams,
      0
    )
    FROM claimed
    WHERE filaments.id = ${filamentId}
    RETURNING filaments.id
  `;
}

async function deductOrderInventory(sql, order, status) {
  if (!order?.product_id || !['failed', 'completed'].includes(status)) return;
  const productRows = await sql`
    SELECT materials, purge_grams FROM products WHERE id = ${order.product_id}
  `;
  const product = productRows[0];
  if (!product) return;
  if (status === 'completed') await deductCompletedMaterial(sql, order, product);
  await deductOutstandingWaste(sql, order, product);
}

// Single owner of order finalization: writes the self_print ledger entry for
// internal orders and deducts filament inventory. The ledger insert and the
// deduction are each independently idempotent (unique index on
// owner_ledger(order_id, kind); the inventory_deducted claim-CTE), so a
// duplicate call is safe. Both the orders PUT handler and the print-jobs bridge
// report handler route completion through here so deduction lives in one place.
async function finalizeOrder(sql, order, status) {
  if (status === 'completed' && order?.internal) {
    await sql`INSERT INTO owner_ledger (id, kind, description, amount, order_id)
      VALUES (${randomUUID()}, 'self_print', ${`הדפסה עצמית ${order.id}`}, ${-Number(order.production_cost || 0)}, ${order.id})
      ON CONFLICT (order_id, kind) WHERE order_id IS NOT NULL DO NOTHING`;
  }
  await deductOrderInventory(sql, order, status);
}

module.exports = {
  completedUsage,
  deductOrderInventory,
  finalizeOrder,
  mergeUsage,
  outstandingWaste,
};
