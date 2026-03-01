/**
 * Background service worker — orchestrates the recording lifecycle.
 *
 * Flow:
 * 1. Popup sends START_RECORDING → inject content script → create offscreen doc → get stream ID → forward to offscreen
 * 2. Content script sends MOUSE_MOVE/MOUSE_CLICK → relay to offscreen doc
 * 3. Popup sends STOP_RECORDING → tell offscreen to stop → receive blob URL → trigger download
 *
 * Navigation handling:
 * - Listens for tab updates (URL changes) and re-injects the content script
 * - The tab capture stream survives navigation (it captures the tab, not the page)
 */

let isRecording = false;
let activeTabId = null;
let recordingStartTime = 0;

// ── Telemetry Collection (for Remotion post-processing) ─────────────
// Cursor positions and clicks are recorded alongside the video so they
// can be fed into the Remotion pipeline for non-destructive compositing.

let telemetryBuffer = [];     // Array of { t, x, y, type: 'move'|'click' }
let telemetryFps = 30;        // Matches the offscreen render loop fps

// ── State Persistence (survives service worker restarts) ────────────────
// MV3 service workers can be killed at any time. We use chrome.storage.local
// to persist recording state. The popup reads directly from storage (no
// service worker round-trip needed for UI recovery).

async function persistState() {
  await chrome.storage.local.set({
    _isRecording: isRecording,
    _activeTabId: activeTabId,
    _recordingStartTime: recordingStartTime,
  });
}

async function restoreState() {
  const data = await chrome.storage.local.get([
    '_isRecording', '_activeTabId', '_recordingStartTime',
  ]);
  if (data._isRecording !== undefined) isRecording = data._isRecording;
  if (data._activeTabId !== undefined) activeTabId = data._activeTabId;
  if (data._recordingStartTime !== undefined) recordingStartTime = data._recordingStartTime;
}

// Restore on service worker wake-up
const stateReady = restoreState();

// ── Re-inject content script on navigation ─────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;

  // Must wait for state restoration — service worker may have just restarted
  stateReady.then(() => {
    if (!isRecording || tabId !== activeTabId) return;
    console.log('[background] Tab navigated, re-injecting content script');
    injectAndStartTracking(tabId);
  });
});

async function injectAndStartTracking(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch (e) {
    console.warn('[background] Content script injection failed:', e.message);
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'START_TRACKING' });
  } catch (e) {
    console.warn('[background] START_TRACKING message failed:', e.message);
  }
}

// ── Message Router ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Mouse events from content script → forward to offscreen + collect telemetry
  if (msg.type === 'MOUSE_MOVE' || msg.type === 'MOUSE_CLICK') {
    // Wait for state restoration in case service worker just restarted
    stateReady.then(() => {
      if (isRecording) {
        chrome.runtime.sendMessage({ ...msg, target: 'offscreen' }).catch(() => {});

        // Collect telemetry for Remotion post-processing
        telemetryBuffer.push({
          t: msg.t || Date.now(),
          x: msg.x,
          y: msg.y,
          type: msg.type === 'MOUSE_CLICK' ? 'click' : 'move',
        });
      }
    });
    return;
  }

  // Commands from popup
  if (msg.type === 'START_RECORDING') {
    handleStartRecording(msg).then(result => sendResponse(result)).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (msg.type === 'STOP_RECORDING') {
    handleStopRecording().then(result => sendResponse(result)).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  // Download request from offscreen document
  if (msg.type === 'DOWNLOAD_READY') {
    const ext = msg.ext || 'webm';
    const timestamp = Date.now();
    console.log('[background] Download ready, size:', msg.size, 'bytes, format:', ext);

    // Export telemetry JSON alongside the video
    exportTelemetry(timestamp);

    chrome.downloads.download({
      url: msg.url,
      filename: `cursorcast-${timestamp}.${ext}`,
      saveAs: true,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[background] Download failed:', chrome.runtime.lastError.message);
      } else {
        console.log('[background] Download started, id:', downloadId);
        // Now it's safe to close the offscreen doc — wait for download to finish
        // so the blob URL stays alive
        chrome.downloads.onChanged.addListener(function onDownloadChanged(delta) {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(onDownloadChanged);
            console.log('[background] Download finished, closing offscreen doc');
            chrome.offscreen.closeDocument().catch(() => {});
          }
        });
      }
    });
    return;
  }

  // Recording state query (popup now reads storage directly, but keep this for backward compat)
  if (msg.type === 'GET_STATE') {
    chrome.storage.local.get(['_isRecording', '_recordingStartTime'], (data) => {
      sendResponse({
        isRecording: data._isRecording || isRecording,
        recordingStartTime: data._recordingStartTime || recordingStartTime,
      });
    });
    return true; // async sendResponse
  }
});

// ── Recording Lifecycle ────────────────────────────────────────────────

// ── Telemetry Export ──────────────────────────────────────────────────
// Builds a Remotion-compatible telemetry JSON from the collected buffer
// and triggers a download alongside the video file.

function exportTelemetry(timestamp) {
  if (telemetryBuffer.length === 0) {
    console.log('[background] No telemetry to export');
    return;
  }

  const durationMs = telemetryBuffer.length > 0
    ? telemetryBuffer[telemetryBuffer.length - 1].t - telemetryBuffer[0].t
    : 0;
  const startT = telemetryBuffer[0].t;

  // Convert timestamps to frame numbers
  const cursor = telemetryBuffer.map((entry) => ({
    frame: Math.round(((entry.t - startT) / 1000) * telemetryFps),
    x: entry.x,
    y: entry.y,
    clicked: entry.type === 'click',
    t: entry.t,
  }));

  // Auto-detect zoom events from click clusters
  const zoomEvents = detectClickClusters(cursor, telemetryFps);

  const telemetry = {
    fps: telemetryFps,
    durationMs,
    totalFrames: Math.round((durationMs / 1000) * telemetryFps),
    cursor,
    zoomEvents,
  };

  const json = JSON.stringify(telemetry, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url,
    filename: `cursorcast-${timestamp}-telemetry.json`,
    saveAs: false, // auto-save alongside the video
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn('[background] Telemetry download failed:', chrome.runtime.lastError.message);
    } else {
      console.log('[background] Telemetry exported, entries:', cursor.length, 'zoom events:', zoomEvents.length);
      // Revoke blob URL after download starts
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  });
}

/**
 * Detect click clusters and generate zoom events.
 * 2+ clicks within CLUSTER_WINDOW_MS → zoom to centroid.
 */
function detectClickClusters(cursor, fps) {
  const CLUSTER_WINDOW_MS = 3000;
  const ZOOM_HOLD_FRAMES = Math.round(fps * 3); // Hold zoom for 3 seconds
  const ZOOM_SCALE = 2.0;

  const clicks = cursor.filter((c) => c.clicked);
  if (clicks.length < 2) return [];

  const events = [];
  let i = 0;

  while (i < clicks.length) {
    // Find all clicks within the window starting from clicks[i]
    const cluster = [clicks[i]];
    let j = i + 1;
    while (j < clicks.length && clicks[j].t - clicks[i].t < CLUSTER_WINDOW_MS) {
      cluster.push(clicks[j]);
      j++;
    }

    if (cluster.length >= 2) {
      // Compute centroid
      const focusX = cluster.reduce((sum, c) => sum + c.x, 0) / cluster.length;
      const focusY = cluster.reduce((sum, c) => sum + c.y, 0) / cluster.length;
      const startFrame = cluster[0].frame;
      const endFrame = cluster[cluster.length - 1].frame + ZOOM_HOLD_FRAMES;

      // Don't overlap with previous event
      const prev = events[events.length - 1];
      if (!prev || startFrame > prev.endFrame) {
        events.push({ startFrame, endFrame, focusX, focusY, scale: ZOOM_SCALE });
      }

      i = j; // Skip past this cluster
    } else {
      i++;
    }
  }

  return events;
}

async function handleStartRecording(msg) {
  if (isRecording) return { success: false, error: 'Already recording' };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { success: false, error: 'No active tab' };
  activeTabId = tab.id;

  // Inject content script and start tracking
  await injectAndStartTracking(activeTabId);

  // Create offscreen document for recording
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Tab capture for screen recording with cursor overlay',
    });
  }

  // Get tab capture stream ID
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: activeTabId,
  });

  // Forward stream ID to offscreen document with settings
  await chrome.runtime.sendMessage({
    type: 'START_CAPTURE',
    target: 'offscreen',
    streamId,
    settings: {
      zoomDepth: msg.zoomDepth || 2.0,
      cursorEnabled: msg.cursorEnabled !== false,
      cursorSize: msg.cursorSize || 1.8,
    },
  });

  isRecording = true;
  recordingStartTime = Date.now();
  telemetryBuffer = []; // Reset telemetry for new recording
  await persistState();
  return { success: true };
}

async function handleStopRecording() {
  if (!isRecording) return { success: false, error: 'Not recording' };

  if (activeTabId) {
    try {
      await chrome.tabs.sendMessage(activeTabId, { type: 'STOP_TRACKING' });
    } catch (e) {
      // Tab may have closed or navigated
    }
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'STOP_CAPTURE',
      target: 'offscreen',
    });
  } catch (e) {
    // Offscreen doc may already be gone
  }

  isRecording = false;
  activeTabId = null;
  recordingStartTime = 0;
  await persistState();

  // Offscreen doc will be closed by the DOWNLOAD_READY handler after download completes.
  // Fallback: close after 60s in case something goes wrong (e.g. user cancels save dialog)
  setTimeout(async () => {
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {
      // May already be closed
    }
  }, 60000);

  return { success: true };
}
