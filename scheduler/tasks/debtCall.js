const qrGen = require('../../qr_gen');

/**
 * Daily Debt Call Reminder Task
 * 
 * Runs on scheduled weekdays (default Mon-Fri at 12:00 PM).
 * Checks database for unpaid debts (db.getDebtList(0)).
 * If unpaid members exist and today's alert hasn't fired yet:
 *  - Sends debt notification mentioning debtors.
 *  - Generates and attaches a SINGLE PromptPay QR code with amount 0 ("แสกนจ่ายค่าสนาม").
 */
module.exports = {
  id: 'debt_call',
  name: 'Daily Debt Call Reminder',
  enabled: process.env.DEBT_CALL_ENABLED !== 'false',

  // Schedule definition: default Mon-Fri at 12:00 PM
  schedule: {
    // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
    days: process.env.DEBT_CALL_DAYS
      ? (process.env.DEBT_CALL_DAYS === '*' ? '*' : process.env.DEBT_CALL_DAYS.split(',').map(d => parseInt(d.trim(), 10)))
      : [1, 2, 3, 4, 5],
    time: process.env.DEBT_CALL_TIME || '12:00'
  },

  /**
   * Executes the debt call push message.
   * @param {Object} context
   * @param {string} context.groupId - Target LINE group ID
   * @param {Object} context.lineClient - lineClient instance
   * @param {Object} context.db - query/db module
   * @returns {Promise<boolean>} Whether push message was dispatched
   */
  execute: async ({ groupId, lineClient, db }) => {
    if (!groupId) {
      console.warn('[DebtCallTask] Execution aborted: No target groupId available');
      return false;
    }

    console.log(`[DebtCallTask] Triggering daily debt check for group: ${groupId}...`);
    const [debt_str, sub, debt_count, proceed, debt_val, debt_members] = await db.getDebtList(0);
    console.log(`[DebtCallTask] getDebtList(0) result: proceed=${proceed}, debt_count=${debt_count}, debt_members=${debt_members ? debt_members.length : 0}`);

    if (!proceed) {
      console.log('[DebtCallTask] Skipped: proceed=false (already alerted today or template_tpl call != 0)');
      return false;
    }

    if (debt_count <= 0) {
      console.log('[DebtCallTask] Skipped: debt_count=0 (no members with debt > 0)');
      return false;
    }

    console.log(`[DebtCallTask] Sending debt reminder to group: ${groupId} for ${debt_count} debtor(s)`);
    const hasSub = sub && typeof sub === 'object' && Object.keys(sub).length > 0 && Object.keys(sub).length <= 20;
    const firstMsg = hasSub
      ? {
          type: 'textV2',
          text: debt_str,
          substitution: sub
        }
      : {
          type: 'text',
          text: debt_str
        };

    const pushMsgs = [firstMsg];

    // Generate a single QR code with amount 0 (no unique amounts needed)
    try {
      let baseUrl = global.baseWebhookUrl || process.env.BASE_WEBHOOK_URL || "https://api.revemu.org";
      if (baseUrl.startsWith('http://')) baseUrl = baseUrl.replace('http://', 'https://');

      console.log(`[DebtCallTask] Generating single QR code with amount 0...`);
      const filename = await qrGen.generateQrCode(0, '006660080321320');
      const localQrUrl = qrGen.getQrImageUrl(filename, baseUrl);
      console.log(`[DebtCallTask] Generated QR: ${filename} -> ${localQrUrl}`);

      pushMsgs.push({
        type: 'image',
        originalContentUrl: localQrUrl,
        previewImageUrl: localQrUrl
      });
    } catch (qrErr) {
      console.error('[DebtCallTask] Error generating single QR code:', qrErr.message || qrErr);
    }

    console.log(`[DebtCallTask] Pushing ${pushMsgs.length} message(s) to group ${groupId}`);
    const result = await lineClient.pushMessage(groupId, pushMsgs);
    console.log(`[DebtCallTask] pushMessage result:`, result ? 'SUCCESS' : 'FAILED');
    return Boolean(result);
  }
};
