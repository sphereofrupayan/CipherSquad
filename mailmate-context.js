(function () {
  const state = {
    page: 'overview',
    selected: null,
    open: null,
    hovered: null,
    focused: null,
    lastClicked: null,
    selectedText: '',
    selectedTextSource: null,
    references: {
      lastMentioned: null,
      lastOpened: null,
      lastCreated: null,
      lastModified: null,
      lastManipulated: null
    }
  };

  let hoverTimer = null;

  function sameReference(left, right) {
    return Boolean(left && right && left.type === right.type && left.id === right.id);
  }

  function setPage(page) {
    state.page = String(page || 'overview');
    state.hovered = null;
    state.focused = null;
    emit();
  }

  function select(reference) {
    state.selected = reference || null;
    if (reference) state.references.lastMentioned = reference;
    emit();
  }

  function open(reference) {
    state.open = reference || null;
    if (reference) {
      state.references.lastOpened = reference;
      state.references.lastMentioned = reference;
    }
    emit();
  }

  function clear(reference) {
    if (!reference || sameReference(state.selected, reference)) state.selected = null;
    if (!reference || sameReference(state.open, reference)) state.open = null;
    emit();
  }

  function remember(kind, reference) {
    const names = {
      mentioned: 'lastMentioned',
      opened: 'lastOpened',
      created: 'lastCreated',
      modified: 'lastModified',
      manipulated: 'lastManipulated'
    };
    const name = names[kind] || kind;
    if (name in state.references) state.references[name] = reference || null;
    emit();
  }

  function snapshot() {
    const visibleObjects = window.MailmateObjects?.listVisible({ page: state.page, limit: 12 }) || [];
    return {
      page: state.page,
      selected: state.selected,
      open: state.open,
      hovered: state.hovered,
      focused: state.focused,
      lastClicked: state.lastClicked,
      selectedText: String(state.selectedText || '').slice(0, 280),
      selectedTextSource: state.selectedTextSource,
      references: { ...state.references },
      visibleObjects
    };
  }

  function emit() {
    window.dispatchEvent(new CustomEvent('mailmate:context', { detail: snapshot() }));
  }

  document.addEventListener('pointerover', event => {
    const reference = window.MailmateObjects?.getFromElement(event.target);
    if (!reference || sameReference(reference, state.hovered)) return;
    state.hovered = reference;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (sameReference(state.hovered, reference)) state.hovered = null;
    }, 8000);
  }, true);

  document.addEventListener('click', event => {
    const reference = window.MailmateObjects?.getFromElement(event.target);
    if (!reference) return;
    state.lastClicked = reference;
    state.references.lastMentioned = reference;
    emit();
  }, true);

  document.addEventListener('focusin', event => {
    state.focused = window.MailmateObjects?.getFromElement(event.target) || null;
  }, true);

  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection?.();
    state.selectedText = String(selection || '').trim().slice(0, 280);
    const sourceElement = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    state.selectedTextSource = state.selectedText
      ? (window.MailmateObjects?.getFromElement(sourceElement) || null)
      : null;
  });

  window.MailmateContext = { state, setPage, select, open, clear, remember, snapshot };
})();
