const assert = require('assert');
const flex = require('../flex');

console.log('Testing Database Schedule (SSOT) & formatScheduleLines...');

// Sample data as reconstructed from match_stat_tbl & team_color_week_tbl
const sampleDbMatches = [
  { match_num: 1, round: 1, start_time: '18:00', end_time: '18:08', team_a_id: 1, team_b_id: 2, status: 'finished', team_a_goal: 2, team_b_goal: 1 },
  { match_num: 2, round: 1, start_time: '18:10', end_time: '18:18', team_a_id: 3, team_b_id: 4, status: 'in_progress', team_a_goal: 1, team_b_goal: 0 },
  { match_num: 3, round: 1, start_time: '18:20', end_time: '18:28', team_a_id: 3, team_b_id: 1, status: 'scheduled', team_a_goal: null, team_b_goal: null }
];

const teamColors = [
  { id: 1, color: 'Red' },
  { id: 2, color: 'Green' },
  { id: 3, color: 'White' },
  { id: 4, color: 'Black' }
];

const colorMap = new Map();
teamColors.forEach(c => colorMap.set(c.id, c.color));
const teams = teamColors.map(c => c.color);

const scheduleMatches = sampleDbMatches.map(r => ({
  matchNo: r.match_num,
  round: r.round,
  startTime: r.start_time,
  endTime: r.end_time,
  teamA: colorMap.get(r.team_a_id),
  teamAId: r.team_a_id,
  teamB: colorMap.get(r.team_b_id),
  teamBId: r.team_b_id,
  resting: teams.filter(t => t !== colorMap.get(r.team_a_id) && t !== colorMap.get(r.team_b_id)),
  status: r.status,
  team_a_goal: r.team_a_goal,
  team_b_goal: r.team_b_goal
}));

assert.strictEqual(scheduleMatches.length, 3);
assert.strictEqual(scheduleMatches[0].teamA, 'Red');
assert.strictEqual(scheduleMatches[0].teamB, 'Green');
assert.deepStrictEqual(scheduleMatches[0].resting, ['White', 'Black']);

// Test Progression: Match 1 is finished, Match 2 is in_progress
const inProg = sampleDbMatches.find(r => r.status === 'in_progress');
assert.strictEqual(inProg.match_num, 2);

const schedObj = {
  weekId: 1,
  date: '27 มิ.ย. 26',
  startTime: '18:00',
  endTime: '21:00',
  matchMinutes: 8,
  breakMinutes: 2,
  totalHours: 3,
  teams,
  totalMatches: scheduleMatches.length,
  totalRounds: 1,
  currentMatch: scheduleMatches[1],
  nextMatch: scheduleMatches[2],
  dbMatches: sampleDbMatches,
  matches: scheduleMatches,
  matchStatus: 'in_progress'
};

// Test Flex builder compatibility
const flexResult = flex.buildScheduleFlex(schedObj, 'black');
assert.strictEqual(flexResult.type, 'bubble');

// Find match rows inside flexResult.body.contents (match rows have margin: 'xs')
const matchRows = flexResult.body.contents.filter(c => c.type === 'box' && c.margin === 'xs');
assert.strictEqual(matchRows.length, 3);

// Match 1: finished (2 - 1)
const m1Vs = matchRows[0].contents[2].contents[1];
assert.strictEqual(m1Vs.text, '2 - 1');
assert.strictEqual(m1Vs.weight, 'bold');

// Match 2: in_progress (1 - 0)
const m2Vs = matchRows[1].contents[2].contents[1];
assert.strictEqual(m2Vs.text, '1 - 0');
assert.strictEqual(m2Vs.weight, 'bold');

// Match 3: scheduled (unplayed, team_a_goal: null) -> MUST be 'vs', NOT 'null - null'
const m3Vs = matchRows[2].contents[2].contents[1];
assert.strictEqual(m3Vs.text, 'vs');
assert.strictEqual(m3Vs.weight, 'regular');
console.log('✔ Match 1 score: "2 - 1", Match 2 score: "1 - 0", Match 3 unplayed: "vs" (no "null - null")');
console.log('✔ buildScheduleFlex works seamlessly with DB-generated schedule object');

const nowFlex = flex.buildNowFlex({
  sched: schedObj,
  currentMatch: schedObj.currentMatch,
  nextMatch: schedObj.nextMatch,
  score: { teamA: 1, teamB: 0 },
  matchStatus: 'in_progress'
}, 'black');
assert.strictEqual(nowFlex.type, 'bubble');
console.log('✔ buildNowFlex works seamlessly with DB-generated schedule object');

console.log('\n🎉 ALL DB SCHEDULE SSOT TESTS PASSED SUCCESSFULLY!');
