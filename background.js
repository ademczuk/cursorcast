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
  // Mouse events from content script → forward to offscreen
  if (msg.type === 'MOUSE_MOVE' || msg.type === 'MOUSE_CLICK') {
    // Wait for state restoration in case service worker just restarted
    stateReady.then(() => {
      if (isRecording) {
        chrome.runtime.sendMessage({ ...msg, target: 'offscreen' }).catch(() => {});
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
    console.log('[background] Download ready, size:', msg.size, 'bytes, format:', ext);
    chrome.downloads.download({
      url: msg.url,
      filename: `cursorcast-${Date.now()}.${ext}`,
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
