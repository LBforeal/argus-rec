const page = document.body.dataset.page;

let _currentFilename = null;
let _transcriptPoll = null;
let _overviewPoll = null;
let _actionsPoll = null;
let _expertPoll = null;

const ARGUS_PROFILE_STORAGE_KEY = 'argus_user_profile_v1';
const ARGUS_MODE_BASIC = 'basic';
const ARGUS_MODE_PRO = 'pro';
const ARGUS_ANALYSIS_MODE_BASIC = 'РћР±С‹С‡РЅС‹Р№ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ';
const ARGUS_ANALYSIS_MODE_DEFAULT = 'РЎР»РµРґРѕРІР°С‚РµР»СЊ РЎРљ';

async function _extractApiError(res, fallbackText) {
  try {
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return data?.detail || data?.error || fallbackText;
    }
    await res.text();
    return `${fallbackText} (HTTP ${res.status})`;
  } catch (_) {
    return fallbackText;
  }
}

if (page === 'index') {
  initIndex();
} else if (page === 'detail') {
  initDetail();
}

// в”Ђв”Ђ INDEX PAGE в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function initIndex() {
  document.getElementById('btn-record').addEventListener('click', _startRecording);
  document.getElementById('btn-stop-record').addEventListener('click', _stopRecording);
  document.getElementById('file-input').addEventListener('change', handleFileUpload);
  document.getElementById('file-list').addEventListener('click', _handleFileListClick);
  document.getElementById('file-list').addEventListener('keydown', _handleFileListClick);

  _initProfileSetupFlow();
  loadFileList();
}

function _getStoredProfile() {
  try {
    const raw = localStorage.getItem(ARGUS_PROFILE_STORAGE_KEY);
    if (!raw) return { mode: '', profession: '' };
    const parsed = JSON.parse(raw);
    const mode = parsed?.mode === ARGUS_MODE_BASIC || parsed?.mode === ARGUS_MODE_PRO
      ? parsed.mode
      : '';
    const profession = typeof parsed?.profession === 'string' ? parsed.profession.trim() : '';
    return { mode, profession };
  } catch (_) {
    return { mode: '', profession: '' };
  }
}

function _saveStoredProfile(profile) {
  try {
    localStorage.setItem(ARGUS_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch (_) {}
}

function _profileToAnalysisMode(profile) {
  if (!profile || !profile.mode) return ARGUS_ANALYSIS_MODE_DEFAULT;
  if (profile.mode === ARGUS_MODE_BASIC) return ARGUS_ANALYSIS_MODE_BASIC;
  if (profile.profession) return profile.profession;
  return ARGUS_ANALYSIS_MODE_DEFAULT;
}

function _analysisModeToProfile(mode) {
  const normalized = (mode || '').trim();
  if (!normalized || normalized === ARGUS_ANALYSIS_MODE_BASIC) {
    return { mode: ARGUS_MODE_BASIC, profession: '' };
  }
  return { mode: ARGUS_MODE_PRO, profession: normalized };
}

function _formatProfileSummary(profile) {
  if (!profile || !profile.mode) return 'РџСЂРѕС„РёР»СЊ РЅРµ РІС‹Р±СЂР°РЅ';
  if (profile.mode === ARGUS_MODE_BASIC) return 'РћР±С‹С‡РЅС‹Р№ СЂРµР¶РёРј';
  return profile.profession || ARGUS_ANALYSIS_MODE_DEFAULT;
}

function _applyProfileSummary() {
  const summary = document.getElementById('profile-summary');
  if (!summary) return;
  summary.textContent = _formatProfileSummary(_getStoredProfile());
}

function _initProfileSetupFlow() {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) {
    _applyProfileSummary();
    return;
  }

  const openButton = document.getElementById('btn-open-profile-setup');
  const cards = Array.from(overlay.querySelectorAll('[data-onboarding-step]'));
  const modeCards = Array.from(overlay.querySelectorAll('[data-mode-card]'));
  const professionCards = Array.from(overlay.querySelectorAll('.onboarding-profession-card'));
  const closeButtons = Array.from(overlay.querySelectorAll('[data-close-onboarding], #onboarding-close'));

  const startButton = document.getElementById('onboarding-start');
  const modeBackButton = document.getElementById('onboarding-mode-back');
  const modeNextButton = document.getElementById('onboarding-mode-next');
  const professionBackButton = document.getElementById('onboarding-profession-back');
  const finishButton = document.getElementById('onboarding-finish');

  let selectedMode = '';
  let selectedProfession = '';
  let activeStep = 'welcome';

  const syncButtons = () => {
    if (modeNextButton) modeNextButton.disabled = !selectedMode;
    if (finishButton) finishButton.disabled = selectedMode === ARGUS_MODE_PRO && !selectedProfession;
  };

  const syncModeUI = () => {
    modeCards.forEach((card) => {
      card.classList.toggle('is-selected', card.dataset.mode === selectedMode);
    });
    syncButtons();
  };

  const syncProfessionUI = () => {
    professionCards.forEach((card) => {
      card.classList.toggle('is-selected', card.dataset.profession === selectedProfession);
    });
    syncButtons();
  };

  const showStep = (step) => {
    activeStep = step;
    cards.forEach((card) => {
      card.classList.toggle('hidden', card.dataset.onboardingStep !== step);
    });
    syncButtons();
  };

  const openOverlay = (step) => {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-onboarding-open');
    showStep(step || activeStep);
  };

  const closeOverlay = () => {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-onboarding-open');
  };

  const loadFromStorage = () => {
    const saved = _getStoredProfile();
    selectedMode = saved.mode;
    selectedProfession = saved.profession;
    syncModeUI();
    syncProfessionUI();
  };

  const saveSelection = () => {
    const profile = selectedMode === ARGUS_MODE_PRO
      ? { mode: ARGUS_MODE_PRO, profession: selectedProfession || ARGUS_ANALYSIS_MODE_DEFAULT }
      : { mode: ARGUS_MODE_BASIC, profession: '' };
    _saveStoredProfile(profile);
    _applyProfileSummary();
  };

  modeCards.forEach((card) => {
    card.addEventListener('click', () => {
      selectedMode = card.dataset.mode || '';
      if (selectedMode === ARGUS_MODE_BASIC) selectedProfession = '';
      syncModeUI();
      syncProfessionUI();
    });
  });

  professionCards.forEach((card) => {
    card.addEventListener('click', () => {
      selectedProfession = card.dataset.profession || '';
      syncProfessionUI();
    });
  });

  if (startButton) startButton.addEventListener('click', () => showStep('mode'));
  if (modeBackButton) modeBackButton.addEventListener('click', () => showStep('welcome'));
  if (modeNextButton) {
    modeNextButton.addEventListener('click', () => {
      if (!selectedMode) return;
      if (selectedMode === ARGUS_MODE_BASIC) {
        saveSelection();
        closeOverlay();
        return;
      }
      showStep('profession');
    });
  }
  if (professionBackButton) professionBackButton.addEventListener('click', () => showStep('mode'));
  if (finishButton) {
    finishButton.addEventListener('click', () => {
      if (selectedMode === ARGUS_MODE_PRO && !selectedProfession) return;
      saveSelection();
      closeOverlay();
    });
  }

  closeButtons.forEach((button) => button.addEventListener('click', closeOverlay));
  overlay.addEventListener('click', (event) => {
    if (event.target && event.target.hasAttribute('data-close-onboarding')) closeOverlay();
  });

  if (openButton) {
    openButton.addEventListener('click', () => {
      loadFromStorage();
      if (selectedMode === ARGUS_MODE_PRO) showStep('profession');
      else showStep('mode');
      openOverlay(activeStep);
    });
  }

  _applyProfileSummary();
  loadFromStorage();
  const savedProfile = _getStoredProfile();
  if (!savedProfile.mode) openOverlay('welcome');
  else closeOverlay();
}

// в”Ђв”Ђ RECORDING в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

let _mediaRecorder = null;
let _recordedChunks = [];
let _recordingStream = null;
let _recordingTimer = null;
let _recordingStartTime = null;

async function _startRecording() {
  const status = document.getElementById('upload-status');
  status.hidden = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    status.hidden = false;
    status.className = 'upload-status error';
    status.textContent = 'Р—Р°РїРёСЃСЊ РЅРµРґРѕСЃС‚СѓРїРЅР° РІ СЌС‚РѕРј Р±СЂР°СѓР·РµСЂРµ. РћС‚РєСЂРѕР№С‚Рµ РЅР° localhost РёР»Рё РёСЃРїРѕР»СЊР·СѓР№С‚Рµ HTTPS.';
    return;
  }

  if (typeof MediaRecorder === 'undefined') {
    status.hidden = false;
    status.className = 'upload-status error';
    status.textContent = 'Р‘СЂР°СѓР·РµСЂ РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚ Р·Р°РїРёСЃСЊ С‡РµСЂРµР· MediaRecorder.';
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    status.hidden = false;
    status.className = 'upload-status error';
    if (err.name === 'NotAllowedError') {
      status.textContent = 'Р”РѕСЃС‚СѓРї Рє РјРёРєСЂРѕС„РѕРЅСѓ Р·Р°РїСЂРµС‰С‘РЅ. Р Р°Р·СЂРµС€РёС‚Рµ РґРѕСЃС‚СѓРї РІ РЅР°СЃС‚СЂРѕР№РєР°С… Р±СЂР°СѓР·РµСЂР°.';
    } else if (err.name === 'NotFoundError') {
      status.textContent = 'РњРёРєСЂРѕС„РѕРЅ РЅРµ РЅР°Р№РґРµРЅ. РџРѕРґРєР»СЋС‡РёС‚Рµ РјРёРєСЂРѕС„РѕРЅ Рё РїРѕРїСЂРѕР±СѓР№С‚Рµ СЃРЅРѕРІР°.';
    } else {
      status.textContent = `РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РґРѕСЃС‚СѓРї Рє РјРёРєСЂРѕС„РѕРЅСѓ: ${err.message}`;
    }
    return;
  }

  _recordingStream = stream;
  _recordedChunks = [];
  try {
    const preferredMimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ];
    let options = undefined;
    if (typeof MediaRecorder.isTypeSupported === 'function') {
      const selected = preferredMimeTypes.find(type => MediaRecorder.isTypeSupported(type));
      if (selected) options = { mimeType: selected };
    }
    _mediaRecorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
  } catch (err) {
    _releaseStream();
    status.hidden = false;
    status.className = 'upload-status error';
    status.textContent = `РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїСѓСЃС‚РёС‚СЊ Р·Р°РїРёСЃСЊ: ${err.message}`;
    return;
  }

  _mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) _recordedChunks.push(e.data);
  };

  _mediaRecorder.onstop = async () => {
    _stopTimer();
    _releaseStream();
    _setRecordingUi(false);

    const rawType = _mediaRecorder && _mediaRecorder.mimeType ? _mediaRecorder.mimeType : 'audio/webm';
    const blob = new Blob(_recordedChunks, { type: rawType });
    _recordedChunks = [];

    if (blob.size === 0) {
      status.hidden = false;
      status.className = 'upload-status error';
      status.textContent = 'Р—Р°РїРёСЃСЊ РїСѓСЃС‚Р°. РџРѕРїСЂРѕР±СѓР№С‚Рµ СЃРЅРѕРІР°.';
      return;
    }

    let wavBlob;
    try {
      wavBlob = await _convertRecordedBlobToWav(blob);
    } catch (err) {
      status.hidden = false;
      status.className = 'upload-status error';
      status.textContent = `РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ Р·Р°РїРёСЃСЊ: ${err.message}`;
      return;
    }

    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const fname = `record_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.wav`;

    const file = new File([wavBlob], fname, { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('file', file);

    status.hidden = false;
    status.className = 'upload-status';
    status.textContent = 'РЎРѕС…СЂР°РЅРµРЅРёРµ Р·Р°РїРёСЃРёвЂ¦';

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const msg = await _extractApiError(res, 'РћС€РёР±РєР° СЃРѕС…СЂР°РЅРµРЅРёСЏ');
        throw new Error(msg);
      }
      status.className = 'upload-status success';
      status.textContent = 'Р—Р°РїРёСЃСЊ СЃРѕС…СЂР°РЅРµРЅР°.';
      await loadFileList();
    } catch (err) {
      status.className = 'upload-status error';
      status.textContent = `РћС€РёР±РєР° СЃРѕС…СЂР°РЅРµРЅРёСЏ Р·Р°РїРёСЃРё: ${err.message}`;
    }
  };

  _mediaRecorder.onerror = () => {
    _stopTimer();
    _releaseStream();
    _setRecordingUi(false);
    status.hidden = false;
    status.className = 'upload-status error';
    status.textContent = 'РћС€РёР±РєР° Р·Р°РїРёСЃРё. РџРѕРїСЂРѕР±СѓР№С‚Рµ СЃРЅРѕРІР°.';
  };

  _mediaRecorder.start();
  _setRecordingUi(true);
  _startTimer();
}

function _stopRecording() {
  if (_mediaRecorder && _mediaRecorder.state === 'recording') {
    _mediaRecorder.stop();
  }
}

function _startTimer() {
  _recordingStartTime = Date.now();
  const el = document.getElementById('recording-timer');
  el.textContent = '00:00';
  _recordingTimer = setInterval(() => {
    const s = Math.floor((Date.now() - _recordingStartTime) / 1000);
    el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 500);
}

function _stopTimer() {
  if (_recordingTimer) {
    clearInterval(_recordingTimer);
    _recordingTimer = null;
  }
}

function _releaseStream() {
  if (_recordingStream) {
    _recordingStream.getTracks().forEach(t => t.stop());
    _recordingStream = null;
  }
}

function _setRecordingUi(isRecording) {
  const actionBar = document.querySelector('.action-bar');
  const panel = document.getElementById('recording-panel');
  const body = document.body;
  if (actionBar) actionBar.hidden = isRecording;
  if (panel) panel.hidden = !isRecording;
  if (body) body.classList.toggle('is-recording', isRecording);
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const status = document.getElementById('upload-status');
  status.hidden = false;
  status.className = 'upload-status';
  status.textContent = `Р—Р°РіСЂСѓР·РєР° С„Р°Р№Р»Р° "${file.name}"...`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      const msg = await _extractApiError(res, 'РќРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°');
      throw new Error(msg);
    }
    status.className = 'upload-status success';
    status.textContent = 'Р¤Р°Р№Р» СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅ.';
    await loadFileList();
  } catch (err) {
    status.className = 'upload-status error';
    status.textContent = `РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё: ${err.message}`;
  }

  // РЎР±СЂРѕСЃ, С‡С‚РѕР±С‹ РјРѕР¶РЅРѕ Р±С‹Р»Рѕ Р·Р°РіСЂСѓР·РёС‚СЊ С‚РѕС‚ Р¶Рµ С„Р°Р№Р» РїРѕРІС‚РѕСЂРЅРѕ
  event.target.value = '';
}

async function loadFileList() {
  const container = document.getElementById('file-list');
  try {
    const res = await fetch('/api/recordings');
    if (!res.ok) throw new Error('РћС€РёР±РєР° СЃРµСЂРІРµСЂР°');
    const files = await res.json();

    if (files.length === 0) {
      container.innerHTML = '<div class="empty-state">РќРµС‚ Р·Р°РїРёСЃРµР№. Р—Р°РіСЂСѓР·РёС‚Рµ РїРµСЂРІС‹Р№ С„Р°Р№Р».</div>';
      return;
    }

    container.innerHTML = files.map(f => {
      const encoded = encodeURIComponent(f.filename);
      return `
        <article class="file-item" data-open-file="${encoded}" role="link" tabindex="0">
          <div class="file-main" data-open-file="${encoded}">
            <div class="file-name">${escapeHtml(f.filename)}</div>
            <div class="file-meta">${formatSize(f.size)} В· ${formatDate(f.modified)}</div>
          </div>
          <button class="file-delete-btn" type="button" data-delete-file="${encoded}" aria-label="РЈРґР°Р»РёС‚СЊ Р·Р°РїРёСЃСЊ ${escapeHtml(f.filename)}">
            РЈРґР°Р»РёС‚СЊ
          </button>
        </article>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state error-text">РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЃРїРёСЃРѕРє С„Р°Р№Р»РѕРІ: ${escapeHtml(err.message || err)}</div>`;
  }
}

function _handleFileListClick(event) {
  const isKeyboardAction = event.type === 'keydown';
  if (isKeyboardAction && event.key !== 'Enter' && event.key !== ' ') return;

  const deleteButton = event.target.closest('[data-delete-file]');
  if (deleteButton) {
    if (isKeyboardAction) event.preventDefault();
    const encoded = deleteButton.dataset.deleteFile;
    const filename = _decodeFilenameFromAttr(encoded);
    if (!filename) return;
    _deleteRecording(filename);
    return;
  }

  const openNode = event.target.closest('[data-open-file]');
  if (openNode) {
    if (isKeyboardAction) event.preventDefault();
    const encoded = openNode.dataset.openFile;
    const filename = _decodeFilenameFromAttr(encoded);
    if (!filename) return;
    _openRecordingDetail(filename);
  }
}

function _decodeFilenameFromAttr(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function _openRecordingDetail(filename) {
  window.location.href = `/detail.html?file=${encodeURIComponent(filename)}`;
}

async function _deleteRecording(filename) {
  const status = document.getElementById('upload-status');
  const ok = window.confirm(`РЈРґР°Р»РёС‚СЊ Р·Р°РїРёСЃСЊ "${filename}"?\nР­С‚Рѕ РґРµР№СЃС‚РІРёРµ РЅРµР»СЊР·СЏ РѕС‚РјРµРЅРёС‚СЊ.`);
  if (!ok) return;

  status.hidden = false;
  status.className = 'upload-status';
  status.textContent = 'РЈРґР°Р»РµРЅРёРµ Р·Р°РїРёСЃРёвЂ¦';

  try {
    const res = await fetch(`/api/recordings/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (!res.ok) {
      let message = `РћС€РёР±РєР° СѓРґР°Р»РµРЅРёСЏ (HTTP ${res.status})`;
      try {
        const data = await res.json();
        if (data && data.detail) message = data.detail;
      } catch {}
      throw new Error(message);
    }

    status.className = 'upload-status success';
    status.textContent = 'Р—Р°РїРёСЃСЊ СѓРґР°Р»РµРЅР°.';
    await loadFileList();
  } catch (err) {
    status.className = 'upload-status error';
    status.textContent = `РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ Р·Р°РїРёСЃСЊ: ${err.message || err}`;
  }
}

// в”Ђв”Ђ DETAIL PAGE в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function initDetail() {
  const params = new URLSearchParams(window.location.search);
  const rawFilename = params.get('file');
  const filename = _decodeFilenameFromAttr(rawFilename) || (rawFilename || '').trim();

  if (!filename) {
    document.getElementById('file-title').textContent = 'Р¤Р°Р№Р» РЅРµ РЅР°Р№РґРµРЅ';
    return;
  }

  _currentFilename = filename;
  document.getElementById('file-title').textContent = filename;
  const detailMeta = document.getElementById('detail-meta');
  if (detailMeta) detailMeta.textContent = `Р¤Р°Р№Р»: ${filename}`;
  document.title = `${filename} вЂ” РђСЂРіСѓСЃ`;

  document.getElementById('audio-player').src =
    `/api/recordings/${encodeURIComponent(filename)}`;

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab !== 'transcript') _clearTranscriptPoll();
      if (tab.dataset.tab !== 'overview') _clearOverviewPoll();
      if (tab.dataset.tab !== 'actions') _clearActionsPoll();
      if (tab.dataset.tab !== 'expert') _clearExpertPoll();

      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');

      if (tab.dataset.tab === 'transcript') _loadTranscriptState(filename);
      if (tab.dataset.tab === 'overview') _loadOverviewState(filename);
      if (tab.dataset.tab === 'actions') _loadActionsState(filename);
      if (tab.dataset.tab === 'expert') _loadExpertState(filename);
    });
  });

  _initAnalysisModeSelector();
  _applyStoredAnalysisModeToDetail();
  _initDocumentGenerator(filename);

  // РћР±Р·РѕСЂ вЂ” Р°РєС‚РёРІРЅС‹Р№ С‚Р°Р± РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ, Р·Р°РіСЂСѓР¶Р°РµРј СЃСЂР°Р·Сѓ
  _loadOverviewState(filename);

  window.addEventListener('beforeunload', () => {
    _clearTranscriptPoll();
    _clearOverviewPoll();
    _clearActionsPoll();
    _clearExpertPoll();
  });
}

function _initAnalysisModeSelector() {
  const dropdown = document.getElementById('analysis-mode-dropdown');
  const trigger = document.getElementById('analysis-mode-trigger');
  const menu = document.getElementById('analysis-mode-menu');
  const value = document.getElementById('analysis-mode-value');
  if (!dropdown || !trigger || !menu || !value) return;

  const close = () => {
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    dropdown.classList.remove('is-open');
  };

  const open = () => {
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    dropdown.classList.add('is-open');
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden')) open();
    else close();
  });

  menu.querySelectorAll('.detail-mode-option').forEach((option) => {
    option.addEventListener('click', () => {
      const mode = option.dataset.mode || option.textContent || '';
      _setAnalysisMode(mode.trim());
      _persistSelectedAnalysisMode(mode.trim());
      close();
    });
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function _getSelectedAnalysisMode() {
  const value = document.getElementById('analysis-mode-value');
  const mode = (value?.textContent || '').trim();
  return mode || _profileToAnalysisMode(_getStoredProfile()) || ARGUS_ANALYSIS_MODE_DEFAULT;
}

function _setAnalysisMode(mode) {
  const menu = document.getElementById('analysis-mode-menu');
  const value = document.getElementById('analysis-mode-value');
  if (!menu || !value) return;

  const normalized = (mode || '').trim();
  if (!normalized) return;

  value.textContent = normalized;
  menu.querySelectorAll('.detail-mode-option').forEach((el) => {
    el.classList.toggle('is-active', (el.dataset.mode || '').trim() === normalized);
  });
}

function _persistSelectedAnalysisMode(mode) {
  _saveStoredProfile(_analysisModeToProfile(mode));
}

function _applyStoredAnalysisModeToDetail() {
  const modeFromProfile = _profileToAnalysisMode(_getStoredProfile());
  _setAnalysisMode(modeFromProfile);
}

function _initDocumentGenerator(filename) {
  const button = document.getElementById('btn-generate-document');
  if (!button) return;
  button.addEventListener('click', () => _generateDocument(filename, button));
}

function _setDocumentStatus(message, isError = false) {
  const status = document.getElementById('detail-doc-status');
  if (!status) return;
  status.hidden = false;
  status.classList.remove('detail-doc-status-error');
  if (isError) status.classList.add('detail-doc-status-error');
  status.textContent = message;
}

async function _generateDocument(filename, button) {
  const baseLabel = 'РЎС„РѕСЂРјРёСЂРѕРІР°С‚СЊ РґРѕРєСѓРјРµРЅС‚';
  button.disabled = true;
  button.textContent = 'Р¤РѕСЂРјРёСЂСѓРµРј...';
  _setDocumentStatus('РЎР±РѕСЂ С‡РµСЂРЅРѕРІРёРєР° РґРѕРєСѓРјРµРЅС‚Р° РёР· Р·Р°РїРёСЃРё...');

  try {
    const res = await fetch(`/api/document/${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) {
      const message = await _extractApiError(res, 'РћС€РёР±РєР° С„РѕСЂРјРёСЂРѕРІР°РЅРёСЏ РґРѕРєСѓРјРµРЅС‚Р°');
      throw new Error(message);
    }

    const data = await res.json();
    if (data.status === 'no_transcript') {
      _setDocumentStatus('Р”РѕРєСѓРјРµРЅС‚ РЅРµРґРѕСЃС‚СѓРїРµРЅ: СЃРЅР°С‡Р°Р»Р° Р·Р°РїСѓСЃС‚РёС‚Рµ Рё РґРѕР¶РґРёС‚РµСЃСЊ РіРѕС‚РѕРІРѕРіРѕ С‚СЂР°РЅСЃРєСЂРёРїС‚Р°.', true);
      return;
    }
    if (data.status !== 'done') {
      _setDocumentStatus(`РќРµ СѓРґР°Р»РѕСЃСЊ СЃС„РѕСЂРјРёСЂРѕРІР°С‚СЊ РґРѕРєСѓРјРµРЅС‚: ${data.error || 'РЅРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°'}`, true);
      return;
    }

    const text = data?.document?.text || '';
    if (!text.trim()) {
      _setDocumentStatus('Р”РѕРєСѓРјРµРЅС‚ СЃС„РѕСЂРјРёСЂРѕРІР°РЅ Р±РµР· СЃРѕРґРµСЂР¶РёРјРѕРіРѕ. РџСЂРѕРІРµСЂСЊС‚Рµ РЅР°Р»РёС‡РёРµ РґР°РЅРЅС‹С… РІ Р·Р°РїРёСЃРё.', true);
      return;
    }

    const safeName = String(filename).replace(/[\\/:*?"<>|]+/g, '_');
    _downloadTextFile(`${safeName}.osmotr.chernovik.txt`, text);
    _setDocumentStatus('Р§РµСЂРЅРѕРІРёРє РґРѕРєСѓРјРµРЅС‚Р° СЃС„РѕСЂРјРёСЂРѕРІР°РЅ Рё СЃРєР°С‡Р°РЅ.');
  } catch (err) {
    _setDocumentStatus(`РќРµ СѓРґР°Р»РѕСЃСЊ СЃС„РѕСЂРјРёСЂРѕРІР°С‚СЊ РґРѕРєСѓРјРµРЅС‚: ${err.message || err}`, true);
  } finally {
    button.disabled = false;
    button.textContent = baseLabel;
  }
}

function _downloadTextFile(fileName, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// в”Ђв”Ђ TRANSCRIPT TAB в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

async function _loadTranscriptState(filename) {
  const container = document.getElementById('transcript-state');
  try {
    const res = await fetch(`/api/transcript/${encodeURIComponent(filename)}`);
    if (!res.ok) {
      const message = await _extractApiError(res, 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°');
      throw new Error(message);
    }
    const data = await res.json();
    _renderTranscriptState(data, filename, container);
  } catch (e) {
    _clearTranscriptPoll();
    container.innerHTML = `<div class="empty-state error-text">РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЃС‚Р°С‚СѓСЃ С‚СЂР°РЅСЃРєСЂРёРїС‚Р°: ${escapeHtml(e.message || e)}</div>`;
  }
}

function _renderTranscriptState(data, filename, container) {
  _clearTranscriptPoll();

  if (data.status === 'idle') {
    container.innerHTML = `
      <div class="empty-state">РўСЂР°РЅСЃРєСЂРёРїС‚ РµС‰С‘ РЅРµ Р·Р°РїСѓС‰РµРЅ.</div>
      <div class="transcript-actions">
        <button class="btn btn-primary" id="btn-start-transcript">РќР°С‡Р°С‚СЊ СЂР°СЃС€РёС„СЂРѕРІРєСѓ</button>
      </div>
    `;
    document.getElementById('btn-start-transcript')
      .addEventListener('click', () => _startTranscription(filename));

  } else if (data.status === 'running') {
    container.innerHTML = '<div class="empty-state">РРґС‘С‚ СЂР°СЃС€РёС„СЂРѕРІРєР°вЂ¦</div>';
    _transcriptPoll = setInterval(() => _loadTranscriptState(filename), 3000);

  } else if (data.status === 'done') {
    if (!data.text || !data.text.trim()) {
      container.innerHTML = '<div class="empty-state">РўСЂР°РЅСЃРєСЂРёРїС‚ РїСѓСЃС‚.</div>';
    } else {
      container.innerHTML = `<div class="transcript-text">${escapeHtml(data.text)}</div>`;
    }

  } else if (data.status === 'error') {
    container.innerHTML = `
      <div class="empty-state error-text">РћС€РёР±РєР° СЂР°СЃС€РёС„СЂРѕРІРєРё: ${escapeHtml(data.error || 'РЅРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°')}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-transcript">РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°</button>
      </div>
    `;
    document.getElementById('btn-retry-transcript')
      .addEventListener('click', () => _startTranscription(filename));

  } else {
    container.innerHTML = `<div class="empty-state error-text">РќРµРѕР¶РёРґР°РЅРЅС‹Р№ СЃС‚Р°С‚СѓСЃ РѕС‚ СЃРµСЂРІРµСЂР°: ${escapeHtml(data.status)}</div>`;
  }
}

async function _startTranscription(filename) {
  const container = document.getElementById('transcript-state');
  container.innerHTML = '<div class="empty-state">РРґС‘С‚ СЂР°СЃС€РёС„СЂРѕРІРєР°вЂ¦</div>';

  try {
    const res = await fetch(`/api/transcribe/${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) {
      const message = await _extractApiError(res, 'РћС€РёР±РєР° Р·Р°РїСѓСЃРєР°');
      throw new Error(message);
    }
    _transcriptPoll = setInterval(() => _loadTranscriptState(filename), 3000);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state error-text">РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїСѓСЃС‚РёС‚СЊ СЂР°СЃС€РёС„СЂРѕРІРєСѓ: ${escapeHtml(err.message || err)}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-transcript">РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°</button>
      </div>
    `;
    document.getElementById('btn-retry-transcript')
      .addEventListener('click', () => _startTranscription(filename));
  }
}

function _clearTranscriptPoll() {
  if (_transcriptPoll) {
    clearInterval(_transcriptPoll);
    _transcriptPoll = null;
  }
}

// в”Ђв”Ђ OVERVIEW TAB в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

async function _loadOverviewState(filename) {
  const container = document.getElementById('overview-state');
  try {
    const res = await fetch(`/api/overview/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('РћС€РёР±РєР° СЃРµСЂРІРµСЂР°');
    const data = await res.json();
    _renderOverviewState(data, filename, container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state error-text">РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЃС‚Р°С‚СѓСЃ РѕР±Р·РѕСЂР°: ${escapeHtml(e.message || e)}</div>`;
  }
}

function _renderOverviewState(data, filename, container) {
  _clearOverviewPoll();

  if (data.status === 'no_transcript') {
    container.innerHTML = '<div class="empty-state">РћР±Р·РѕСЂ РЅРµРґРѕСЃС‚СѓРїРµРЅ: РЅРµС‚ РіРѕС‚РѕРІРѕРіРѕ С‚СЂР°РЅСЃРєСЂРёРїС‚Р°.</div>';

  } else if (data.status === 'idle') {
    container.innerHTML = `
      <div class="empty-state">РћР±Р·РѕСЂ РµС‰С‘ РЅРµ Р·Р°РїСѓС‰РµРЅ.</div>
      <div class="transcript-actions">
        <button class="btn btn-primary" id="btn-start-overview">РџРѕСЃС‚СЂРѕРёС‚СЊ РѕР±Р·РѕСЂ</button>
      </div>
    `;
    document.getElementById('btn-start-overview')
      .addEventListener('click', () => _startOverview(filename));

  } else if (data.status === 'running') {
    container.innerHTML = '<div class="empty-state">РРґС‘С‚ РїРѕСЃС‚СЂРѕРµРЅРёРµ РѕР±Р·РѕСЂР°вЂ¦</div>';
    _overviewPoll = setInterval(() => _loadOverviewState(filename), 2000);

  } else if (data.status === 'done') {
    if (!data.text || !data.text.trim()) {
      container.innerHTML = '<div class="empty-state">РћР±Р·РѕСЂ РїСѓСЃС‚.</div>';
    } else {
      container.innerHTML = `<div class="transcript-text">${escapeHtml(data.text)}</div>`;
    }

  } else if (data.status === 'error') {
    container.innerHTML = `
      <div class="empty-state error-text">РћС€РёР±РєР° РїРѕСЃС‚СЂРѕРµРЅРёСЏ РѕР±Р·РѕСЂР°: ${escapeHtml(data.error || 'РЅРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°')}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-overview">РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°</button>
      </div>
    `;
    document.getElementById('btn-retry-overview')
      .addEventListener('click', () => _startOverview(filename));

  } else {
    container.innerHTML = `<div class="empty-state error-text">РќРµРѕР¶РёРґР°РЅРЅС‹Р№ СЃС‚Р°С‚СѓСЃ РѕС‚ СЃРµСЂРІРµСЂР°: ${escapeHtml(data.status)}</div>`;
  }
}

async function _startOverview(filename) {
  const container = document.getElementById('overview-state');
  container.innerHTML = '<div class="empty-state">РРґС‘С‚ РїРѕСЃС‚СЂРѕРµРЅРёРµ РѕР±Р·РѕСЂР°вЂ¦</div>';

  try {
    const res = await fetch(`/api/overview/${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) throw new Error(`РћС€РёР±РєР° Р·Р°РїСѓСЃРєР° (HTTP ${res.status})`);
    const data = await res.json();
    if (data.status === 'no_transcript') {
      container.innerHTML = '<div class="empty-state">РћР±Р·РѕСЂ РЅРµРґРѕСЃС‚СѓРїРµРЅ: РЅРµС‚ РіРѕС‚РѕРІРѕРіРѕ С‚СЂР°РЅСЃРєСЂРёРїС‚Р°.</div>';
      return;
    }
    if (data.status === 'error') {
      container.innerHTML = `
        <div class="empty-state error-text">РћС€РёР±РєР° РїРѕСЃС‚СЂРѕРµРЅРёСЏ РѕР±Р·РѕСЂР°: ${escapeHtml(data.error || 'РЅРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°')}</div>
        <div class="transcript-actions">
          <button class="btn btn-secondary" id="btn-retry-overview">РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°</button>
        </div>
      `;
      document.getElementById('btn-retry-overview')
        .addEventListener('click', () => _startOverview(filename));
      return;
    }
    _overviewPoll = setInterval(() => _loadOverviewState(filename), 2000);
  } catch (e) {
    container.innerHTML = `
      <div class="empty-state error-text">РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїСѓСЃС‚РёС‚СЊ РїРѕСЃС‚СЂРѕРµРЅРёРµ РѕР±Р·РѕСЂР°: ${escapeHtml(e.message || e)}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-overview">РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°</button>
      </div>
    `;
    document.getElementById('btn-retry-overview')
      .addEventListener('click', () => _startOverview(filename));
  }
}

function _clearOverviewPoll() {
  if (_overviewPoll) {
    clearInterval(_overviewPoll);
    _overviewPoll = null;
  }
}

// в”Ђв”Ђ ACTIONS TAB в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

async function _loadActionsState(filename) {
  const container = document.getElementById('actions-state');
  try {
    const res = await fetch(`/api/actions/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('РћС€РёР±РєР° СЃРµСЂРІРµСЂР°');
    const data = await res.json();
    _renderActionsState(data, filename, container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state error-text">РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЃС‚Р°С‚СѓСЃ РґРµР№СЃС‚РІРёР№: ${escapeHtml(e.message || e)}</div>`;
  }
}

function _renderActionsState(data, filename, container) {
  _clearActionsPoll();

  if (data.status === 'no_transcript') {
    container.innerHTML = '<div class="empty-state">Р”РµР№СЃС‚РІРёСЏ РЅРµРґРѕСЃС‚СѓРїРЅС‹: РЅРµС‚ РіРѕС‚РѕРІРѕРіРѕ С‚СЂР°РЅСЃРєСЂРёРїС‚Р°.</div>';

  } else if (data.status === 'idle') {
    container.innerHTML = `
      <div class="empty-state">Р”РµР№СЃС‚РІРёСЏ РµС‰С‘ РЅРµ Р·Р°РїСѓС‰РµРЅС‹.</div>
      <div class="transcript-actions">
        <button class="btn btn-primary" id="btn-start-actions">РќР°Р№С‚Рё РґРµР№СЃС‚РІРёСЏ</button>
      </div>
    `;
    document.getElementById('btn-start-actions')
      .addEventListener('click', () => _startActions(filename));

  } else if (data.status === 'running') {
    container.innerHTML = '<div class="empty-state">РРґС‘С‚ РїРѕСЃС‚СЂРѕРµРЅРёРµ РґРµР№СЃС‚РІРёР№вЂ¦</div>';
    _actionsPoll = setInterval(() => _loadActionsState(filename), 2000);

  } else if (data.status === 'done') {
    if (!data.items || data.items.length === 0) {
      container.innerHTML = '<div class="empty-state">Р’ С‚СЂР°РЅСЃРєСЂРёРїС‚Рµ РЅРµ РЅР°Р№РґРµРЅРѕ РґРµР№СЃС‚РІРёР№ РёР»Рё Р·Р°РґР°С‡.</div>';
    } else {
      const list = data.items.map(item => `<li style="margin-bottom:8px">${escapeHtml(item)}</li>`).join('');
      container.innerHTML = `<div class="transcript-text"><ol style="padding-left:20px;margin:0">${list}</ol></div>`;
    }

  } else if (data.status === 'error') {
    container.innerHTML = `
      <div class="empty-state error-text">РћС€РёР±РєР° РїРѕРёСЃРєР° РґРµР№СЃС‚РІРёР№: ${escapeHtml(data.error || 'РЅРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°')}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-actions">РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°</button>
      </div>
    `;
    document.getElementById('btn-retry-actions')
      .addEventListener('click', () => _startActions(filename));

  } else {
    container.innerHTML = `<div class="empty-state error-text">РќРµРѕР¶РёРґР°РЅРЅС‹Р№ СЃС‚Р°С‚СѓСЃ РѕС‚ СЃРµСЂРІРµСЂР°: ${escapeHtml(data.status)}</div>`;
  }
}

async function _startActions(filename) {
  const container = document.getElementById('actions-state');
  container.innerHTML = '<div class="empty-state">РРґС‘С‚ РїРѕСЃС‚СЂРѕРµРЅРёРµ РґРµР№СЃС‚РІРёР№вЂ¦</div>';

  try {
    const res = await fetch(`/api/actions/${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) throw new Error(`РћС€РёР±РєР° Р·Р°РїСѓСЃРєР° (HTTP ${res.status})`);
    const data = await res.json();
    if (data.status === 'no_transcript') {
      container.innerHTML = '<div class="empty-state">Р”РµР№СЃС‚РІРёСЏ РЅРµРґРѕСЃС‚СѓРїРЅС‹: РЅРµС‚ РіРѕС‚РѕРІРѕРіРѕ С‚СЂР°РЅСЃРєСЂРёРїС‚Р°.</div>';
      return;
    }
    if (data.status === 'error') {
      container.innerHTML = `
        <div class="empty-state error-text">РћС€РёР±РєР° РїРѕРёСЃРєР° РґРµР№СЃС‚РІРёР№: ${escapeHtml(data.error || 'РЅРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°')}</div>
        <div class="transcript-actions">
          <button class="btn btn-secondary" id="btn-retry-actions">РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°</button>
        </div>
      `;
      document.getElementById('btn-retry-actions')
        .addEventListener('click', () => _startActions(filename));
      return;
    }
    _actionsPoll = setInterval(() => _loadActionsState(filename), 2000);
  } catch (e) {
    container.innerHTML = `
      <div class="empty-state error-text">РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїСѓСЃС‚РёС‚СЊ РїРѕРёСЃРє РґРµР№СЃС‚РІРёР№: ${escapeHtml(e.message || e)}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-actions">РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°</button>
      </div>
    `;
    document.getElementById('btn-retry-actions')
      .addEventListener('click', () => _startActions(filename));
  }
}

function _clearActionsPoll() {
  if (_actionsPoll) {
    clearInterval(_actionsPoll);
    _actionsPoll = null;
  }
}

// в”Ђв”Ђ EXPERT TAB в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

async function _loadExpertState(filename) {
  const container = document.getElementById('expert-state');
  try {
    const res = await fetch(`/api/expert/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('РћС€РёР±РєР° СЃРµСЂРІРµСЂР°');
    const data = await res.json();
    _renderExpertState(data, filename, container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state error-text">РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЃС‚Р°С‚СѓСЃ СЌРєСЃРїРµСЂС‚РЅРѕРіРѕ Р°РЅР°Р»РёР·Р°: ${escapeHtml(e.message || e)}</div>`;
  }
}

function _renderExpertState(data, filename, container) {
  _clearExpertPoll();

  if (data.status === 'no_transcript') {
    container.innerHTML = '<div class="empty-state">Р­РєСЃРїРµСЂС‚РЅС‹Р№ Р°РЅР°Р»РёР· РЅРµРґРѕСЃС‚СѓРїРµРЅ: РЅРµС‚ РіРѕС‚РѕРІРѕРіРѕ С‚СЂР°РЅСЃРєСЂРёРїС‚Р°.</div>';

  } else if (data.status === 'idle') {
    container.innerHTML = `
      <div class="empty-state">Р­РєСЃРїРµСЂС‚РЅС‹Р№ Р°РЅР°Р»РёР· РµС‰С‘ РЅРµ Р·Р°РїСѓС‰РµРЅ.</div>
      <div class="transcript-actions">
        <button class="btn btn-primary" id="btn-start-expert">Р—Р°РїСѓСЃС‚РёС‚СЊ Р°РЅР°Р»РёР·</button>
      </div>
    `;
    document.getElementById('btn-start-expert')
      .addEventListener('click', () => _startExpert(filename));

  } else if (data.status === 'running') {
    container.innerHTML = '<div class="empty-state">РРґС‘С‚ СЌРєСЃРїРµСЂС‚РЅС‹Р№ Р°РЅР°Р»РёР·вЂ¦ Р­С‚Рѕ РјРѕР¶РµС‚ Р·Р°РЅСЏС‚СЊ РґРѕ РјРёРЅСѓС‚С‹.</div>';
    _expertPoll = setInterval(() => _loadExpertState(filename), 4000);

  } else if (data.status === 'done') {
    const report = data.report || {};
    if (!report.title) {
      container.innerHTML = `
        <div class="empty-state error-text">Р¤РѕСЂРјР°С‚ СЌРєСЃРїРµСЂС‚РЅРѕРіРѕ РѕС‚С‡С‘С‚Р° СѓСЃС‚Р°СЂРµР». РџРµСЂРµР·Р°РїСѓСЃС‚РёС‚Рµ Р°РЅР°Р»РёР·.</div>
        <div class="transcript-actions">
          <button class="btn btn-secondary" id="btn-rerun-expert">РџРµСЂРµР·Р°РїСѓСЃС‚РёС‚СЊ Р°РЅР°Р»РёР·</button>
        </div>
      `;
      document.getElementById('btn-rerun-expert')
        .addEventListener('click', () => _startExpert(filename));
    } else {
      _renderExpertReport(report, container);
    }

  } else if (data.status === 'error') {
    container.innerHTML = `
      <div class="empty-state error-text">РћС€РёР±РєР° СЌРєСЃРїРµСЂС‚РЅРѕРіРѕ Р°РЅР°Р»РёР·Р°: ${escapeHtml(data.error || 'РЅРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°')}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-expert">РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°</button>
      </div>
    `;
    document.getElementById('btn-retry-expert')
      .addEventListener('click', () => _startExpert(filename));

  } else {
    container.innerHTML = `<div class="empty-state error-text">РќРµРѕР¶РёРґР°РЅРЅС‹Р№ РѕС‚РІРµС‚ СЃРµСЂРІРµСЂР°: ${escapeHtml(JSON.stringify(data).substring(0, 200))}</div>`;
  }
}

function _renderExpertReport(report, container) {
  if (!report || !report.title) {
    container.innerHTML = '<div class="empty-state">РђРЅР°Р»РёР· РЅРµ РІРµСЂРЅСѓР» СЂРµР·СѓР»СЊС‚Р°С‚РѕРІ.</div>';
    return;
  }

  const levelClass = report.match_level === 'Р’С‹СЃРѕРєРёР№' ? 'level-high'
    : report.match_level === 'РЎСЂРµРґРЅРёР№' ? 'level-medium' : 'level-low';

  const signsHtml = (report.found_signs || []).length > 0
    ? (report.found_signs.map(s => `<span class="expert-chip">${escapeHtml(s)}</span>`).join(''))
    : '<span class="expert-empty-inline">РЅРµ РЅР°Р№РґРµРЅРѕ</span>';

  const actionsHtml = (report.action_items || []).length > 0
    ? `<ul class="expert-actions-list">${report.action_items.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
    : '<p class="expert-empty-inline">РЅРµС‚</p>';

  const phrasesHtml = (report.key_phrases || []).length > 0
    ? `<ul class="expert-phrases-list">${report.key_phrases.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
    : '<p class="expert-empty-inline">РЅРµС‚</p>';

  const summaries = report.speakers_summary || [];
  const speakerSummaryHtml = `
    <div class="expert-section">
      <div class="expert-section-label">Р”РµРјРѕ-СЂР°Р·РґРµР»РµРЅРёРµ СѓС‡Р°СЃС‚РЅРёРєРѕРІ</div>
      ${summaries.length > 0
        ? summaries.map(sp => `
            <div class="expert-speaker-card">
              <div class="expert-speaker-name">${escapeHtml(sp.speaker)}</div>
              <div class="expert-speaker-text">${escapeHtml(sp.text)}</div>
            </div>`).join('')
        : '<p class="expert-empty-inline">Р”РµРјРѕ-СЂР°Р·РґРµР»РµРЅРёРµ СЃРїРёРєРµСЂРѕРІ РЅРµРґРѕСЃС‚СѓРїРЅРѕ РґР»СЏ СЌС‚РѕР№ Р·Р°РїРёСЃРё.</p>'}
    </div>`;

  const signs = report.speaker_signs || [];
  const speakerSignsHtml = signs.length > 0
    ? `<div class="expert-section">
        <div class="expert-section-label">РџСЂРёР·РЅР°РєРё РїРѕ СѓС‡Р°СЃС‚РЅРёРєР°Рј</div>
        ${signs.map(sp => `
          <div class="expert-speaker-signs-row">
            <span class="expert-speaker-signs-name">${escapeHtml(sp.speaker)}:</span>
            <span class="expert-speaker-signs-list">${(sp.signs || []).map(s => escapeHtml(s)).join(', ')}</span>
          </div>`).join('')}
      </div>` : '';

  container.innerHTML = `
    <div class="expert-report">
      <h2 class="expert-title">${escapeHtml(report.title)}</h2>
      <p class="expert-subtitle">${escapeHtml(report.subtitle)}</p>

      <div class="expert-cards-row">
        <div class="expert-card">
          <div class="expert-card-label">РЎС†РµРЅР°СЂРёР№</div>
          <div class="expert-card-value">${escapeHtml(report.scenario)}</div>
        </div>
        <div class="expert-card">
          <div class="expert-card-label">РЈСЂРѕРІРµРЅСЊ СЃРѕРІРїР°РґРµРЅРёСЏ</div>
          <div class="expert-card-value ${levelClass}">${escapeHtml(report.match_level)}</div>
        </div>
      </div>

      <div class="expert-section">
        <div class="expert-section-label">РћР±РЅР°СЂСѓР¶РµРЅРЅС‹Рµ РїСЂРёР·РЅР°РєРё</div>
        <div class="expert-chips">${signsHtml}</div>
      </div>

      <div class="expert-section">
        <div class="expert-section-label">Р’С‹РІРѕРґ</div>
        <p class="expert-conclusion">${escapeHtml(report.conclusion)}</p>
      </div>

      <div class="expert-section">
        <div class="expert-section-label">Р РµРєРѕРјРµРЅРґРѕРІР°РЅРЅС‹Рµ РґРµР№СЃС‚РІРёСЏ</div>
        ${actionsHtml}
      </div>

      <div class="expert-section">
        <div class="expert-section-label">РљР»СЋС‡РµРІС‹Рµ С„СЂР°Р·С‹ РІ Р·Р°РїРёСЃРё</div>
        ${phrasesHtml}
      </div>

      ${speakerSummaryHtml}
      ${speakerSignsHtml}

      <p class="expert-note">${escapeHtml(report.note)}</p>
    </div>
  `;
}

async function _startExpert(filename) {
  const container = document.getElementById('expert-state');
  container.innerHTML = '<div class="empty-state">РРґС‘С‚ СЌРєСЃРїРµСЂС‚РЅС‹Р№ Р°РЅР°Р»РёР·вЂ¦ Р­С‚Рѕ РјРѕР¶РµС‚ Р·Р°РЅСЏС‚СЊ РґРѕ РјРёРЅСѓС‚С‹.</div>';

  try {
    const mode = _getSelectedAnalysisMode();
    const query = `?analysis_mode=${encodeURIComponent(mode)}`;
    const res = await fetch(`/api/expert/${encodeURIComponent(filename)}${query}`, { method: 'POST' });
    if (!res.ok) throw new Error('РћС€РёР±РєР° Р·Р°РїСѓСЃРєР°');
    _expertPoll = setInterval(() => _loadExpertState(filename), 4000);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state error-text">РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїСѓСЃС‚РёС‚СЊ СЌРєСЃРїРµСЂС‚РЅС‹Р№ Р°РЅР°Р»РёР·: ${escapeHtml(err.message || err)}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-expert">РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°</button>
      </div>
    `;
    document.getElementById('btn-retry-expert')
      .addEventListener('click', () => _startExpert(filename));
  }
}

function _clearExpertPoll() {
  if (_expertPoll) {
    clearInterval(_expertPoll);
    _expertPoll = null;
  }
}

// в”Ђв”Ђ РЈРўРР›РРўР« в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' Р‘';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' РљР‘';
  return (bytes / 1048576).toFixed(1) + ' РњР‘';
}

function formatDate(ts) {
  return new Date(ts * 1000).toLocaleString('ru-RU');
}

async function _convertRecordedBlobToWav(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('AudioContext РЅРµРґРѕСЃС‚СѓРїРµРЅ РІ Р±СЂР°СѓР·РµСЂРµ');
  }
  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await new Promise((resolve, reject) => {
      ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
    });
    return _audioBufferToWavBlob(decoded);
  } finally {
    if (ctx && typeof ctx.close === 'function') {
      try { await ctx.close(); } catch {}
    }
  }
}

function _audioBufferToWavBlob(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / channels;
    }
  }
  const wavBuffer = _encodeWavPcm16(mono, sampleRate);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function _encodeWavPcm16(samples, sampleRate) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

