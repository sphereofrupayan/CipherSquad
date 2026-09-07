(() => {
  'use strict';

  const IDLE_POLL_MS = 12000;
  const ACTIVE_POLL_MS = 3500;
  const FAILURE_THRESHOLD = 3;
  const SUCCESS_THRESHOLD = 2;
  const ACTIVE = new Set([
    'waiting_local_model','compute_retrying','resuming','queued','planning',
    'reading_context','researching','generating','drafting_reply',
    'creating_files','verifying','preparing','working'
  ]);

  const runtime = {
    timer: null,
    busy: false,
    stableReady: null,
    failures: 0,
    successes: 0,
    resumedCycle: false
  };

  async function api(url, options = {}) {
    const r = await fetch(url, { cache: 'no-store', ...options });
    let body = {};
    try { body = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(body.error || `${url} returned ${r.status}`);
    return body;
  }

  function stable(raw) {
    if (raw.ready) {
      runtime.successes++;
      runtime.failures = 0;
      if (runtime.stableReady === null) runtime.stableReady = true;
      if (runtime.successes >= SUCCESS_THRESHOLD) runtime.stableReady = true;
    } else {
      runtime.failures++;
      runtime.successes = 0;
      if (runtime.failures >= FAILURE_THRESHOLD) runtime.stableReady = false;
    }
    return { ...raw, rawReady: raw.ready, ready: runtime.stableReady === null ? true : runtime.stableReady };
  }

  function banner() {
    const tab = document.querySelector('#tab-work');
    if (!tab) return null;
    let el = document.querySelector('#kyleComputeBanner');
    if (el) return el;
    el = document.createElement('section');
    el.id = 'kyleComputeBanner';
    el.className = 'kyle-compute-banner';
    el.hidden = true;
    el.innerHTML = `
      <div class="kyle-compute-copy">
        <div class="kyle-compute-title-row">
          <strong id="kyleComputeTitle">Kyle Work</strong>
          <span id="kyleComputeState" class="kyle-compute-state">Checking</span>
        </div>
        <p id="kyleComputeMessage"></p>
        <small id="kyleComputeMeta"></small>
      </div>
      <div class="kyle-compute-actions">
        <button id="kyleComputeRetry" type="button" class="secondary-btn">Retry</button>
        <button id="kyleWorkResume" type="button" class="primary-btn" hidden>Resume</button>
      </div>`;
    tab.insertBefore(el, tab.firstElementChild);
    el.querySelector('#kyleComputeRetry')?.addEventListener('click', () => poll(true));
    el.querySelector('#kyleWorkResume')?.addEventListener('click', async () => {
      await resumeWaiting();
      await poll(true);
    });
    return el;
  }

  async function jobs() {
    try {
      const value = await api('/api/work/jobs');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  const waiting = list => list.filter(j => j?.status === 'waiting_local_model');
  const active = list => list.filter(j => ACTIVE.has(j?.status));

  async function resumeWaiting() {
    const list = waiting(await jobs());
    await Promise.allSettled(
      list.map(j => api(`/api/work/jobs/${encodeURIComponent(j.id)}/run`, { method: 'POST' }))
    );
    window.dispatchEvent(new CustomEvent('mailmate:work-refresh'));
  }

  function paint(c, list) {
    const el = banner();
    if (!el) return;
    const w = waiting(list);
    const a = active(list);

    if (!w.length && !a.length) {
      el.hidden = true;
      return;
    }

    const title = el.querySelector('#kyleComputeTitle');
    const state = el.querySelector('#kyleComputeState');
    const msg = el.querySelector('#kyleComputeMessage');
    const meta = el.querySelector('#kyleComputeMeta');
    const retry = el.querySelector('#kyleComputeRetry');
    const resume = el.querySelector('#kyleWorkResume');

    el.hidden = false;
    el.classList.remove('is-ready','needs-hotspot','needs-config','needs-compute');

    if (c.ready) {
      el.classList.add('is-ready');
      title.textContent = 'Kyle Work compute ready';
      state.textContent = c.mode === 'remote_local' ? 'TAILSCALE AI READY' : 'LOCAL AI READY';
      if (!c.rawReady) {
        msg.textContent = 'Connection briefly dipped. Kyle is keeping the job alive while retrying.';
        meta.textContent = 'Transient failure suppressed · progress preserved';
      } else {
        msg.textContent = c.mode === 'remote_local'
          ? 'Using Priyam’s workstation over Tailscale.'
          : 'Using LM Studio on this device.';
        meta.textContent = w.length ? `${w.length} paused job${w.length === 1 ? '' : 's'} ready to resume.` : 'Private local inference';
      }
      retry.hidden = true;
      resume.hidden = w.length === 0;
      return;
    }

    el.classList.add('needs-compute');
    title.textContent = 'Kyle Work is waiting for compute';
    state.textContent = 'AI PAUSED';

    if (c.role === 'host') {
      msg.textContent = 'Start/check LM Studio Local API on this workstation.';
      meta.textContent = 'Expected: 127.0.0.1:2806 · Work progress remains saved.';
    } else {
      msg.textContent = 'Make sure Tailscale is connected and Priyam’s workstation is online.';
      meta.textContent = 'Work progress remains saved and will resume when compute is stable.';
    }
    retry.hidden = false;
    resume.hidden = true;
  }

  async function poll(force = false) {
    if (runtime.busy && !force) return;
    runtime.busy = true;
    let list = [];
    try {
      const [raw, current] = await Promise.all([api('/api/compute/status'), jobs()]);
      list = current;
      const c = stable(raw);
      paint(c, list);

      if (c.rawReady && runtime.successes >= SUCCESS_THRESHOLD && !runtime.resumedCycle && waiting(list).length) {
        runtime.resumedCycle = true;
        await resumeWaiting();
      }
      if (!c.rawReady) runtime.resumedCycle = false;
    } catch (error) {
      runtime.failures++;
      runtime.successes = 0;
      if (runtime.failures >= FAILURE_THRESHOLD) {
        runtime.stableReady = false;
        const el = banner();
        if (el && (active(list).length || waiting(list).length)) {
          el.hidden = false;
          el.classList.add('needs-compute');
          el.querySelector('#kyleComputeState').textContent = 'STATUS OFFLINE';
          el.querySelector('#kyleComputeMessage').textContent = 'Could not verify the local/Tailscale compute route.';
          el.querySelector('#kyleComputeMeta').textContent = 'Check Flask, Tailscale and LM Studio. Progress remains saved.';
        }
      }
      console.warn('[Kyle Compute]', error);
    } finally {
      runtime.busy = false;
      clearTimeout(runtime.timer);
      runtime.timer = setTimeout(() => poll(false), active(list).length ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    }
  }

  function start() {
    banner();
    poll(true);
    window.addEventListener('focus', () => poll(true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });
    window.addEventListener('mailmate:work-refresh', () => poll(true));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
