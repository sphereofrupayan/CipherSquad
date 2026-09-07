(function () {
  function fromResponse(message, response = {}, resolution = {}) {
    return {
      id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      goal: String(message || '').trim().slice(0, 180),
      steps: (response.actions || []).slice(0, 8),
      references: resolution.references || [],
      createdAt: new Date().toISOString()
    };
  }

  function isUndo(message) {
    return /^\s*(undo|undo that|put it back|revert that)\s*[.!]?\s*$/i.test(String(message || ''));
  }

  function isApproval(message) {
    return /^\s*(confirm|confirm it|approve|approve it|save it|do it|yes)\s*[.!]?\s*$/i.test(String(message || ''));
  }

  function isCancellation(message) {
    return /^\s*(cancel|cancel it|never mind|nevermind|discard it|no)\s*[.!]?\s*$/i.test(String(message || ''));
  }

  window.KylePlanner = { fromResponse, isUndo, isApproval, isCancellation };
})();
