const db = require('../query');
const slipService = require('../slip');
const lineClient = require('../lineClient');
const logger = require('../utils/logger');
const { getFormatDate } = require('../utils/date');

const RETRY_DELAYS_SECONDS = [120, 300, 600, 900, 1800, 3600, 7200, 14400];
const MAX_ATTEMPTS = Math.max(1, Number(process.env.SLIP_VERIFY_MAX_ATTEMPTS) || RETRY_DELAYS_SECONDS.length);
const MAX_AGE_HOURS = Math.max(1, Number(process.env.SLIP_VERIFY_MAX_AGE_HOURS) || 24);
const BATCH_LIMIT = Math.max(1, Number(process.env.SLIP_VERIFY_BATCH_LIMIT) || 10);
const INTER_REQUEST_DELAY_MS = 500;

let isVerifying = false;

/**
 * Sleeps for the specified duration in milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Checks whether a noticed slip is due for its next EasySlip verification attempt.
 * Uses progressive backoff based on verify_attempts so delayed bank slips settle naturally.
 * @param {Object} slip - Row from slip_log
 * @param {number} nowMs - Current epoch timestamp in ms
 * @param {boolean} [force=false] - Bypass backoff timer when triggered manually
 * @returns {boolean}
 */
function isSlipDueForVerify(slip, nowMs, force = false) {
  if (force) return true;

  const attempts = Number(slip.verify_attempts) || 0;
  const delaySeconds = RETRY_DELAYS_SECONDS[Math.min(attempts, RETRY_DELAYS_SECONDS.length - 1)];
  const refDate = (attempts === 0 || !slip.last_verify_at) ? slip.created_at : slip.last_verify_at;
  if (!refDate) return true;

  const refMs = new Date(refDate).getTime();
  if (Number.isNaN(refMs)) return true;

  return (nowMs - refMs) >= delaySeconds * 1000;
}

/**
 * Detects quota, auth, or rate-limit errors where retrying immediately or burning attempts is undesirable.
 * @param {Object|null} error
 * @returns {boolean}
 */
function isQuotaOrAuthError(error) {
  if (!error || typeof error !== 'object') return false;
  const code = String(error.code || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();
  const status = Number(error.status || error.statusCode || 0);
  if (status === 401 || status === 402 || status === 429) return true;
  return /quota|limit|unauthorized|forbidden|too_many|credit/.test(`${code} ${message}`);
}

/**
 * Resolves the target LINE group ID for background verification notifications.
 * @returns {Promise<string|null>}
 */
async function resolveNotifyGroupId() {
  try {
    const rawGroupId = process.env.LINE_GROUP_ID || (await db.getActiveGroupId());
    if (!rawGroupId) return null;
    return await db.resolveLineGroupId(rawGroupId);
  } catch (err) {
    logger.warn('[SlipVerifier] Failed to resolve notification groupId:', err.message);
    return null;
  }
}

/**
 * Pushes verification notification messages to LINE in safe chunks of up to 5 messages.
 * @param {Array<Object>} messages
 */
async function pushNotifications(messages) {
  if (!messages || messages.length === 0) return;
  const targetGroupId = await resolveNotifyGroupId();
  if (!targetGroupId) {
    logger.warn('[SlipVerifier] Skipping LINE notification: no active groupId found.');
    return;
  }

  for (let i = 0; i < messages.length; i += 5) {
    const chunk = messages.slice(i, i + 5);
    await lineClient.pushMessage(targetGroupId, chunk);
  }
}

/**
 * Verifies a single pending slip against EasySlip, updates slip_log, and returns outcome details.
 * @param {Object} slip
 * @param {number} activeWeekCost
 * @returns {Promise<Object>}
 */
async function verifySingleSlip(slip, activeWeekCost) {
  const verifyResult = await slipService.verifySlipPayload(slip.qrcode, slip.sender_name);

  if (verifyResult.success && verifyResult.slipData) {
    let memberDebt = 0;
    if (slip.sender_id) {
      const members = await db.queryMemberbyLineID(slip.sender_id);
      if (members && members.length > 0) {
        memberDebt = Number(members[0].debt) || 0;
      }
    }

    const processed = slipService.processSlipData(verifyResult.slipData, slip.sender_name, {
      isDuplicate: false,
      memberDebt,
      weekCost: activeWeekCost,
      formatDateFn: (d) => getFormatDate(d, 'short', { buddhistEra: true, includeTime: true })
    });

    await db.markSlipVerified(slip.id, processed.logStatus, verifyResult.slipData);

    const isCleanSuccess = processed.slipToMe && processed.shouldClearDebt;
    let notifyText = null;
    if (isCleanSuccess && process.env.SLIP_VERIFY_NOTIFY_SUCCESS !== 'false') {
      const d = processed.details;
      notifyText = `✅ ตรวจสอบสลิป #${slip.id} (${slip.sender_name}) ย้อนหลังสำเร็จ\n`
        + `💰 ยอดเงิน: ${d.amountStr} บาท\n`
        + `💸 จาก: ${d.senderName}${d.senderBank ? ` - ${d.senderBank}` : ''}\n`
        + `💵 ให้กับ: ${d.recipientName}`;
    } else if (!isCleanSuccess) {
      notifyText = `⚠️ ตรวจสอบสลิป #${slip.id} (${slip.sender_name}) ย้อนหลังพบข้อสังเกต\n${processed.header.trim()}`;
    }

    return {
      outcome: 'verified',
      slipId: slip.id,
      senderName: slip.sender_name,
      logStatus: processed.logStatus,
      amount: processed.details?.amountStr || null,
      slipToMe: processed.slipToMe,
      shouldClearDebt: processed.shouldClearDebt,
      notifyText
    };
  }

  if (isQuotaOrAuthError(verifyResult.error)) {
    const errText = `${verifyResult.error?.code || ''} ${verifyResult.error?.message || 'Quota/Auth error'}`.trim();
    return {
      outcome: 'paused',
      slipId: slip.id,
      senderName: slip.sender_name,
      error: errText
    };
  }

  const errText = verifyResult.error
    ? `${verifyResult.error.code || ''} - ${verifyResult.error.message || ''}`.replace(/^\s*-\s*/, '').trim()
    : 'No response / network error';

  await db.recordSlipVerifyAttempt(slip.id, errText);
  const nextAttempts = (Number(slip.verify_attempts) || 0) + 1;
  let notifyText = null;
  if (nextAttempts >= MAX_ATTEMPTS) {
    notifyText = `⚠️ สลิป #${slip.id} (${slip.sender_name}) ตรวจสอบผ่าน EasySlip ไม่สำเร็จหลังลอง ${nextAttempts} ครั้ง\nสาเหตุล่าสุด: ${errText}`;
  }

  return {
    outcome: 'failed',
    slipId: slip.id,
    senderName: slip.sender_name,
    attempts: nextAttempts,
    error: errText,
    notifyText
  };
}

/**
 * Sweeps pending 'noticed' slips and verifies due records against EasySlip API.
 * @param {Object} [options={}]
 * @param {boolean} [options.force=false] - Ignore backoff window and check all recent noticed slips
 * @param {boolean} [options.notify=true] - Push LINE notifications on verification results
 * @returns {Promise<Object>} Summary of the verification sweep
 */
async function runPendingSlipVerification({ force = false, notify = true } = {}) {
  if (isVerifying) {
    logger.debug('[SlipVerifier] Previous verification sweep still running, skipping.');
    return { skipped: true, checked: 0, verified: 0, failed: 0, deferred: 0, results: [] };
  }

  isVerifying = true;
  const summary = { checked: 0, verified: 0, failed: 0, deferred: 0, results: [] };

  try {
    const candidates = await db.getPendingSlipsForVerify({
      maxAttempts: MAX_ATTEMPTS,
      maxAgeHours: MAX_AGE_HOURS,
      limit: BATCH_LIMIT
    });

    if (!candidates || candidates.length === 0) {
      return summary;
    }

    const nowMs = Date.now();
    const dueSlips = candidates.filter(slip => isSlipDueForVerify(slip, nowMs, force));
    summary.deferred = candidates.length - dueSlips.length;

    if (dueSlips.length === 0) {
      return summary;
    }

    logger.info(`[SlipVerifier] Starting verification sweep for ${dueSlips.length} noticed slip(s) (force=${force})...`);

    const weekInfoList = await db.queryWeekID(0);
    const activeWeekCost = (weekInfoList && weekInfoList.length > 0 && weekInfoList[0].cost > 0)
      ? Number(weekInfoList[0].cost)
      : 0;

    const notifyMessages = [];

    for (let i = 0; i < dueSlips.length; i++) {
      const slip = dueSlips[i];
      summary.checked++;

      const res = await verifySingleSlip(slip, activeWeekCost);
      summary.results.push(res);

      if (res.outcome === 'verified') {
        summary.verified++;
        logger.info(`[SlipVerifier] Slip #${slip.id} (${slip.sender_name}) verified -> status=${res.logStatus}, amount=${res.amount || '-'}`);
        if (res.notifyText) {
          notifyMessages.push({ type: 'text', text: res.notifyText });
        }
      } else if (res.outcome === 'paused') {
        summary.checked--;
        summary.deferred += (dueSlips.length - i);
        logger.warn(`[SlipVerifier] Pausing sweep due to EasySlip quota/auth error: ${res.error}`);
        break;
      } else {
        summary.failed++;
        logger.debug(`[SlipVerifier] Slip #${slip.id} attempt ${res.attempts}/${MAX_ATTEMPTS} failed: ${res.error}`);
        if (res.notifyText) {
          notifyMessages.push({ type: 'text', text: res.notifyText });
        }
      }

      if (i < dueSlips.length - 1) {
        await sleep(INTER_REQUEST_DELAY_MS);
      }
    }

    if (notify && notifyMessages.length > 0) {
      await pushNotifications(notifyMessages);
    }

    logger.info(`[SlipVerifier] Sweep finished: checked=${summary.checked}, verified=${summary.verified}, failed=${summary.failed}, deferred=${summary.deferred}`);
    return summary;
  } catch (err) {
    logger.error('[SlipVerifier] Unexpected error during verification sweep:', err);
    return summary;
  } finally {
    isVerifying = false;
  }
}

module.exports = {
  runPendingSlipVerification,
  isSlipDueForVerify,
  RETRY_DELAYS_SECONDS,
  MAX_ATTEMPTS
};
