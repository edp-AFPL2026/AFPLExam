/* Shared helpers for the student site and the admin dashboard */
(function () {
  'use strict';

  // The server clock is the only clock that counts. Every response that contains serverTime re-syncs it.
  const Clock = {
    offset: 0,
    sync(serverTime) {
      if (typeof serverTime === 'number') this.offset = serverTime - Date.now();
    },
    now() {
      return Date.now() + this.offset;
    },
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, opts) {
    const o = opts || {};
    const headers = {};
    let body;
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    if (o.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(o.json);
    } else if (o.form) {
      body = o.form; // the browser sets the multipart header itself
    }

    let res;
    try {
      res = await fetch(`/api${path}`, { method: o.method || 'GET', headers, body, keepalive: !!o.keepalive });
    } catch (e) {
      const err = new Error('Cannot reach the server. Check your internet connection and try again.');
      err.status = 0;
      throw err;
    }

    if (o.blob) {
      if (!res.ok) {
        const err = new Error(`Download failed (${res.status})`);
        err.status = res.status;
        throw err;
      }
      return res.blob();
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = { error: text.slice(0, 200) };
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    if (data && typeof data.serverTime === 'number') Clock.sync(data.serverTime);
    return data;
  }

  function toast(message, type) {
    let box = $('#toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = `toast ${type || ''}`;
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.remove(), type === 'error' ? 7000 : 4000);
  }

  /** Opens a modal. Returns { el, close }. `html` is trusted markup (escape user text with esc()). */
  function openModal(html, opts) {
    const o = opts || {};
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${o.wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    const previous = document.activeElement;
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey);
      if (previous && previous.focus) previous.focus();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !o.locked) close();
    };
    document.addEventListener('keydown', onKey);
    if (!o.locked) back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    const first = back.querySelector('input, select, textarea, button');
    if (first) first.focus();
    return { el: back.firstElementChild, close };
  }

  function confirmModal({ title, body, confirmText, cancelText, danger }) {
    return new Promise((resolve) => {
      const m = openModal(
        `<h2>${esc(title)}</h2><div>${body}</div>
         <div class="modal-actions">
           <button class="btn btn-ghost" data-no>${esc(cancelText || 'Cancel')}</button>
           <button class="btn ${danger ? 'btn-red' : 'btn-primary'}" data-yes>${esc(confirmText || 'Confirm')}</button>
         </div>`
      );
      m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
      m.el.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
    });
  }

  const pad = (n) => String(n).padStart(2, '0');

  /** 3725000 -> "1:02:05",  125000 -> "02:05" */
  function fmtClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  /** Long countdown: "2 days 03:12:09" */
  function fmtCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${d ? `${d} day${d > 1 ? 's' : ''} ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  const letter = (i) => String.fromCharCode(65 + i);

  window.AF = { Clock, $, $$, esc, api, toast, openModal, confirmModal, fmtClock, fmtCountdown, fmtDateTime, fmtDate, fmtTime, signed, letter };
})();
