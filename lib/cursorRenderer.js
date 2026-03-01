/**
 * Cursor rendering — draws an emulated mouse cursor on a canvas.
 * Ported from CursorLens/src/lib/cursor/cursorComposer.ts
 *
 * Supports arrow and ibeam glyphs with click-pulse ripple,
 * radial highlight, and drop shadow effects.
 */

const CLICK_PULSE_MS = 420;

const CURSOR_GLYPH_HOTSPOT = {
  arrow: { x: -4, y: -8 },
  ibeam: { x: 0, y: 0 },
};

export const DEFAULT_CURSOR_STYLE = {
  enabled: true,
  size: 1.8,
  highlight: 0.75,
  ripple: 0.7,
  shadow: 0.45,
  offsetX: 0,
  offsetY: 0,
};

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(t) {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

function drawArrowCursorGlyph(ctx) {
  ctx.beginPath();
  ctx.moveTo(-4, -8);
  ctx.lineTo(13, 2);
  ctx.lineTo(6, 4);
  ctx.lineTo(9, 13);
  ctx.lineTo(5, 14);
  ctx.lineTo(2, 5);
  ctx.lineTo(-2, 10);
  ctx.closePath();

  ctx.fillStyle = '#f7f9ff';
  ctx.fill();
  ctx.strokeStyle = '#0f1218';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawIBeamCursorGlyph(ctx) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Outer stroke (dark outline)
  ctx.strokeStyle = '#0f1218';
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.moveTo(-4.8, -10);
  ctx.lineTo(4.8, -10);
  ctx.moveTo(-4.8, 10);
  ctx.lineTo(4.8, 10);
  ctx.stroke();

  // Inner stroke (light fill)
  ctx.strokeStyle = '#f7f9ff';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.moveTo(-4.8, -10);
  ctx.lineTo(4.8, -10);
  ctx.moveTo(-4.8, 10);
  ctx.lineTo(4.8, 10);
  ctx.stroke();
  ctx.restore();
}

function drawCursorGlyph(ctx, cursorKind) {
  if (cursorKind === 'ibeam') {
    drawIBeamCursorGlyph(ctx);
    return;
  }
  drawArrowCursorGlyph(ctx);
}

/**
 * Resolve the click-pulse animation intensity (0-1) based on how recently a click occurred.
 */
export function resolveClickPulse(timeMs, clickTimes) {
  if (clickTimes.length === 0) return 0;

  let idx = clickTimes.length - 1;
  while (idx >= 0 && clickTimes[idx] > timeMs) {
    idx -= 1;
  }
  if (idx < 0) return 0;

  const delta = timeMs - clickTimes[idx];
  if (delta < 0 || delta > CLICK_PULSE_MS) return 0;

  return 1 - clamp01(delta / CLICK_PULSE_MS);
}

/**
 * Build a CursorResolvedState for the current frame.
 * Simplified from CursorLens — uses live cursor position instead of track interpolation.
 *
 * @param {Object} params
 * @param {number} params.clickPulse - 0..1 click animation intensity
 * @param {Object} [params.style] - Partial cursor style overrides
 * @returns {Object} CursorResolvedState
 */
export function buildCursorState(clickPulse = 0, style = {}) {
  const s = { ...DEFAULT_CURSOR_STYLE, ...style };
  if (!s.enabled) {
    return {
      visible: false,
      scale: s.size,
      highlightAlpha: 0,
      rippleScale: 0,
      rippleAlpha: 0,
      cursorKind: 'arrow',
    };
  }

  const clickAccent = easeOutCubic(clickPulse);

  return {
    visible: true,
    scale: s.size * (1 + clickAccent * 0.1),
    highlightAlpha: s.highlight * (0.35 + clickAccent * 0.25),
    rippleScale: 1 + clickAccent * 1.8,
    rippleAlpha: s.ripple * clickPulse,
    cursorKind: 'arrow',
  };
}

/**
 * Draw the composited cursor (glyph + ripple + highlight + shadow) at a canvas position.
 * Ported from CursorLens cursorComposer.ts lines 641-706.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number }} point - Position in canvas pixels
 * @param {Object} state - CursorResolvedState from buildCursorState()
 * @param {Object} [style] - Optional style overrides
 * @param {number} [contentScale=1]
 */
export function drawCompositedCursor(ctx, point, state, style, contentScale = 1) {
  if (!state.visible) return;

  const s = { ...DEFAULT_CURSOR_STYLE, ...style };
  const safeContentScale = Math.max(0.1, Math.min(8, Number.isFinite(contentScale) ? contentScale : 1));
  const scale = state.scale * safeContentScale;
  const cursorKind = state.cursorKind === 'ibeam' ? 'ibeam' : 'arrow';
  const cursorHotspot = CURSOR_GLYPH_HOTSPOT[cursorKind];
  const translatedX = point.x + (s.offsetX || 0);
  const translatedY = point.y + (s.offsetY || 0);

  ctx.save();
  ctx.translate(translatedX, translatedY);

  // Ripple ring on click
  if (state.rippleAlpha > 0.001) {
    ctx.save();
    ctx.globalAlpha = state.rippleAlpha;
    ctx.strokeStyle = 'rgba(78,161,255,1)';
    ctx.lineWidth = 2;
    const rippleRadius = 10 * state.rippleScale * scale;
    ctx.beginPath();
    ctx.arc(0, 0, rippleRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Radial highlight glow
  if (state.highlightAlpha > 0.001) {
    ctx.save();
    ctx.globalAlpha = state.highlightAlpha;
    const gradient = ctx.createRadialGradient(0, 0, 2, 0, 0, 20 * scale);
    gradient.addColorStop(0, 'rgba(78,161,255,0.5)');
    gradient.addColorStop(1, 'rgba(78,161,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 20 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Cursor glyph with optional shadow
  if (s.shadow > 0.001) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${0.5 * s.shadow})`;
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2 * scale;
    ctx.translate(-cursorHotspot.x * scale, -cursorHotspot.y * scale);
    ctx.scale(scale, scale);
    drawCursorGlyph(ctx, cursorKind);
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(-cursorHotspot.x * scale, -cursorHotspot.y * scale);
    ctx.scale(scale, scale);
    drawCursorGlyph(ctx, cursorKind);
    ctx.restore();
  }

  ctx.restore();
}
