(function () {
  const API_BASE = window.location.origin;

  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request returned ${response.status}`);
    return data;
  }

  const PAGES = new Set(['overview', 'inbox', 'work', 'calendar', 'automations', 'status', 'integrations', 'settings']);
  const INBOX_FILTERS = new Set(['all', 'important', 'action', 'unread']);
  const previews = new Map();

  function exactReference(args = {}) {
    const reference = args.reference || args;
    if (!reference?.type || !reference?.id) throw new Error('Kyle tool requires an exact object reference');
    return { type: String(reference.type), id: String(reference.id) };
  }

  function findEmail(id) {
    const emails = window.Kyle?.store?.context?.emails || [];
    return emails.find(email => String(email.id || email.gmail_id || email.threadId || email.subject) === String(id));
  }

  function createKyleActions() {
    return {
      openPage(page) {
        if (!PAGES.has(page)) return false;
        console.log('[Harness] navigation action', page);
        document.querySelector(`.nav-tab[data-tab="${page}"]`)?.click();
        return true;
      },

      showEmailResults(results) {
        console.log('[Harness] tool result gmail.search');
        window.Kyle.store.lastResults = results || [];
        this.openPage('inbox');
      },

      openEmail(indexOrId) {
        const results = window.Kyle.store.lastResults || [];
        const index = Number(indexOrId);
        const email = Number.isFinite(index)
          ? results[index - 1]
          : results.find(item => item.id === indexOrId);
        const exact = email || findEmail(indexOrId);
        if (!exact) return false;
        window.Kyle.store.selectedEmail = exact;
        window.dispatchEvent(new CustomEvent('harness:open-email', { detail: exact }));
        this.openPage('inbox');
        return true;
      },

      navigation: {
        openCalendar() {
          document.querySelector('.nav-tab[data-tab="calendar"]')?.click();
          return true;
        }
      },

      calendar: {
        async listEvents({ start, end, limit = 100 } = {}) {
          const url = new URL(`${API_BASE}/api/calendar/events`);
          if (start) url.searchParams.set('start', start);
          if (end) url.searchParams.set('end', end);
          url.searchParams.set('limit', String(limit));
          return readJson(await fetch(url));
        },

        async createEvent(payload) {
          const event = await readJson(await fetch(`${API_BASE}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }));
          window.dispatchEvent(new CustomEvent('harness:calendar-refresh'));
          return event;
        },

        async updateEvent(eventId, payload) {
          if (!eventId) throw new Error('No calendar event selected');
          const event = await readJson(await fetch(`${API_BASE}/api/calendar/events/${encodeURIComponent(eventId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }));
          window.dispatchEvent(new CustomEvent('harness:calendar-refresh'));
          return event;
        },

        async deleteEvent(eventId) {
          if (!eventId) throw new Error('No calendar event selected');
          const result = await readJson(await fetch(`${API_BASE}/api/calendar/events/${encodeURIComponent(eventId)}`, {
            method: 'DELETE'
          }));
          window.dispatchEvent(new CustomEvent('harness:calendar-refresh'));
          return result;
        },

        async deleteEvents(eventIds) {
          const result = await readJson(await fetch(`${API_BASE}/api/calendar/events/delete-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_ids: eventIds })
          }));
          window.dispatchEvent(new CustomEvent('harness:calendar-refresh'));
          return result;
        }
      }
    };
  }

  const actions = createKyleActions();
  // Stable tool names for Kyle/agent integrations.
  actions.calendar.list_events = actions.calendar.listEvents;
  actions.calendar.create_event = actions.calendar.createEvent;
  actions.calendar.update_event = actions.calendar.updateEvent;
  actions.calendar.delete_event = actions.calendar.deleteEvent;
  actions.navigation.open_calendar = actions.navigation.openCalendar;

  const semanticTools = {
    'navigation.open': async args => {
      const previousPage = window.MailmateContext?.snapshot?.().page || 'overview';
      const nextPage = String(args?.page || '');
      const ok = actions.openPage(nextPage);
      return { ok, undo: previousPage !== nextPage ? () => actions.openPage(previousPage) : null };
    },
    'inbox.set_filter': async args => {
      const filter = String(args?.filter || '');
      if (!INBOX_FILTERS.has(filter)) throw new Error('Unknown inbox filter');
      const previous = document.querySelector('.filter-tab.active')?.dataset.filter || 'all';
      actions.openPage('inbox');
      document.querySelector(`.filter-tab[data-filter="${filter}"]`)?.click();
      return {
        ok: true,
        undo: previous !== filter
          ? () => document.querySelector(`.filter-tab[data-filter="${previous}"]`)?.click()
          : null
      };
    },
    'inbox.open_email': async args => {
      const reference = exactReference(args);
      if (reference.type !== 'email') throw new Error('Expected an email reference');
      return { ok: actions.openEmail(reference.id) };
    },
    'calendar.open_event': async args => {
      const reference = exactReference(args);
      if (reference.type !== 'calendar-event') throw new Error('Expected a calendar event reference');
      actions.openPage('calendar');
      await new Promise(resolve => setTimeout(resolve, 80));
      const element = window.MailmateObjects?.getElement(reference);
      if (!element) throw new Error('That calendar event is not visible in this week');
      element.click();
      return { ok: true };
    },
    'work.focus': async args => {
      const reference = exactReference(args);
      actions.openPage('work');
      await new Promise(resolve => setTimeout(resolve, 60));
      const element = window.MailmateObjects?.getElement(reference);
      if (!element) throw new Error('That work item is not currently available');
      element.click();
      return { ok: true };
    },
    'ui.highlight': async args => {
      const reference = exactReference(args);
      const element = window.MailmateObjects?.getElement(reference);
      if (!element) return false;
      element.classList.remove('kyle-focus');
      void element.offsetWidth;
      element.classList.add('kyle-focus');
      setTimeout(() => element.classList.remove('kyle-focus'), 2600);
      return { ok: true };
    },
    'ui.scroll_to': async args => {
      const reference = exactReference(args);
      const element = window.MailmateObjects?.getElement(reference);
      if (!element) return false;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { ok: true };
    },
    'ui.annotate': async args => {
      const reference = exactReference(args);
      return { ok: window.KyleMotion?.annotate(reference, String(args?.text || '').slice(0, 90)) !== false };
    },
    'ui.toast': async args => {
      const message = String(args?.message || '').trim().slice(0, 180);
      if (!message) return false;
      let toast = document.getElementById('kyleToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'kyleToast';
        toast.className = 'kyle-toast';
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add('is-visible');
      clearTimeout(toast.hideTimer);
      toast.hideTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
      return { ok: true };
    },
    'calendar.preview_move': async args => {
      const reference = exactReference(args);
      if (reference.type !== 'calendar-event') throw new Error('Expected a calendar event reference');
      const event = window.AgentCalendar?.getEvents?.().find(item => String(item.id) === reference.id);
      if (!event) throw new Error('Calendar event is not available');
      const originalStart = new Date(event.start);
      const originalEnd = new Date(event.end || originalStart.getTime() + 3600000);
      const nextStart = new Date(args.start);
      if (Number.isNaN(nextStart.getTime())) throw new Error('Preview needs an exact start time');
      const nextEnd = args.end ? new Date(args.end) : new Date(nextStart.getTime() + Math.max(900000, originalEnd - originalStart));
      const previewId = `preview_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const preview = {
        id: previewId,
        kind: 'move',
        reference: { ...args.reference, type: reference.type, id: reference.id },
        original: { start: originalStart.toISOString(), end: originalEnd.toISOString() },
        next: { start: nextStart.toISOString(), end: nextEnd.toISOString() },
        deltaMinutes: (nextStart - originalStart) / 60000
      };
      previews.set(previewId, preview);
      return { ok: true, previewId, preview, requiresApproval: true };
    },
    'calendar.commit_move': async args => {
      const preview = previews.get(String(args.previewId || ''));
      if (!preview || preview.kind !== 'move') throw new Error('Move preview expired');
      const event = await actions.calendar.updateEvent(preview.reference.id, preview.next);
      previews.delete(preview.id);
      return {
        ok: true,
        event,
        reference: preview.reference,
        undo: () => actions.calendar.updateEvent(preview.reference.id, preview.original)
      };
    },
    'calendar.preview_create': async args => {
      const payload = { ...(args.payload || {}) };
      if (!payload.title || !payload.start || !payload.end) throw new Error('Calendar preview is incomplete');
      const previewId = `preview_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const preview = { id: previewId, kind: 'create', payload };
      previews.set(previewId, preview);
      return { ok: true, previewId, preview, requiresApproval: true };
    },
    'calendar.commit_create': async args => {
      const preview = previews.get(String(args.previewId || ''));
      if (!preview || preview.kind !== 'create') throw new Error('Create preview expired');
      const event = await actions.calendar.createEvent(preview.payload);
      previews.delete(preview.id);
      const reference = { type: 'calendar-event', id: String(event.id), label: event.title || preview.payload.title };
      return { ok: true, event, reference, undo: () => actions.calendar.deleteEvent(event.id) };
    },
    'calendar.inspect_event': async args => {
      const reference = exactReference(args);
      if (reference.type !== 'calendar-event') throw new Error('Expected a calendar event reference');
      const event = window.AgentCalendar?.getEvents?.().find(item => String(item.id) === reference.id);
      if (!event) throw new Error('Calendar event is not available');
      return { ok: true, event };
    },
    'calendar.delete_prepare': async args => {
      const requested = Array.isArray(args.references) ? args.references : [args.reference || args];
      const references = requested.map(item => exactReference(item));
      if (references.some(reference => reference.type !== 'calendar-event')) throw new Error('Expected calendar event references');
      const available = window.AgentCalendar?.getVisibleEvents?.() || window.AgentCalendar?.getEvents?.() || [];
      const events = references.map(reference => available.find(item => String(item.id) === reference.id)).filter(Boolean);
      if (events.length !== references.length) throw new Error('One or more calendar events are no longer available');
      const previewId = `delete_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      previews.set(previewId, { id: previewId, kind: 'delete', events, references });
      window.KyleUi?.active?.showCalendarConfirmation?.(events);
      return { ok: true, previewId, events, requiresApproval: true, approvalKind: 'calendar-delete' };
    },
    'calendar.delete_confirmed': async args => {
      const preview = previews.get(String(args.previewId || ''));
      if (!preview || preview.kind !== 'delete') throw new Error('Delete confirmation expired');
      const virtualEvents = preview.events.filter(event => event.source === 'deadline');
      const googleEvents = preview.events.filter(event => event.source !== 'deadline');
      const eventIds = googleEvents.map(event => String(event.id));
      const virtualDeleted = [];
      const failed = [];
      for (const event of virtualEvents) {
        try {
          await window.AgentCalendar?.dismissDeadline?.(event.marker);
          virtualDeleted.push({ id: event.id, marker: event.marker, source: 'deadline' });
        } catch (error) {
          failed.push({ id: event.id, error: error.message });
        }
      }
      const result = eventIds.length
        ? await actions.calendar.deleteEvents(eventIds)
        : { deleted: [], failed: [] };
      previews.delete(preview.id);
      const refreshed = await window.AgentCalendar?.refresh?.();
      const remainingIds = new Set((refreshed || []).map(event => String(event.id)));
      const verifiedDeleted = eventIds.filter(id => !remainingIds.has(id));
      failed.push(...(result.failed || []));
      eventIds.filter(id => remainingIds.has(id)).forEach(id => {
        if (!failed.some(item => String(item.id) === id)) failed.push({ id, error: 'Event still exists after refresh' });
      });
      return {
        ok: failed.length === 0,
        deletedCount: verifiedDeleted.length + virtualDeleted.length,
        failedCount: failed.length,
        deleted: [...(result.deleted || []), ...virtualDeleted],
        failed
      };
    },
    'calendar.refresh': async () => ({ ok: true, events: await window.AgentCalendar?.refresh?.() }),
    'automation.run_now': async args => {
      const reference = exactReference(args);
      if (reference.type !== 'automation') throw new Error('Expected an automation reference');
      return { ok: true, result: await window.AgentAutomations?.runNow?.(reference.id) };
    },
    'automation.enable': async args => {
      const reference = exactReference(args);
      if (reference.type !== 'automation') throw new Error('Expected an automation reference');
      return { ok: true, automation: await window.AgentAutomations?.setEnabled?.(reference.id, true) };
    },
    'automation.disable': async args => {
      const reference = exactReference(args);
      if (reference.type !== 'automation') throw new Error('Expected an automation reference');
      return { ok: true, automation: await window.AgentAutomations?.setEnabled?.(reference.id, false) };
    },
    'mail.compose': async args => {
      const draft = {
        recipient: args.recipient || args.to || '',
        to: args.to || '',
        subject: args.subject || '',
        body: args.body || ''
      };
      if (window.KyleUi?.active?.openComposer) {
        window.KyleUi.active.openComposer(draft, 'compose');
      } else {
        window.dispatchEvent(new CustomEvent('kyle:composer-open', { detail: { draft, mode: 'compose' } }));
      }
      return {
        ok: true,
        undo: () => {
          if (window.KyleUi?.active?.closeComposer) window.KyleUi.active.closeComposer();
          else window.dispatchEvent(new CustomEvent('kyle:composer-close'));
        }
      };
    },
    'mail.reply': async args => {
      const draft = {
        recipient: args.recipient || args.to || '',
        to: args.to || '',
        subject: args.subject || '',
        body: args.body || '',
        thread_id: args.thread_id || null,
        in_reply_to: args.in_reply_to || null
      };
      if (window.KyleUi?.active?.openComposer) {
        window.KyleUi.active.openComposer(draft, 'reply');
      } else {
        window.dispatchEvent(new CustomEvent('kyle:composer-open', { detail: { draft, mode: 'reply' } }));
      }
      return {
        ok: true,
        undo: () => {
          if (window.KyleUi?.active?.closeComposer) window.KyleUi.active.closeComposer();
          else window.dispatchEvent(new CustomEvent('kyle:composer-close'));
        }
      };
    },
    'mail.update_draft': async args => {
      if (window.KyleUi?.active?.setComposerDraft) {
        window.KyleUi.active.setComposerDraft(args);
      }
      return { ok: true };
    },
    'mail.send_draft': async args => {
      if (window.KyleUi?.active?.sendCurrentComposer) {
        return await window.KyleUi.active.sendCurrentComposer();
      }
      return { ok: false, error: 'Composer not available' };
    },
    'mail.close_composer': async args => {
      if (window.KyleUi?.active?.closeComposer) {
        window.KyleUi.active.closeComposer();
      } else {
        window.dispatchEvent(new CustomEvent('kyle:composer-close'));
      }
      return { ok: true };
    }
  };

  async function run(toolName, args = {}, transaction = null) {
    const tool = semanticTools[toolName];
    if (!tool) throw new Error('Tool is not allowed');
    const result = await tool(args, transaction);
    const reference = args?.reference;
    if (reference && result !== false && result?.ok !== false) window.MailmateContext?.remember?.('manipulated', reference);
    if (toolName === 'calendar.commit_move' && result?.reference) window.MailmateContext?.remember?.('modified', result.reference);
    if (toolName === 'calendar.commit_create' && result?.reference) window.MailmateContext?.remember?.('created', result.reference);
    return result;
  }

  async function execute(requestedActions = []) {
    if (window.KyleExecutor) {
      return window.KyleExecutor.execute({
        id: `run_${Date.now().toString(36)}`,
        goal: 'Kyle action',
        steps: requestedActions
      });
    }
    const results = [];
    for (const action of requestedActions.slice(0, 24)) {
      if (!semanticTools[action?.tool]) {
        results.push({ tool: action?.tool || '', ok: false, error: 'Tool is not allowed' });
        continue;
      }
      try {
        const result = await run(action.tool, action.args || {});
        results.push({ tool: action.tool, ok: result !== false && result?.ok !== false });
      } catch (error) {
        results.push({ tool: action.tool, ok: false, error: error.message });
      }
    }
    return results;
  }

  window.KyleActions = actions;
  window.KyleTools = { execute, run, previews, names: Object.freeze(Object.keys(semanticTools)) };
})();
