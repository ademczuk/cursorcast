import React from "react";
import { interpolate, useVideoConfig } from "remotion";

const CLICK_PULSE_FRAMES = 15; // ~500ms at 30fps

/**
 * Emulated cursor overlay with click-pulse animation.
 *
 * Renders an SVG arrow cursor at the given position, with a ripple ring
 * and glow effect on click. The cursor glyph matches CursorCast's
 * existing style: white fill (#f7f9ff) with dark outline (#0f1218).
 *
 * Position (x, y) is in normalized video coordinates (0-1). This component
 * transforms them to screen coordinates accounting for the floating window
 * padding and zoom transform.
 */
export const CursorOverlay: React.FC<{
  /** Normalized cursor X in video space (0-1) */
  videoX: number;
  /** Normalized cursor Y in video space (0-1) */
  videoY: number;
  /** Whether a click pulse should be animating */
  clicking: boolean;
  /** Frames since the most recent click */
  clickAge: number;
  /** Cursor size multiplier */
  size: number;
  /** Current zoom scale */
  zoomScale: number;
  /** Zoom origin X (normalized 0-1) */
  zoomOriginX: number;
  /** Zoom origin Y (normalized 0-1) */
  zoomOriginY: number;
  /** Padding around the floating window (px) */
  padding: number;
}> = ({
  videoX,
  videoY,
  clicking,
  clickAge,
  size,
  zoomScale,
  zoomOriginX,
  zoomOriginY,
  padding,
}) => {
  const { width, height } = useVideoConfig();

  // Window dimensions (inside padding)
  const windowW = width - padding * 2;
  const windowH = height - padding * 2;

  // Map cursor from video-normalized coords to screen coords.
  // The CSS transform `scale(s)` with origin `(ox%, oy%)` maps a point (px, py) to:
  //   screenPx = originPx + (px - originPx) * scale
  const originPx = zoomOriginX * windowW;
  const originPy = zoomOriginY * windowH;
  const videoPx = videoX * windowW;
  const videoPy = videoY * windowH;

  const screenX = padding + originPx + (videoPx - originPx) * zoomScale;
  const screenY = padding + originPy + (videoPy - originPy) * zoomScale;

  // Don't render if cursor is outside the visible window area (with margin)
  const margin = 40;
  if (
    screenX < padding - margin ||
    screenX > width - padding + margin ||
    screenY < padding - margin ||
    screenY > height - padding + margin
  ) {
    return null;
  }

  // Click pulse animation (easeOutCubic)
  const pulseProgress = clicking
    ? interpolate(clickAge, [0, CLICK_PULSE_FRAMES], [0, 1], {
        extrapolateRight: "clamp",
      })
    : 0;

  const eased = 1 - Math.pow(1 - pulseProgress, 3); // easeOutCubic
  const ringRadius = 8 + eased * 32;
  const ringOpacity = 1 - eased;
  const glowOpacity = (1 - eased) * 0.4;

  const cursorScale = size * 1.2;

  return (
    <div
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        zIndex: 10,
        pointerEvents: "none",
        // Offset so the cursor tip is at the exact position
        transform: `translate(-2px, -1px)`,
      }}
    >
      {/* Radial glow on click */}
      {clicking && (
        <div
          style={{
            position: "absolute",
            left: 2,
            top: 1,
            width: ringRadius * 2,
            height: ringRadius * 2,
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle, rgba(78, 161, 255, ${glowOpacity}) 0%, transparent 70%)`,
          }}
        />
      )}

      {/* Click ripple ring */}
      {clicking && (
        <div
          style={{
            position: "absolute",
            left: 2,
            top: 1,
            width: ringRadius * 2,
            height: ringRadius * 2,
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            border: `2px solid rgba(78, 161, 255, ${ringOpacity * 0.7})`,
          }}
        />
      )}

      {/* Arrow cursor SVG */}
      <svg
        width={24 * cursorScale}
        height={24 * cursorScale}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))",
        }}
      >
        {/* Outline */}
        <path
          d="M5.5 2.5V21.5L10.5 16.5H17L5.5 2.5Z"
          stroke="#0f1218"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        {/* Fill */}
        <path
          d="M5.5 2.5V21.5L10.5 16.5H17L5.5 2.5Z"
          fill="#f7f9ff"
        />
      </svg>
    </div>
  );
};
