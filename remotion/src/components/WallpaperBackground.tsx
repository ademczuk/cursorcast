import React from "react";
import { AbsoluteFill } from "remotion";

/**
 * Static wallpaper/background layer.
 * Accepts any CSS background value: gradients, solid colors, or url() images.
 * This layer never zooms — it stays fixed behind the floating video window.
 */
export const WallpaperBackground: React.FC<{ background: string }> = ({
  background,
}) => {
  return (
    <AbsoluteFill
      style={{
        background,
        zIndex: 0,
      }}
    />
  );
};
