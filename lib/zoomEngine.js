/**
 * Zoom engine — click-cluster detection and zoom viewport calculation.
 *
 * Auto-zoom triggers when 2+ clicks occur within a 3-second window,
 * zooming toward the centroid of the click cluster.
 * Zoom-out happens when no clicks have occurred for 3 seconds.
 *
 * Focus clamping adapted from CursorLens/focusUtils.ts.
 */

import {
  createSpringState,
  createSpring2D,
  stepSpring,
  stepSpring2D,
  ZOOM_SPRING_CONFIG,
  DEFAULT_SPRING_CONFIG,
} from './spring.js';

// How many clicks within this window trigger a zoom
const ZOOM_CLUSTER_WINDOW_MS = 3000;
const MIN_CLICKS_TO_ZOOM = 2;
const ZOOM_SCALE_TARGET = 2.0;
const ZOOM_SCALE_DEFAULT = 1.0;

// Idle timeout: zoom out after this long with no clicks
const ZOOM_IDLE_TIMEOUT_MS = 3000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Creates a new ZoomEngine instance that manages:
 * - Click history and cluster detection
 * - Zoom scale spring animation
 * - Focus point spring animation (where the zoom centers)
 * - Viewport source-rect calculation for canvas drawImage
 */
export function createZoomEngine() {
  let clickHistory = [];
  let zoomScaleSpring = createSpringState(ZOOM_SCALE_DEFAULT);
  let zoomScaleTarget = ZOOM_SCALE_DEFAULT;
  let focusSpring = createSpring2D(0.5, 0.5);
  let focusTarget = { x: 0.5, y: 0.5 };
  let lastClickTime = 0;
  let isZoomed = false;

  return {
    /**
     * Register a click event. Evaluates whether to trigger/maintain zoom.
     * @param {number} x - Normalized 0-1 horizontal position
     * @param {number} y - Normalized 0-1 vertical position
     * @param {number} t - Timestamp in ms (Date.now())
     */
    onClick(x, y, t) {
      clickHistory.push({ x, y, t });
      lastClickTime = t;

      // Prune clicks older than the cluster window
      const cutoff = t - ZOOM_CLUSTER_WINDOW_MS;
      clickHistory = clickHistory.filter(c => c.t >= cutoff);

      if (clickHistory.length >= MIN_CLICKS_TO_ZOOM) {
        // Compute centroid of recent clicks
        const centroidX = clickHistory.reduce((s, c) => s + c.x, 0) / clickHistory.length;
        const centroidY = clickHistory.reduce((s, c) => s + c.y, 0) / clickHistory.length;

        focusTarget = {
          x: clamp(centroidX, 0, 1),
          y: clamp(centroidY, 0, 1),
        };
        zoomScaleTarget = ZOOM_SCALE_TARGET;
        isZoomed = true;
      }
    },

    /**
     * Update cursor position. When zoomed, the focus follows the cursor.
     * @param {number} x - Normalized 0-1
     * @param {number} y - Normalized 0-1
     */
    onCursorMove(x, y) {
      if (isZoomed) {
        // While zoomed, gently follow the cursor for focus
        focusTarget = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
      }
    },

    /**
     * Step the physics simulation by dt seconds.
     * Call this every frame in requestAnimationFrame.
     * @param {number} dt - Delta time in seconds
     * @param {number} now - Current time in ms (Date.now())
     * @returns {{ scale: number, focusX: number, focusY: number }}
     */
    step(dt, now) {
      // Check idle timeout — zoom out if no clicks for ZOOM_IDLE_TIMEOUT_MS
      if (isZoomed && now - lastClickTime > ZOOM_IDLE_TIMEOUT_MS) {
        zoomScaleTarget = ZOOM_SCALE_DEFAULT;
        isZoomed = false;
        // Let focus drift back to center
        focusTarget = { x: 0.5, y: 0.5 };
      }

      // Animate zoom scale
      zoomScaleSpring = stepSpring(zoomScaleSpring, zoomScaleTarget, ZOOM_SPRING_CONFIG, dt);
      const scale = clamp(zoomScaleSpring.position, 1.0, 5.0);

      // Animate focus point
      const focusConfig = isZoomed
        ? { stiffness: 120, damping: 20, mass: 1 } // Soft follow when zoomed
        : DEFAULT_SPRING_CONFIG; // Snap back when unzoomed
      focusSpring = stepSpring2D(focusSpring, focusTarget.x, focusTarget.y, focusConfig, dt);

      // Clamp focus so the viewport stays within bounds at current zoom
      const marginX = 1 / (2 * scale);
      const marginY = 1 / (2 * scale);
      const focusX = clamp(focusSpring.x.position, marginX, 1 - marginX);
      const focusY = clamp(focusSpring.y.position, marginY, 1 - marginY);

      return { scale, focusX, focusY };
    },

    /**
     * Compute the source rectangle for ctx.drawImage() given the current zoom state.
     * @param {number} canvasW - Canvas width in pixels
     * @param {number} canvasH - Canvas height in pixels
     * @param {number} scale - Current zoom scale from step()
     * @param {number} focusX - Normalized focus X from step()
     * @param {number} focusY - Normalized focus Y from step()
     * @returns {{ srcX: number, srcY: number, srcW: number, srcH: number }}
     */
    computeSourceRect(canvasW, canvasH, scale, focusX, focusY) {
      const srcW = canvasW / scale;
      const srcH = canvasH / scale;
      const focusPxX = focusX * canvasW;
      const focusPxY = focusY * canvasH;
      const srcX = clamp(focusPxX - srcW / 2, 0, canvasW - srcW);
      const srcY = clamp(focusPxY - srcH / 2, 0, canvasH - srcH);

      return { srcX, srcY, srcW, srcH };
    },

    /**
     * Map a normalized cursor position (0-1) to canvas-space coordinates
     * accounting for the current zoom viewport.
     * @param {number} normX - Normalized cursor X (0-1)
     * @param {number} normY - Normalized cursor Y (0-1)
     * @param {number} canvasW
     * @param {number} canvasH
     * @param {{ srcX: number, srcY: number, srcW: number, srcH: number }} sourceRect
     * @returns {{ x: number, y: number }}
     */
    cursorToCanvas(normX, normY, canvasW, canvasH, sourceRect) {
      const cursorPxX = normX * canvasW;
      const cursorPxY = normY * canvasH;
      const drawX = ((cursorPxX - sourceRect.srcX) / sourceRect.srcW) * canvasW;
      const drawY = ((cursorPxY - sourceRect.srcY) / sourceRect.srcH) * canvasH;
      return { x: drawX, y: drawY };
    },

    /** Get whether currently zoomed in */
    get isZoomed() { return isZoomed; },
    /** Get current zoom scale target */
    get zoomTarget() { return zoomScaleTarget; },
  };
}
