import { spring, interpolate } from "remotion";
import type { ZoomEvent } from "./types";

/**
 * Computes the current zoom state from an array of zoom events.
 *
 * Each zoom event defines a time range [startFrame, endFrame] during which
 * the camera zooms toward (focusX, focusY) at the given scale.
 *
 * Spring animations handle the transitions in and out.
 */
export function useZoom(
  frame: number,
  fps: number,
  events: ZoomEvent[],
): { scale: number; originX: number; originY: number } {
  if (events.length === 0) {
    return { scale: 1, originX: 0.5, originY: 0.5 };
  }

  // Find the active event (frame is within its range)
  const active = events.find(
    (e) => frame >= e.startFrame && frame < e.endFrame,
  );

  // Find the most recently ended event (for zoom-out animation)
  const ZOOM_OUT_WINDOW = Math.round(fps * 1.5); // 1.5s to fully zoom out
  const recentlyEnded = active
    ? null
    : [...events]
        .filter((e) => frame >= e.endFrame && frame < e.endFrame + ZOOM_OUT_WINDOW)
        .sort((a, b) => b.endFrame - a.endFrame)[0] ?? null;

  if (active) {
    // Zooming in or holding zoom
    const enterProgress = spring({
      frame: frame - active.startFrame,
      fps,
      config: { stiffness: 80, damping: 22, mass: 1 },
    });

    const scale = interpolate(enterProgress, [0, 1], [1, active.scale]);
    const originX = interpolate(enterProgress, [0, 1], [0.5, active.focusX]);
    const originY = interpolate(enterProgress, [0, 1], [0.5, active.focusY]);

    return { scale, originX, originY };
  }

  if (recentlyEnded) {
    // Zooming out from the most recently ended event
    const exitProgress = spring({
      frame: frame - recentlyEnded.endFrame,
      fps,
      config: { stiffness: 60, damping: 20, mass: 1 },
    });

    const scale = interpolate(exitProgress, [0, 1], [recentlyEnded.scale, 1]);
    const originX = interpolate(exitProgress, [0, 1], [recentlyEnded.focusX, 0.5]);
    const originY = interpolate(exitProgress, [0, 1], [recentlyEnded.focusY, 0.5]);

    return { scale, originX, originY };
  }

  // No zoom active
  return { scale: 1, originX: 0.5, originY: 0.5 };
}
