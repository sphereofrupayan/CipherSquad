const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScript(name, context) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), context, { filename: name });
}

function narrationTest() {
  const context = vm.createContext({ window: {} });
  loadScript('kyle-executor.js', context);
  const narrate = context.window.KyleExecutor.observedNarration;
  const transaction = count => ({
    status: 'complete',
    steps: [{
      status: 'complete',
      action: { tool: 'inbox.set_filter', args: { filter: 'important' } },
      observation: { details: { filter: 'important', count } }
    }]
  });
  assert.equal(narrate(transaction(0)), "You don't have any important messages right now.");
  assert.equal(narrate(transaction(1)), 'I found 1 important message.');
  assert.equal(narrate(transaction(4)), 'I found 4 important messages.');
}

async function audioInterruptionTest() {
  let handlers;
  let aborts = 0;
  let cleanups = 0;

  class FakeRecognition {
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
    abort() { aborts += 1; }
  }

  const states = {
    IDLE: 'IDLE', LISTENING: 'LISTENING', TRANSCRIBING: 'TRANSCRIBING',
    THINKING: 'THINKING', SPEAKING: 'SPEAKING', INTERRUPTED: 'INTERRUPTED', ERROR: 'ERROR'
  };
  const store = {
    current: states.IDLE,
    states,
    muted: false,
    context: {},
    set(value) { this.current = value; },
    addMessage() {}
  };
  const ui = {
    bind(value) { handlers = value; },
    setMuted() {}, setLiveText() {}, setAmplitude() {}, renderBrief() {}, renderResults() {}
  };
  const audio = {
    async openMic() {},
    cleanupMic() { cleanups += 1; }
  };
  const window = {
    SpeechRecognition: FakeRecognition,
    KyleState: { createKyleState: () => store },
    KyleUi: { createKyleUi: () => ui },
    KyleAudio: { createAudioEngine: () => audio },
    dispatchEvent() {},
    addEventListener() {},
    location: { origin: 'http://localhost:5000' },
    KyleExecutor: { pending: () => null },
    KyleReferents: { resolvePrompt: () => ({ references: [], unresolved: false }) }
  };
  const context = vm.createContext({
    window,
    document: { querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => '' },
    console,
    performance: { now: () => 1000 },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    CustomEvent: class {},
    fetch: async () => ({ ok: false })
  });
  loadScript('kyle.js', context);

  await window.Kyle.startListening();
  assert.equal(store.current, states.LISTENING);
  handlers.onMute();
  assert.equal(store.muted, true);
  assert.equal(store.current, states.IDLE);
  assert.equal(aborts, 1);

  handlers.onMute();
  await window.Kyle.startListening();
  handlers.onTextFocus();
  assert.equal(store.current, states.IDLE);
  assert.equal(aborts, 2);
  assert.ok(cleanups >= 2);
}

(async () => {
  narrationTest();
  await audioInterruptionTest();
  console.log('Kyle runtime tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
