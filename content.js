/**
 * Content script — injected into the active tab to track mouse events.
 * Sends normalized (0-1) cursor positions and click events to the
 * background service worker at ~30fps.
 */

(() => {
  // Guard against double-injection
  if (window.__cursorCastTrackerInjected) return;
  window.__cursorCastTrackerInjected = true;

  let tracking = false;
  let rafPending = false;
  let latestX = 0;
  let latestY = 0;

  function sendMouseMove() {
    rafPending = false;
    if (!tracking) return;

    const normX = window.innerWidth > 0 ? latestX / window.innerWidth : 0.5;
    const normY = window.innerHeight > 0 ? latestY / window.innerHeight : 0.5;

    try {
      chrome.runtime.sendMessage({
        type: 'MOUSE_MOVE',
        x: Math.min(1, Math.max(0, normX)),
        y: Math.min(1, Math.max(0, normY)),
      });
    } catch (e) { /* Service worker not ready */ }
  }

  function onMouseMove(e) {
    if (!tracking) return;
    latestX = e.clientX;
    latestY = e.clientY;

    // Throttle to ~30fps using rAF
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(sendMouseMove);
    }
  }

  function onClick(e) {
    if (!tracking) return;

    const normX = window.innerWidth > 0 ? e.clientX / window.innerWidth : 0.5;
    const normY = window.innerHeight > 0 ? e.clientY / window.innerHeight : 0.5;

    try {
      chrome.runtime.sendMessage({
        type: 'MOUSE_CLICK',
        x: Math.min(1, Math.max(0, normX)),
        y: Math.min(1, Math.max(0, normY)),
        t: Date.now(),
      });
    } catch (e) { /* Service worker not ready */ }
  }

  // Listen for start/stop commands from the background worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START_TRACKING') {
      tracking = true;
      document.addEventListener('mousemove', onMouseMove, { passive: true });
      document.addEventListener('click', onClick, true);
    } else if (msg.type === 'STOP_TRACKING') {
      tracking = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('click', onClick, true);
    }
  });
})();
