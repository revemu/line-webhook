const assert = require('assert');

// Test that fixtures with missing team IDs or missing rounds are properly sanitized
function sanitizeFixture(m, colorToIdMap = new Map()) {
  const matchNum = m.matchNo;
  const round = m.round || 1;
  const startTime = m.startTime || null;
  const endTime = m.endTime || null;
  let teamAId = m.teamAId || (m.teamA ? colorToIdMap.get(String(m.teamA).trim().toLowerCase()) : null) || null;
  let teamBId = m.teamBId || (m.teamB ? colorToIdMap.get(String(m.teamB).trim().toLowerCase()) : null) || null;

  return { matchNum, round, startTime, endTime, teamAId, teamBId };
}

console.log('Testing fixture sanitization and fallback mapping...');

const colorMap = new Map([
  ['red', 10],
  ['green', 11],
  ['white', 12],
  ['black', 13]
]);

// Case 1: Full fixture
const f1 = sanitizeFixture({
  matchNo: 1,
  round: 1,
  startTime: '18:00',
  endTime: '18:08',
  teamA: 'Red',
  teamAId: 10,
  teamB: 'Green',
  teamBId: 11
}, colorMap);

assert.strictEqual(f1.matchNum, 1);
assert.strictEqual(f1.round, 1);
assert.strictEqual(f1.startTime, '18:00');
assert.strictEqual(f1.teamAId, 10);
assert.strictEqual(f1.teamBId, 11);
console.log('✔ Case 1 passed: Full fixture retained properly');

// Case 2: Missing team IDs in cached schedule.json, should be resolved by color name
const f2 = sanitizeFixture({
  matchNo: 2,
  startTime: '18:10',
  endTime: '18:18',
  teamA: 'White',
  teamB: 'Black'
}, colorMap);

assert.strictEqual(f2.matchNum, 2);
assert.strictEqual(f2.round, 1); // defaulted to 1
assert.strictEqual(f2.teamAId, 12); // resolved from colorMap
assert.strictEqual(f2.teamBId, 13); // resolved from colorMap
console.log('✔ Case 2 passed: Missing teamAId/teamBId properly resolved from color name');

// Case 3: Completely missing times / unknowns, must not be undefined (mysql2 requirement)
const f3 = sanitizeFixture({
  matchNo: 3,
  teamA: 'Unknown1',
  teamB: 'Unknown2'
}, colorMap);

assert.strictEqual(f3.startTime, null);
assert.notStrictEqual(f3.startTime, undefined);
assert.strictEqual(f3.endTime, null);
assert.notStrictEqual(f3.endTime, undefined);
assert.strictEqual(f3.teamAId, null);
assert.notStrictEqual(f3.teamAId, undefined);
console.log('✔ Case 3 passed: All null/undefined fields safely guarded for mysql2 compatibility');

console.log('\n🎉 ALL FIXTURE SANITIZATION TESTS PASSED!');
