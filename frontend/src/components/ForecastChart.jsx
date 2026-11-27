import { useEffect, useRef, useState } from 'react';

function readCssToken(styles, name, fallback) {
  const value = styles.getPropertyValue(name)?.trim();
  return value || fallback;
}

export default function ForecastChart({
  forecast = [],
  threshold = 0,
  width = 840,
  height = 280,
  theme
}) {
  const canvasRef = useRef(null);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const styles = getComputedStyle(document.documentElement);
    const gridColor = readCssToken(styles, '--chart-grid', 'rgba(15, 23, 42, 0.14)');
    const axisColor = readCssToken(styles, '--chart-axis', '#475569');
    const lineColor = readCssToken(styles, '--chart-line', '#0369a1');
    const pointOkColor = readCssToken(styles, '--chart-point-ok', '#0369a1');
    const pointAlertColor = readCssToken(styles, '--chart-point-alert', '#dc2626');
    const thresholdColor = readCssToken(styles, '--chart-threshold', '#b45309');
    const thresholdLabelColor = readCssToken(styles, '--chart-threshold-label', '#92400e');
    const fontFamily = readCssToken(styles, '--font-sans', 'sans-serif');

    if (!forecast || !forecast.length) {
      ctx.fillStyle = axisColor;
      ctx.font = `14px ${fontFamily}`;
      ctx.fillText('Not enough transaction data to plot forecast.', 24, h / 2);
      return;
    }

    const pad = { top: 24, right: 24, bottom: 36, left: 48 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const maxVal = Math.max(threshold * 1.25, ...forecast.map((d) => d.predicted_stock), 10);

    // Grid lines & Y-axis labels
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = axisColor;
    ctx.font = `12px ${fontFamily}`;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH * i) / 4;
      const val = Math.round(maxVal * (1 - i / 4));
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillText(String(val), 8, y + 4);
    }

    // Threshold dashed line
    const threshY = pad.top + plotH * (1 - threshold / maxVal);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = thresholdColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, threshY);
    ctx.lineTo(w - pad.right, threshY);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = thresholdLabelColor;
    ctx.fillText(`Threshold (${threshold})`, w - pad.right - 110, Math.max(16, threshY - 6));

    // Projected stock curve
    const xStep = plotW / Math.max(1, forecast.length - 1);
    ctx.strokeStyle = lineColor;
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
      ctx.fillStyle = pt.predicted_stock <= threshold ? pointAlertColor : pointOkColor;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      if (idx % 2 === 0 || idx === forecast.length - 1) {
        ctx.fillStyle = axisColor;
        ctx.fillText(`D${pt.day}`, x - 8, h - 12);
      }
    });
  }, [forecast, threshold, width, height, activeTheme]);

  return (
    <div className="chart-wrap">
      <canvas ref={canvasRef} width={width} height={height} />
    </div>
  );
}
