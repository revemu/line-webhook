/**
 * Daily Schedule Summary Task
 * 
 * Runs everyday at 16:00 (4:00 PM).
 * Checks the current active week:
 *  - Date & Time range
 *  - Max players capacity (maxweek)
 *  - Registered players count
 * 
 * Sends a push message mentioning @All:
 *  @All 
 *  เสาร์นี้ {date} เราเริ่มเตะเวลา {time_range} นะครับ
 * 
 * If maxweek is not yet filled (remaining > 0):
 *  ยังบวกเพิ่มได้อีก {remaining} นะครับ
 */

module.exports = {
  id: 'schedule_summary',
  name: 'Daily Schedule Summary',
  enabled: process.env.SCHEDULE_SUMMARY_ENABLED !== 'false',
  groupId: process.env.SCHEDULE_SUMMARY_GROUP_ID || null, // Optional explicit override, or resolves from DB (group_id_schedule_summary)

  // Schedule definition: everyday at 16:00
  schedule: {
    days: process.env.SCHEDULE_SUMMARY_DAYS || 'mon-fri', // '*' = Everyday, or 'mon-fri', [1,2,3,4,5], 'sat,sun', etc.
    time: process.env.SCHEDULE_SUMMARY_TIME || '16:00'
  },

  /**
   * Executes the daily schedule summary push message.
   * @param {Object} context
   * @param {string} context.groupId - Target LINE group ID
   * @param {Object} context.lineClient - lineClient instance
   * @param {Object} context.db - query/db module
   * @returns {Promise<boolean>} Whether push message was dispatched
   */
  execute: async ({ groupId, lineClient, db }) => {
    if (!groupId) {
      console.warn('[ScheduleSummaryTask] Execution aborted: No target groupId available');
      return false;
    }

    console.log(`[ScheduleSummaryTask] Running daily schedule summary for group: ${groupId}...`);
    const weekRes = await db.queryWeekID(0);
    if (!weekRes || weekRes.length === 0) {
      console.warn('[ScheduleSummaryTask] Execution aborted: No active week found in DB');
      return false;
    }

    const week = weekRes[0];
    const weekId = week.id;
    const dateStr = week.date ? (await db.getFormatDate(week.date, 'short')) : '';
    const timeRange = week.time_range || '17:30-20:00';
    const maxPlayers = parseInt(week.max, 10) || 0;

    // Query registered outfield members for current week
    const members = await db.executeQuery(
      "SELECT member_id, team_id FROM member_team_week_tbl WHERE week_id = ?",
      [weekId]
    );

    // In this system, team_id == 100 is goalie; other registrations are outfield players
    const registeredFieldPlayers = (members || []).filter(m => m.team_id != 100).length;
    const remaining = maxPlayers - registeredFieldPlayers;

    let text = `{all}\nเสาร์นี้ ${dateStr} เราเริ่มเตะเวลา ${timeRange} นะครับ`;
    if (remaining > 0) {
      text += `\n\nยังบวกเพิ่มได้อีก ${remaining} นะครับ`;
    }

    const pushMsg = {
      type: 'textV2',
      text,
      substitution: {
        all: {
          type: 'mention',
          mentionee: {
            type: 'all'
          }
        }
      }
    };

    console.log(`[ScheduleSummaryTask] Sending schedule summary: date='${dateStr}', time='${timeRange}', registered=${registeredFieldPlayers}/${maxPlayers}, remaining=${remaining}`);
    const result = await lineClient.pushMessage(groupId, [pushMsg]);
    console.log(`[ScheduleSummaryTask] pushMessage result:`, result ? 'SUCCESS' : 'FAILED');
    return Boolean(result);
  }
};
