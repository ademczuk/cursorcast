/**
 * CLI render script — takes a raw recording + telemetry JSON and produces
 * a polished MP4 with zoom, cursor, and wallpaper effects.
 *
 * Usage:
 *   npx tsx render.ts --video recording.webm --telemetry telemetry.json --output final.mp4
 *   npx tsx render.ts --video recording.webm --telemetry telemetry.json --background "midnight"
 *
 * Options:
 *   --video       Path to raw screen recording (required)
 *   --telemetry   Path to cursor telemetry JSON (required)
 *   --output      Output MP4 path (default: out/cursorcast-{timestamp}.mp4)
 *   --background  Wallpaper preset name or CSS gradient (default: purple-haze)
 *   --padding     Padding around window in px (default: 48)
 *   --radius      Border radius in px (default: 12)
 *   --cursor-size Cursor size multiplier (default: 1.0)
 *   --no-cursor   Disable cursor overlay
 *   --fps         Output FPS (default: 30)
 *   --width       Output width (default: 1920)
 *   --height      Output height (default: 1080)
 */

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { WALLPAPER_PRESETS, TelemetrySchema } from "./src/lib/types";

// ESM compatibility — __dirname doesn't exist in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Parse CLI args ───────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].replace(/^--/, "");
      if (key === "no-cursor") {
        opts["no-cursor"] = "true";
      } else {
        opts[key] = args[i + 1] || "";
        i++;
      }
    }
  }

  if (!opts.video) {
    console.error("Error: --video is required");
    console.error("Usage: npx tsx render.ts --video recording.webm --telemetry telemetry.json");
    process.exit(1);
  }
  if (!opts.telemetry) {
    console.error("Error: --telemetry is required");
    process.exit(1);
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  // Read telemetry
  const telemetryRaw = fs.readFileSync(opts.telemetry, "utf-8");
  const telemetry = TelemetrySchema.parse(JSON.parse(telemetryRaw));

  // Resolve video path to absolute URL for Remotion
  const videoAbsPath = path.resolve(opts.video);

  // Copy video to public/ so Remotion can serve it
  const publicDir = path.join(__dirname, "public");
  const videoFilename = "recording" + path.extname(opts.video);
  const videoDest = path.join(publicDir, videoFilename);
  fs.copyFileSync(videoAbsPath, videoDest);
  console.log(`Copied ${videoAbsPath} → ${videoDest}`);

  // Resolve wallpaper
  const bgInput = opts.background || "purple-haze";
  const background =
    WALLPAPER_PRESETS[bgInput as keyof typeof WALLPAPER_PRESETS] || bgInput;

  const fps = parseInt(opts.fps || "30", 10);
  const width = parseInt(opts.width || "1920", 10);
  const height = parseInt(opts.height || "1080", 10);
  const padding = parseInt(opts.padding || "48", 10);
  const borderRadius = parseInt(opts.radius || "12", 10);
  const cursorSize = parseFloat(opts["cursor-size"] || "1.0");
  const cursorEnabled = opts["no-cursor"] !== "true";

  const totalFrames = telemetry.totalFrames || Math.round((telemetry.durationMs / 1000) * fps);

  const outputPath =
    opts.output ||
    path.join("out", `cursorcast-${Date.now()}.mp4`);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  console.log("Bundling Remotion project...");
  const bundleLocation = await bundle({
    entryPoint: path.join(__dirname, "src", "index.ts"),
  });

  console.log("Selecting composition...");
  const inputProps = {
    videoSrc: videoFilename, // relative to public/
    cursorData: telemetry.cursor,
    zoomEvents: telemetry.zoomEvents,
    background,
    padding,
    borderRadius,
    cursorSize,
    cursorEnabled,
  };

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "ScreenRecording",
    inputProps,
  });

  // Override duration and dimensions
  composition.durationInFrames = totalFrames;
  composition.fps = fps;
  composition.width = width;
  composition.height = height;

  console.log(`Rendering ${totalFrames} frames at ${width}x${height} ${fps}fps...`);
  console.log(`Background: ${bgInput}`);
  console.log(`Output: ${outputPath}`);

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      process.stdout.write(`\rRendering: ${pct}%`);
    },
  });

  console.log(`\nDone! Output: ${outputPath}`);

  // Clean up copied video
  try {
    fs.unlinkSync(videoDest);
  } catch {}
}

main().catch((err) => {
  console.error("Render failed:", err);
  process.exit(1);
});
