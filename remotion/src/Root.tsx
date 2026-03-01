import React from "react";
import { Composition, staticFile } from "remotion";
import { ScreenRecording } from "./compositions/ScreenRecording";
import { RecordingPropsSchema, WALLPAPER_PRESETS } from "./lib/types";

/**
 * Remotion root — registers all available compositions.
 *
 * The ScreenRecording composition accepts inputProps:
 * - videoSrc: path to raw recording (place in public/ or use a URL)
 * - cursorData: array of { frame, x, y, clicked } from CursorCast telemetry
 * - zoomEvents: array of { startFrame, endFrame, focusX, focusY, scale }
 * - background: CSS gradient/color string
 * - padding, borderRadius, cursorSize, cursorEnabled: visual settings
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Main composition — 1080p at 30fps, 30s default duration */}
      <Composition
        id="ScreenRecording"
        component={ScreenRecording}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        schema={RecordingPropsSchema}
        defaultProps={{
          videoSrc: staticFile("recording.mp4"),
          cursorData: [],
          zoomEvents: [],
          background: WALLPAPER_PRESETS["purple-haze"],
          padding: 48,
          borderRadius: 12,
          cursorSize: 1.0,
          cursorEnabled: true,
        }}
      />

      {/* 4K variant */}
      <Composition
        id="ScreenRecording4K"
        component={ScreenRecording}
        durationInFrames={900}
        fps={30}
        width={3840}
        height={2160}
        schema={RecordingPropsSchema}
        defaultProps={{
          videoSrc: staticFile("recording.mp4"),
          cursorData: [],
          zoomEvents: [],
          background: WALLPAPER_PRESETS["purple-haze"],
          padding: 96,
          borderRadius: 24,
          cursorSize: 1.5,
          cursorEnabled: true,
        }}
      />
    </>
  );
};
