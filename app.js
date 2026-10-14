/* ==========================================================================
   Telepleo — app logic
   Plain JS, no dependencies. Two views (Editor / Prompter) toggled by
   adding/removing the `is-active` class on <section class="view">.
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     Storage keys / helpers
     --------------------------------------------------------------------- */

  const LS_SCRIPTS = 'telepleo.scripts';
  const LS_WPM = 'telepleo.wpm';
  const LS_FONT = 'telepleo.fontSize';
  const LS_MIRROR = 'telepleo.mirror';
  const LS_TIP_SHOWN = 'telepleo.tipShown';
  const LS_THEME = 'telepleo.theme';
  const LS_FOCUS = 'telepleo.focus';

  // Five font-size steps (was three) — map any old saved value across.
  const FONT_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'];
  const LEGACY_FONT_MAP = { small: 'sm', medium: 'md', large: 'xl' };
  const FOCUS_SIZES = [100, 75, 50, 25];

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // localStorage full or unavailable — fail silently, it's not critical.
      console.warn('Telepleo: could not save to localStorage', e);
    }
  }

  function readRaw(key, fallback) {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  }

  /* ---------------------------------------------------------------------
     DOM references
     --------------------------------------------------------------------- */

  const editorView = document.getElementById('editor-view');
  const prompterView = document.getElementById('prompter-view');

  const scriptInput = document.getElementById('script-input');
  const wordCountEl = document.getElementById('word-count');
  const readTimeEl = document.getElementById('read-time');
  const statWpmEl = document.getElementById('stat-wpm');
  const scriptNameInput = document.getElementById('script-name-input');
  const saveScriptBtn = document.getElementById('save-script-btn');
  const savedScriptsList = document.getElementById('saved-scripts-list');
  const noScriptsMsg = document.getElementById('no-scripts-msg');
  const startBtn = document.getElementById('start-btn');

  const prompterStage = document.getElementById('prompter-stage');
  const prompterViewport = document.getElementById('prompter-viewport');
  const prompterScroller = document.getElementById('prompter-scroller');
  const prompterText = document.getElementById('prompter-text');
  const scrubTrack = document.getElementById('scrub-track');
  const scrubThumb = document.getElementById('scrub-thumb');

  const controlsBar = document.getElementById('prompter-controls');
  const settingsPanel = document.getElementById('settings-panel');
  const exitBtn = document.getElementById('exit-btn');
  const timeRemainingEl = document.getElementById('time-remaining');
  const mirrorBtn = document.getElementById('mirror-btn');
  const restartBtn = document.getElementById('restart-btn');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const wpmDownBtn = document.getElementById('wpm-down');
  const wpmUpBtn = document.getElementById('wpm-up');
  const wpmValueEl = document.getElementById('wpm-value');
  const wpmSlider = document.getElementById('wpm-slider');
  const fontButtons = Array.from(document.querySelectorAll('.font-btn'));

  const themeButtons = Array.from(document.querySelectorAll('.theme-btn'));
  const focusButtons = Array.from(document.querySelectorAll('.focus-btn'));
  const durationInput = document.getElementById('duration-input');
  const applyDurationBtn = document.getElementById('apply-duration-btn');
  const durationNote = document.getElementById('duration-note');

  const firstTip = document.getElementById('first-tip');
  const dismissTipBtn = document.getElementById('dismiss-tip-btn');

  /* ---------------------------------------------------------------------
     Word counting / time estimate helpers
     --------------------------------------------------------------------- */

  function countWords(text) {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }

  function formatMinSec(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ':' + String(sec).padStart(2, '0');
  }

  /* ---------------------------------------------------------------------
     App state
     --------------------------------------------------------------------- */

  const MIN_WPM = 100;
  const MAX_WPM = 200;

  function normalizeFontSize(v) {
    if (FONT_SIZES.includes(v)) return v;
    if (LEGACY_FONT_MAP[v]) return LEGACY_FONT_MAP[v];
    return 'xs';
  }

  function normalizeFocus(v) {
    const n = parseInt(v, 10);
    return FOCUS_SIZES.includes(n) ? n : 100;
  }

  const state = {
    wpm: clampWpm(parseInt(readRaw(LS_WPM, '150'), 10) || 150),
    fontSize: normalizeFontSize(readRaw(LS_FONT, 'xs')),
    mirror: readRaw(LS_MIRROR, 'false') === 'true',
    theme: readRaw(LS_THEME, 'dark') === 'light' ? 'light' : 'dark',
    focusScale: normalizeFocus(readRaw(LS_FOCUS, '100')),
    totalWords: 0,
    isPlaying: false,
    animStartTime: 0,
    animStartProgress: 0,   // progress (0..1) frozen at the start of the current segment
    totalDurationMs: 0,     // time to scroll 0 -> 1 at the current wpm
    rafId: null,
    cachedTextHeight: 0,
    cachedReadingLineY: 0,
    scrubbing: false
  };

  function clampWpm(v) {
    return Math.min(MAX_WPM, Math.max(MIN_WPM, v));
  }

  /* ---------------------------------------------------------------------
     Saved scripts (localStorage)
     --------------------------------------------------------------------- */

  function getSavedScripts() {
    return readJSON(LS_SCRIPTS, []);
  }

  function setSavedScripts(list) {
    writeJSON(LS_SCRIPTS, list);
  }

  function renderSavedScripts() {
    const scripts = getSavedScripts().slice().sort((a, b) => b.updatedAt - a.updatedAt);
    savedScriptsList.innerHTML = '';

    if (scripts.length === 0) {
      noScriptsMsg.style.display = 'block';
      return;
    }
    noScriptsMsg.style.display = 'none';

    scripts.forEach((script) => {
      const li = document.createElement('li');
      li.className = 'saved-script-item';

      const nameBtn = document.createElement('button');
      nameBtn.className = 'saved-script-name';
      nameBtn.textContent = script.name;
      nameBtn.title = 'Load "' + script.name + '"';
      nameBtn.addEventListener('click', () => {
        scriptInput.value = script.text;
        scriptNameInput.value = script.name;
        onScriptTextChanged();
        scriptInput.focus();
      });

      const meta = document.createElement('span');
      meta.className = 'saved-script-meta';
      meta.textContent = countWords(script.text) + 'w';

      const renameBtn = document.createElement('button');
      renameBtn.className = 'icon-action-btn';
      renameBtn.title = 'Rename';
      renameBtn.textContent = '✎';
      renameBtn.addEventListener('click', () => {
        const newName = window.prompt('Rename script:', script.name);
        if (newName && newName.trim() && newName.trim() !== script.name) {
          const all = getSavedScripts();
          const target = all.find((s) => s.id === script.id);
          if (target) {
            target.name = newName.trim().slice(0, 60);
            target.updatedAt = Date.now();
            setSavedScripts(all);
            renderSavedScripts();
          }
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-action-btn danger';
      deleteBtn.title = 'Delete';
      deleteBtn.textContent = '🗑';
      deleteBtn.addEventListener('click', () => {
        if (window.confirm('Delete "' + script.name + '"?')) {
          const all = getSavedScripts().filter((s) => s.id !== script.id);
          setSavedScripts(all);
          renderSavedScripts();
        }
      });

      li.appendChild(nameBtn);
      li.appendChild(meta);
      li.appendChild(renameBtn);
      li.appendChild(deleteBtn);
      savedScriptsList.appendChild(li);
    });
  }

  function saveCurrentScript() {
    const text = scriptInput.value;
    if (!text.trim()) return;

    let name = scriptNameInput.value.trim();
    if (!name) {
      const d = new Date();
      name = 'Script ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    name = name.slice(0, 60);

    const all = getSavedScripts();
    const existing = all.find((s) => s.name.toLowerCase() === name.toLowerCase());

    if (existing) {
      existing.text = text;
      existing.updatedAt = Date.now();
    } else {
      all.push({
        id: 'script_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: name,
        text: text,
        updatedAt: Date.now()
      });
    }

    setSavedScripts(all);
    scriptNameInput.value = name;
    renderSavedScripts();

    saveScriptBtn.textContent = 'Saved ✓';
    setTimeout(() => { saveScriptBtn.textContent = 'Save'; }, 1200);
  }

  /* ---------------------------------------------------------------------
     Editor view logic
     --------------------------------------------------------------------- */

  let statsDebounce = null;

  function onScriptTextChanged() {
    clearTimeout(statsDebounce);
    statsDebounce = setTimeout(updateEditorStats, 80);
    startBtn.disabled = !scriptInput.value.trim();
  }

  function updateEditorStats() {
    const words = countWords(scriptInput.value);
    wordCountEl.textContent = words + (words === 1 ? ' word' : ' words');
    const seconds = (words / state.wpm) * 60;
    statWpmEl.textContent = state.wpm;
    readTimeEl.innerHTML = formatMinSec(seconds) + ' at <span id="stat-wpm">' + state.wpm + '</span> WPM';
  }

  scriptInput.addEventListener('input', onScriptTextChanged);
  saveScriptBtn.addEventListener('click', saveCurrentScript);

  startBtn.addEventListener('click', () => {
    const text = scriptInput.value;
    if (!text.trim()) return;
    enterPrompter(text);
  });

  /* ---------------------------------------------------------------------
     View switching
     --------------------------------------------------------------------- */

  function showView(view) {
    editorView.classList.remove('is-active');
    prompterView.classList.remove('is-active');
    view.classList.add('is-active');
  }

  function enterPrompter(text) {
    state.totalWords = countWords(text);
    prompterText.textContent = text;

    // Apply persisted settings
    setFontSize(state.fontSize, { skipRender: true });
    setMirror(state.mirror, { skipRender: true });
    setTheme(state.theme, { skipRender: true });
    setFocusScale(state.focusScale, { skipRender: true });
    setWpmValue(state.wpm, { skipRender: true });

    // Reset scroll to top, paused, ready to go.
    state.isPlaying = false;
    state.animStartProgress = 0;
    state.animStartTime = 0;
    state.totalDurationMs = computeTotalDuration();

    showView(prompterView);

    // Measure after layout (fonts etc.) settles.
    requestAnimationFrame(() => {
      remeasure();
      renderFrame(0);
      updatePlayPauseButton();
      showControls({ persistent: true });
    });

    maybeShowFirstTip();
  }

  exitBtn.addEventListener('click', () => {
    pausePlayback();
    showView(editorView);
  });

  /* ---------------------------------------------------------------------
     Scroll engine
     --------------------------------------------------------------------- */

  function computeTotalDuration() {
    if (state.totalWords <= 0) return 0;
    return (state.totalWords / state.wpm) * 60000;
  }

  function remeasure() {
    state.cachedTextHeight = prompterText.scrollHeight;
    state.cachedReadingLineY = prompterViewport.clientHeight * 0.33;
  }

  function getCurrentProgress(now) {
    if (!state.isPlaying) return state.animStartProgress;
    if (state.totalDurationMs <= 0) return 1;

    const remainingFraction = 1 - state.animStartProgress;
    if (remainingFraction <= 0) return 1;

    const segmentDuration = state.totalDurationMs * remainingFraction;
    if (segmentDuration <= 0) return 1;

    const elapsed = now - state.animStartTime;
    const p = state.animStartProgress + (elapsed / segmentDuration) * remainingFraction;
    return Math.min(1, Math.max(0, p));
  }

  function renderFrame(progress) {
    const textHeight = state.cachedTextHeight;
    const readingLineY = state.cachedReadingLineY;
    const translateY = readingLineY - progress * textHeight;

    prompterScroller.style.transform = 'translate3d(0,' + translateY.toFixed(2) + 'px,0)';

    if (!state.scrubbing) {
      scrubThumb.style.top = (progress * 100).toFixed(2) + '%';
    }
    scrubTrack.setAttribute('aria-valuenow', Math.round(progress * 100));

    const remainingWords = state.totalWords * (1 - progress);
    const remainingSeconds = (remainingWords / state.wpm) * 60;
    timeRemainingEl.textContent = formatMinSec(remainingSeconds) + ' left';
  }

  function tick(now) {
    const progress = getCurrentProgress(now);
    renderFrame(progress);

    if (progress >= 1) {
      state.isPlaying = false;
      state.animStartProgress = 1;
      updatePlayPauseButton();
      showControls({ persistent: true });
      return;
    }

    if (state.isPlaying) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function startPlayback() {
    if (state.totalWords <= 0) return;

    // If at the very end, restart from the top.
    if (state.animStartProgress >= 1) {
      state.animStartProgress = 0;
    }

    state.animStartTime = performance.now();
    state.totalDurationMs = computeTotalDuration();
    state.isPlaying = true;

    cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(tick);

    updatePlayPauseButton();
    startAutoHideTimer();
  }

  function pausePlayback() {
    if (state.isPlaying) {
      state.animStartProgress = getCurrentProgress(performance.now());
    }
    state.isPlaying = false;
    cancelAnimationFrame(state.rafId);
    updatePlayPauseButton();
    clearAutoHideTimer();
    showControls({ persistent: true });
  }

  function togglePlayback() {
    if (state.isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  }

  function restartPlayback() {
    state.animStartProgress = 0;
    state.animStartTime = performance.now();
    state.totalDurationMs = computeTotalDuration();
    renderFrame(0);
    if (state.isPlaying) {
      cancelAnimationFrame(state.rafId);
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function updatePlayPauseButton() {
    playPauseBtn.textContent = state.isPlaying ? '❚❚' : '▶';
    playPauseBtn.setAttribute('aria-label', state.isPlaying ? 'Pause' : 'Play');
  }

  /* --- Live WPM change without jarring the current position --- */

  function setWpmValue(newWpm, opts) {
    opts = opts || {};
    newWpm = clampWpm(Math.round(newWpm));

    // Freeze current visual progress under the *old* speed, then continue
    // the remaining distance at the *new* speed.
    const now = performance.now();
    const frozenProgress = state.totalWords > 0 ? getCurrentProgress(now) : 0;

    state.wpm = newWpm;
    state.animStartProgress = frozenProgress;
    state.animStartTime = now;
    state.totalDurationMs = computeTotalDuration();

    wpmValueEl.textContent = newWpm;
    wpmSlider.value = String(newWpm);
    writeJSON(LS_WPM, newWpm); // stored as number via JSON, read back with parseInt fallback too
    localStorage.setItem(LS_WPM, String(newWpm));

    if (!opts.skipRender) {
      renderFrame(frozenProgress);
    }
    updateEditorStats();
  }

  wpmSlider.addEventListener('input', () => setWpmValue(parseInt(wpmSlider.value, 10)));
  wpmDownBtn.addEventListener('click', () => setWpmValue(state.wpm - 5));
  wpmUpBtn.addEventListener('click', () => setWpmValue(state.wpm + 5));

  /* --- Font size (instant, keeps relative scroll position) --- */

  function setFontSize(size, opts) {
    opts = opts || {};
    size = normalizeFontSize(size);
    state.fontSize = size;
    prompterText.classList.remove('font-xs', 'font-sm', 'font-md', 'font-lg', 'font-xl');
    prompterText.classList.add('font-' + size);
    localStorage.setItem(LS_FONT, size);

    fontButtons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.size === size);
    });

    if (!opts.skipRender) {
      requestAnimationFrame(() => {
        remeasure();
        renderFrame(getCurrentProgress(performance.now()));
      });
    }
  }

  fontButtons.forEach((btn) => {
    btn.addEventListener('click', () => setFontSize(btn.dataset.size));
  });

  /* --- Mirror mode --- */

  function setMirror(on, opts) {
    opts = opts || {};
    state.mirror = on;
    prompterScroller.classList.toggle('is-mirrored', on);
    mirrorBtn.classList.toggle('is-active', on);
    mirrorBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    localStorage.setItem(LS_MIRROR, on ? 'true' : 'false');
  }

  mirrorBtn.addEventListener('click', () => setMirror(!state.mirror));

  /* --- Background theme (dark / light, with contrasting text) --- */

  function setTheme(theme, opts) {
    opts = opts || {};
    theme = theme === 'light' ? 'light' : 'dark';
    state.theme = theme;
    prompterView.classList.toggle('theme-light', theme === 'light');
    localStorage.setItem(LS_THEME, theme);

    themeButtons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.theme === theme);
    });
  }

  themeButtons.forEach((btn) => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });

  /* --- Focus zoom: shrink the reading area to a centered box --- */

  function setFocusScale(scale, opts) {
    opts = opts || {};
    scale = normalizeFocus(scale);
    state.focusScale = scale;

    prompterStage.classList.remove('focus-100', 'focus-75', 'focus-50', 'focus-25');
    prompterStage.classList.add('focus-' + scale);
    localStorage.setItem(LS_FOCUS, String(scale));

    focusButtons.forEach((btn) => {
      btn.classList.toggle('is-active', parseInt(btn.dataset.focus, 10) === scale);
    });

    if (!opts.skipRender) {
      requestAnimationFrame(() => {
        remeasure();
        renderFrame(getCurrentProgress(performance.now()));
      });
    }
  }

  focusButtons.forEach((btn) => {
    btn.addEventListener('click', () => setFocusScale(btn.dataset.focus));
  });

  /* --- Duration-based speed --- */

  applyDurationBtn.addEventListener('click', () => {
    const minutes = parseFloat(durationInput.value);
    if (!minutes || minutes <= 0 || state.totalWords <= 0) {
      durationNote.textContent = 'Enter a target duration in minutes.';
      return;
    }
    const idealWpm = state.totalWords / minutes;
    const applied = clampWpm(Math.round(idealWpm));
    setWpmValue(applied);

    if (Math.round(idealWpm) !== applied) {
      durationNote.textContent =
        'Ideal speed would be ' + Math.round(idealWpm) + ' WPM — clamped to ' + applied +
        ' (the ' + (applied === MIN_WPM ? 'minimum' : 'maximum') + ' supported speed).';
    } else {
      durationNote.textContent = 'Speed set to ' + applied + ' WPM for a ~' + minutes + ' minute read.';
    }
  });

  /* --- Restart / play-pause buttons --- */

  restartBtn.addEventListener('click', restartPlayback);
  playPauseBtn.addEventListener('click', togglePlayback);

  /* ---------------------------------------------------------------------
     Tap-to-jump
     --------------------------------------------------------------------- */

  function jumpToClientY(clientY) {
    const rect = prompterViewport.getBoundingClientRect();
    const localY = clientY - rect.top;

    const now = performance.now();
    const currentProgress = getCurrentProgress(now);
    const currentTranslateY = state.cachedReadingLineY - currentProgress * state.cachedTextHeight;

    // The text-space Y coordinate under the tap, given the current transform.
    const textY = localY - currentTranslateY;
    const textHeight = state.cachedTextHeight || 1;
    const newProgress = Math.min(1, Math.max(0, textY / textHeight));

    state.animStartProgress = newProgress;
    state.animStartTime = now;

    if (!state.isPlaying) {
      renderFrame(newProgress);
    }
  }

  let tapStartX = 0, tapStartY = 0, tapMoved = false;

  prompterViewport.addEventListener('pointerdown', (e) => {
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapMoved = false;
  });

  prompterViewport.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientX - tapStartX) > 10 || Math.abs(e.clientY - tapStartY) > 10) {
      tapMoved = true;
    }
  });

  prompterViewport.addEventListener('pointerup', (e) => {
    if (tapMoved) return; // it was a drag/scroll gesture, not a tap
    jumpToClientY(e.clientY);
    showControls({});
  });

  /* ---------------------------------------------------------------------
     Vertical scrub bar — drag (or tap) anywhere on the track to scroll
     straight to that point in the script.
     --------------------------------------------------------------------- */

  let scrubWasPlaying = false;

  function progressFromTrackEvent(e) {
    const rect = scrubTrack.getBoundingClientRect();
    const frac = (e.clientY - rect.top) / rect.height;
    return Math.min(1, Math.max(0, frac));
  }

  scrubTrack.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    state.scrubbing = true;
    scrubTrack.classList.add('is-visible');
    try { scrubTrack.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    scrubWasPlaying = state.isPlaying;
    if (state.isPlaying) pausePlayback();

    const p = progressFromTrackEvent(e);
    state.animStartProgress = p;
    scrubThumb.style.top = (p * 100).toFixed(2) + '%';
    renderFrame(p);
    showControls({ persistent: true });
  });

  scrubTrack.addEventListener('pointermove', (e) => {
    if (!state.scrubbing) return;
    e.stopPropagation();
    const p = progressFromTrackEvent(e);
    state.animStartProgress = p;
    scrubThumb.style.top = (p * 100).toFixed(2) + '%';
    renderFrame(p);
  });

  function endScrub(e) {
    if (!state.scrubbing) return;
    state.scrubbing = false;
    try { scrubTrack.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    if (scrubWasPlaying) {
      startPlayback();
    } else {
      showControls({ persistent: true });
    }
  }

  scrubTrack.addEventListener('pointerup', endScrub);
  scrubTrack.addEventListener('pointercancel', endScrub);

  /* ---------------------------------------------------------------------
     Auto-hide controls
     --------------------------------------------------------------------- */

  let autoHideTimer = null;

  function startAutoHideTimer() {
    clearAutoHideTimer();
    autoHideTimer = setTimeout(() => {
      if (state.isPlaying && !state.scrubbing) {
        // The bottom play/speed bar stays on screen while the script scrolls;
        // only the settings panel and scrub handle fade away.
        settingsPanel.classList.add('is-hidden');
        scrubTrack.classList.remove('is-visible');
      }
    }, 2200);
  }

  function clearAutoHideTimer() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  function showControls(opts) {
    opts = opts || {};
    controlsBar.classList.remove('is-hidden');
    settingsPanel.classList.remove('is-hidden');
    scrubTrack.classList.add('is-visible');
    if (state.isPlaying && !opts.persistent) {
      startAutoHideTimer();
    } else {
      clearAutoHideTimer();
    }
  }

  // Tapping directly on the controls bar should never trigger a text jump.
  controlsBar.addEventListener('pointerdown', (e) => e.stopPropagation());
  controlsBar.addEventListener('pointerup', (e) => e.stopPropagation());
  settingsPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
  settingsPanel.addEventListener('pointerup', (e) => e.stopPropagation());

  /* ---------------------------------------------------------------------
     First-run tip
     --------------------------------------------------------------------- */

  function maybeShowFirstTip() {
    if (readRaw(LS_TIP_SHOWN, null) === 'true') return;
    firstTip.classList.remove('is-hidden');
  }

  dismissTipBtn.addEventListener('click', () => {
    firstTip.classList.add('is-hidden');
    localStorage.setItem(LS_TIP_SHOWN, 'true');
  });

  /* ---------------------------------------------------------------------
     Keyboard shortcuts (desktop testing convenience)
     --------------------------------------------------------------------- */

  document.addEventListener('keydown', (e) => {
    if (!prompterView.classList.contains('is-active')) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayback();
      showControls({});
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      setWpmValue(state.wpm + 5);
      showControls({});
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      setWpmValue(state.wpm - 5);
      showControls({});
    } else if (e.key === 'r' || e.key === 'R') {
      restartPlayback();
      showControls({});
    } else if (e.key === 'Escape') {
      exitBtn.click();
    }
  });

  /* ---------------------------------------------------------------------
     Resize / orientation handling
     --------------------------------------------------------------------- */

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (prompterView.classList.contains('is-active')) {
        const progress = getCurrentProgress(performance.now());
        remeasure();
        renderFrame(progress);
      }
    }, 120);
  });

  /* ---------------------------------------------------------------------
     Service worker (offline support)
     --------------------------------------------------------------------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch((err) => {
        console.warn('Telepleo: service worker registration failed', err);
      });
    });
  }

  /* ---------------------------------------------------------------------
     Init
     --------------------------------------------------------------------- */

  function init() {
    wpmSlider.value = String(state.wpm);
    wpmValueEl.textContent = state.wpm;
    setFontSize(state.fontSize, { skipRender: true });
    setMirror(state.mirror, { skipRender: true });
    setTheme(state.theme, { skipRender: true });
    setFocusScale(state.focusScale, { skipRender: true });
    updateEditorStats();
    renderSavedScripts();
    startBtn.disabled = !scriptInput.value.trim();
  }

  init();
})();
