(function () {
  function snapshot() {
    return window.MailmateContext?.snapshot?.() || {};
  }

  function capture(action) {
    const reference = action?.args?.reference;
    const element = reference ? window.MailmateObjects?.getElement(reference) : null;
    return {
      context: snapshot(),
      reference,
      connected: Boolean(element?.isConnected),
      rect: element?.getBoundingClientRect?.().toJSON?.() || null
    };
  }

  async function after(action, before, result) {
    await new Promise(resolve => setTimeout(resolve, 20));
    const current = snapshot();
    let satisfied = result !== false && result?.ok !== false;
    const details = {};
    if (action.tool === 'navigation.open') satisfied = current.page === action.args?.page;
    if (action.tool === 'inbox.set_filter') {
      const activeFilter = document.querySelector('.filter-tab.active')?.dataset.filter || '';
      details.filter = activeFilter;
      details.count = document.querySelectorAll('#emailList .email-item').length;
      satisfied = activeFilter === action.args?.filter;
    }
    if (action.tool === 'inbox.open_email') {
      satisfied = current.open?.type === 'email' && current.open?.id === action.args?.reference?.id;
    }
    if (action.tool === 'calendar.open_event') {
      satisfied = current.open?.type === 'calendar-event' && current.open?.id === action.args?.reference?.id;
    }
    return { satisfied, before: before?.context || {}, after: current, details };
  }

  window.KyleObservation = { snapshot, capture, after };
})();
