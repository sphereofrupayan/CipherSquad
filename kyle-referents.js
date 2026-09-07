(function () {
  const REFERENCE_PATTERN = /\b(this one|that one|the selected one|the open one|this|that|it|these|those)\b/ig;

  function expectedType(prompt) {
    const text = String(prompt || '').toLowerCase();
    if (/\bemail\s+for\s+(this|that|the)\s+event\b/.test(text)) return 'calendar-event';
    if (/\b(add|put|save)\s+(this|that|it)\s+(to|on)\s+(my\s+)?calendar\b/.test(text)) return 'email';
    if (/\b(reply|email|message|sender|archive|star|unread|inbox)\b/.test(text)) return 'email';
    if (/\b(calendar|event|meeting|schedule|reschedule|move|appointment)\b/.test(text)) return 'calendar-event';
    if (/\b(task|work item|action item|blocker)\b/.test(text)) return 'work-item';
    return null;
  }

  function relationalCandidate(text, type, context) {
    const lower = text.toLowerCase();
    if (/\b(last thing|last event|last item)\s+(you\s+)?created\b/.test(lower)) {
      return context.references?.lastCreated || null;
    }
    if (/\b(email|message)\s+i\s+just\s+opened\b/.test(lower)) {
      const candidate = context.references?.lastOpened;
      return candidate?.type === 'email' ? candidate : null;
    }

    if (/\b(next email|email below|one below)\b/.test(lower) || /\b(one above|previous email|email above)\b/.test(lower)) {
      const anchor = context.selected?.type === 'email' ? context.selected : context.open;
      const element = window.MailmateObjects?.getElement(anchor);
      const rows = [...(element?.parentElement?.querySelectorAll?.('[data-kyle-type="email"][data-kyle-id]') || [])];
      const index = rows.indexOf(element);
      const delta = /\b(one above|previous email|email above)\b/.test(lower) ? -1 : 1;
      return index >= 0 ? window.MailmateObjects?.getFromElement(rows[index + delta]) : null;
    }

    const visible = context.visibleObjects || [];
    if (/\b(red|clashing|conflicting)\s+(event|meeting)\b/.test(lower)) {
      const events = visible.filter(item => item.type === 'calendar-event' && (item.metadata?.conflict === 'true' || item.metadata?.urgency === 'clash'));
      return events.length === 1 ? events[0] : null;
    }

    const fromMatch = lower.match(/\b(?:email|one|message)\s+from\s+([a-z][a-z\s.'-]{1,40})/i);
    if (fromMatch) {
      const needle = fromMatch[1].trim();
      const emails = visible.filter(item => item.type === 'email' && `${item.label} ${item.metadata?.sender || ''}`.toLowerCase().includes(needle));
      return emails.length === 1 ? emails[0] : null;
    }

    const afterMatch = lower.match(/\b(?:event|meeting)\s+after\s+(.+?)(?:[?.]|$)/i);
    if (afterMatch) {
      const events = visible
        .filter(item => item.type === 'calendar-event')
        .sort((a, b) => String(a.metadata?.start || '').localeCompare(String(b.metadata?.start || '')));
      const anchorIndex = events.findIndex(item => item.label.toLowerCase().includes(afterMatch[1].trim()));
      return anchorIndex >= 0 ? events[anchorIndex + 1] || null : null;
    }

    return null;
  }

  function matches(reference, type) {
    return Boolean(reference && (!type || reference.type === type));
  }

  function unique(references) {
    const seen = new Set();
    return references.filter(reference => {
      const key = `${reference?.type}:${reference?.id}`;
      if (!reference?.type || !reference?.id || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function resolvePrompt(prompt) {
    const text = String(prompt || '').trim();
    const mentions = [...text.matchAll(REFERENCE_PATTERN)].map(match => match[0].toLowerCase());
    const hasRelationalReference = /\b(next email|email below|one below|one above|previous email|email above|red event|clashing event|conflicting event|email i just opened|message i just opened|last thing (?:you )?created|event after|meeting after|email from|message from)\b/i.test(text);
    const hasReference = mentions.length > 0 || hasRelationalReference;
    const type = expectedType(text);
    const context = window.MailmateContext?.snapshot?.() || {};
    const relation = hasRelationalReference ? relationalCandidate(text, type, context) : null;

    if (!hasReference) {
      return { hasReference: false, references: [], unresolved: false, context };
    }

    if (hasRelationalReference) {
      if (!relation || !matches(relation, type)) return clarification(type, context, []);
      window.MailmateContext?.remember?.('mentioned', relation);
      return {
        hasReference: true,
        references: [relation],
        bindings: { relation },
        unresolved: false,
        confidence: 'high',
        reason: 'relational reference',
        expectedType: type,
        context
      };
    }

    const tiers = [
      ['selected text source', [context.selectedText ? context.selectedTextSource : null]],
      ['selected object', [context.selected]],
      ['open object', [context.open]],
      ['hovered object', [context.hovered]],
      ['focused object', [context.focused]],
      ['last clicked object', [context.lastClicked]],
      ['last manipulated object', [context.references?.lastManipulated]],
      ['recently mentioned object', [context.references?.lastMentioned, context.references?.lastOpened]],
      ['visible object', context.visibleObjects || []]
    ];

    const resolved = [];
    const bindings = {};
    const reasons = [];
    for (const mention of mentions) {
      let found = null;
      for (const [reason, references] of tiers) {
        const candidates = unique(references
          .filter(reference => matches(reference, type))
          .filter(reference => mentions.length === 1 || !resolved.some(item => item.type === reference.type && item.id === reference.id)));
        if (candidates.length === 1) {
          found = candidates[0];
          reasons.push(reason);
          break;
        }
        if (candidates.length > 1) return clarification(type, context, candidates);
      }
      if (!found) return clarification(type, context, []);
      resolved.push(found);
      bindings[mention] = found;
    }

    resolved.forEach(reference => window.MailmateContext?.remember?.('mentioned', reference));
    return {
      hasReference: true,
      references: resolved,
      bindings,
      unresolved: false,
      confidence: reasons.includes('visible object') ? 'medium' : 'high',
      reason: reasons.join(', '),
      expectedType: type,
      context
    };
  }

  function clarification(type, context, candidates) {
    const noun = type === 'calendar-event' ? 'calendar event' : type === 'email' ? 'email' : type === 'work-item' ? 'work item' : 'item';
    return {
      hasReference: true,
      references: [],
      unresolved: true,
      ambiguous: candidates.length > 1,
      expectedType: type,
      context,
      clarification: candidates.length > 1
        ? `Which ${noun} do you mean? Select or open it first.`
        : `Which ${noun} do you mean? Click it, then ask me again.`
    };
  }

  window.KyleReferents = { resolvePrompt, expectedType };
})();
