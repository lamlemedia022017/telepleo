/* ==========================================================================
   Telepleo — PIN screen (ONLINE COPY ONLY)

   This file is a template. build_online.py fills in SALT, HASH and ITER from
   the PIN you type, and writes the finished file into the online folder.
   The PIN itself is never stored — only a salted PBKDF2-SHA256 hash.

   What this is: a casual lock. It keeps people who stumble on the link from
   opening the app. It is NOT strong security — the checking happens in the
   browser, so someone technical can read the page files directly, and a short
   PIN can be guessed. Nothing secret lives in the app: your scripts stay in
   each browser's own storage and are never uploaded.
   ========================================================================== */

(function () {
  'use strict';

  var SALT = '811a184d3e48e06ea3eb7a5dabf97648';        // hex
  var HASH = 'dd7b2319177883aba91b02fcda1df61d2d866fa630d5781fee5f0b4d3aba0a72';        // hex, PBKDF2-SHA256, 32 bytes
  var ITER = 200000;          // PBKDF2 iterations
  var STORE_KEY = 'telepleo.gate';
  var REMEMBER_DAYS = 30;       // how long a device stays unlocked
  var MAX_TRIES = 5;            // wrong tries before a short pause
  var PAUSE_SECONDS = 30;

  /* ---- helpers ---------------------------------------------------------- */

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2);
    return s;
  }

  // Changes whenever the PIN changes, so a new PIN re-locks every device.
  function token() { return HASH.slice(0, 16); }

  function isRemembered() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      return !!v && v.k === token() && (Date.now() - v.t) < REMEMBER_DAYS * 86400000;
    } catch (e) { return false; }
  }

  function remember() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ k: token(), t: Date.now() })); } catch (e) {}
  }

  function derive(pin) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt: hexToBytes(SALT), iterations: ITER, hash: 'SHA-256' },
          key, 256);
      })
      .then(bytesToHex);
  }

  /* ---- already unlocked on this device? --------------------------------- */

  if (isRemembered()) return;

  /* ---- lock the page ---------------------------------------------------- */

  var root = document.documentElement;
  root.classList.add('tp-locked');

  var style = document.createElement('style');
  style.textContent =
    'html.tp-locked #app{visibility:hidden}' +
    'html.tp-locked,html.tp-locked body{background:#0a0a0a}' +
    '#tp-gate{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:14px;padding:24px;background:#0a0a0a;color:#f5f5f5;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;text-align:center}' +
    '#tp-gate h1{margin:0;font-size:28px;font-weight:700;letter-spacing:.2px}' +
    '#tp-gate p{margin:0;color:#9a9a9a;font-size:15px}' +
    '#tp-gate form{display:flex;flex-direction:column;align-items:center;gap:14px;margin-top:6px}' +
    '#tp-pin{width:220px;padding:14px 12px;font-size:28px;text-align:center;letter-spacing:.35em;' +
    'color:#f5f5f5;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);' +
    'border-radius:12px;outline:none}' +
    '#tp-pin:focus{border-color:#4fd1c5}' +
    '#tp-go{width:220px;padding:14px;font-size:17px;font-weight:600;color:#002826;background:#4fd1c5;' +
    'border:0;border-radius:12px;cursor:pointer}' +
    '#tp-go:disabled{background:rgba(255,255,255,.08);color:#9a9a9a;cursor:not-allowed}' +
    '#tp-msg{min-height:20px;font-size:14px;color:#ff6b6b}' +
    '@keyframes tp-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}' +
    '#tp-pin.tp-shake{animation:tp-shake .3s}';
  document.head.appendChild(style);

  function build() {
    var gate = document.createElement('div');
    gate.id = 'tp-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-label', 'Enter PIN');
    gate.innerHTML =
      '<h1>Telepleo</h1>' +
      '<p>Enter your PIN to continue</p>' +
      '<form id="tp-form" autocomplete="off">' +
      '<input id="tp-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" ' +
      'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="PIN">' +
      '<button id="tp-go" type="submit">Unlock</button>' +
      '<div id="tp-msg" role="alert" aria-live="polite"></div>' +
      '</form>';
    document.body.appendChild(gate);

    var form = document.getElementById('tp-form');
    var pinEl = document.getElementById('tp-pin');
    var goEl = document.getElementById('tp-go');
    var msgEl = document.getElementById('tp-msg');
    var tries = 0;

    if (!(window.crypto && crypto.subtle)) {
      msgEl.textContent = 'This page needs a secure (https) connection to check the PIN.';
      goEl.disabled = true;
      pinEl.disabled = true;
      return;
    }

    pinEl.focus();

    function pause() {
      var left = PAUSE_SECONDS;
      goEl.disabled = true;
      pinEl.disabled = true;
      var t = setInterval(function () {
        msgEl.textContent = 'Too many tries. Wait ' + left + 's.';
        if (left-- <= 0) {
          clearInterval(t);
          tries = 0;
          goEl.disabled = false;
          pinEl.disabled = false;
          msgEl.textContent = '';
          pinEl.focus();
        }
      }, 1000);
      msgEl.textContent = 'Too many tries. Wait ' + left + 's.';
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pin = pinEl.value.trim();
      if (!pin) return;
      goEl.disabled = true;
      derive(pin).then(function (h) {
        if (h === HASH) {
          remember();
          root.classList.remove('tp-locked');
          gate.parentNode.removeChild(gate);
          return;
        }
        tries++;
        pinEl.value = '';
        pinEl.classList.remove('tp-shake');
        void pinEl.offsetWidth;           // restart the shake animation
        pinEl.classList.add('tp-shake');
        goEl.disabled = false;
        if (tries >= MAX_TRIES) { pause(); } else { msgEl.textContent = 'Wrong PIN. Try again.'; pinEl.focus(); }
      }).catch(function () {
        goEl.disabled = false;
        msgEl.textContent = 'Could not check the PIN on this browser.';
      });
    });
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
