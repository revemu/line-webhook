const { matchesDay } = require('../scheduler/taskRegistry');

const testCases = [
  { target: 'mon-fri,sun', expected: { Sun: true, Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: false } },
  { target: '1-5,0', expected: { Sun: true, Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: false } },
  { target: 'fri', expected: { Sun: false, Mon: false, Tue: false, Wed: false, Thu: false, Fri: true, Sat: false } },
  { target: 'sat-sun', expected: { Sun: true, Mon: false, Tue: false, Wed: false, Thu: false, Fri: false, Sat: true } },
  { target: 'mon,wed,fri', expected: { Sun: false, Mon: true, Tue: false, Wed: true, Thu: false, Fri: true, Sat: false } },
];

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let allPassed = true;
for (const tc of testCases) {
  console.log(`\nTesting schedule: "${tc.target}"`);
  for (let dow = 0; dow < 7; dow++) {
    const day = dayNames[dow];
    const actual = matchesDay(tc.target, dow);
    const expected = tc.expected[day];
    const pass = actual === expected;
    if (!pass) allPassed = false;
    console.log(`  ${day} (dow=${dow}): ${actual} ${pass ? '✅' : '❌ (expected ' + expected + ')'}`);
  }
}

console.log(allPassed ? '\nALL TESTS PASSED! 🎉' : '\nSOME TESTS FAILED! ❌');
process.exit(allPassed ? 0 : 1);
