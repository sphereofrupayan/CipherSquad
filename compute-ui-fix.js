(() => {
  'use strict';

  const ACTIVE = new Set([
    'waiting_local_model', 'queued', 'planning', 'reading_context',
    'researching', 'generating', 'drafting_reply', 'creating_files',
    'verifying', 'preparing', 'working'
  ]);

  async function json(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  }

  function setText(el, value) {
    if (el) el.textContent = value;
  }

  async function refreshCompactCompute() {
    const banner = document.querySelector('#kyleComputeBanner');
    if (!banner) return;

    let jobs = [];
    try {
      const result = await json('/api/work/jobs');
      jobs = Array.isArray(result) ? result : [];
    } catch (_) {}

    const active = jobs.filter(j => ACTIVE.has(j?.status));
    const waiting = jobs.filter(j => j?.status === 'waiting_local_model');

    // History-only Work page should not display a compute warning at all.
    if (!active.length && !waiting.length) {
      banner.hidden = true;
      banner.classList.remove('mailmate-compute-compact');
      return;
    }

    let compute;
    try {
      compute = await json('/api/compute/status');
    } catch (_) {
      banner.hidden = false;
      banner.classList.add('mailmate-compute-compact', 'needs-compute');
      setText(banner.querySelector('#kyleComputeTitle'), 'Kyle Work paused');
      setText(banner.querySelector('#kyleComputeState'), 'BACKEND OFFLINE');
      setText(banner.querySelector('#kyleComputeMessage'), 'Restart the Flask backend, then retry.');
      return;
    }

    banner.classList.add('mailmate-compute-compact');
    banner.classList.remove('needs-hotspot', 'needs-config', 'needs-compute', 'is-ready');

    const title = banner.querySelector('#kyleComputeTitle');
    const state = banner.querySelector('#kyleComputeState');
    const message = banner.querySelector('#kyleComputeMessage');
    const meta = banner.querySelector('#kyleComputeMeta');
    const retry = banner.querySelector('#kyleComputeRetry');
    const resume = banner.querySelector('#kyleWorkResume');

    if (compute.ready) {
      banner.classList.add('is-ready');
      banner.hidden = waiting.length === 0;
      setText(title, 'Kyle Work ready');
      setText(state, compute.mode === 'remote_local' ? 'TEAM AI' : 'LOCAL AI');
      setText(message, waiting.length ? `${waiting.length} paused job${waiting.length === 1 ? '' : 's'} ready to resume.` : '');
      setText(meta, compute.mode === 'remote_local' ? 'Private hotspot compute' : 'LM Studio local compute');
      if (retry) retry.hidden = true;
      if (resume) resume.hidden = waiting.length === 0;
      return;
    }

    banner.hidden = false;
    banner.classList.add('needs-compute');
    setText(title, 'Kyle Work paused');
    setText(state, 'AI OFFLINE');

    if (compute.role === 'host') {
      setText(message, 'Start the LM Studio local API server on this workstation.');
      setText(meta, 'Expected: 127.0.0.1:2806. You do not need to connect this laptop to its own hotspot.');
    } else {
      setText(message, `Connect this laptop to ${compute.connect_label || "Priyam's hotspot"}.`);
      setText(meta, 'Mailmate will use Priyamâ€™s workstation over the private LAN automatically.');
    }

    if (retry) {
      retry.hidden = false;
      retry.innerHTML = '<i class="fas fa-rotate-right"></i> Retry';
    }
    if (resume) resume.hidden = true;
  }

  function start() {
    refreshCompactCompute();
    setInterval(refreshCompactCompute, 4000);
    window.addEventListener('focus', refreshCompactCompute);
    window.addEventListener('mailmate:work-refresh', refreshCompactCompute);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
