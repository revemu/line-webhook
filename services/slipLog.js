const { executeQuery } = require('../db/pool');
const logger = require('../utils/logger');

let slipLogSchemaEnsured = false;

/**
 * Ensures slip_log table and retry-tracking columns exist.
 */
async function ensureSlipLogSchema() {
  if (slipLogSchemaEnsured) return;

  const createSql = `CREATE TABLE IF NOT EXISTS slip_log (
    id SERIAL PRIMARY KEY,
    sender_id VARCHAR(255),
    sender_name VARCHAR(255),
    image_path VARCHAR(255),
    status VARCHAR(50),
    qrcode TEXT,
    response_json TEXT,
    verify_attempts INTEGER DEFAULT 0,
    last_verify_at TIMESTAMP NULL,
    last_verify_error VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;
  await executeQuery(createSql, []);

  const requiredCols = [
    { name: 'qrcode', ddl: 'ALTER TABLE slip_log ADD COLUMN IF NOT EXISTS qrcode TEXT' },
    { name: 'response_json', ddl: 'ALTER TABLE slip_log ADD COLUMN IF NOT EXISTS response_json TEXT' },
    { name: 'verify_attempts', ddl: 'ALTER TABLE slip_log ADD COLUMN IF NOT EXISTS verify_attempts INTEGER DEFAULT 0' },
    { name: 'last_verify_at', ddl: 'ALTER TABLE slip_log ADD COLUMN IF NOT EXISTS last_verify_at TIMESTAMP NULL' },
    { name: 'last_verify_error', ddl: 'ALTER TABLE slip_log ADD COLUMN IF NOT EXISTS last_verify_error VARCHAR(255) NULL' }
  ];

  const colRows = await executeQuery(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'slip_log'`,
    []
  );
  const existingCols = new Set((colRows || []).map(r => String(r.column_name || r.COLUMN_NAME || '').toLowerCase()));

  for (const col of requiredCols) {
    if (!existingCols.has(col.name)) {
      await executeQuery(col.ddl, []);
    }
  }

  slipLogSchemaEnsured = true;
}

/**
 * Inserts a new slip verification log record.
 */
async function logSlip(senderId, senderName, imagePath, status, qrcode = null, responseJson = null) {
  try {
    await ensureSlipLogSchema();

    const sql = `INSERT INTO slip_log (sender_id, sender_name, image_path, status, qrcode, response_json) VALUES (?, ?, ?, ?, ?, ?)`;
    const jsonStr = responseJson ? JSON.stringify(responseJson) : null;
    await executeQuery(sql, [senderId, senderName, imagePath, status, qrcode, jsonStr]);
  } catch (err) {
    logger.error("Error logging slip:", err);
  }
}

/**
 * Looks up a logged slip by decoded QR payload.
 */
async function getSlipByQRCode(qrcode) {
  try {
    const sql = `SELECT id, response_json FROM slip_log WHERE qrcode = ? LIMIT 1`;
    const rows = await executeQuery(sql, [qrcode]);
    if (rows && rows.length > 0) {
      return {
        id: rows[0].id,
        data: rows[0].response_json ? JSON.parse(rows[0].response_json) : null
      };
    }
  } catch (err) {
    if (err.code !== '42703' && err.code !== 'ER_BAD_FIELD_ERROR') {
      logger.error("Error getting slip by qrcode:", err);
    }
  }
  return null;
}

/**
 * Updates slip status and payload JSON, refreshing created_at timestamp.
 */
async function updateSlipLog(id, status, responseJson = null) {
  try {
    const jsonStr = responseJson ? JSON.stringify(responseJson) : null;
    const sql = `UPDATE slip_log SET status = ?, response_json = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?`;
    await executeQuery(sql, [status, jsonStr, id]);
  } catch (err) {
    logger.error("Error updating slip log:", err);
  }
}

/**
 * Marks a noticed slip as verified and clears last_verify_error.
 */
async function markSlipVerified(id, status, responseJson = null) {
  try {
    await ensureSlipLogSchema();
    const jsonStr = responseJson ? JSON.stringify(responseJson) : null;
    const sql = `UPDATE slip_log SET status = ?, response_json = ?, last_verify_at = CURRENT_TIMESTAMP, last_verify_error = NULL WHERE id = ?`;
    await executeQuery(sql, [status, jsonStr, id]);
  } catch (err) {
    logger.error("Error marking slip verified:", err);
  }
}

/**
 * Deletes a slip_log row by ID.
 */
async function deleteSlipLog(id) {
  try {
    await ensureSlipLogSchema();
    const sql = `DELETE FROM slip_log WHERE id = ?`;
    await executeQuery(sql, [id]);
  } catch (err) {
    logger.error("Error deleting slip log:", err);
  }
}

/**
 * Increments (or sets) verify_attempts and records last_verify_at / last_verify_error.
 */
async function recordSlipVerifyAttempt(id, errorMessage = null, forceAttempts = null) {
  try {
    await ensureSlipLogSchema();
    const trimmedError = errorMessage ? String(errorMessage).substring(0, 250) : null;
    if (forceAttempts !== null && forceAttempts !== undefined && Number.isFinite(Number(forceAttempts))) {
      const sql = `UPDATE slip_log SET verify_attempts = ?, last_verify_at = CURRENT_TIMESTAMP, last_verify_error = ? WHERE id = ?`;
      await executeQuery(sql, [Math.max(1, Math.floor(Number(forceAttempts))), trimmedError, id]);
    } else {
      const sql = `UPDATE slip_log SET verify_attempts = COALESCE(verify_attempts, 0) + 1, last_verify_at = CURRENT_TIMESTAMP, last_verify_error = ? WHERE id = ?`;
      await executeQuery(sql, [trimmedError, id]);
    }
  } catch (err) {
    logger.error("Error recording slip verify attempt:", err);
  }
}

/**
 * Resets all queued 'noticed' slips to 'api_expired' when EasySlip API expires or quota/auth fails,
 * preventing background sweeps from re-verifying them repeatedly.
 */
async function resetNoticedSlipsOnApiExpired(errorMessage = null) {
  try {
    await ensureSlipLogSchema();
    const trimmedError = errorMessage ? String(errorMessage).substring(0, 250) : 'API expired / quota exceeded';
    const sql = `UPDATE slip_log SET status = 'api_expired', last_verify_at = CURRENT_TIMESTAMP, last_verify_error = ? WHERE status = 'noticed'`;
    return await executeQuery(sql, [trimmedError]);
  } catch (err) {
    logger.error("Error resetting noticed slips on API expiry:", err);
    return null;
  }
}

/**
 * Fetches queued noticed slips eligible for background EasySlip verification.
 */
async function getPendingSlipsForVerify({ maxAttempts = 8, maxAgeHours = 168, limit = 10 } = {}) {
  try {
    await ensureSlipLogSchema();
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 10)));
    const safeMaxAttempts = Math.max(1, Math.floor(Number(maxAttempts) || 8));
    const safeMaxAgeHours = Math.max(1, Math.floor(Number(maxAgeHours) || 168));
    const sql = `
      SELECT id, sender_id, sender_name, image_path, status, qrcode, response_json, created_at,
             COALESCE(verify_attempts, 0) AS verify_attempts, last_verify_at, last_verify_error
      FROM slip_log
      WHERE status = 'noticed'
        AND qrcode IS NOT NULL
        AND TRIM(qrcode) != ''
        AND COALESCE(verify_attempts, 0) < ?
        AND created_at >= NOW() - (${safeMaxAgeHours} * INTERVAL '1 hour')
      ORDER BY created_at ASC
      LIMIT ${safeLimit}
    `;
    return await executeQuery(sql, [safeMaxAttempts]);
  } catch (err) {
    logger.error("Error getting pending slips for verify:", err);
    return [];
  }
}

/**
 * Lists recent noticed slips optionally filtered by senderId.
 */
async function getNoticedSlips(senderId = null) {
  try {
    let sql = `SELECT id, sender_name, image_path, status, qrcode, created_at FROM slip_log WHERE status = 'noticed'`;
    const params = [];
    if (senderId) {
      sql += ` AND sender_id = ?`;
      params.push(senderId);
    }
    sql += ` ORDER BY created_at DESC LIMIT 10`;
    return await executeQuery(sql, params);
  } catch (err) {
    logger.error("Error getting noticed slips:", err);
    return [];
  }
}

/**
 * Fetches a single slip_log record by ID.
 */
async function getSlipById(id) {
  try {
    const sql = `SELECT id, sender_id, sender_name, image_path, status, qrcode, response_json, created_at FROM slip_log WHERE id = ?`;
    const rows = await executeQuery(sql, [id]);
    if (rows && rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    logger.error("Error getting slip by id:", err);
  }
  return null;
}

module.exports = {
  ensureSlipLogSchema,
  logSlip,
  getSlipByQRCode,
  updateSlipLog,
  markSlipVerified,
  deleteSlipLog,
  recordSlipVerifyAttempt,
  resetNoticedSlipsOnApiExpired,
  getPendingSlipsForVerify,
  getNoticedSlips,
  getSlipById
};
