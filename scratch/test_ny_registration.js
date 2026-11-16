const db = require('../query');

async function runTests() {
  console.log('Testing ensureNYTable & NY Registration...');
  try {
    // 1. Ensure table exists
    await db.ensureNYTable();
    console.log('✅ ensureNYTable executed successfully.');

    // 2. Query active week
    const week = await db.queryWeekID();
    console.log('Current active week:', week && week.length > 0 ? `Week ID ${week[0].id} (${week[0].date})` : 'None');

    // 3. Test getMemberNY
    const nyList = await db.getMemberNY();
    console.log('Current NY registration text output:\n---');
    console.log(nyList);
    console.log('---');

    console.log('All checks passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during test:', err);
    process.exit(1);
  }
}

runTests();
