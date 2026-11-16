const fs = require('fs');
const path = require('path');
const flex = require('../flex');

// Load sample schedule.json fixtures
const schedJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../schedule.json'), 'utf8'));

console.log('====================================================');
console.log('🧪 Testing Match State Progression & DB Schedule Logic');
console.log('====================================================\n');

// Mock match resolution logic as implemented in getCurrentMatch
function resolveMatchProgression(schedMatches, dbMatches) {
  let currentMatchNo = 1;
  let nextMatchNo = Math.min(2, schedMatches.length);
  let currentDbRow = null;
  let matchStatus = 'scheduled';

  const hasStatusCol = dbMatches.some(r => r.status !== undefined && r.status !== null);

  if (hasStatusCol) {
    const inProgress = dbMatches.find(r => r.status === 'in_progress');
    if (inProgress) {
      currentMatchNo = inProgress.match_num;
      currentDbRow = inProgress;
      matchStatus = 'in_progress';
      const nextSched = dbMatches.find(r => r.status === 'scheduled' && r.match_num > currentMatchNo);
      nextMatchNo = nextSched ? nextSched.match_num : Math.min(currentMatchNo + 1, schedMatches.length);
    } else {
      const firstSched = dbMatches.find(r => r.status === 'scheduled');
      if (firstSched) {
        currentMatchNo = firstSched.match_num;
        currentDbRow = firstSched;
        matchStatus = 'scheduled';
        const nextSched = dbMatches.find(r => r.status === 'scheduled' && r.match_num > currentMatchNo);
        nextMatchNo = nextSched ? nextSched.match_num : Math.min(currentMatchNo + 1, schedMatches.length);
      } else {
        currentMatchNo = schedMatches.length;
        currentDbRow = dbMatches.find(r => r.match_num === currentMatchNo) || dbMatches[dbMatches.length - 1];
        matchStatus = 'all_finished';
        nextMatchNo = currentMatchNo;
      }
    }
  } else {
    const maxDbMatchNum = Math.max(...dbMatches.map(r => r.match_num));
    currentMatchNo = maxDbMatchNum;
    nextMatchNo = Math.min(maxDbMatchNum + 1, schedMatches.length);
    currentDbRow = dbMatches.find(r => r.match_num === maxDbMatchNum);
  }

  const currentMatch = schedMatches.find(m => m.matchNo === currentMatchNo) || schedMatches[0];
  const nextMatch = schedMatches.find(m => m.matchNo === nextMatchNo && nextMatchNo !== currentMatchNo) || null;

  let score = null;
  if (currentDbRow) {
    if (matchStatus === 'in_progress' || matchStatus === 'all_finished' || currentDbRow.status === 'finished') {
      score = {
        teamA: currentDbRow.team_a_goal ?? 0,
        teamB: currentDbRow.team_b_goal ?? 0
      };
    } else if (matchStatus === 'scheduled') {
      score = null;
    }
  }

  return { currentMatchNo, nextMatchNo, currentMatch, nextMatch, currentDbRow, matchStatus, score };
}

let allPassed = true;

// Scenario 1: Fresh schedule, all 18 matches are 'scheduled'
console.log('--- Test 1: All matches scheduled (Before tournament starts) ---');
const dbMatches1 = schedJson.matches.map(m => ({
  id: m.matchNo,
  week_id: 1,
  match_num: m.matchNo,
  team_a_id: m.teamAId,
  team_b_id: m.teamBId,
  team_a_goal: null,
  team_b_goal: null,
  status: 'scheduled'
}));

const res1 = resolveMatchProgression(schedJson.matches, dbMatches1);
console.log(`Current Match: ${res1.currentMatchNo} (Expected: 1)`);
console.log(`Next Match: ${res1.nextMatchNo} (Expected: 2)`);
console.log(`Status: ${res1.matchStatus} (Expected: scheduled)`);
console.log(`Score: ${JSON.stringify(res1.score)} (Expected: null)`);

const nowFlex1 = flex.buildNowFlex({
  sched: schedJson,
  currentMatch: res1.currentMatch,
  nextMatch: res1.nextMatch,
  score: res1.score,
  matchStatus: res1.matchStatus
}, 'black');
const nowStr1 = JSON.stringify(nowFlex1);
const hasWaitingHeader1 = nowStr1.includes('แมตช์ถัดไป (รอเริ่ม)');
console.log(`NowFlex displays "แมตช์ถัดไป (รอเริ่ม)": ${hasWaitingHeader1}`);
if (res1.currentMatchNo !== 1 || res1.nextMatchNo !== 2 || res1.matchStatus !== 'scheduled' || !hasWaitingHeader1) allPassed = false;

// Scenario 2: Match 1 is finished, Match 2 is waiting (Break interval)
console.log('\n--- Test 2: Match 1 is finished, advance to Match 2 ---');
const dbMatches2 = JSON.parse(JSON.stringify(dbMatches1));
dbMatches2[0].status = 'finished';
dbMatches2[0].team_a_goal = 2;
dbMatches2[0].team_b_goal = 1;

const res2 = resolveMatchProgression(schedJson.matches, dbMatches2);
console.log(`Current Match: ${res2.currentMatchNo} (Expected: 2)`);
console.log(`Next Match: ${res2.nextMatchNo} (Expected: 3)`);
console.log(`Status: ${res2.matchStatus} (Expected: scheduled)`);
if (res2.currentMatchNo !== 2 || res2.nextMatchNo !== 3 || res2.matchStatus !== 'scheduled') allPassed = false;

// Scenario 3: Match 2 is IN_PROGRESS (Live)
console.log('\n--- Test 3: Match 2 is in_progress (Live) ---');
const dbMatches3 = JSON.parse(JSON.stringify(dbMatches2));
dbMatches3[1].status = 'in_progress';
dbMatches3[1].team_a_goal = 1;
dbMatches3[1].team_b_goal = 0;

const res3 = resolveMatchProgression(schedJson.matches, dbMatches3);
console.log(`Current Match: ${res3.currentMatchNo} (Expected: 2)`);
console.log(`Next Match: ${res3.nextMatchNo} (Expected: 3)`);
console.log(`Status: ${res3.matchStatus} (Expected: in_progress)`);
console.log(`Live Score: ${res3.score.teamA} - ${res3.score.teamB} (Expected: 1 - 0)`);

const nowFlex3 = flex.buildNowFlex({
  sched: schedJson,
  currentMatch: res3.currentMatch,
  nextMatch: res3.nextMatch,
  score: res3.score,
  matchStatus: res3.matchStatus
}, 'black');
const nowStr3 = JSON.stringify(nowFlex3);
const hasLiveHeader3 = nowStr3.includes('กำลังแข่ง (LIVE)');
console.log(`NowFlex displays "กำลังแข่ง (LIVE)": ${hasLiveHeader3}`);
if (res3.currentMatchNo !== 2 || res3.matchStatus !== 'in_progress' || !hasLiveHeader3 || res3.score.teamA !== 1) allPassed = false;

// Scenario 4: Match 2 is finished, advance to Match 3
console.log('\n--- Test 4: Match 2 finished, advance to Match 3 ---');
const dbMatches4 = JSON.parse(JSON.stringify(dbMatches3));
dbMatches4[1].status = 'finished';
dbMatches4[1].team_a_goal = 1;
dbMatches4[1].team_b_goal = 1;

const res4 = resolveMatchProgression(schedJson.matches, dbMatches4);
console.log(`Current Match: ${res4.currentMatchNo} (Expected: 3)`);
console.log(`Next Match: ${res4.nextMatchNo} (Expected: 4)`);
console.log(`Status: ${res4.matchStatus} (Expected: scheduled)`);
if (res4.currentMatchNo !== 3 || res4.nextMatchNo !== 4 || res4.matchStatus !== 'scheduled') allPassed = false;

// Scenario 5: All 18 matches are finished
console.log('\n--- Test 5: All matches finished ---');
const dbMatches5 = schedJson.matches.map(m => ({
  id: m.matchNo,
  week_id: 1,
  match_num: m.matchNo,
  team_a_id: m.teamAId,
  team_b_id: m.teamBId,
  team_a_goal: 1,
  team_b_goal: 0,
  status: 'finished'
}));

const res5 = resolveMatchProgression(schedJson.matches, dbMatches5);
console.log(`Current Match: ${res5.currentMatchNo} (Expected: 18)`);
console.log(`Status: ${res5.matchStatus} (Expected: all_finished)`);
if (res5.currentMatchNo !== 18 || res5.matchStatus !== 'all_finished') allPassed = false;

// Scenario 6: Clean Sheet & Goal filter logic
console.log('\n--- Test 6: Clean Sheet & Goal calculation only counts played matches ---');
const filterPlayed = (rows) => (rows || []).filter(m => {
  if (m.status !== undefined && m.status !== null) {
    return m.status === 'finished' || m.status === 'in_progress';
  }
  return m.team_a_goal !== null && m.team_a_goal !== undefined;
});

const playedMatches = filterPlayed(dbMatches2);
console.log(`Total DB rows: ${dbMatches2.length}, Played matches counted: ${playedMatches.length} (Expected: 1)`);
if (playedMatches.length !== 1) allPassed = false;

console.log('====================================================');
if (allPassed) {
  console.log('🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED!');
  process.exit(1);
}
