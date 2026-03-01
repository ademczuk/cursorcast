/**
 * Offscreen recording engine — the core of the extension.
 *
 * Uses setInterval (not requestAnimationFrame, which is unreliable in offscreen docs)
 * for the compositing loop. Draws tab capture video + zoom transform + emulated cursor
 * onto a canvas, then records via MediaRecorder.
 */

import {
  createSpring2D,
  stepSpring2D,
  DEFAULT_SPRING_CONFIG,
} from './lib/spring.js';

import {
  drawCompositedCursor,
  buildCursorState,
  resolveClickPulse,
} from './lib/cursorRenderer.js';

import { createZoomEngine } from './lib/zoomEngine.js';

// ── State ──────────────────────────────────────────────────────────────

let recording = false;
let mediaRecorder = null;
let recordedChunks = [];
let renderIntervalId = null;
let capturedStream = null;

// Live cursor position (updated by content script messages)
let cursorX = 0.5;
let cursorY = 0.5;

// Click timestamps for cursor pulse animation
const clickTimes = [];
const MAX_CLICK_HISTORY = 50;

// Springs for smooth cursor rendering
let cursorSpring = createSpring2D(0.5, 0.5);

// Zoom engine
const zoomEngine = createZoomEngine();

// Timing
let recordingStartMs = 0;
let lastFrameTimeMs = 0;

// Settings
let settings = {
  zoomDepth: 2.0,
  cursorEnabled: true,
  cursorSize: 1.8,
};

// ── Message Handling ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Accept messages targeted to offscreen, OR mouse events relayed from background
  if (msg.target !== 'offscreen' && msg.type !== 'MOUSE_MOVE' && msg.type !== 'MOUSE_CLICK') return;

  switch (msg.type) {
    case 'MOUSE_MOVE':
      cursorX = msg.x;
      cursorY = msg.y;
      zoomEngine.onCursorMove(msg.x, msg.y);
      break;

    case 'MOUSE_CLICK':
      cursorX = msg.x;
      cursorY = msg.y;
      clickTimes.push(msg.t);
      if (clickTimes.length > MAX_CLICK_HISTORY) clickTimes.shift();
      zoomEngine.onClick(msg.x, msg.y, msg.t);
      break;

    case 'START_CAPTURE':
      if (msg.settings) settings = { ...settings, ...msg.settings };
      startCapture(msg.streamId).catch(err => {
        console.error('[offscreen] startCapture failed:', err);
      });
      break;

    case 'STOP_CAPTURE':
      stopCapture();
      break;
  }
});

console.log('[offscreen] Offscreen document loaded and listening');

// ── Compositing Frame ──────────────────────────────────────────────────

function renderFrame(video, canvas, ctx) {
  const now = performance.now();
  const dt = lastFrameTimeMs > 0
    ? Math.min((now - lastFrameTimeMs) / 1000, 0.05)
    : 1 / 30;
  lastFrameTimeMs = now;

  const currentTimeMs = Date.now();

  // Step cursor spring toward latest mouse position
  cursorSpring = stepSpring2D(
    cursorSpring,
    cursorX,
    cursorY,
    DEFAULT_SPRING_CONFIG,
    dt
  );

  // Step zoom engine (click-cluster detection + spring animation)
  const { scale, focusX, focusY } = zoomEngine.step(dt, currentTimeMs);

  // Compute source rect (the zoomed viewport within the video)
  const sourceRect = zoomEngine.computeSourceRect(
    canvas.width,
    canvas.height,
    scale,
    focusX,
    focusY
  );

  // Draw the zoomed video frame
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Only draw if video has valid dimensions
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    ctx.drawImage(
      video,
      sourceRect.srcX, sourceRect.srcY, sourceRect.srcW, sourceRect.srcH,
      0, 0, canvas.width, canvas.height
    );
  }

  // Draw emulated cursor
  if (settings.cursorEnabled) {
    const cursorPos = zoomEngine.cursorToCanvas(
      cursorSpring.x.position,
      cursorSpring.y.position,
      canvas.width,
      canvas.height,
      sourceRect
    );

    const clickPulse = resolveClickPulse(currentTimeMs, clickTimes);
    const cursorState = buildCursorState(clickPulse, {
      size: settings.cursorSize,
    });

    // Only draw if cursor is within the visible viewport (with margin)
    if (
      cursorPos.x >= -30 && cursorPos.x <= canvas.width + 30 &&
      cursorPos.y >= -30 && cursorPos.y <= canvas.height + 30
    ) {
      drawCompositedCursor(ctx, cursorPos, cursorState);
    }
  }
}

// ── Capture Lifecycle ──────────────────────────────────────────────────

async function startCapture(streamId) {
  if (recording) {
    console.warn('[offscreen] Already recording');
    return;
  }

  console.log('[offscreen] Starting capture with streamId:', streamId?.slice(0, 20) + '...');

  // Get the tab capture stream
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });
  } catch (err) {
    console.error('[offscreen] getUserMedia failed:', err);
    return;
  }

  capturedStream = stream;
  console.log('[offscreen] Got stream, video tracks:', stream.getVideoTracks().length, 'audio tracks:', stream.getAudioTracks().length);

  const video = document.getElementById('source-video');
  video.srcObject = stream;

  try {
    await video.play();
  } catch (err) {
    console.error('[offscreen] video.play() failed:', err);
    return;
  }

  // Wait for video dimensions — poll since loadedmetadata may have already fired
  let waitAttempts = 0;
  while (video.videoWidth === 0 && waitAttempts < 50) {
    await new Promise(r => setTimeout(r, 100));
    waitAttempts++;
  }

  if (video.videoWidth === 0 || video.videoHeight === 0) {
    console.error('[offscreen] Video has no dimensions after waiting');
    return;
  }

  console.log('[offscreen] Video dimensions:', video.videoWidth, 'x', video.videoHeight);

  const canvas = document.getElementById('composite-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  // Reset state
  cursorSpring = createSpring2D(0.5, 0.5);
  recordedChunks = [];
  recordingStartMs = Date.now();
  lastFrameTimeMs = 0;
  recording = true;

  // Draw at least one frame before starting capture stream
  renderFrame(video, canvas, ctx);

  // Use captureStream(0) — we manually request frames by drawing to canvas
  // The 0 means "only capture when the canvas changes" which is every render tick
  const outputStream = canvas.captureStream(30);

  // Mix in audio from the tab capture
  const audioTracks = stream.getAudioTracks();
  for (const track of audioTracks) {
    outputStream.addTrack(track);
  }

  console.log('[offscreen] Output stream tracks:', outputStream.getTracks().length);

  // Choose best available codec — prefer MP4 (YouTube-ready, VLC-native)
  let mimeType;
  if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')) {
    mimeType = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
  } else if (MediaRecorder.isTypeSupported('video/mp4')) {
    mimeType = 'video/mp4';
  } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9,opus')) {
    mimeType = 'video/webm; codecs=vp9,opus';
  } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8,opus')) {
    mimeType = 'video/webm; codecs=vp8,opus';
  } else {
    mimeType = 'video/webm';
  }
  const isMP4 = mimeType.startsWith('video/mp4');

  console.log('[offscreen] Using mimeType:', mimeType, isMP4 ? '(MP4)' : '(WebM)');

  mediaRecorder = new MediaRecorder(outputStream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
      console.log('[offscreen] Chunk received:', event.data.size, 'bytes, total chunks:', recordedChunks.length);
    }
  };

  mediaRecorder.onerror = (event) => {
    console.error('[offscreen] MediaRecorder error:', event.error);
  };

  mediaRecorder.onstop = async () => {
    console.log('[offscreen] MediaRecorder stopped, chunks:', recordedChunks.length);

    if (recordedChunks.length === 0) {
      console.error('[offscreen] No data recorded');
      return;
    }

    let blob = new Blob(recordedChunks, { type: mimeType });
    console.log('[offscreen] Raw blob size:', blob.size, 'bytes');

    // Fix WebM duration header (MP4 doesn't need this — it has correct headers)
    if (!isMP4) {
      const durationMs = Date.now() - recordingStartMs;
      try {
        blob = await fixWebmDuration(blob, durationMs);
        console.log('[offscreen] Duration patched:', durationMs, 'ms');
      } catch (err) {
        console.warn('[offscreen] Duration fix failed, using raw blob:', err.message);
      }
    }

    const url = URL.createObjectURL(blob);
    console.log('[offscreen] Blob URL:', url);

    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_READY',
      url,
      size: blob.size,
      ext: isMP4 ? 'mp4' : 'webm',
    });
  };

  // Start recording
  mediaRecorder.start(1000);
  console.log('[offscreen] MediaRecorder started, state:', mediaRecorder.state);

  // Start render loop using setInterval (requestAnimationFrame is unreliable in offscreen docs)
  const FRAME_INTERVAL_MS = 1000 / 30; // 30fps
  renderIntervalId = setInterval(() => {
    if (!recording) return;
    try {
      renderFrame(video, canvas, ctx);
    } catch (err) {
      console.error('[offscreen] Render frame error:', err);
    }
  }, FRAME_INTERVAL_MS);

  console.log('[offscreen] Render loop started at 30fps');
}

function stopCapture() {
  console.log('[offscreen] Stopping capture...');
  recording = false;

  if (renderIntervalId) {
    clearInterval(renderIntervalId);
    renderIntervalId = null;
  }

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  // Stop all tracks on the source stream
  if (capturedStream) {
    capturedStream.getTracks().forEach(track => track.stop());
    capturedStream = null;
  }

  const video = document.getElementById('source-video');
  if (video) {
    video.srcObject = null;
  }
}

// ── WebM Duration Fix ──────────────────────────────────────────────────
// MediaRecorder produces WebM files without a duration in the Segment/Info header.
// This patches the EBML to inject the duration so VLC/ffprobe/etc. can seek and show length.

async function fixWebmDuration(blob, durationMs) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Strategy 1: Find and patch existing Duration element (0x44 0x89)
  for (let i = 0; i < Math.min(bytes.length, 4096); i++) {
    if (bytes[i] === 0x44 && bytes[i + 1] === 0x89) {
      // Found Duration element. Next byte is EBML size, then the float value.
      if (bytes[i + 2] === 0x88) {
        // 0x88 = 8 bytes follow (float64)
        const dv = new DataView(buffer, i + 3, 8);
        const existing = dv.getFloat64(0);
        if (!existing || existing === 0 || isNaN(existing) || existing === Infinity) {
          dv.setFloat64(0, durationMs);
        }
        return new Blob([buffer], { type: blob.type });
      }
      if (bytes[i + 2] === 0x84) {
        // 0x84 = 4 bytes follow (float32)
        const dv = new DataView(buffer, i + 3, 4);
        const existing = dv.getFloat32(0);
        if (!existing || existing === 0 || isNaN(existing) || existing === Infinity) {
          dv.setFloat32(0, durationMs);
        }
        return new Blob([buffer], { type: blob.type });
      }
    }
  }

  // Strategy 2: Duration element not found. Inject it after the Segment Info header.
  // Find the Info element (EBML ID: 0x15 0x49 0xA9 0x66) and inject Duration inside it.
  // Duration element = [0x44, 0x89] (ID) + [0x88] (size=8) + float64(durationMs) = 11 bytes
  for (let i = 0; i < Math.min(bytes.length, 4096); i++) {
    if (bytes[i] === 0x15 && bytes[i + 1] === 0x49 &&
        bytes[i + 2] === 0xA9 && bytes[i + 3] === 0x66) {
      // Found Segment Info. The next bytes encode the element size (variable-length EBML int).
      // We need to find the end of the Info size field to know where Info content starts.
      const sizeStart = i + 4;
      const sizeByte = bytes[sizeStart];

      // Determine EBML VINT width (leading zeros count + 1)
      let vintWidth = 0;
      for (let bit = 7; bit >= 0; bit--) {
        if (sizeByte & (1 << bit)) { vintWidth = 8 - bit; break; }
      }
      if (vintWidth === 0) break; // Invalid VINT

      // Read the original Info element size
      let infoSize = sizeByte & ((1 << (8 - vintWidth)) - 1);
      for (let j = 1; j < vintWidth; j++) {
        infoSize = (infoSize << 8) | bytes[sizeStart + j];
      }

      // We'll inject 11 bytes (Duration element) at the start of Info content
      const insertOffset = sizeStart + vintWidth;
      const durationEl = new Uint8Array(11);
      durationEl[0] = 0x44; // Duration ID byte 1
      durationEl[1] = 0x89; // Duration ID byte 2
      durationEl[2] = 0x88; // Size = 8 bytes
      const dv = new DataView(durationEl.buffer, 3, 8);
      dv.setFloat64(0, durationMs);

      // Update the Info element size to include the new 11 bytes.
      // Re-encode with same VINT width (if it fits)
      const newInfoSize = infoSize + 11;
      const maxForWidth = (1 << (7 * vintWidth)) - 2; // Max value for this VINT width
      if (newInfoSize > maxForWidth) {
        // Size doesn't fit in same width — bail and return original
        console.warn('[offscreen] Cannot expand Info element size, returning original');
        return blob;
      }

      // Build new size VINT
      const newSizeBytes = new Uint8Array(vintWidth);
      let remaining = newInfoSize;
      for (let j = vintWidth - 1; j >= 0; j--) {
        newSizeBytes[j] = remaining & 0xFF;
        remaining >>= 8;
      }
      // Set the VINT marker bit
      newSizeBytes[0] |= (1 << (8 - vintWidth));

      // Also need to update the Segment element size (parent of Info).
      // Find it at the start: EBML header + Segment element.
      // The Segment element ID is 0x18 0x53 0x80 0x67.
      // Its size is often "unknown" (0x01FFFFFFFFFFFFFF) which means we don't need to patch it.
      // Chrome's MediaRecorder typically writes unknown Segment size, so this is safe.

      // Assemble: [before insert] + [duration element] + [after insert]
      // But we also need to patch the Info size bytes in-place
      const result = new Uint8Array(bytes.length + 11);
      result.set(bytes.subarray(0, sizeStart), 0);
      result.set(newSizeBytes, sizeStart);
      result.set(bytes.subarray(sizeStart + vintWidth, insertOffset), sizeStart + vintWidth);
      // Now insert the duration element
      result.set(durationEl, insertOffset);
      // Copy the rest of the original data
      result.set(bytes.subarray(insertOffset), insertOffset + 11);

      console.log('[offscreen] Injected Duration element at offset', insertOffset);
      return new Blob([result], { type: blob.type });
    }
  }

  // Neither strategy worked — return original blob
  console.warn('[offscreen] Could not find Info element, returning original blob');
  return blob;
}
