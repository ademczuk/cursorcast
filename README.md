# CursorCast

> Chrome extension that records your tab with an emulated cursor and auto-zoom on clicks. MP4 output, YouTube-ready.

<p align="center">
  <img src="demo.gif" alt="CursorCast demo — recording a browser tab" width="720">
</p>

## Features

- **Tab capture recording** — records the active tab at native resolution (e.g. 3440x1440)
- **Emulated cursor** — arrow cursor rendered on the canvas with click-pulse ripple and glow
- **Auto-zoom on click clusters** — 2+ clicks within 3 seconds triggers smooth 2x zoom toward the click centroid
- **Spring physics** — cursor movement and zoom transitions use damped harmonic oscillators for natural motion
- **MP4 output** — records directly to H.264+AAC MP4 (Chrome 130+), YouTube-ready
- **Navigation-safe** — recording survives page navigation; content script is automatically re-injected
- **Persistent state** — timer and recording state survive popup close/reopen and service worker restarts

## Install

```bash
git clone https://github.com/ademczuk/cursorcast.git
```
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** and select the cloned `cursorcast/` folder
4. Pin the extension in the toolbar

## Usage

1. Navigate to the tab you want to record
2. Click the CursorCast icon in the toolbar
3. Adjust settings (zoom depth, cursor on/off, cursor size)
4. Click **Record**
5. Interact with the page — clicks trigger auto-zoom
6. Click the extension icon again and click **Stop**
7. Save the MP4 file

## Architecture

```
content.js (mouse tracker, injected into tab)
    │
    ▼
background.js (service worker, message relay)
    │
    ▼
offscreen.js (compositing engine + MediaRecorder)
    │
    ▼
.mp4 file
```

## Settings

| Setting | Range | Default | Description |
|---------|-------|---------|-------------|
| Zoom | 1.5x / 2x / 3x | 2x | Maximum zoom level on click clusters |
| Cursor | on/off | on | Show emulated cursor in recording |
| Size | 0.8 - 3.5 | 1.8 | Cursor size multiplier |

## Ported Code

Spring physics from [open-screenstudio](https://github.com/) and cursor rendering from CursorLens. Zoom engine written fresh for the extension.
