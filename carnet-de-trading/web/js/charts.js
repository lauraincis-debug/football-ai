/**
 * Graphiques Canvas (aucune dépendance).
 * - chandelles japonaise avec axes et grille discrète ;
 * - courbe d'equity / de backtest avec remplissage dégradé ;
 * - respect de la densité d'écran et du redimensionnement.
 */

const COLORS = {
  grid: "rgba(35, 55, 79, .55)",
  axis: "#6b7f99",
  text: "#93a6bf",
  up: "#20d6a0",
  down: "#ff707d",
  accent: "#29d6cf",
  line: "#6aa9ff",
  bg: "rgba(9, 15, 29, 0)",
};

function setup(canvas, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 600;
  const h = height || canvas.clientHeight || 220;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, h);
  return { ctx, width, height: h };
}

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min || 0];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => step * m);
  const chosen = candidates.find((c) => span / c <= count) || candidates[candidates.length - 1];
  const ticks = [];
  for (let v = Math.ceil(min / chosen) * chosen; v <= max; v += chosen) ticks.push(v);
  return ticks;
}

function formatPrice(value, precision) {
  if (!Number.isFinite(value)) return "—";
  const digits = precision ?? (value >= 1000 ? 2 : value >= 10 ? 3 : 5);
  return value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function drawEquityChart(canvas, values, { height = 220, color = COLORS.accent, baseline = null } = {}) {
  if (!canvas) return;
  const { ctx, width, height: h } = setup(canvas, height);
  const data = (values || []).map(Number).filter(Number.isFinite);
  if (data.length < 2) {
    ctx.fillStyle = COLORS.text;
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.fillText("Pas encore assez de données.", 12, h / 2);
    return;
  }
  const pad = { l: 8, r: 54, t: 14, b: 20 };
  const plotW = width - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const min = Math.min(...data, baseline ?? Infinity);
  const max = Math.max(...data, baseline ?? -Infinity);
  const span = max - min || Math.abs(max) * 0.01 || 1;
  const x = (i) => pad.l + (i / (data.length - 1)) * plotW;
  const y = (v) => pad.t + plotH - ((v - min) / span) * plotH;

  // grille + axe des prix
  const ticks = niceTicks(min, max, 4);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = COLORS.text;
  ticks.forEach((tick) => {
    const yy = Math.round(y(tick)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, yy);
    ctx.lineTo(width - pad.r, yy);
    ctx.stroke();
    ctx.fillText(formatPrice(tick), width - pad.r + 6, yy + 3);
  });

  if (Number.isFinite(baseline)) {
    const by = y(baseline);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(147, 166, 191, .5)";
    ctx.beginPath();
    ctx.moveTo(pad.l, by);
    ctx.lineTo(width - pad.r, by);
    ctx.stroke();
    ctx.restore();
  }

  // dégradé
  const gradient = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
  gradient.addColorStop(0, hexToRgba(color, 0.28));
  gradient.addColorStop(1, hexToRgba(color, 0.01));
  ctx.beginPath();
  ctx.moveTo(x(0), y(data[0]));
  data.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(data.length - 1), pad.t + plotH);
  ctx.lineTo(x(0), pad.t + plotH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // courbe
  ctx.beginPath();
  data.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = "round";
  ctx.stroke();

  // dernier point
  const lastX = x(data.length - 1);
  const lastY = y(data[data.length - 1]);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawCandles(canvas, candles, { height = 360, precision, overlays = [] } = {}) {
  if (!canvas) return;
  const { ctx, width, height: h } = setup(canvas, height);
  const rows = (candles || []).filter((c) => c && Number.isFinite(Number(c.close)));
  if (rows.length < 2) {
    ctx.fillStyle = COLORS.text;
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.fillText("Historique insuffisant.", 12, h / 2);
    return;
  }
  const pad = { l: 8, r: 62, t: 14, b: 22 };
  const plotW = width - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const highs = rows.map((c) => Number(c.high));
  const lows = rows.map((c) => Number(c.low));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const slot = plotW / rows.length;
  const bodyW = Math.max(1.5, Math.min(11, slot * 0.62));
  const x = (i) => pad.l + slot * (i + 0.5);
  const y = (v) => pad.t + plotH - ((v - min) / span) * plotH;

  // grille
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = COLORS.text;
  niceTicks(min, max, 5).forEach((tick) => {
    const yy = Math.round(y(tick)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, yy);
    ctx.lineTo(width - pad.r, yy);
    ctx.stroke();
    ctx.fillText(formatPrice(tick, precision), width - pad.r + 6, yy + 3);
  });

  // chandelles
  rows.forEach((candle, i) => {
    const open = Number(candle.open);
    const close = Number(candle.close);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const up = close >= open;
    const color = up ? COLORS.up : COLORS.down;
    const cx = x(i);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, y(high));
    ctx.lineTo(Math.round(cx) + 0.5, y(low));
    ctx.stroke();
    const top = y(Math.max(open, close));
    const bottom = y(Math.min(open, close));
    const bodyHeight = Math.max(1, bottom - top);
    ctx.globalAlpha = up ? 0.85 : 0.9;
    ctx.fillRect(cx - bodyW / 2, top, bodyW, bodyHeight);
    ctx.globalAlpha = 1;
  });

  // dernières lignes (EMA) si fournies
  overlays.forEach((overlay) => {
    const points = overlay.values;
    if (!points || points.length < 2) return;
    ctx.beginPath();
    points.forEach((value, i) => {
      const idx = rows.length - points.length + i;
      if (idx < 0) return;
      const xx = x(idx);
      const yy = y(Number(value));
      i === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
    });
    ctx.strokeStyle = overlay.color;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  });

  // axe temporel minimal : première et dernière bougie
  ctx.fillStyle = COLORS.axis;
  ctx.font = "10px ui-monospace, monospace";
  const first = new Date(rows[0].time);
  const last = new Date(rows[rows.length - 1].time);
  const fmt = (d) =>
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const fmtDay = (d) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  ctx.fillText(`${fmtDay(first)} ${fmt(first)}`, pad.l, h - 6);
  const lastLabel = `${fmtDay(last)} ${fmt(last)}`;
  const lastWidth = ctx.measureText(lastLabel).width;
  ctx.fillText(lastLabel, width - pad.r - lastWidth, h - 6);
}

export function drawSparkline(canvas, values, { color = COLORS.accent } = {}) {
  if (!canvas) return;
  const { ctx, width, height } = setup(canvas, canvas.clientHeight || 40);
  const data = (values || []).map(Number).filter(Number.isFinite);
  if (data.length < 2) return;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  ctx.beginPath();
  data.forEach((value, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 3 - ((value - min) / span) * (height - 6);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

export function drawLoginBackdrop(canvas) {
  if (!canvas) return;
  let frame = 0;
  let animation;
  const series = Array.from({ length: 3 }, () => []);

  const render = () => {
    const { ctx, width, height } = setup(canvas, canvas.clientHeight || window.innerHeight);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(35, 55, 79, .35)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const y = (i / 10) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    const colors = ["rgba(41, 214, 207, .85)", "rgba(106, 169, 255, .6)", "rgba(32, 214, 160, .55)"];
    series.forEach((points, idx) => {
      points.push(0.5 + Math.sin((frame + idx * 40) / 55 + idx) * 0.16 + Math.cos((frame + idx * 20) / 21) * 0.05);
      if (points.length > 160) points.shift();
      ctx.beginPath();
      points.forEach((value, i) => {
        const x = (i / 160) * width;
        const y = height * (0.75 - value * 0.4);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = colors[idx];
      ctx.lineWidth = 1.4;
      ctx.stroke();
    });
    frame += 1;
    animation = requestAnimationFrame(render);
  };

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    for (let i = 0; i < 60; i += 1) {
      series.forEach((points) => points.push(0.5 + Math.sin((i + 12) / 9) * 0.2));
    }
    render();
    cancelAnimationFrame(animation);
    return;
  }
  render();
  window.addEventListener("beforeunload", () => cancelAnimationFrame(animation), { once: true });
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value.length === 3 ? value.split("").map((c) => c + c).join("") : value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
