/**
 * Popup UI logic — controls recording start/stop and settings.
 *
 * Recording state is persisted in chrome.storage.local so the popup
 * can recover the correct UI even if the service worker restarted.
 */

const recordBtn = document.getElementById('record-btn');
const btnLabel = document.getElementById('btn-label');
const timerEl = document.getElementById('timer');
const zoomDepthEl = document.getElementById('zoom-depth');
const cursorToggleEl = document.getElementById('cursor-toggle');
const cursorSizeEl = document.getElementById('cursor-size');

let isRecording = false;
let timerInterval = null;
let startTime = 0;

// Recover recording state directly from storage (no service worker round-trip)
chrome.storage.local.get(
  ['_isRecording', '_recordingStartTime', 'zoomDepth', 'cursorEnabled', 'cursorSize'],
  (data) => {
    // Restore recording UI
    if (data._isRecording) {
      setRecordingUI(true);
      startTime = data._recordingStartTime || Date.now();
      startTimer();
    }

    // Restore settings
    if (data.zoomDepth) zoomDepthEl.value = data.zoomDepth;
    if (data.cursorEnabled !== undefined) cursorToggleEl.checked = data.cursorEnabled;
    if (data.cursorSize) cursorSizeEl.value = data.cursorSize;
  }
);

// Save settings on change
zoomDepthEl.addEventListener('change', () => {
  chrome.storage.local.set({ zoomDepth: zoomDepthEl.value });
});
cursorToggleEl.addEventListener('change', () => {
  chrome.storage.local.set({ cursorEnabled: cursorToggleEl.checked });
});
cursorSizeEl.addEventListener('input', () => {
  chrome.storage.local.set({ cursorSize: cursorSizeEl.value });
});

recordBtn.addEventListener('click', async () => {
  if (isRecording) {
    // Stop recording
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
      if (response?.success) {
        setRecordingUI(false);
        stopTimer();
      }
    });
  } else {
    // Start recording
    const settings = {
      type: 'START_RECORDING',
      zoomDepth: parseFloat(zoomDepthEl.value),
      cursorEnabled: cursorToggleEl.checked,
      cursorSize: parseFloat(cursorSizeEl.value),
    };

    chrome.runtime.sendMessage(settings, (response) => {
      if (response?.success) {
        setRecordingUI(true);
        startTime = Date.now();
        startTimer();
      } else {
        btnLabel.textContent = response?.error || 'Error';
        setTimeout(() => { btnLabel.textContent = 'Record'; }, 2000);
      }
    });
  }
});

function setRecordingUI(active) {
  isRecording = active;
  if (active) {
    recordBtn.classList.add('recording');
    btnLabel.textContent = 'Stop';
    timerEl.style.display = 'block';
  } else {
    recordBtn.classList.remove('recording');
    btnLabel.textContent = 'Record';
    timerEl.style.display = 'none';
  }
}

function startTimer() {
  stopTimer();
  // Update immediately so user sees the time right away
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function updateTimerDisplay() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = `${mins}:${secs}`;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerEl.textContent = '00:00';
}
