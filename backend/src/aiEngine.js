function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export async function getConsumptionRows(db, itemId, days = 30) {
  const { rows } = await db.query(
    `SELECT quantity_change, created_at
     FROM transaction_logs
     WHERE item_id = $1
       AND action_type = 'consumed'
       AND created_at >= NOW() - ($2::text || ' days')::interval
     ORDER BY created_at ASC`,
    [itemId, days]
  );
  return rows;
}

export async function calculateConsumptionRate(db, itemId, days = 30) {
  const rows = await getConsumptionRows(db, itemId, days);
  if (!rows.length) return 0;
  const totalConsumed = rows.reduce((sum, r) => sum + Math.abs(r.quantity_change), 0);
  return Number((totalConsumed / days).toFixed(2));
}

export async function predictDepletion(db, itemId) {
  const itemRes = await db.query(
    'SELECT id, name, quantity, threshold FROM items WHERE id = $1 AND is_deleted = FALSE',
    [itemId]
  );
  const item = itemRes.rows[0];
  if (!item) return null;

  const rate = await calculateConsumptionRate(db, itemId, 30);
  if (rate <= 0) {
    return {
      item_name: item.name,
      current_stock: item.quantity,
      daily_rate: 0,
      days_until_empty: null,
      days_until_threshold: null,
      status: item.quantity === 0 ? 'critical' : item.quantity <= item.threshold ? 'warning' : 'no_data'
    };
  }

  const daysUntilEmpty = Number((item.quantity / rate).toFixed(1));
  const daysUntilThreshold = Number((Math.max(0, item.quantity - item.threshold) / rate).toFixed(1));
  const status =
    item.quantity === 0 || daysUntilThreshold <= 3
      ? 'critical'
      : daysUntilThreshold <= 7
        ? 'warning'
        : 'healthy';

  return {
    item_name: item.name,
    current_stock: item.quantity,
    daily_rate: rate,
    days_until_empty: daysUntilEmpty,
    days_until_threshold: daysUntilThreshold,
    status
  };
}

export async function suggestThreshold(db, itemId, bufferDays = 7) {
  const rate = await calculateConsumptionRate(db, itemId, 30);
  if (rate <= 0) return null;
  let suggested = Math.floor(rate * bufferDays) + 1;
  const rows = await getConsumptionRows(db, itemId, 30);
  if (rows.length >= 5) {
    const vals = rows.map((r) => Math.abs(r.quantity_change));
    suggested += Math.floor(stdev(vals) * 1.5);
  }
  return Math.max(1, suggested);
}

export async function detectAnomalies(db, itemId) {
  const rows = await getConsumptionRows(db, itemId, 60);
  if (rows.length < 8) return [];
  const vals = rows.map((r) => Math.abs(r.quantity_change));
  const avg = mean(vals);
  const sd = stdev(vals);
  if (sd === 0) return [];

  const anomalies = [];
  for (const r of rows) {
    const qty = Math.abs(r.quantity_change);
    const z = (qty - avg) / sd;
    if (Math.abs(z) >= 1.8) {
      anomalies.push({
        date: r.created_at,
        quantity: qty,
        z_score: Number(z.toFixed(2)),
        type: z > 0 ? 'spike' : 'drop'
      });
    }
  }
  return anomalies.slice(-5);
}

export async function forecastDemand(db, itemId, futureDays = 14) {
  const itemRes = await db.query(
    'SELECT quantity, threshold FROM items WHERE id = $1 AND is_deleted = FALSE',
    [itemId]
  );
  const item = itemRes.rows[0];
  if (!item) return [];

  const rate = await calculateConsumptionRate(db, itemId, 30);
  const forecast = [];
  let stock = item.quantity;
  const dailyAvg = rate > 0 ? rate : 0.4;

  for (let day = 1; day <= futureDays; day++) {
    const seasonalFactor = day % 7 === 0 || day % 7 === 6 ? 0.75 : 1.08;
    const predictedUsage = Number((dailyAvg * seasonalFactor).toFixed(2));
    stock = Number(Math.max(0, stock - predictedUsage).toFixed(1));
    forecast.push({
      day,
      predicted_usage: predictedUsage,
      predicted_stock: stock,
      threshold: item.threshold
    });
  }
  return forecast;
}

export async function getInsights(db) {
  const { rows: items } = await db.query(
    'SELECT id, name, quantity, threshold, unit_price FROM items WHERE is_deleted = FALSE ORDER BY name ASC'
  );
  const insights = [];
  const critical = [];

  for (const item of items) {
    const pred = await predictDepletion(db, item.id);
    if (pred && pred.status === 'critical') {
      critical.push({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        days: pred.days_until_threshold
      });
    }
    if (pred && pred.daily_rate > 0) {
      const suggested = await suggestThreshold(db, item.id);
      if (suggested && Math.abs(suggested - item.threshold) >= 3) {
        insights.push({
          type: 'threshold_adjustment',
          item_id: item.id,
          item_name: item.name,
          current_threshold: item.threshold,
          suggested_threshold: suggested,
          message: `Adjust "${item.name}" threshold from ${item.threshold} to ${suggested} based on 30-day usage (${pred.daily_rate}/day).`
        });
      }
    }
  }

  if (critical.length > 0) {
    insights.unshift({
      type: 'critical_stock',
      items: critical,
      message: `${critical.length} item(s) are out of stock or projected to hit low stock within 3 days.`
    });
  }

  const total = items.length;
  const low = items.filter((i) => i.quantity <= i.threshold && i.quantity > 0).length;
  const out = items.filter((i) => i.quantity === 0).length;
  const totalValue = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price || 0), 0);
  const healthScore = Math.round(Math.max(0, (1 - (low + out * 2) / Math.max(total, 1)) * 100));

  insights.push({
    type: 'summary',
    total_items: total,
    low_stock: low,
    out_of_stock: out,
    total_value: Number(totalValue.toFixed(2)),
    health_score: healthScore
  });

  return insights;
}
