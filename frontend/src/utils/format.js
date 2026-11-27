export function formatMoney(num) {
  return `$${Number(num || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function statusOf(item) {
  if (item.quantity === 0) return 'out';
  if (item.quantity <= item.threshold) return 'low';
  return 'ok';
}

export function statusLabel(cls) {
  if (cls === 'out') return 'Out of Stock';
  if (cls === 'low') return 'Low Stock';
  return 'In Stock';
}

export function csvEscapeCell(value) {
  let str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export function buildInventoryCsv(items) {
  const headers = [
    'ID',
    'Name',
    'SKU',
    'Category',
    'Quantity',
    'Threshold',
    'Unit',
    'Unit Price',
    'Total Value',
    'Status'
  ];
  const lines = [headers.map(csvEscapeCell).join(',')];
  for (const item of items) {
    const row = [
      item.id,
      item.name,
      item.sku || '',
      item.category_name || 'Uncategorized',
      item.quantity,
      item.threshold,
      item.unit || 'pcs',
      Number(item.unit_price || 0).toFixed(2),
      (item.quantity * Number(item.unit_price || 0)).toFixed(2),
      statusLabel(statusOf(item))
    ];
    lines.push(row.map(csvEscapeCell).join(','));
  }
  return lines.join('\n');
}
