import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { WallpaperBackground } from "../components/WallpaperBackground";
import { FloatingWindow } from "../components/FloatingWindow";
import { CursorOverlay } from "../components/CursorOverlay";
import { useZoom } from "../lib/useZoom";
import { useCursor } from "../lib/useCursor";
import type { RecordingProps } from "../lib/types";

/**
 * Main composition: takes a raw screen recording + cursor telemetry and
 * produces a polished video with:
 *
 * 1. Wallpaper background (gradient or image — never zooms)
 * 2. Floating window with rounded corners and layered drop shadows
 * 3. Spring-animated zoom on click clusters
 * 4. Emulated arrow cursor with click-pulse ripple
 *
 * This is the Remotion equivalent of what CursorCast's offscreen.js
 * did in real-time — but non-destructive and declarative.
 */
export const ScreenRecording: React.FC<RecordingProps> = ({
  videoSrc,
  cursorData,
  zoomEvents,
  background,
  padding,
  borderRadius,
  cursorSize,
  cursorEnabled,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Compute zoom state from events
  const { scale, originX, originY } = useZoom(frame, fps, zoomEvents);

  // Compute cursor position from telemetry
  const { x: cursorX, y: cursorY, clicking, clickAge } = useCursor(
    frame,
    cursorData,
  );

  return (
    <AbsoluteFill>
      {/* Layer 1: Static wallpaper background */}
      <WallpaperBackground background={background} />

      {/* Layer 2: Floating video window with zoom */}
      <FloatingWindow
        videoSrc={videoSrc}
        scale={scale}
        originX={originX}
        originY={originY}
        padding={padding}
        borderRadius={borderRadius}
      />

      {/* Layer 3: Cursor overlay */}
      {cursorEnabled && (
        <CursorOverlay
          videoX={cursorX}
          videoY={cursorY}
          clicking={clicking}
          clickAge={clickAge}
          size={cursorSize}
          zoomScale={scale}
          zoomOriginX={originX}
          zoomOriginY={originY}
          padding={padding}
        />
      )}
    </AbsoluteFill>
  );
};
