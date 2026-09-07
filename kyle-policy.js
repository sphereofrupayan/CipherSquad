(function () {
  const UI_TOOLS = new Set([
    'navigation.open', 'inbox.set_filter', 'inbox.open_email', 'calendar.open_event',
    'work.focus', 'ui.highlight', 'ui.scroll_to', 'ui.annotate', 'ui.toast',
    'calendar.preview_move', 'calendar.preview_create'
  ]);
  const WRITE_TOOLS = new Set(['calendar.commit_move', 'calendar.commit_create']);
  const DESTRUCTIVE_TOOLS = new Set(['calendar.delete', 'inbox.send_reply']);

  function evaluate(action = {}) {
    const tool = String(action.tool || '');
    if (UI_TOOLS.has(tool)) return { allowed: true, risk: 'ui' };
    if (WRITE_TOOLS.has(tool)) {
      const previewId = String(action.args?.previewId || '');
      if (!previewId) return { allowed: false, reason: 'A visible preview is required before this write.' };
      if (!action.args?.approved) return { allowed: false, approvalRequired: true, reason: 'Review the preview, then confirm the change.' };
      return { allowed: true, risk: 'write' };
    }
    if (DESTRUCTIVE_TOOLS.has(tool)) {
      return { allowed: false, approvalRequired: true, reason: 'This action needs explicit confirmation.' };
    }
    return { allowed: false, reason: 'Tool is not in Kyle policy.' };
  }

  window.KylePolicy = { evaluate };
})();
