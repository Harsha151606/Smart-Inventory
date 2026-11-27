import { useEffect, useRef, useState } from 'react';

function readCssToken(styles, name, fallback) {
  const val = styles.getPropertyValue(name)?.trim();
  return val || fallback;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Operational Canvas Chart supporting grouped primary/comparison bars (Dashboard)
 * and forecast curves (Analytics / Item Detail) with a CSP-safe #111827 hover tooltip.
 */
export default function ForecastChart({
  series = null,
  forecast = [],
  threshold = 0,
  width = 720,
  height = 250,
  theme
}) {
  const canvasRef = useRef(null);
  const hitRegionsRef = useRef([]);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const [observedTheme, setObservedTheme] = useState(() =>
    typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-theme') || 'light'
      : 'light'
  );

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      setObservedTheme(document.documentElement.getAttribute('data-theme') || 'light');
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
    return () => observer.disconnect();
  }, []);

  const activeTheme = theme || observedTheme;
  const isBarMode = Array.isArray(series) && series.length > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    hitRegionsRef.current = [];

    const styles = getComputedStyle(document.documentElement);
    const gridColor = readCssToken(styles, '--chart-grid', '#F0F0EE');
    const axisColor = readCssToken(styles, '--chart-axis', '#6B7280');
    const primaryColor = readCssToken(styles, '--chart-primary', '#1D61E7');
    const secondaryColor = readCssToken(styles, '--chart-secondary', '#E5E7EB');
    const secondaryLineColor = readCssToken(styles, '--chart-line-secondary', '#94A3B8');
    const thresholdColor = readCssToken(styles, '--chart-threshold', '#F97316');
    const tooltipBg = readCssToken(styles, '--chart-tooltip-bg', '#111827');
    const tooltipText = readCssToken(styles, '--chart-tooltip-text', '#FFFFFF');
    const tooltipMuted = readCssToken(styles, '--chart-tooltip-muted', '#9CA3AF');
    const fontFamily = readCssToken(styles, '--font-sans', 'sans-serif');

    const pad = { top: 20, right: 16, bottom: 32, left: 46 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    if (isBarMode) {
      const maxVal = Math.max(
        10,
        ...series.flatMap((d) => [Number(d.primary || 0), Number(d.secondary || 0)])
      );

      // Crisp horizontal gridlines only (zero outer chart border)
      ctx.strokeStyle = gridColor;
      ctx.fillStyle = axisColor;
      ctx.font = `11px ${fontFamily}`;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotH * i) / 4;
        const val = Math.round(maxVal * (1 - i / 4));
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
        ctx.fillText(String(val), 6, y + 4);
      }

      const groupW = plotW / series.length;
      const barW = Math.min(22, Math.max(8, groupW * 0.28));
      const gap = Math.min(6, barW * 0.35);

      series.forEach((pt, idx) => {
        const centerX = pad.left + idx * groupW + groupW / 2;
        const pH = Math.max(2, (Number(pt.primary || 0) / maxVal) * plotH);
        const sH = Math.max(2, (Number(pt.secondary || 0) / maxVal) * plotH);

        const pX = centerX - barW - gap / 2;
        const sX = centerX + gap / 2;
        const pY = pad.top + plotH - pH;
        const sY = pad.top + plotH - sH;

        // Primary Royal Blue bar
        ctx.fillStyle = primaryColor;
        roundRectPath(ctx, pX, pY, barW, pH, 4);
        ctx.fill();

        // Comparison light grey bar
        ctx.fillStyle = secondaryColor;
        roundRectPath(ctx, sX, sY, barW, sH, 4);
        ctx.fill();

        // X-axis label
        ctx.fillStyle = axisColor;
        ctx.font = `11px ${fontFamily}`;
        const labelW = ctx.measureText(pt.label).width;
        ctx.fillText(pt.label, centerX - labelW / 2, h - 10);

        hitRegionsRef.current.push({
          idx,
          xMin: pad.left + idx * groupW,
          xMax: pad.left + (idx + 1) * groupW,
          anchorX: centerX,
          anchorY: Math.min(pY, sY),
          title: pt.label,
          line1: `${pt.primaryLabel || 'Stock Units'}: ${pt.primary}`,
          line2: `${pt.secondaryLabel || 'Target / Threshold'}: ${pt.secondary}`
        });
      });
    } else {
      if (!forecast || !forecast.length) {
        ctx.fillStyle = axisColor;
        ctx.font = `13px ${fontFamily}`;
        ctx.fillText('Not enough transaction data to plot forecast.', 24, h / 2);
        return;
      }

      const maxVal = Math.max(threshold * 1.25, ...forecast.map((d) => d.predicted_stock), 10);

      // Horizontal gridlines
      ctx.strokeStyle = gridColor;
      ctx.fillStyle = axisColor;
      ctx.font = `11px ${fontFamily}`;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotH * i) / 4;
        const val = Math.round(maxVal * (1 - i / 4));
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
        ctx.fillText(String(val), 6, y + 4);
      }

      // Threshold reference line (secondary dashed)
      const threshY = pad.top + plotH * (1 - threshold / maxVal);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = secondaryLineColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad.left, threshY);
      ctx.lineTo(w - pad.right, threshY);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = axisColor;
      ctx.fillText(`Reorder Threshold (${threshold})`, w - pad.right - 135, Math.max(14, threshY - 6));

      // Royal Blue primary forecast curve
      const xStep = plotW / Math.max(1, forecast.length - 1);
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      forecast.forEach((pt, idx) => {
        const x = pad.left + idx * xStep;
        const y = pad.top + plotH * (1 - pt.predicted_stock / maxVal);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Points & day labels
      forecast.forEach((pt, idx) => {
        const x = pad.left + idx * xStep;
        const y = pad.top + plotH * (1 - pt.predicted_stock / maxVal);
        const isBelow = pt.predicted_stock <= threshold;
        ctx.fillStyle = isBelow ? thresholdColor : primaryColor;
        ctx.beginPath();
        ctx.arc(x, y, hoverIdx === idx ? 5.5 : 3.5, 0, Math.PI * 2);
        ctx.fill();

        if (idx % 2 === 0 || idx === forecast.length - 1) {
          ctx.fillStyle = axisColor;
          ctx.fillText(`D${pt.day}`, x - 8, h - 10);
        }

        hitRegionsRef.current.push({
          idx,
          xMin: x - xStep / 2,
          xMax: x + xStep / 2,
          anchorX: x,
          anchorY: y,
          title: `Day ${pt.day}`,
          line1: `Projected Stock: ${pt.predicted_stock}`,
          line2: `Est. Usage: ${pt.predicted_usage ?? 0}/day`
        });
      });
    }

    // Dark #111827 Floating Hover Tooltip rendered inside canvas (CSP-safe)
    const hovered = hitRegionsRef.current.find((r) => r.idx === hoverIdx);
    if (hovered) {
      ctx.font = `600 11px ${fontFamily}`;
      const w1 = ctx.measureText(hovered.title).width;
      ctx.font = `500 11px ${fontFamily}`;
      const w2 = ctx.measureText(hovered.line1).width;
      const w3 = ctx.measureText(hovered.line2).width;
      const boxW = Math.max(w1, w2, w3) + 20;
      const boxH = 54;
      const bx = Math.min(w - boxW - 8, Math.max(pad.left, hovered.anchorX - boxW / 2));
      const by = Math.max(6, hovered.anchorY - boxH - 10);

      ctx.fillStyle = tooltipBg;
      roundRectPath(ctx, bx, by, boxW, boxH, 8);
      ctx.fill();

      ctx.fillStyle = tooltipText;
      ctx.font = `600 11px ${fontFamily}`;
      ctx.fillText(hovered.title, bx + 10, by + 16);

      ctx.fillStyle = tooltipText;
      ctx.font = `500 11px ${fontFamily}`;
      ctx.fillText(hovered.line1, bx + 10, by + 32);

      ctx.fillStyle = tooltipMuted;
      ctx.fillText(hovered.line2, bx + 10, by + 46);
    }
  }, [series, forecast, threshold, width, height, activeTheme, hoverIdx, isBarMode]);

  function handleMouseMove(e) {
    const canvas = canvasRef.current;
    if (!canvas || !hitRegionsRef.current.length) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const match = hitRegionsRef.current.find((r) => mouseX >= r.xMin && mouseX <= r.xMax);
    setHoverIdx(match ? match.idx : -1);
  }

  return (
    <div className="chart-wrap">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(-1)}
      />
    </div>
  );
}
