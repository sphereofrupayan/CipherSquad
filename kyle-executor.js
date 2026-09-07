(function () {
  const transactions = [];
  let pendingApproval = null;

  function setState(name) {
    const state = window.Kyle?.store;
    if (state?.states?.[name]) state.set(state.states[name]);
  }

  function observedNarration(transaction) {
    const completed = (transaction.steps || []).filter(step => step.status === 'complete');
    const filterStep = [...completed].reverse().find(step => step.action?.tool === 'inbox.set_filter');
    if (filterStep) {
      const count = Number(filterStep.observation?.details?.count || 0);
      const filter = filterStep.observation?.details?.filter || filterStep.action.args?.filter;
      const nouns = {
        important: ['important message', 'important messages'],
        unread: ['unread message', 'unread messages'],
        action: ['message requiring action', 'messages requiring action'],
        all: ['message', 'messages']
      };
      const [singular, plural] = nouns[filter] || nouns.all;
      if (count === 0) return `You don't have any ${plural} right now.`;
      if (count === 1) return `I found 1 ${singular}.`;
      return `I found ${count} ${plural}.`;
    }
    const opened = [...completed].reverse().find(step => step.action?.tool === 'inbox.open_email');
    if (opened) return `I opened ${opened.action.args?.reference?.label || 'that email'}.`;
    const deleted = [...completed].reverse().find(step => step.action?.tool === 'calendar.delete_confirmed');
    if (deleted) {
      const count = Number(deleted.result?.deletedCount || 0);
      const failed = Number(deleted.result?.failedCount || 0);
      return failed ? `${count} deleted. ${failed} could not be removed.` : `${count} calendar event${count === 1 ? '' : 's'} deleted.`;
    }
    const navigation = [...completed].reverse().find(step => step.action?.tool === 'navigation.open');
    if (navigation) {
      const page = navigation.action.args?.page || 'page';
      return `${page.charAt(0).toUpperCase()}${page.slice(1)} opened.`;
    }
    if (transaction.status === 'failed' || transaction.status === 'blocked') return 'I could not complete that action.';
    return '';
  }

  async function executePlan(plan) {
    const transaction = {
      id: plan.id,
      goal: plan.goal,
      status: 'running',
      steps: [],
      changedObjects: [],
      undo: [],
      startedAt: new Date().toISOString()
    };
    transactions.push(transaction);
    if (transactions.length > 20) transactions.shift();
    setState('ACTING');

    for (const action of plan.steps || []) {
      const policy = window.KylePolicy?.evaluate(action) || { allowed: false, reason: 'Policy unavailable.' };
      if (!policy.allowed) {
        transaction.steps.push({ action, status: policy.approvalRequired ? 'waiting-approval' : 'blocked', policy });
        transaction.status = policy.approvalRequired ? 'waiting-approval' : 'blocked';
        if (policy.approvalRequired) setState('WAITING_APPROVAL');
        window.KyleMotion?.caption(policy.reason, { transient: true });
        break;
      }

      const step = { action, status: 'running', startedAt: new Date().toISOString() };
      transaction.steps.push(step);
      window.dispatchEvent(new CustomEvent('kyle:action-start', { detail: { transaction, action } }));

      try {
        await window.KyleMotion?.before(action);
        const before = window.KyleObservation?.capture(action);
        const result = await window.KyleTools.run(action.tool, action.args || {}, transaction);
        setState('OBSERVING');
        const observation = await window.KyleObservation?.after(action, before, result);
        await window.KyleMotion?.after(action, result, observation);
        step.status = observation?.satisfied === false ? 'unverified' : 'complete';
        step.result = result;
        step.observation = observation;
        if (typeof result?.undo === 'function') transaction.undo.push(result.undo);
        if (action.args?.reference && result !== false) transaction.changedObjects.push(action.args.reference);
        window.dispatchEvent(new CustomEvent('kyle:action-complete', { detail: { transaction, action, result, observation } }));
        if (result?.requiresApproval && result?.previewId) {
          const commitTool = action.tool === 'calendar.preview_move' ? 'calendar.commit_move'
            : action.tool === 'calendar.preview_create' ? 'calendar.commit_create'
              : action.tool === 'calendar.delete_prepare' ? 'calendar.delete_confirmed'
              : null;
          if (commitTool) {
            pendingApproval = {
              transaction,
              action: { tool: commitTool, args: { previewId: result.previewId, approved: true } }
            };
            transaction.status = 'waiting-approval';
            transaction.pendingApproval = { tool: commitTool, previewId: result.previewId };
            setState('WAITING_APPROVAL');
            window.KyleMotion?.caption(
              commitTool === 'calendar.delete_confirmed'
                ? 'Review the event list, then confirm or cancel.'
                : 'Preview ready. Say confirm to save it.',
              { transient: true }
            );
            break;
          }
        }
      } catch (error) {
        step.status = 'failed';
        step.error = error.message;
        transaction.status = 'failed';
        window.dispatchEvent(new CustomEvent('kyle:action-complete', { detail: { transaction, action, error: error.message } }));
        break;
      }
      setState('ACTING');
    }

    if (transaction.status === 'running') transaction.status = 'complete';
    transaction.narration = observedNarration(transaction);
    transaction.completedAt = new Date().toISOString();
    if (transaction.status === 'complete') setState('DONE');
    return transaction;
  }

  function execute(plan) {
    return window.KyleMotion?.queue
      ? window.KyleMotion.queue([() => executePlan(plan)])
      : executePlan(plan);
  }

  async function undoLast() {
    const transaction = [...transactions].reverse().find(item => item.status === 'complete' && item.undo.length);
    if (!transaction) return { ok: false, message: 'There is nothing I can safely undo yet.' };
    setState('ACTING');
    window.KyleMotion?.caption('Putting that back...');
    for (const undo of [...transaction.undo].reverse()) await undo();
    transaction.status = 'undone';
    setState('DONE');
    return { ok: true, message: 'Done. I put it back.' };
  }

  async function approvePending() {
    if (!pendingApproval) return { ok: false, message: 'There is no preview waiting for approval.' };
    const pending = pendingApproval;
    pendingApproval = null;
    pending.transaction.status = 'preview-approved';
    const transaction = await execute({
      id: `run_${Date.now().toString(36)}_approval`,
      goal: `Approve ${pending.action.tool}`,
      steps: [pending.action]
    });
    const result = transaction.steps?.at(-1)?.result || {};
    return transaction.status === 'complete'
      ? { ok: true, message: transaction.narration || 'Done. I saved the change.', result }
      : { ok: false, message: 'I could not save that change.' };
  }

  function cancelPending() {
    if (!pendingApproval) return { ok: false, message: 'There is no preview to cancel.' };
    const previewId = pendingApproval.action.args.previewId;
    window.KyleTools?.previews?.delete(previewId);
    document.querySelector(`[data-kyle-preview-id="${previewId}"]`)?.remove();
    pendingApproval.transaction.status = 'cancelled';
    pendingApproval = null;
    window.KyleUi?.active?.closeSurface?.();
    setState('DONE');
    return { ok: true, message: 'Cancelled. I did not change your calendar.' };
  }

  window.KyleExecutor = {
    execute,
    undoLast,
    approvePending,
    cancelPending,
    observedNarration,
    transactions,
    latest: () => transactions.at(-1) || null,
    pending: () => pendingApproval
  };
})();
