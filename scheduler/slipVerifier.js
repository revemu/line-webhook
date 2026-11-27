const fs = require('fs').promises;
const path = require('path');
const db = require('../query');
const slipService = require('../slip');
const logger = require('../utils/logger');
const { getFormatDate } = require('../utils/date');

const SLIP_IMG_DIR = path.resolve(__dirname, '..', 'img', 'slip');

const DEFAULT_RETRY_DELAYS_SECONDS = [120, 300, 600, 900, 1800, 3600, 7200, 14400];
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
 * @param {number[]} [retryDelaysSeconds=DEFAULT_RETRY_DELAYS_SECONDS] - Backoff schedule in seconds
 * @returns {boolean}
 */
function isSlipDueForVerify(slip, nowMs, force = false, retryDelaysSeconds = DEFAULT_RETRY_DELAYS_SECONDS) {
  if (force) return true;

  const schedule = (Array.isArray(retryDelaysSeconds) && retryDelaysSeconds.length > 0)
    ? retryDelaysSeconds
    : DEFAULT_RETRY_DELAYS_SECONDS;
  const attempts = Number(slip.verify_attempts) || 0;
  const delaySeconds = schedule[Math.min(attempts, schedule.length - 1)];
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
function isRateLimitError(error) {
  if (!error || typeof error !== 'object') return false;
  const status = Number(error.status || error.statusCode || error.httpStatus || 0);
  if (status === 429) return true;
  const code = String(error.code || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();
  return /too_many|rate.?limit/.test(`${code} ${message}`);
}

/**
 * Detects permanent payload/validation errors where retrying the same QR will never succeed.
 * @param {Object|null} error
 * @returns {boolean}
 */
function isPermanentVerifyError(error) {
  if (!error || typeof error !== 'object') return false;
  const code = String(error.code || '').toUpperCase();
  return code === 'VALIDATION_ERROR' || code === 'INVALID_PAYLOAD';
}

/**
 * Verifies a single pending slip against EasySlip, updates slip_log, and returns outcome details.
 * @param {Object} slip
 * @param {number} activeWeekCost
 * @param {Object} cfg - Config loaded from DB app_settings_tbl
 * @returns {Promise<Object>}
 */
async function verifySingleSlip(slip, activeWeekCost, cfg) {
  if (typeof slipService.isBankSlipQRCode === 'function' && !slipService.isBankSlipQRCode(slip.qrcode)) {
    await db.deleteSlipLog(slip.id);
    if (slip.image_path) {
      try {
        const relPath = String(slip.image_path).replace(/^\/+/, '');
        const resolved = path.resolve(__dirname, '..', relPath);
        if (resolved.startsWith(SLIP_IMG_DIR + path.sep)) {
          await fs.unlink(resolved);
        }
      } catch (unlinkErr) {
        // Ignore missing local file
      }
    }
    return {
      outcome: 'invalid_qr',
      slipId: slip.id,
      senderName: slip.sender_name,
      error: 'Deleted non-bank-slip QR from DB'
    };
  }

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

    return {
      outcome: 'verified',
      slipId: slip.id,
      senderName: slip.sender_name,
      logStatus: processed.logStatus,
      amount: processed.details?.amountStr || null,
      slipToMe: processed.slipToMe,
      shouldClearDebt: processed.shouldClearDebt
    };
  }

  if (slipService.isApiExpiredOrQuotaError(verifyResult.error)) {
    const errText = `${verifyResult.error?.code || verifyResult.error?.status || ''} ${verifyResult.error?.message || 'API expired / quota exceeded'}`.trim();
    return {
      outcome: 'api_expired',
      slipId: slip.id,
      senderName: slip.sender_name,
      error: errText
    };
  }

  if (isRateLimitError(verifyResult.error)) {
    const errText = `${verifyResult.error?.code || ''} ${verifyResult.error?.message || 'Rate limit error'}`.trim();
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

  const isPermanent = isPermanentVerifyError(verifyResult.error);
  const nextAttempts = isPermanent ? cfg.maxAttempts : (Number(slip.verify_attempts) || 0) + 1;
  await db.recordSlipVerifyAttempt(slip.id, errText, isPermanent ? cfg.maxAttempts : null);

  return {
    outcome: 'failed',
    slipId: slip.id,
    senderName: slip.sender_name,
    attempts: nextAttempts,
    error: errText
  };
}

/**
 * Sweeps pending 'noticed' slips and verifies due records against EasySlip API silently (DB-only, no LINE notifications).
 * @param {Object} [options={}]
 * @param {boolean} [options.force=false] - Ignore enabled flag and backoff window when triggered manually
 * @returns {Promise<Object>} Summary of the verification sweep
 */
async function runPendingSlipVerification({ force = false } = {}) {
  if (isVerifying) {
    logger.debug('[SlipVerifier] Previous verification sweep still running, skipping.');
    return { skipped: true, checked: 0, verified: 0, failed: 0, deferred: 0, results: [] };
  }

  isVerifying = true;
  const summary = { checked: 0, verified: 0, failed: 0, deferred: 0, results: [], pollSeconds: 60, hasPending: false };

  try {
    const cfg = await db.getSlipVerifyConfig();
    summary.pollSeconds = cfg.pollSeconds;

    if (!force && !cfg.enabled) {
      summary.disabled = true;
      return summary;
    }

    const candidates = await db.getPendingSlipsForVerify({
      maxAttempts: cfg.maxAttempts,
      maxAgeHours: cfg.maxAgeHours,
      limit: cfg.batchLimit
    });

    if (!candidates || candidates.length === 0) {
      summary.hasPending = false;
      return summary;
    }

    const nowMs = Date.now();
    const dueSlips = candidates.filter(slip => isSlipDueForVerify(slip, nowMs, force, cfg.retryDelaysSeconds));
    summary.deferred = candidates.length - dueSlips.length;

    if (dueSlips.length === 0) {
      summary.hasPending = true;
      return summary;
    }

    logger.info(`[SlipVerifier] Starting verification sweep for ${dueSlips.length} noticed slip(s) (force=${force})...`);

    const weekInfoList = await db.queryWeekID(0);
    const activeWeekCost = (weekInfoList && weekInfoList.length > 0 && weekInfoList[0].cost > 0)
      ? Number(weekInfoList[0].cost)
      : 0;

    for (let i = 0; i < dueSlips.length; i++) {
      const slip = dueSlips[i];
      summary.checked++;

      const res = await verifySingleSlip(slip, activeWeekCost, cfg);
      summary.results.push(res);

      if (res.outcome === 'verified') {
        summary.verified++;
        logger.info(`[SlipVerifier] Slip #${slip.id} (${slip.sender_name}) verified -> status=${res.logStatus}, amount=${res.amount || '-'}`);
      } else if (res.outcome === 'invalid_qr') {
        summary.failed++;
        logger.info(`[SlipVerifier] Slip #${slip.id} (${slip.sender_name}) deleted from slip_log (not a bank slip Mini-QR)`);
        continue;
      } else if (res.outcome === 'api_expired') {
        summary.checked--;
        summary.apiExpired = true;
        summary.deferred = 0;
        await db.resetNoticedSlipsOnApiExpired(res.error);
        logger.warn(`[SlipVerifier] EasySlip API expired/quota exceeded (${res.error}); reset noticed slip status to api_expired and stopped retries.`);
        break;
      } else if (res.outcome === 'paused') {
        summary.checked--;
        summary.deferred += (dueSlips.length - i);
        logger.warn(`[SlipVerifier] Pausing sweep due to EasySlip rate-limit error: ${res.error}`);
        break;
      } else {
        summary.failed++;
        logger.debug(`[SlipVerifier] Slip #${slip.id} attempt ${res.attempts}/${cfg.maxAttempts} failed: ${res.error}`);
      }

      if (i < dueSlips.length - 1) {
        await sleep(INTER_REQUEST_DELAY_MS);
      }
    }

    const hasRetryableResult = !summary.apiExpired && summary.results.some(
      r => r.outcome === 'paused' || (r.outcome === 'failed' && r.attempts < cfg.maxAttempts)
    );
    summary.hasPending = !summary.apiExpired && ((candidates.length >= cfg.batchLimit) || summary.deferred > 0 || hasRetryableResult);

    logger.info(`[SlipVerifier] Sweep finished: checked=${summary.checked}, verified=${summary.verified}, failed=${summary.failed}, deferred=${summary.deferred}, hasPending=${summary.hasPending}`);
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
  DEFAULT_RETRY_DELAYS_SECONDS
};
