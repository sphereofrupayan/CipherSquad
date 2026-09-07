(function () {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let queueTail = Promise.resolve();

  function duration(ms) {
    return reducedMotion?.matches ? 0 : ms;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, duration(ms)));
  }

  function queue(tasks) {
    const run = async () => {
      for (const task of tasks) await task();
    };
    queueTail = queueTail.then(run, run);
    return queueTail;
  }

  function caption(text, options = {}) {
    window.dispatchEvent(new CustomEvent('kyle:motion-caption', {
      detail: { text: String(text || ''), transient: Boolean(options.transient) }
    }));
  }

  function labelFor(action) {
    const label = action.args?.reference?.label || 'that item';
    const labels = {
      'navigation.open': `Opening ${action.args?.page || 'that page'}...`,
      'inbox.set_filter': 'Filtering your inbox...',
      'inbox.open_email': `Finding ${label}...`,
      'calendar.open_event': `Opening ${label}...`,
      'calendar.preview_move': `Previewing a new time for ${label}...`,
      'calendar.preview_create': 'Finding a place on your calendar...',
      'work.focus': `Focusing ${label}...`,
      'ui.highlight': 'Showing you where...',
      'ui.scroll_to': 'Bringing it into view...'
    };
    return labels[action.tool] || 'Working on it...';
  }

  async function acquire(reference) {
    const element = window.MailmateObjects?.getElement(reference);
    if (!element) return false;
    element.scrollIntoView({ behavior: reducedMotion?.matches ? 'auto' : 'smooth', block: 'center' });
    element.classList.add('kyle-acquiring');
    await wait(140);
    element.classList.remove('kyle-acquiring');
    return true;
  }

  async function emphasizeSelection(reference) {
    const snapshot = window.MailmateContext?.snapshot?.() || {};
    const source = snapshot.selectedTextSource;
    if (!snapshot.selectedText || source?.type !== reference?.type || source?.id !== reference?.id) return false;
    const range = window.getSelection?.()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return false;
    const sweep = document.createElement('span');
    sweep.className = 'kyle-selection-emphasis';
    Object.assign(sweep.style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`
    });
    document.body.appendChild(sweep);
    requestAnimationFrame(() => sweep.classList.add('is-visible'));
    annotate(reference, 'Using this', 1100);
    await wait(180);
    setTimeout(() => sweep.remove(), duration(900));
    return true;
  }

  async function navigate(page) {
    const nav = window.MailmateObjects?.getElement({ type: 'page', id: page });
    const current = document.querySelector('.tab-panel.active');
    nav?.classList.add('kyle-nav-target');
    current?.classList.add('kyle-panel-leaving');
    await wait(120);
    nav?.classList.remove('kyle-nav-target');
  }

  async function focus(reference) {
    const element = window.MailmateObjects?.getElement(reference);
    if (!element) return false;
    element.classList.remove('kyle-focus');
    void element.offsetWidth;
    element.classList.add('kyle-focus');
    setTimeout(() => element.classList.remove('kyle-focus'), duration(1800));
    return true;
  }

  async function reveal(reference) {
    const element = window.MailmateObjects?.getElement(reference);
    const detail = reference?.type === 'email' ? document.getElementById('emailDetail') : element;
    if (!detail) return false;
    detail.classList.remove('kyle-reveal');
    void detail.offsetWidth;
    detail.classList.add('kyle-reveal');
    setTimeout(() => detail.classList.remove('kyle-reveal'), duration(650));
    await wait(190);
    return true;
  }

  function annotate(reference, text, timeout = 1700) {
    const element = window.MailmateObjects?.getElement(reference);
    if (!element || !text) return false;
    const note = document.createElement('span');
    note.className = 'kyle-annotation';
    note.textContent = String(text).slice(0, 90);
    document.body.appendChild(note);
    const rect = element.getBoundingClientRect();
    note.style.left = `${Math.min(window.innerWidth - note.offsetWidth - 12, Math.max(12, rect.left))}px`;
    note.style.top = `${Math.max(10, rect.top - 34)}px`;
    requestAnimationFrame(() => note.classList.add('is-visible'));
    setTimeout(() => {
      note.classList.remove('is-visible');
      setTimeout(() => note.remove(), duration(180));
    }, duration(timeout));
    return true;
  }

  async function previewMove(reference, result) {
    const element = window.MailmateObjects?.getElement(reference);
    if (!element || !result?.preview) return false;
    const ghost = element.cloneNode(true);
    const rect = element.getBoundingClientRect();
    ghost.className = `${element.className} kyle-calendar-ghost`;
    ghost.dataset.kylePreviewId = result.previewId;
    Object.assign(ghost.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', zIndex: '1800'
    });
    document.body.appendChild(ghost);
    const delta = Number(result.preview.deltaMinutes || 0) / 60 * 56;
    requestAnimationFrame(() => { ghost.style.transform = `translateY(${delta}px)`; });
    await wait(520);
    ghost.classList.add('is-settled');
    return true;
  }

  async function previewCreate(result) {
    const preview = result?.preview;
    const start = new Date(preview?.payload?.start);
    const end = new Date(preview?.payload?.end);
    if (!preview || Number.isNaN(start.getTime())) return false;
    const dayKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const grid = document.getElementById('calendarGrid');
    const column = grid?.querySelector(`[data-calendar-day="${dayKey}"]`);
    if (!column) return false;
    const startHour = Number(grid.dataset.startHour || 7);
    const minutes = start.getHours() * 60 + start.getMinutes() - startHour * 60;
    const durationMinutes = Math.max(30, (end - start) / 60000 || 60);
    const ghost = document.createElement('div');
    ghost.className = 'calendar-event-block source-ai kyle-calendar-create-ghost';
    ghost.dataset.kylePreviewId = result.previewId;
    ghost.style.top = `${Math.max(0, minutes / 60 * 56)}px`;
    ghost.style.height = `${Math.max(28, durationMinutes / 60 * 56 - 2)}px`;
    ghost.innerHTML = `<strong></strong><small>Preview</small>`;
    ghost.querySelector('strong').textContent = preview.payload.title;
    column.appendChild(ghost);
    requestAnimationFrame(() => ghost.classList.add('is-visible'));
    await wait(340);
    return true;
  }

  async function before(action) {
    caption(labelFor(action));
    if (action.tool === 'navigation.open') return navigate(action.args?.page);
    if (action.args?.reference) {
      await acquire(action.args.reference);
      await emphasizeSelection(action.args.reference);
      return true;
    }
    return wait(20);
  }

  async function after(action, result, observation) {
    document.querySelectorAll('.kyle-panel-leaving').forEach(panel => panel.classList.remove('kyle-panel-leaving'));
    if (action.tool === 'calendar.preview_move') await previewMove(action.args?.reference, result);
    if (action.tool === 'calendar.preview_create') await previewCreate(result);
    if (action.tool === 'calendar.commit_move' || action.tool === 'calendar.commit_create') {
      document.querySelector(`[data-kyle-preview-id="${action.args?.previewId}"]`)?.remove();
    }
    if (action.args?.reference) {
      await focus(action.args.reference);
      if (/open_email|open_event|work\.focus/.test(action.tool)) await reveal(action.args.reference);
    }
    const progress = observation?.satisfied ? 'Done.' : 'I could not verify that change.';
    window.dispatchEvent(new CustomEvent('kyle:action-progress', { detail: { action, progress, observation } }));
  }

  window.KyleMotion = { queue, caption, acquire, emphasizeSelection, navigate, focus, reveal, annotate, previewMove, previewCreate, before, after, wait };
})();
