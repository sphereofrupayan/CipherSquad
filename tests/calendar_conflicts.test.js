const assert = require('node:assert/strict');
const CalendarConflicts = require('../calendar-conflicts.js');

function event(id, overrides = {}) {
  return {
    id,
    title: `Event ${id}`,
    start: '2026-09-08T10:00:00+05:30',
    end: '2026-09-08T11:00:00+05:30',
    source: 'google',
    all_day: false,
    status: 'confirmed',
    transparency: 'opaque',
    ...overrides
  };
}

function pairCount(events) {
  return CalendarConflicts.annotate(events).pairs.length;
}

assert.equal(pairCount([event('a')]), 0);
assert.equal(pairCount([event('deadline-a', { source: 'deadline' })]), 0);
assert.equal(pairCount([
  event('deadline-a', { source: 'deadline' }),
  event('deadline-b', { source: 'deadline' })
]), 0);
assert.equal(pairCount([
  event('google-a', { title: 'DA submission', agent_harness: { agent_harness_marker: 'gmail-123' } }),
  event('virtual-a', { title: 'DA submission', source: 'deadline', marker: 'gmail-123' })
]), 0);
assert.equal(pairCount([
  event('a'),
  event('b', { start: '2026-09-08T11:00:00+05:30', end: '2026-09-08T12:00:00+05:30' })
]), 0);
const overlapping = CalendarConflicts.annotate([
  event('a'),
  event('b', { start: '2026-09-08T10:30:00+05:30', end: '2026-09-08T11:30:00+05:30' })
]);
assert.deepEqual(overlapping.pairs, [{ a: 'a', b: 'b', overlapMinutes: 30 }]);
assert.equal(pairCount([
  event('google-a', { title: 'Project review', agent_harness: { agent_harness_marker: 'mailmate-7' } }),
  event('ai-a', { title: 'Project review', source: 'ai', marker: 'mailmate-7' })
]), 0);
const cleared = CalendarConflicts.annotate(overlapping.events.map((item, index) => ({
  ...item,
  start: index ? '2026-09-08T11:00:00+05:30' : item.start,
  end: index ? '2026-09-08T12:00:00+05:30' : '2026-09-08T10:00:00+05:30'
})));
assert.equal(cleared.pairs.length, 0);
assert.ok(cleared.events.every(item => !item.conflict && item.conflict_with.length === 0));

console.log('Calendar conflict tests: ok');
