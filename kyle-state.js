(function () {
  const states = {
    IDLE: 'IDLE',
    LISTENING: 'LISTENING',
    TRANSCRIBING: 'TRANSCRIBING',
    THINKING: 'THINKING',
    SPEAKING: 'SPEAKING',
    INTERRUPTED: 'INTERRUPTED',
    ERROR: 'ERROR',
    RESULT: 'RESULT',
    ACTING: 'ACTING',
    OBSERVING: 'OBSERVING',
    WAITING_APPROVAL: 'WAITING_APPROVAL',
    DONE: 'DONE'
  };

  function createKyleState() {
    return {
      states,
      current: states.IDLE,
      conversation: [],
      lastResults: [],
      selectedEmail: null,
      currentPage: 'overview',
      context: null,
      muted: false,
      set(next) {
        this.current = next;
        console.log('[Kyle Voice] state', next);
        window.dispatchEvent(new CustomEvent('kyle:state', { detail: { state: next } }));
      },
      addMessage(role, text) {
        const message = { role, text, at: new Date().toISOString() };
        this.conversation.push(message);
        window.dispatchEvent(new CustomEvent('kyle:message', { detail: message }));
      }
    };
  }

  window.KyleState = { createKyleState, states };
})();
