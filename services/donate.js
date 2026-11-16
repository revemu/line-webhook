const { pool, executeQuery } = require('../db/pool');
const { resolveMemberDisplayInfo, fetchDisplayAssets } = require('./memberDisplay');

let donateLogTableEnsured = false;

/**
 * Ensures donate_log_tbl exists and seeds existing member_tbl.donate balances once if empty.
 */
async function ensureDonateLogTable() {
  if (donateLogTableEnsured) return;
  const createSql = `
    CREATE TABLE IF NOT EXISTS donate_log_tbl (
      id INT AUTO_INCREMENT PRIMARY KEY,
      member_id INT NOT NULL,
      amount INT NOT NULL,
      source VARCHAR(50) NOT NULL DEFAULT 'manual',
      note VARCHAR(255) NULL,
      created_by VARCHAR(100) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_donate_member (member_id),
      INDEX idx_donate_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `;
  await executeQuery(createSql, []);

  const countRows = await executeQuery("SELECT COUNT(*) AS cnt FROM donate_log_tbl", []);
  const existingCount = (countRows && countRows[0]) ? Number(countRows[0].cnt || 0) : 0;
  if (existingCount === 0) {
    await executeQuery(
      `INSERT INTO donate_log_tbl (member_id, amount, source, note, created_by)
       SELECT id, donate, 'initial', 'ยอดสะสมเดิม', 'system'
       FROM member_tbl
       WHERE donate > 0`,
      []
    );
  }
  donateLogTableEnsured = true;
}

/**
 * Atomically adjusts a member's cumulative donate balance and records a transaction in donate_log_tbl.
 * @param {number} memberId
 * @param {number} deltaAmount - Positive to add, negative to deduct
 * @param {Object} [options={}]
 * @param {string} [options.source='manual']
 * @param {string|null} [options.note=null]
 * @param {string|null} [options.createdBy=null]
 * @returns {Promise<Object|null>}
 */
async function adjustMemberDonate(memberId, deltaAmount, { source = 'manual', note = null, createdBy = null } = {}) {
  const delta = Math.trunc(Number(deltaAmount));
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error('Donation amount must be a non-zero integer');
  }

  await ensureDonateLogTable();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      "SELECT id, name, alias, donate FROM member_tbl WHERE id = ? FOR UPDATE",
      [memberId]
    );
    if (!rows || rows.length === 0) {
      await conn.rollback();
      return null;
    }

    const memberRow = rows[0];
    const previousTotal = Number(memberRow.donate) || 0;
    const newTotal = Math.max(0, previousTotal + delta);
    const actualDelta = newTotal - previousTotal;

    let logId = null;
    if (actualDelta !== 0) {
      const cleanNote = note ? String(note).trim().substring(0, 250) : null;
      const cleanBy = createdBy ? String(createdBy).trim().substring(0, 95) : null;
      const [insertRes] = await conn.execute(
        "INSERT INTO donate_log_tbl (member_id, amount, source, note, created_by) VALUES (?, ?, ?, ?, ?)",
        [memberId, actualDelta, source, cleanNote, cleanBy]
      );
      logId = insertRes ? insertRes.insertId : null;
      await conn.execute("UPDATE member_tbl SET donate = ? WHERE id = ?", [newTotal, memberId]);
    }

    await conn.commit();
    return {
      memberId: memberRow.id,
      name: memberRow.name,
      alias: memberRow.alias,
      previousTotal,
      delta: actualDelta,
      newTotal,
      logId
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Fetches sorted donate leaderboard enriched with display assets (avatars, badges, tier colors).
 * @param {number} [limit=100]
 * @returns {Promise<Object>}
 */
async function getDonateLeaderboard(limit = 100) {
  await ensureDonateLogTable();
  const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 100)));
  const assets = await fetchDisplayAssets();

  const [sumRows, donorRows] = await Promise.all([
    executeQuery("SELECT COUNT(*) AS donor_count, COALESCE(SUM(donate), 0) AS total_donate FROM member_tbl WHERE donate > 0", []),
    executeQuery(
      `SELECT id, name, alias, \`rank\`, donate, picture_url, line_user_id
       FROM member_tbl
       WHERE donate > 0
       ORDER BY donate DESC, id ASC
       LIMIT ${safeLimit}`,
      []
    )
  ]);

  const totalDonate = (sumRows && sumRows[0]) ? Number(sumRows[0].total_donate || 0) : 0;
  const donorCount = (sumRows && sumRows[0]) ? Number(sumRows[0].donor_count || 0) : 0;

  const donors = (donorRows || []).map((m, idx) => {
    const info = resolveMemberDisplayInfo(
      m,
      assets.badges,
      assets.donateColors,
      assets.hofCounts,
      assets.hofBadge,
      assets.hofAwards
    );
    return {
      rankNum: idx + 1,
      id: m.id,
      name: (m.name || '').replace(/^@/, ''),
      rawName: m.name,
      donate: Number(m.donate) || 0,
      nameColor: info.nameColor,
      badgeUrl: info.badgeUrl,
      badgeSize: info.badgeSize,
      hofBadges: info.hofBadges,
      pictureUrl: info.pictureUrl
    };
  });

  return {
    donors,
    totalDonate,
    donorCount,
    donateColors: assets.donateColors || []
  };
}

/**
 * Fetches recent donation log entries joined with member names.
 * @param {number} [limit=15]
 * @returns {Promise<Array<Object>>}
 */
async function getRecentDonateLogs(limit = 15) {
  await ensureDonateLogTable();
  const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 15)));
  return await executeQuery(
    `SELECT d.id, d.member_id, m.name AS member_name, m.donate AS member_total,
            d.amount, d.source, d.note, d.created_by, d.created_at
     FROM donate_log_tbl d
     LEFT JOIN member_tbl m ON m.id = d.member_id
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT ${safeLimit}`,
    []
  );
}

module.exports = {
  ensureDonateLogTable,
  adjustMemberDonate,
  getDonateLeaderboard,
  getRecentDonateLogs
};
