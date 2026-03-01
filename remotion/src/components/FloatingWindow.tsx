import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";

/**
 * Floating video window with rounded corners, drop shadow, and zoom transform.
 *
 * The video is rendered inside a padded container with overflow:hidden for
 * the rounded corners. The zoom is applied via CSS transform on the inner
 * video element — the container clips the zoomed content.
 *
 * This replicates Cursorful's "browser window floating in wallpaper" effect:
 * - Wallpaper background (parent) stays static
 * - This window has padding, rounded corners, and shadow
 * - Video inside zooms toward the click focus point
 */
export const FloatingWindow: React.FC<{
  videoSrc: string;
  scale: number;
  originX: number;
  originY: number;
  padding: number;
  borderRadius: number;
}> = ({ videoSrc, scale, originX, originY, padding, borderRadius }) => {
  const hasVideo = videoSrc && videoSrc.length > 0;

  return (
    <AbsoluteFill
      style={{
        padding,
        zIndex: 1,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius,
          overflow: "hidden",
          boxShadow: [
            "0 4px 8px rgba(0, 0, 0, 0.15)",
            "0 16px 32px rgba(0, 0, 0, 0.25)",
            "0 48px 80px rgba(0, 0, 0, 0.4)",
          ].join(", "),
          position: "relative",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `scale(${scale})`,
            transformOrigin: `${originX * 100}% ${originY * 100}%`,
          }}
        >
          {hasVideo ? (
            <OffthreadVideo
              src={videoSrc.startsWith("http") || videoSrc.startsWith("blob:") ? videoSrc : staticFile(videoSrc)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                background: "#1a1a2e",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#667eea",
                fontSize: 24,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              No recording loaded
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
