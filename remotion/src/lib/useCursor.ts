import { interpolate } from "remotion";
import type { CursorPoint } from "./types";

/**
 * Interpolates cursor position from telemetry data at the given frame.
 *
 * Uses Remotion's interpolate() for smooth linear interpolation between
 * recorded cursor positions. Click detection looks for clicks within
 * a small frame window.
 */
export function useCursor(
  frame: number,
  data: CursorPoint[],
): { x: number; y: number; clicking: boolean; clickAge: number } {
  if (data.length === 0) {
    return { x: 0.5, y: 0.5, clicking: false, clickAge: Infinity };
  }

  // Build monotonically increasing frame arrays (deduplicate same-frame entries)
  const deduped = deduplicateFrames(data);

  // interpolate() requires at least 2 points — return constant for single point
  if (deduped.length < 2) {
    const only = deduped[0];
    const clicking = only.clicked === true;
    return { x: only.x, y: only.y, clicking, clickAge: clicking ? 0 : Infinity };
  }

  const frames = deduped.map((d) => d.frame);
  const xs = deduped.map((d) => d.x);
  const ys = deduped.map((d) => d.y);

  const x = interpolate(frame, frames, xs, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame, frames, ys, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Find the most recent click
  const CLICK_PULSE_FRAMES = 15; // ~500ms at 30fps
  const clicks = data.filter((d) => d.clicked);
  const recentClick = findMostRecentClick(clicks, frame);
  const clickAge = recentClick !== null ? frame - recentClick.frame : Infinity;
  const clicking = clickAge >= 0 && clickAge < CLICK_PULSE_FRAMES;

  return { x, y, clicking, clickAge };
}

/**
 * Removes duplicate frame entries, keeping the last value per frame.
 * Ensures monotonically increasing frame numbers for interpolate().
 */
function deduplicateFrames(data: CursorPoint[]): CursorPoint[] {
  const map = new Map<number, CursorPoint>();
  for (const point of data) {
    map.set(point.frame, point);
  }
  return Array.from(map.values()).sort((a, b) => a.frame - b.frame);
}

/**
 * Find the most recent click at or before the given frame.
 * Assumes clicks are sorted by frame number (ascending).
 */
function findMostRecentClick(
  clicks: CursorPoint[],
  frame: number,
): CursorPoint | null {
  if (clicks.length === 0) return null;

  let result: CursorPoint | null = null;
  for (const click of clicks) {
    if (click.frame <= frame) {
      result = click;
    } else {
      break;
    }
  }
  return result;
}
