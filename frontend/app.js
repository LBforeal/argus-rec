const page = document.body.dataset.page;

let _currentFilename = null;
let _transcriptPoll = null;
let _overviewPoll = null;
let _actionsPoll = null;
let _expertPoll = null;

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
  _mediaRecorder = new MediaRecorder(stream);

  _mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) _recordedChunks.push(e.data);
  };

  _mediaRecorder.onstop = async () => {
    _stopTimer();
    _releaseStream();
    document.getElementById('recording-panel').hidden = true;
    document.querySelector('.action-bar').hidden = false;

    const blob = new Blob(_recordedChunks, { type: 'audio/webm' });
    _recordedChunks = [];

    if (blob.size === 0) {
      status.hidden = false;
      status.className = 'upload-status error';
      status.textContent = 'Запись пуста. Попробуйте снова.';
      return;
    }

    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const fname = `record_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.webm`;

    const file = new File([blob], fname, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('file', file);

    status.hidden = false;
    status.className = 'upload-status';
    status.textContent = 'Сохранение записи…';

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Ошибка сохранения');
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
    document.getElementById('recording-panel').hidden = true;
    document.querySelector('.action-bar').hidden = false;
    status.hidden = false;
    status.className = 'upload-status error';
    status.textContent = 'Ошибка записи. Попробуйте снова.';
  };

  _mediaRecorder.start();
  document.querySelector('.action-bar').hidden = true;
  document.getElementById('recording-panel').hidden = false;
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
      const err = await res.json();
      throw new Error(err.detail || 'Неизвестная ошибка');
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

    container.innerHTML = files.map(f => `
      <a class="file-item" href="/detail.html?file=${encodeURIComponent(f.filename)}">
        <div class="file-name">${escapeHtml(f.filename)}</div>
        <div class="file-meta">${formatSize(f.size)} · ${formatDate(f.modified)}</div>
      </a>
    `).join('');
  } catch {
    container.innerHTML = '<div class="empty-state error-text">Не удалось загрузить список файлов.</div>';
  }
}

// ── DETAIL PAGE ─────────────────────────────────────────────

function initDetail() {
  const params = new URLSearchParams(window.location.search);
  const filename = params.get('file');

  if (!filename) {
    document.getElementById('file-title').textContent = 'Файл не найден';
    return;
  }

  _currentFilename = filename;
  document.getElementById('file-title').textContent = filename;
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

  // Обзор — активный таб по умолчанию, загружаем сразу
  _loadOverviewState(filename);

  window.addEventListener('beforeunload', () => {
    _clearTranscriptPoll();
    _clearOverviewPoll();
    _clearActionsPoll();
    _clearExpertPoll();
  });
}

// ── TRANSCRIPT TAB ───────────────────────────────────────────

async function _loadTranscriptState(filename) {
  const container = document.getElementById('transcript-state');
  try {
    const res = await fetch(`/api/transcript/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('Ошибка сервера');
    const data = await res.json();
    _renderTranscriptState(data, filename, container);
  } catch (e) {
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
    if (!res.ok) throw new Error('Ошибка запуска');
    _transcriptPoll = setInterval(() => _loadTranscriptState(filename), 3000);
  } catch {
    container.innerHTML = `
      <div class="empty-state error-text">Не удалось запустить расшифровку.</div>
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
    _renderExpertResult(data.sections || [], container);

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

function _renderExpertResult(sections, container) {
  if (!sections || sections.length === 0) {
    container.innerHTML = '<div class="empty-state">Анализ не вернул результатов.</div>';
    return;
  }
  let html = '';
  for (const section of sections) {
    html += `<div style="margin-bottom:24px">`;
    html += `<h3 style="font-size:16px;font-weight:600;margin-bottom:12px;color:#1a1a1a">${escapeHtml(section.title)}</h3>`;
    if (!section.items || section.items.length === 0) {
      html += `<p style="color:#999;font-size:14px;padding:8px 0">Не найдено.</p>`;
    } else {
      for (const item of section.items) {
        html += `<div style="margin-bottom:14px;padding:12px 14px;border:1px solid #e5e5e5;border-radius:8px">`;
        html += `<p style="font-size:14px;font-weight:500;margin-bottom:8px;color:#1a1a1a">${escapeHtml(item.text || '')}</p>`;
        if (item.quote) {
          html += `<blockquote style="border-left:3px solid #e53935;padding-left:12px;margin:8px 0;color:#555;font-size:13px;font-style:italic">\u00AB${escapeHtml(item.quote)}\u00BB</blockquote>`;
        }
        if (item.source_file) {
          html += `<p style="font-size:12px;color:#888;margin-top:8px">`;
          html += `<strong>Источник:</strong> ${escapeHtml(item.source_file)}`;
          if (item.source_excerpt) {
            html += ` \u2014 \u00AB${escapeHtml(item.source_excerpt)}\u00BB`;
          }
          html += `</p>`;
        }
        html += `</div>`;
      }
    }
    html += `</div>`;
  }
  container.innerHTML = html;
}

async function _startExpert(filename) {
  const container = document.getElementById('expert-state');
  container.innerHTML = '<div class="empty-state">Идёт экспертный анализ… Это может занять до минуты.</div>';

  try {
    const res = await fetch(`/api/expert/${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) throw new Error('Ошибка запуска');
    _expertPoll = setInterval(() => _loadExpertState(filename), 4000);
  } catch {
    container.innerHTML = `
      <div class="empty-state error-text">Не удалось запустить экспертный анализ.</div>
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

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
