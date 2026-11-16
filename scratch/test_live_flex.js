const fs = require('fs');
const path = require('path');
const flex = require('../flex');

// Load sample schedule.json
const schedJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../schedule.json'), 'utf8'));

console.log('--- TEST 1: Current Match = 5 (User scenario: 3 4 live 6 7 8 9 ... 18) ---');
const curMatch5 = schedJson.matches.find(m => m.matchNo === 5) || {
  matchNo: 5,
  round: 1,
  startTime: '18:40',
  endTime: '18:48',
  teamA: 'White',
  teamB: 'Red'
};

const matchInfo5 = {
  sched: schedJson,
  currentMatch: curMatch5,
  scorers: [],
  assists: [],
  table: [
    { team: 'Red', w: 1, d: 0, l: 0, gd: 2, pts: 3 },
    { team: 'Green', w: 0, d: 1, l: 0, gd: 0, pts: 1 },
    { team: 'White', w: 0, d: 1, l: 0, gd: 0, pts: 1 },
    { team: 'Black', w: 0, d: 0, l: 1, gd: -2, pts: 0 }
  ],
  dbMatches: [
    { id: 1, match_num: 1, team_a_goal: 2, team_b_goal: 0, team_a_id: 1, team_b_id: 2 }
  ],
  recentMatchDetails: {},
  imageUrl: 'https://example.com/banner.jpg',
  webLiveUrl: 'https://boxch2.kdnstream.com/web/view'
};

const bubble5 = flex.buildLiveFlex(matchInfo5, 'black');

// Check footer
console.log('Bubble footer exists:', !!bubble5.footer);
console.log('Bubble footer uri:', bubble5.footer?.contents?.[0]?.action?.uri);
console.log('Bubble header action uri:', bubble5.header?.contents?.[0]?.action?.uri);

// Find rendered match numbers from bodyContents by finding the match number node
function extractMatchNumbers(bubble) {
  const matchNos = [];
  function search(node) {
    if (!node) return;
    if (typeof node === 'object') {
      if (node.offsetStart === '-6px' && node.text && typeof node.text === 'string' && /^\d+$/.test(node.text.trim())) {
        matchNos.push(parseInt(node.text.trim(), 10));
      }
      for (const key of Object.keys(node)) {
        search(node[key]);
      }
    }
  }
  search(bubble.body);
  return matchNos;
}

const renderedMatches = extractMatchNumbers(bubble5);
console.log('Rendered match numbers:', renderedMatches);

// Check if matches 3, 4, 5, 6, 7, 8, 9, 18 are present
const expectedMatches = [3, 4, 5, 6, 7, 8, 9, 18];
const matchesExactly = JSON.stringify(renderedMatches) === JSON.stringify(expectedMatches);
console.log('Rendered matches exactly [3, 4, 5, 6, 7, 8, 9, 18]:', matchesExactly);

// Check web link banner in body
const bodyString = JSON.stringify(bubble5.body);
const hasWebBanner = bodyString.includes('boxch2.kdnstream.com/web/view');
console.log('Web view URL in bodyContents:', hasWebBanner);

console.log('\n--- TEST 2: Current Match = 1 (Start of schedule) ---');
const curMatch1 = schedJson.matches.find(m => m.matchNo === 1);
const matchInfo1 = { ...matchInfo5, currentMatch: curMatch1 };
const bubble1 = flex.buildLiveFlex(matchInfo1, 'black');
const renderedMatches1 = extractMatchNumbers(bubble1);
console.log('Rendered match numbers for Match 1:', renderedMatches1);
const matches1Expected = [1, 2, 3, 4, 5, 18];
const matches1Exactly = JSON.stringify(renderedMatches1) === JSON.stringify(matches1Expected);
console.log('Matches for Match 1 exactly [1, 2, 3, 4, 5, 18]:', matches1Exactly);

console.log('\n--- TEST 3: White Theme ---');
const whiteBubble = flex.buildLiveFlex(matchInfo5, 'white');
console.log('White theme footer uri:', whiteBubble.footer?.contents?.[0]?.action?.uri);

console.log('\n--- TEST 4: Export makeBoxUriButton ---');
console.log('flex.makeBoxUriButton is function:', typeof flex.makeBoxUriButton === 'function');
const btn = flex.makeBoxUriButton('ดูเว็บ', 'https://boxch2.kdnstream.com/web/view', '#0284c7');
console.log('Generated button uri:', btn.action.uri);

if (matchesExactly && matches1Exactly && hasWebBanner && !!bubble5.footer) {
  console.log('\n✅ ALL TESTS PASSED!');
  process.exit(0);
} else {
  console.log('\n❌ TESTS FAILED!');
  process.exit(1);
}
