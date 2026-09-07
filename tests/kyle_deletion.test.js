const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(name, context) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), context, { filename: name });
}

(async () => {
  const calls = [];
  const store = {
    states: { ACTING: 'ACTING', OBSERVING: 'OBSERVING', WAITING_APPROVAL: 'WAITING_APPROVAL', DONE: 'DONE' },
    set() {}
  };
  const window = {
    Kyle: { store },
    KyleMotion: {
      queue: tasks => tasks.reduce((promise, task) => promise.then(task), Promise.resolve()),
      before: async () => {}, after: async () => {}, caption() {}
    },
    KyleObservation: { capture: () => ({}), after: async () => ({ satisfied: true }) },
    KyleTools: {
      previews: new Map(),
      run: async (tool, args) => {
        calls.push({ tool, args });
        if (tool === 'calendar.delete_prepare') return { ok: true, previewId: 'delete_1', requiresApproval: true };
        return { ok: true, deletedCount: 2, failedCount: 0 };
      }
    },
    KyleUi: { active: { closeSurface() {} } },
    dispatchEvent() {}
  };
  const context = vm.createContext({
    window,
    document: { querySelector: () => null },
    CustomEvent: class {},
    console,
    Date,
    Promise
  });
  load('kyle-policy.js', context);
  load('kyle-executor.js', context);

  const prepared = await window.KyleExecutor.execute({
    id: 'run_delete',
    goal: 'Delete two meetings',
    steps: [{ tool: 'calendar.delete_prepare', args: { references: [
      { type: 'calendar-event', id: 'a' }, { type: 'calendar-event', id: 'b' }
    ] } }]
  });
  assert.equal(prepared.status, 'waiting-approval');
  assert.ok(window.KyleExecutor.pending());

  const approved = await window.KyleExecutor.approvePending();
  assert.equal(approved.ok, true);
  assert.equal(approved.result.deletedCount, 2);
  assert.deepEqual(calls.map(call => call.tool), ['calendar.delete_prepare', 'calendar.delete_confirmed']);
  assert.equal(calls[1].args.approved, true);
  console.log('Kyle deletion tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
