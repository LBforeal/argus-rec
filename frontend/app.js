const page = document.body.dataset.page;

let _currentFilename = null;
let _transcriptPoll = null;
let _overviewPoll = null;
let _actionsPoll = null;
let _expertPoll = null;

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

// ── INDEX PAGE ──────────────────────────────────────────────

function initIndex() {
  document.getElementById('btn-record').addEventListener('click', _startRecording);
  document.getElementById('btn-stop-record').addEventListener('click', _stopRecording);
  document.getElementById('file-input').addEventListener('change', handleFileUpload);
  document.getElementById('file-list').addEventListener('click', _handleFileListClick);
  document.getElementById('file-list').addEventListener('keydown', _handleFileListClick);

  loadFileList();
}

// ── RECORDING ───────────────────────────────────────────────

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
    status.textContent = 'Запись недоступна в этом браузере. Откройте на localhost или используйте HTTPS.';
    return;
  }

  if (typeof MediaRecorder === 'undefined') {
    status.hidden = false;
    status.className = 'upload-status error';
    status.textContent = 'Браузер не поддерживает запись через MediaRecorder.';
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    status.hidden = false;
    status.className = 'upload-status error';
    if (err.name === 'NotAllowedError') {
      status.textContent = 'Доступ к микрофону запрещён. Разрешите доступ в настройках браузера.';
    } else if (err.name === 'NotFoundError') {
      status.textContent = 'Микрофон не найден. Подключите микрофон и попробуйте снова.';
    } else {
      status.textContent = `Не удалось получить доступ к микрофону: ${err.message}`;
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
    status.textContent = `Не удалось запустить запись: ${err.message}`;
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
      status.textContent = 'Запись пуста. Попробуйте снова.';
      return;
    }

    let wavBlob;
    try {
      wavBlob = await _convertRecordedBlobToWav(blob);
    } catch (err) {
      status.hidden = false;
      status.className = 'upload-status error';
      status.textContent = `Не удалось обработать запись: ${err.message}`;
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
    status.textContent = 'Сохранение записи…';

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const msg = await _extractApiError(res, 'Ошибка сохранения');
        throw new Error(msg);
      }
      status.className = 'upload-status success';
      status.textContent = 'Запись сохранена.';
      await loadFileList();
    } catch (err) {
      status.className = 'upload-status error';
      status.textContent = `Ошибка сохранения записи: ${err.message}`;
    }
  };

  _mediaRecorder.onerror = () => {
    _stopTimer();
    _releaseStream();
    _setRecordingUi(false);
    status.hidden = false;
    status.className = 'upload-status error';
    status.textContent = 'Ошибка записи. Попробуйте снова.';
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
  status.textContent = `Загрузка файла "${file.name}"...`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      const msg = await _extractApiError(res, 'Неизвестная ошибка');
      throw new Error(msg);
    }
    status.className = 'upload-status success';
    status.textContent = 'Файл успешно загружен.';
    await loadFileList();
  } catch (err) {
    status.className = 'upload-status error';
    status.textContent = `Ошибка загрузки: ${err.message}`;
  }

  // Сброс, чтобы можно было загрузить тот же файл повторно
  event.target.value = '';
}

async function loadFileList() {
  const container = document.getElementById('file-list');
  try {
    const res = await fetch('/api/recordings');
    if (!res.ok) throw new Error('Ошибка сервера');
    const files = await res.json();

    if (files.length === 0) {
      container.innerHTML = '<div class="empty-state">Нет записей. Загрузите первый файл.</div>';
      return;
    }

    container.innerHTML = files.map(f => {
      const encoded = encodeURIComponent(f.filename);
      return `
        <article class="file-item" data-open-file="${encoded}" role="link" tabindex="0">
          <div class="file-main" data-open-file="${encoded}">
            <div class="file-name">${escapeHtml(f.filename)}</div>
            <div class="file-meta">${formatSize(f.size)} · ${formatDate(f.modified)}</div>
          </div>
          <button class="file-delete-btn" type="button" data-delete-file="${encoded}" aria-label="Удалить запись ${escapeHtml(f.filename)}">
            Удалить
          </button>
        </article>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state error-text">Не удалось загрузить список файлов: ${escapeHtml(err.message || err)}</div>`;
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
  const ok = window.confirm(`Удалить запись "${filename}"?\nЭто действие нельзя отменить.`);
  if (!ok) return;

  status.hidden = false;
  status.className = 'upload-status';
  status.textContent = 'Удаление записи…';

  try {
    const res = await fetch(`/api/recordings/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (!res.ok) {
      let message = `Ошибка удаления (HTTP ${res.status})`;
      try {
        const data = await res.json();
        if (data && data.detail) message = data.detail;
      } catch {}
      throw new Error(message);
    }

    status.className = 'upload-status success';
    status.textContent = 'Запись удалена.';
    await loadFileList();
  } catch (err) {
    status.className = 'upload-status error';
    status.textContent = `Не удалось удалить запись: ${err.message || err}`;
  }
}

// ── DETAIL PAGE ─────────────────────────────────────────────

function initDetail() {
  const params = new URLSearchParams(window.location.search);
  const rawFilename = params.get('file');
  const filename = _decodeFilenameFromAttr(rawFilename) || (rawFilename || '').trim();

  if (!filename) {
    document.getElementById('file-title').textContent = 'Файл не найден';
    return;
  }

  _currentFilename = filename;
  document.getElementById('file-title').textContent = filename;
  const detailMeta = document.getElementById('detail-meta');
  if (detailMeta) detailMeta.textContent = `Файл: ${filename}`;
  document.title = `${filename} — Аргус`;

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
  _initDocumentGenerator(filename);

  // Обзор — активный таб по умолчанию, загружаем сразу
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
      value.textContent = mode.trim();
      menu.querySelectorAll('.detail-mode-option').forEach((el) => el.classList.remove('is-active'));
      option.classList.add('is-active');
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
  return mode || 'Следователь СК';
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
  const baseLabel = 'Сформировать документ';
  button.disabled = true;
  button.textContent = 'Формируем...';
  _setDocumentStatus('Сбор черновика документа из записи...');

  try {
    const res = await fetch(`/api/document/${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) {
      const message = await _extractApiError(res, 'Ошибка формирования документа');
      throw new Error(message);
    }

    const data = await res.json();
    if (data.status === 'no_transcript') {
      _setDocumentStatus('Документ недоступен: сначала запустите и дождитесь готового транскрипта.', true);
      return;
    }
    if (data.status !== 'done') {
      _setDocumentStatus(`Не удалось сформировать документ: ${data.error || 'неизвестная ошибка'}`, true);
      return;
    }

    const text = data?.document?.text || '';
    if (!text.trim()) {
      _setDocumentStatus('Документ сформирован без содержимого. Проверьте наличие данных в записи.', true);
      return;
    }

    const safeName = String(filename).replace(/[\\/:*?"<>|]+/g, '_');
    _downloadTextFile(`${safeName}.osmotr.chernovik.txt`, text);
    _setDocumentStatus('Черновик документа сформирован и скачан.');
  } catch (err) {
    _setDocumentStatus(`Не удалось сформировать документ: ${err.message || err}`, true);
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

// ── TRANSCRIPT TAB ───────────────────────────────────────────

async function _loadTranscriptState(filename) {
  const container = document.getElementById('transcript-state');
  try {
    const res = await fetch(`/api/transcript/${encodeURIComponent(filename)}`);
    if (!res.ok) {
      const message = await _extractApiError(res, 'Ошибка сервера');
      throw new Error(message);
    }
    const data = await res.json();
    _renderTranscriptState(data, filename, container);
  } catch (e) {
    _clearTranscriptPoll();
    container.innerHTML = `<div class="empty-state error-text">Не удалось получить статус транскрипта: ${escapeHtml(e.message || e)}</div>`;
  }
}

function _renderTranscriptState(data, filename, container) {
  _clearTranscriptPoll();

  if (data.status === 'idle') {
    container.innerHTML = `
      <div class="empty-state">Транскрипт ещё не запущен.</div>
      <div class="transcript-actions">
        <button class="btn btn-primary" id="btn-start-transcript">Начать расшифровку</button>
      </div>
    `;
    document.getElementById('btn-start-transcript')
      .addEventListener('click', () => _startTranscription(filename));

  } else if (data.status === 'running') {
    container.innerHTML = '<div class="empty-state">Идёт расшифровка…</div>';
    _transcriptPoll = setInterval(() => _loadTranscriptState(filename), 3000);

  } else if (data.status === 'done') {
    if (!data.text || !data.text.trim()) {
      container.innerHTML = '<div class="empty-state">Транскрипт пуст.</div>';
    } else {
      container.innerHTML = `<div class="transcript-text">${escapeHtml(data.text)}</div>`;
    }

  } else if (data.status === 'error') {
    container.innerHTML = `
      <div class="empty-state error-text">Ошибка расшифровки: ${escapeHtml(data.error || 'неизвестная ошибка')}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-transcript">Попробовать снова</button>
      </div>
    `;
    document.getElementById('btn-retry-transcript')
      .addEventListener('click', () => _startTranscription(filename));

  } else {
    container.innerHTML = `<div class="empty-state error-text">Неожиданный статус от сервера: ${escapeHtml(data.status)}</div>`;
  }
}

async function _startTranscription(filename) {
  const container = document.getElementById('transcript-state');
  container.innerHTML = '<div class="empty-state">Идёт расшифровка…</div>';

  try {
    const res = await fetch(`/api/transcribe/${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) {
      const message = await _extractApiError(res, 'Ошибка запуска');
      throw new Error(message);
    }
    _transcriptPoll = setInterval(() => _loadTranscriptState(filename), 3000);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state error-text">Не удалось запустить расшифровку: ${escapeHtml(err.message || err)}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-transcript">Попробовать снова</button>
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

// ── OVERVIEW TAB ─────────────────────────────────────────────

async function _loadOverviewState(filename) {
  const container = document.getElementById('overview-state');
  try {
    const res = await fetch(`/api/overview/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('Ошибка сервера');
    const data = await res.json();
    _renderOverviewState(data, filename, container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state error-text">Не удалось получить статус обзора: ${escapeHtml(e.message || e)}</div>`;
  }
}

function _renderOverviewState(data, filename, container) {
  _clearOverviewPoll();

  if (data.status === 'no_transcript') {
    container.innerHTML = '<div class="empty-state">Обзор недоступен: нет готового транскрипта.</div>';

  } else if (data.status === 'idle') {
    container.innerHTML = `
      <div class="empty-state">Обзор ещё не запущен.</div>
      <div class="transcript-actions">
        <button class="btn btn-primary" id="btn-start-overview">Построить обзор</button>
      </div>
    `;
    document.getElementById('btn-start-overview')
      .addEventListener('click', () => _startOverview(filename));

  } else if (data.status === 'running') {
    container.innerHTML = '<div class="empty-state">Идёт построение обзора…</div>';
    _overviewPoll = setInterval(() => _loadOverviewState(filename), 2000);

  } else if (data.status === 'done') {
    if (!data.text || !data.text.trim()) {
      container.innerHTML = '<div class="empty-state">Обзор пуст.</div>';
    } else {
      container.innerHTML = `<div class="transcript-text">${escapeHtml(data.text)}</div>`;
    }

  } else if (data.status === 'error') {
    container.innerHTML = `
      <div class="empty-state error-text">Ошибка построения обзора: ${escapeHtml(data.error || 'неизвестная ошибка')}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-overview">Попробовать снова</button>
      </div>
    `;
    document.getElementById('btn-retry-overview')
      .addEventListener('click', () => _startOverview(filename));

  } else {
    container.innerHTML = `<div class="empty-state error-text">Неожиданный статус от сервера: ${escapeHtml(data.status)}</div>`;
  }
}

async function _startOverview(filename) {
  const container = document.getElementById('overview-state');
  container.innerHTML = '<div class="empty-state">Идёт построение обзора…</div>';

  try {
    const res = await fetch(`/api/overview/${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) throw new Error(`Ошибка запуска (HTTP ${res.status})`);
    const data = await res.json();
    if (data.status === 'no_transcript') {
      container.innerHTML = '<div class="empty-state">Обзор недоступен: нет готового транскрипта.</div>';
      return;
    }
    if (data.status === 'error') {
      container.innerHTML = `
        <div class="empty-state error-text">Ошибка построения обзора: ${escapeHtml(data.error || 'неизвестная ошибка')}</div>
        <div class="transcript-actions">
          <button class="btn btn-secondary" id="btn-retry-overview">Попробовать снова</button>
        </div>
      `;
      document.getElementById('btn-retry-overview')
        .addEventListener('click', () => _startOverview(filename));
      return;
    }
    _overviewPoll = setInterval(() => _loadOverviewState(filename), 2000);
  } catch (e) {
    container.innerHTML = `
      <div class="empty-state error-text">Не удалось запустить построение обзора: ${escapeHtml(e.message || e)}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-overview">Попробовать снова</button>
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

// ── ACTIONS TAB ──────────────────────────────────────────────

async function _loadActionsState(filename) {
  const container = document.getElementById('actions-state');
  try {
    const res = await fetch(`/api/actions/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('Ошибка сервера');
    const data = await res.json();
    _renderActionsState(data, filename, container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state error-text">Не удалось получить статус действий: ${escapeHtml(e.message || e)}</div>`;
  }
}

function _renderActionsState(data, filename, container) {
  _clearActionsPoll();

  if (data.status === 'no_transcript') {
    container.innerHTML = '<div class="empty-state">Действия недоступны: нет готового транскрипта.</div>';

  } else if (data.status === 'idle') {
    container.innerHTML = `
      <div class="empty-state">Действия ещё не запущены.</div>
      <div class="transcript-actions">
        <button class="btn btn-primary" id="btn-start-actions">Найти действия</button>
      </div>
    `;
    document.getElementById('btn-start-actions')
      .addEventListener('click', () => _startActions(filename));

  } else if (data.status === 'running') {
    container.innerHTML = '<div class="empty-state">Идёт построение действий…</div>';
    _actionsPoll = setInterval(() => _loadActionsState(filename), 2000);

  } else if (data.status === 'done') {
    if (!data.items || data.items.length === 0) {
      container.innerHTML = '<div class="empty-state">В транскрипте не найдено действий или задач.</div>';
    } else {
      const list = data.items.map(item => `<li style="margin-bottom:8px">${escapeHtml(item)}</li>`).join('');
      container.innerHTML = `<div class="transcript-text"><ol style="padding-left:20px;margin:0">${list}</ol></div>`;
    }

  } else if (data.status === 'error') {
    container.innerHTML = `
      <div class="empty-state error-text">Ошибка поиска действий: ${escapeHtml(data.error || 'неизвестная ошибка')}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-actions">Попробовать снова</button>
      </div>
    `;
    document.getElementById('btn-retry-actions')
      .addEventListener('click', () => _startActions(filename));

  } else {
    container.innerHTML = `<div class="empty-state error-text">Неожиданный статус от сервера: ${escapeHtml(data.status)}</div>`;
  }
}

async function _startActions(filename) {
  const container = document.getElementById('actions-state');
  container.innerHTML = '<div class="empty-state">Идёт построение действий…</div>';

  try {
    const res = await fetch(`/api/actions/${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) throw new Error(`Ошибка запуска (HTTP ${res.status})`);
    const data = await res.json();
    if (data.status === 'no_transcript') {
      container.innerHTML = '<div class="empty-state">Действия недоступны: нет готового транскрипта.</div>';
      return;
    }
    if (data.status === 'error') {
      container.innerHTML = `
        <div class="empty-state error-text">Ошибка поиска действий: ${escapeHtml(data.error || 'неизвестная ошибка')}</div>
        <div class="transcript-actions">
          <button class="btn btn-secondary" id="btn-retry-actions">Попробовать снова</button>
        </div>
      `;
      document.getElementById('btn-retry-actions')
        .addEventListener('click', () => _startActions(filename));
      return;
    }
    _actionsPoll = setInterval(() => _loadActionsState(filename), 2000);
  } catch (e) {
    container.innerHTML = `
      <div class="empty-state error-text">Не удалось запустить поиск действий: ${escapeHtml(e.message || e)}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-actions">Попробовать снова</button>
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

// ── EXPERT TAB ───────────────────────────────────────────────

async function _loadExpertState(filename) {
  const container = document.getElementById('expert-state');
  try {
    const res = await fetch(`/api/expert/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('Ошибка сервера');
    const data = await res.json();
    _renderExpertState(data, filename, container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state error-text">Не удалось получить статус экспертного анализа: ${escapeHtml(e.message || e)}</div>`;
  }
}

function _renderExpertState(data, filename, container) {
  _clearExpertPoll();

  if (data.status === 'no_transcript') {
    container.innerHTML = '<div class="empty-state">Экспертный анализ недоступен: нет готового транскрипта.</div>';

  } else if (data.status === 'idle') {
    container.innerHTML = `
      <div class="empty-state">Экспертный анализ ещё не запущен.</div>
      <div class="transcript-actions">
        <button class="btn btn-primary" id="btn-start-expert">Запустить анализ</button>
      </div>
    `;
    document.getElementById('btn-start-expert')
      .addEventListener('click', () => _startExpert(filename));

  } else if (data.status === 'running') {
    container.innerHTML = '<div class="empty-state">Идёт экспертный анализ… Это может занять до минуты.</div>';
    _expertPoll = setInterval(() => _loadExpertState(filename), 4000);

  } else if (data.status === 'done') {
    const report = data.report || {};
    if (!report.title) {
      container.innerHTML = `
        <div class="empty-state error-text">Формат экспертного отчёта устарел. Перезапустите анализ.</div>
        <div class="transcript-actions">
          <button class="btn btn-secondary" id="btn-rerun-expert">Перезапустить анализ</button>
        </div>
      `;
      document.getElementById('btn-rerun-expert')
        .addEventListener('click', () => _startExpert(filename));
    } else {
      _renderExpertReport(report, container);
    }

  } else if (data.status === 'error') {
    container.innerHTML = `
      <div class="empty-state error-text">Ошибка экспертного анализа: ${escapeHtml(data.error || 'неизвестная ошибка')}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-expert">Попробовать снова</button>
      </div>
    `;
    document.getElementById('btn-retry-expert')
      .addEventListener('click', () => _startExpert(filename));

  } else {
    container.innerHTML = `<div class="empty-state error-text">Неожиданный ответ сервера: ${escapeHtml(JSON.stringify(data).substring(0, 200))}</div>`;
  }
}

function _renderExpertReport(report, container) {
  if (!report || !report.title) {
    container.innerHTML = '<div class="empty-state">Анализ не вернул результатов.</div>';
    return;
  }

  const levelClass = report.match_level === 'Высокий' ? 'level-high'
    : report.match_level === 'Средний' ? 'level-medium' : 'level-low';

  const signsHtml = (report.found_signs || []).length > 0
    ? (report.found_signs.map(s => `<span class="expert-chip">${escapeHtml(s)}</span>`).join(''))
    : '<span class="expert-empty-inline">не найдено</span>';

  const actionsHtml = (report.action_items || []).length > 0
    ? `<ul class="expert-actions-list">${report.action_items.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
    : '<p class="expert-empty-inline">нет</p>';

  const phrasesHtml = (report.key_phrases || []).length > 0
    ? `<ul class="expert-phrases-list">${report.key_phrases.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
    : '<p class="expert-empty-inline">нет</p>';

  const summaries = report.speakers_summary || [];
  const speakerSummaryHtml = `
    <div class="expert-section">
      <div class="expert-section-label">Демо-разделение участников</div>
      ${summaries.length > 0
        ? summaries.map(sp => `
            <div class="expert-speaker-card">
              <div class="expert-speaker-name">${escapeHtml(sp.speaker)}</div>
              <div class="expert-speaker-text">${escapeHtml(sp.text)}</div>
            </div>`).join('')
        : '<p class="expert-empty-inline">Демо-разделение спикеров недоступно для этой записи.</p>'}
    </div>`;

  const signs = report.speaker_signs || [];
  const speakerSignsHtml = signs.length > 0
    ? `<div class="expert-section">
        <div class="expert-section-label">Признаки по участникам</div>
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
          <div class="expert-card-label">Сценарий</div>
          <div class="expert-card-value">${escapeHtml(report.scenario)}</div>
        </div>
        <div class="expert-card">
          <div class="expert-card-label">Уровень совпадения</div>
          <div class="expert-card-value ${levelClass}">${escapeHtml(report.match_level)}</div>
        </div>
      </div>

      <div class="expert-section">
        <div class="expert-section-label">Обнаруженные признаки</div>
        <div class="expert-chips">${signsHtml}</div>
      </div>

      <div class="expert-section">
        <div class="expert-section-label">Вывод</div>
        <p class="expert-conclusion">${escapeHtml(report.conclusion)}</p>
      </div>

      <div class="expert-section">
        <div class="expert-section-label">Рекомендованные действия</div>
        ${actionsHtml}
      </div>

      <div class="expert-section">
        <div class="expert-section-label">Ключевые фразы в записи</div>
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
  container.innerHTML = '<div class="empty-state">Идёт экспертный анализ… Это может занять до минуты.</div>';

  try {
    const mode = _getSelectedAnalysisMode();
    const query = `?analysis_mode=${encodeURIComponent(mode)}`;
    const res = await fetch(`/api/expert/${encodeURIComponent(filename)}${query}`, { method: 'POST' });
    if (!res.ok) throw new Error('Ошибка запуска');
    _expertPoll = setInterval(() => _loadExpertState(filename), 4000);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state error-text">Не удалось запустить экспертный анализ: ${escapeHtml(err.message || err)}</div>
      <div class="transcript-actions">
        <button class="btn btn-secondary" id="btn-retry-expert">Попробовать снова</button>
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

// ── УТИЛИТЫ ─────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / 1048576).toFixed(1) + ' МБ';
}

function formatDate(ts) {
  return new Date(ts * 1000).toLocaleString('ru-RU');
}

async function _convertRecordedBlobToWav(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('AudioContext недоступен в браузере');
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
