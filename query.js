const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('./utils/logger');
require('dotenv').config({ quiet: true });
const flex = require('./flex');
const lineClient = require('./lineClient');
const { getFormatDate, getShortDate, getSlashDate, thaiMonthsShort, parseDateInput, getWeekEndInfo } = require('./utils/date');
const { invalidateLeaderStatsCache } = require('./utils/leaderCache');
const { pool, executeQuery } = require('./db/pool');
const { resolveMemberDisplayInfo, fetchDisplayAssets } = require('./services/memberDisplay');
const {
  ensureAppSettingsTable,
  getSetting,
  setSetting,
  getSettingsByCategory,
  getSlipVerifyConfig,
  setSlipVerifyConfig
} = require('./services/appSettings');
const {
  ensureDonateLogTable,
  adjustMemberDonate,
  getDonateLeaderboard,
  getRecentDonateLogs
} = require('./services/donate');
const {
  ensureSlipLogSchema,
  logSlip,
  getSlipByQRCode,
  updateSlipLog,
  markSlipVerified,
  deleteSlipLog,
  recordSlipVerifyAttempt,
  getPendingSlipsForVerify,
  getNoticedSlips,
  getSlipById
} = require('./services/slipLog');

let lastGroupId = null;

async function ensureMemberPicture(member, groupId = null) {
  if (!member || !member.line_user_id) return;

  const pic = member.picture_url || member.pictureUrl;
  const hasPic = pic && String(pic).trim() !== '' && String(pic).toLowerCase() !== 'none' && String(pic).toLowerCase() !== 'null';

  // If member already has a profile picture in DB, do not fetch from LINE API
  if (hasPic) {
    member.picture_url = pic;
    member.pictureUrl = pic;
    return;
  }

  if (groupId) {
    lastGroupId = groupId;
  }
  const effectiveGroupId = groupId || lastGroupId;
  const client = lineClient.getLineClient();

  if (effectiveGroupId) {
    try {
      const profile = await client.getGroupMemberProfile(effectiveGroupId, member.line_user_id);
      if (profile && profile.pictureUrl) {
        member.inGroup = true;
        await executeQuery("UPDATE member_tbl SET picture_url = ? WHERE id = ?", [profile.pictureUrl, member.id]);
        member.picture_url = profile.pictureUrl;
        member.pictureUrl = profile.pictureUrl;
        return;
      }
    } catch (groupErr) {
      const isNotFound = groupErr.statusCode === 404 ||
        groupErr.status === 404 ||
        groupErr.originalError?.response?.status === 404 ||
        (groupErr.message && groupErr.message.includes('404'));
      if (isNotFound) {
        member.inGroup = false;
        logger.info(`[ensureMemberPicture] Member ${member.name} (${member.id}) is no longer in group ${effectiveGroupId}`);
      } else {
        logger.warn(`[ensureMemberPicture] Failed to check group profile for ${member.name}:`, groupErr.message);
      }
    }
  }

  // Fallback direct profile fetch if missing in DB and group check did not populate
  try {
    const profile = await client.getProfile(member.line_user_id);
    if (profile && profile.pictureUrl) {
      await executeQuery("UPDATE member_tbl SET picture_url = ? WHERE id = ?", [profile.pictureUrl, member.id]);
      member.picture_url = profile.pictureUrl;
      member.pictureUrl = profile.pictureUrl;
    }
  } catch (err) {
    logger.error(`[ensureMemberPicture] failed to fetch direct profile for user ${member.line_user_id}:`, err.message);
  }
}


// In-memory cache for fast, zero-latency group tag formatting in logs
const groupCache = new Map();
const lastGroupSync = new Map();
const GROUP_SYNC_INTERVAL_MS = 60 * 60 * 1000; // Throttle LINE API sync to once per hour

function updateGroupCache(record) {
  if (!record || !record.line_group_id) return;
  const item = {
    id: record.id,
    line_group_id: record.line_group_id,
    group_name: record.group_name || null,
    member_count: record.member_count !== undefined ? record.member_count : null,
    picture_url: record.picture_url || null
  };
  groupCache.set(record.line_group_id, item);
  if (record.id) {
    groupCache.set(String(record.id), item);
  }
}

async function ensureLineGroupTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS line_group_id_tbl (
        id SERIAL PRIMARY KEY,
        line_group_id VARCHAR(64) NOT NULL UNIQUE,
        group_name VARCHAR(255) NULL,
        member_count INTEGER NULL DEFAULT 0,
        picture_url VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await executeQuery(sql);
    await executeQuery("CREATE INDEX IF NOT EXISTS idx_line_group_id ON line_group_id_tbl (line_group_id)");

    // Load existing groups into memory cache
    const rows = await executeQuery("SELECT id, line_group_id, group_name, member_count, picture_url FROM line_group_id_tbl");
    for (const row of rows) {
      updateGroupCache(row);
    }
  } catch (err) {
    logger.error('Error ensuring line_group_id_tbl:', err.message);
  }
}

// Test database connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    logger.info('✅ Connected to PostgreSQL database successfully');
    connection.release();
    await ensureLineGroupTable();
    await ensureScheduledTaskTable();
    await ensureMatchStatScheduleColumns();
    await ensureUserTable();
    await ensureMemberFeeExemptColumn();
    await ensureDonateLogTable();
  } catch (error) {
    logger.error('❌ Error connecting to PostgreSQL database:', error.message);
  }
}

async function ensureScheduledTaskTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS scheduled_task_tbl (
        id SERIAL PRIMARY KEY,
        task_key VARCHAR(100) NOT NULL UNIQUE,
        task_name VARCHAR(255) NOT NULL,
        task_type VARCHAR(20) NOT NULL DEFAULT 'command',
        command VARCHAR(255) NULL,
        text_message TEXT NULL,
        schedule_days VARCHAR(100) NOT NULL DEFAULT '*',
        schedule_time VARCHAR(10) NOT NULL DEFAULT '20:00',
        group_id VARCHAR(100) NULL,
        delivery_mode VARCHAR(20) NOT NULL DEFAULT 'push',
        expire_minutes INTEGER NULL DEFAULT 60,
        enabled SMALLINT NOT NULL DEFAULT 1,
        last_run_date VARCHAR(30) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await executeQuery(sql);
    await executeQuery("ALTER TABLE scheduled_task_tbl ADD COLUMN IF NOT EXISTS expire_minutes INTEGER NULL DEFAULT 60");
  } catch (err) {
    logger.error('Error ensuring scheduled_task_tbl:', err.message);
  }
}

async function ensureMatchStatScheduleColumns() {
  try {
    const colCheck = await executeQuery(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'match_stat_tbl' AND column_name = 'status'"
    );
    if (!colCheck || colCheck.length === 0) {
      await executeQuery(`
        ALTER TABLE match_stat_tbl
          ADD COLUMN IF NOT EXISTS round INTEGER NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS start_time VARCHAR(10) NULL,
          ADD COLUMN IF NOT EXISTS end_time VARCHAR(10) NULL,
          ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'finished',
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      `);
      logger.info('✅ Auto-migrated match_stat_tbl with schedule and status columns');
    }
  } catch (err) {
    logger.warn('Notice: match_stat_tbl schema check (manual migration: migrations/match_stat_schedule.sql):', err.message);
  }

  try {
    await executeQuery(`
      ALTER TABLE match_stat_tbl
        ALTER COLUMN team_a_goal DROP NOT NULL,
        ALTER COLUMN team_b_goal DROP NOT NULL
    `);
  } catch (modErr) { }
}

async function ensureUserTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS user_tbl (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'admin',
        name VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await executeQuery(sql);
    await executeQuery("CREATE INDEX IF NOT EXISTS idx_username ON user_tbl (username)");

    const users = await executeQuery('SELECT COUNT(*) as cnt FROM user_tbl');
    if (users && users[0] && Number(users[0].cnt) === 0) {
      await executeQuery(`
        INSERT INTO user_tbl (username, password, role, name) VALUES
        ('admin', '$2b$10$DOtGRoaOcG3UGGBjWdxtFutYUcq/FJ47bKeLMf5hSPwSFl6HEr1xG', 'admin', 'Match Admin'),
        ('root', '$2b$10$NFftupORvl9C7xgWiLdeFujSb8m/W1otZZhXNFc7iOd.RJxv/RrK.', 'root', 'System Root')
        ON CONFLICT (username) DO NOTHING
      `);
      logger.info('✅ Initialized default user_tbl accounts (admin, root)');
    }
  } catch (err) {
    logger.warn('Notice: user_tbl schema check:', err.message);
  }
}

async function ensureMemberFeeExemptColumn() {
  try {
    await executeQuery("ALTER TABLE member_tbl ADD COLUMN IF NOT EXISTS fee_exempt SMALLINT NOT NULL DEFAULT 0");
  } catch (err) {
    logger.warn('Notice: member_tbl fee_exempt schema check (manual migration: migrations/member_fee_exempt.sql):', err.message);
  }
}


const { getBaseUrl, getFullUrl, getLiveWebUrl } = require('./utils/url');

async function getAdminCommands() {
  const results = await executeQuery("SELECT cmd FROM admin_cmd_tbl");
  return results.map(r => r.cmd);
}

async function updateAlertCall(value = 1) {

  let query;
  query = `update template_tpl set value=${value} where name='call'`;

  const res = await executeQuery(query);
  //logger.info(res) ;
  return res;

}

async function updateMember(member_id, value, type = 0) {
  let query;
  if (type == 0) {
    query = "update member_tbl set name=? where id=?";
    return await executeQuery(query, [value, member_id]);
  } else if (type == 1) {
    //query = `update member_team_week_tbl set team_id=${value} where member_id=${member_id} and week_id=${week_id}`
  }
}

async function updateMemberRank(member_id, rank) {
  const query = 'UPDATE member_tbl SET "rank" = ? WHERE id = ?';
  return await executeQuery(query, [rank, member_id]);
}

async function updateMemberPriority(member_id, priority) {
  const query = "update member_tbl set priority=? where id=?";
  return await executeQuery(query, [priority, member_id]);
}

async function updateMemberAvoidIds(member_id, avoid_ids) {
  const query = "update member_tbl set avoid_ids=? where id=?";
  return await executeQuery(query, [avoid_ids !== null && avoid_ids !== undefined ? String(avoid_ids).trim() : '', member_id]);
}

async function setMemberWeekPriority(member_id, week_id, priority) {
  const query = "update member_team_week_tbl set priority=? where member_id=? and week_id=?";
  return await executeQuery(query, [priority, member_id, week_id]);
}

async function resetMemberTeam() {
  const week = await queryWeekID();
  let query = `update member_team_week_tbl set team_id=0, pos_id=0 where week_id=${week[0].id}`;

  const res = await executeQuery(query);
  //logger.info(res) ;
  return res;

}

/**
 * Inserts a new member into member_tbl, or updates and returns the existing record
 * if the same line_user_id already exists (prevents duplicates & ER_DUP_ENTRY race errors).
 */
async function newMember(lineID, name, pictureUrl = null, avoid_ids = '') {
  const cleanLineId = (lineID && String(lineID).trim()) ? String(lineID).trim() : null;
  const alias = String(name || '').replace('@', '');

  if (cleanLineId) {
    const existing = await executeQuery(
      "SELECT id, name, picture_url FROM member_tbl WHERE line_user_id = ? LIMIT 1",
      [cleanLineId]
    );
    if (existing && existing.length > 0) {
      await updateMemberInfo(existing[0].id, name, pictureUrl !== null ? pictureUrl : existing[0].picture_url);
      return { insertId: existing[0].id, affectedRows: 0, alreadyExists: true };
    }
  }

  try {
    const query = "INSERT INTO member_tbl (name, debt, donate, team_id, alias, line_user_id, avoid_ids, picture_url) VALUES (?, 0, 0, 0, ?, ?, ?, ?) RETURNING id";
    const res = await executeQuery(query, [name, alias, cleanLineId, avoid_ids || '', pictureUrl]);
    return res;
  } catch (err) {
    if (err && (err.code === '23505' || err.code === 'ER_DUP_ENTRY') && cleanLineId) {
      const existing = await executeQuery(
        "SELECT id, picture_url FROM member_tbl WHERE line_user_id = ? LIMIT 1",
        [cleanLineId]
      );
      if (existing && existing.length > 0) {
        await updateMemberInfo(existing[0].id, name, pictureUrl !== null ? pictureUrl : existing[0].picture_url);
        return { insertId: existing[0].id, affectedRows: 0, alreadyExists: true };
      }
    }
    throw err;
  }
}

async function updateMemberInfo(member_id, name, pictureUrl = undefined) {
  if (pictureUrl !== undefined) {
    let query = "update member_tbl set name = ?, picture_url = ? where id = ?";
    return await executeQuery(query, [name, pictureUrl, member_id]);
  } else {
    let query = "update member_tbl set name = ? where id = ?";
    return await executeQuery(query, [name, member_id]);
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Selects up to `count` colors from `availableColors`, prioritizing colors with
 * the lowest usage count in `usageCounts` (case-insensitive keys).
 * Ties at the same usage count are broken uniformly at random, and the final
 * selected list is shuffled so team slot order (index 1, 2, 3...) is unbiased.
 *
 * @param {string[]} availableColors
 * @param {number} count
 * @param {Map<string, number>|Object<string, number>} [usageCounts={}]
 * @param {Function} [shuffleFn=shuffleArray]
 * @returns {string[]}
 */
function selectLeastUsedColors(availableColors, count, usageCounts = {}, shuffleFn = shuffleArray) {
  if (!Array.isArray(availableColors) || availableColors.length === 0 || count <= 0) {
    return [];
  }

  const seen = new Set();
  const uniqueColors = [];
  for (const raw of availableColors) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueColors.push(trimmed);
  }

  const getCount = (color) => {
    const key = color.toLowerCase();
    if (usageCounts instanceof Map) {
      return Number(usageCounts.get(key) || 0);
    }
    return Number(usageCounts[key] || 0);
  };

  const buckets = new Map();
  for (const color of uniqueColors) {
    const cnt = getCount(color);
    if (!buckets.has(cnt)) buckets.set(cnt, []);
    buckets.get(cnt).push(color);
  }

  const sortedCounts = Array.from(buckets.keys()).sort((a, b) => a - b);
  const selected = [];
  for (const cnt of sortedCounts) {
    if (selected.length >= count) break;
    const tier = shuffleFn([...buckets.get(cnt)]);
    const needed = count - selected.length;
    selected.push(...tier.slice(0, needed));
  }

  return shuffleFn(selected);
}

async function newTeamColorWeek(color, index, week_id) {
  const query = "INSERT INTO team_color_week_tbl VALUES (DEFAULT, ?, ?, ?)";
  logger.info(`${query} [${index}, ${week_id}, ${color}]`);

  const res = await executeQuery(query, [index, week_id, color]);
  return res;
}

const YEARLY_COLOR_USAGE_ALIASES = {
  // In 2026, Green was retired and replaced by Yellow; count historical 2026 Green weeks under Yellow.
  2026: {
    green: 'yellow'
  }
};

async function resolveTargetWeekForColors(targetWeekId = null) {
  let week_id;
  let max_players = 24;
  let targetYear = new Date().getFullYear();
  let dateStr = '';

  if (targetWeekId) {
    const numericTargetId = Number(targetWeekId);
    const weekRows = await executeQuery(
      "SELECT id, max, year, EXTRACT(YEAR FROM date)::int AS date_year, TO_CHAR(date, 'FMDD Mon YYYY') AS date_str FROM week_tbl WHERE id = ? LIMIT 1",
      [numericTargetId]
    );
    if (weekRows && weekRows.length > 0) {
      week_id = weekRows[0].id;
      max_players = weekRows[0].max || 24;
      targetYear = Number(weekRows[0].year) || Number(weekRows[0].date_year) || new Date().getFullYear();
      dateStr = weekRows[0].date_str || '';
    } else {
      week_id = numericTargetId;
    }
  } else {
    const weekRows = await executeQuery(
      "SELECT id, max, year, EXTRACT(YEAR FROM date)::int AS date_year, TO_CHAR(date, 'FMDD Mon YYYY') AS date_str FROM week_tbl ORDER BY id DESC LIMIT 1"
    );
    if (!weekRows || weekRows.length === 0) return null;
    week_id = weekRows[0].id;
    max_players = weekRows[0].max || 24;
    targetYear = Number(weekRows[0].year) || Number(weekRows[0].date_year) || new Date().getFullYear();
    dateStr = weekRows[0].date_str || '';
  }

  if (targetYear > 2400) {
    targetYear -= 543;
  }

  let registeredCount = 0;
  try {
    const regRes = await executeQuery("SELECT COUNT(*) as cnt FROM member_team_week_tbl WHERE week_id = ?", [week_id]);
    registeredCount = regRes?.[0]?.cnt || 0;
  } catch (err) {}

  return { week_id, max_players, targetYear, registeredCount, dateStr };
}

async function getTeamColorPool() {
  const poolRes = await executeQuery("SELECT value FROM template_tpl WHERE name = 'team_color_pools'");
  return poolRes && poolRes.length > 0 ? poolRes.map(r => r.value) : [];
}

async function getYearlyColorUsageCounts(targetYear, excludeWeekId = null) {
  const params = [String(targetYear), targetYear];
  let excludeClause = '';
  if (excludeWeekId !== null && excludeWeekId !== undefined) {
    excludeClause = ' AND tcw.week_id <> ?';
    params.push(excludeWeekId);
  }

  const usageRows = await executeQuery(
    `SELECT LOWER(TRIM(tcw.color)) AS color_key, COUNT(*) AS usage_count
     FROM team_color_week_tbl tcw
     JOIN week_tbl w ON tcw.week_id = w.id
     WHERE (w.year::text = ?::text OR EXTRACT(YEAR FROM w.date)::int = ?)${excludeClause}
       AND tcw.color IS NOT NULL
       AND TRIM(tcw.color) <> ''
     GROUP BY LOWER(TRIM(tcw.color))`,
    params
  );

  const aliasMap = YEARLY_COLOR_USAGE_ALIASES[Number(targetYear)] || {};
  const usageCounts = {};
  for (const row of usageRows || []) {
    if (!row.color_key) continue;
    const canonicalKey = aliasMap[row.color_key] || row.color_key;
    usageCounts[canonicalKey] = (usageCounts[canonicalKey] || 0) + Number(row.usage_count || 0);
  }
  return usageCounts;
}

const yearlyColorStatsCache = new Map();

function normalizeCalendarYear(rawYear) {
  let y = Number(rawYear) || new Date().getFullYear();
  if (y > 2400) y -= 543;
  return y;
}

function buildYearlyColorStatsPayload(usageCounts, year) {
  const normalizedYear = normalizeCalendarYear(year);
  const counts = {};
  let totalSlots = 0;

  for (const [rawKey, rawCnt] of Object.entries(usageCounts || {})) {
    const key = String(rawKey || '').trim().toLowerCase();
    const cnt = Number(rawCnt || 0);
    if (!key || cnt <= 0) continue;
    counts[key] = (counts[key] || 0) + cnt;
    totalSlots += cnt;
  }

  const percentages = {};
  if (totalSlots > 0) {
    for (const [key, cnt] of Object.entries(counts)) {
      percentages[key] = Number(((cnt / totalSlots) * 100).toFixed(1));
    }
  }

  return {
    year: normalizedYear,
    totalSlots,
    counts,
    percentages,
    updatedAt: new Date().toISOString()
  };
}

async function refreshYearlyColorStatsCache(targetYear = new Date().getFullYear()) {
  const year = normalizeCalendarYear(targetYear);
  const usageCounts = await getYearlyColorUsageCounts(year, null);
  const payload = buildYearlyColorStatsPayload(usageCounts, year);
  yearlyColorStatsCache.set(year, payload);

  try {
    await setSetting(`color_year_stats_${year}`, JSON.stringify(payload), {
      category: 'cache',
      description: `Cached yearly team color selection stats for ${year}`
    });
  } catch (err) {
    logger.warn(`[ColorStatsCache] Failed to persist color_year_stats_${year}:`, err.message);
  }

  return payload;
}

async function getYearlyColorStatsCached(targetYear = new Date().getFullYear()) {
  const year = normalizeCalendarYear(targetYear);
  if (yearlyColorStatsCache.has(year)) {
    return yearlyColorStatsCache.get(year);
  }

  try {
    const raw = await getSetting(`color_year_stats_${year}`, null);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.counts && parsed.percentages) {
        yearlyColorStatsCache.set(year, parsed);
        return parsed;
      }
    }
  } catch (err) {
    logger.warn(`[ColorStatsCache] Failed to parse cached color_year_stats_${year}:`, err.message);
  }

  return await refreshYearlyColorStatsCache(year);
}

async function addTeamColorWeek(count = 3, targetWeekId = null) {
  const weekCtx = await resolveTargetWeekForColors(targetWeekId);
  if (!weekCtx) return;

  const { week_id, max_players, targetYear, registeredCount } = weekCtx;
  const targetCount = (max_players > 24 || registeredCount > 24) ? 4 : count;

  const res = await executeQuery("SELECT * FROM team_color_week_tbl WHERE week_id = ?", [week_id]);

  if (!res || res.length < targetCount) {
    const colors = await getTeamColorPool();
    const existingColors = new Set(
      (res || []).map(r => (r.color || '').trim().toLowerCase()).filter(Boolean)
    );
    const availableColors = colors.filter(c => c && !existingColors.has(c.trim().toLowerCase()));

    const usageCounts = await getYearlyColorUsageCounts(targetYear, week_id);
    const existingCount = res ? res.length : 0;
    const numToInsert = targetCount - existingCount;
    const selectedColors = selectLeastUsedColors(availableColors, numToInsert, usageCounts);

    logger.info(
      `[addTeamColorWeek] week_id=${week_id} year=${targetYear} selected=[${selectedColors.join(', ')}] ` +
      `(yearly usage: ${availableColors.map(c => `${c}=${usageCounts[c.trim().toLowerCase()] || 0}`).join(', ')})`
    );

    for (let i = 0; i < selectedColors.length; i++) {
      await newTeamColorWeek(selectedColors[i], existingCount + i + 1, week_id);
    }

    if (selectedColors.length > 0) {
      await refreshYearlyColorStatsCache(targetYear);
    }
  } else {
    //logger.info("Team color week already exist!");
  }
}

/**
 * Re-rolls team colors for the target (or latest) week using least-used-first
 * yearly color counts, preserving existing team_color_week_tbl IDs in place so
 * assigned players and scheduled unplayed matches stay linked cleanly.
 * Blocked if any match in the week has already been played/scored.
 */
async function rerollTeamColors(targetWeekId = null) {
  const weekCtx = await resolveTargetWeekForColors(targetWeekId);
  if (!weekCtx) {
    return { success: false, message: 'ไม่พบข้อมูลสัปดาห์ในระบบ' };
  }

  const { week_id, max_players, targetYear, registeredCount, dateStr } = weekCtx;

  const matches = await executeQuery(
    "SELECT id, status, team_a_goal, team_b_goal FROM match_stat_tbl WHERE week_id = ?",
    [week_id]
  );
  if (matches && matches.some(isMatchPlayed)) {
    return { success: false, message: 'ไม่สามารถสุ่มสีใหม่ได้ เนื่องจากสัปดาห์นี้มีการเริ่มแข่งหรือบันทึกผลไปแล้ว' };
  }

  const scoredTableRows = await executeQuery(
    "SELECT 1 FROM table_week_tbl WHERE week_id = ? AND (w > 0 OR d > 0 OR l > 0 OR pts > 0 OR g > 0 OR a > 0) LIMIT 1",
    [week_id]
  );
  if (scoredTableRows && scoredTableRows.length > 0) {
    return { success: false, message: 'ไม่สามารถสุ่มสีใหม่ได้ เนื่องจากสัปดาห์นี้มีตารางคะแนนแล้ว' };
  }

  const poolColors = await getTeamColorPool();
  if (!poolColors || poolColors.length === 0) {
    return { success: false, message: 'ไม่พบข้อมูลสีทีมใน template_tpl (team_color_pools)' };
  }

  let existingRows = await executeQuery(
    "SELECT id, color FROM team_color_week_tbl WHERE week_id = ? ORDER BY id ASC",
    [week_id]
  );
  existingRows = existingRows || [];
  const oldColors = existingRows.map(r => r.color).filter(Boolean);

  let targetCount = (max_players > 24 || registeredCount > 24) ? 4 : 3;

  if (existingRows.length > targetCount) {
    const excessIds = existingRows.slice(targetCount).map(r => r.id);
    const inClause = excessIds.map(() => '?').join(',');
    const inUseMtw = await executeQuery(
      `SELECT 1 FROM member_team_week_tbl WHERE week_id = ? AND team_id IN (${inClause}) LIMIT 1`,
      [week_id, ...excessIds]
    );
    const inUseMatch = await executeQuery(
      `SELECT 1 FROM match_stat_tbl WHERE week_id = ? AND (team_a_id IN (${inClause}) OR team_b_id IN (${inClause})) LIMIT 1`,
      [week_id, ...excessIds, ...excessIds]
    );
    const inUseTable = await executeQuery(
      `SELECT 1 FROM table_week_tbl WHERE week_id = ? AND team_week_id IN (${inClause}) LIMIT 1`,
      [week_id, ...excessIds]
    );

    const hasRefs = (inUseMtw && inUseMtw.length > 0) ||
      (inUseMatch && inUseMatch.length > 0) ||
      (inUseTable && inUseTable.length > 0);

    if (hasRefs) {
      targetCount = existingRows.length;
    } else {
      await executeQuery(`DELETE FROM team_color_week_tbl WHERE id IN (${inClause})`, excessIds);
      existingRows = existingRows.slice(0, targetCount);
    }
  }

  const usageCounts = await getYearlyColorUsageCounts(targetYear, week_id);
  const selectedColors = selectLeastUsedColors(poolColors, targetCount, usageCounts);

  if (selectedColors.length === 0) {
    return { success: false, message: 'ไม่สามารถเลือกสีทีมจาก pool ได้' };
  }

  for (let i = 0; i < selectedColors.length; i++) {
    if (i < existingRows.length) {
      await executeQuery(
        "UPDATE team_color_week_tbl SET color = ? WHERE id = ?",
        [selectedColors[i], existingRows[i].id]
      );
    } else {
      await newTeamColorWeek(selectedColors[i], i + 1, week_id);
    }
  }

  const afterCounts = { ...usageCounts };
  for (const c of selectedColors) {
    const key = c.trim().toLowerCase();
    afterCounts[key] = (afterCounts[key] || 0) + 1;
  }

  await refreshYearlyColorStatsCache(targetYear);

  const poolUsageSummary = poolColors.map(c => `${c}=${afterCounts[c.trim().toLowerCase()] || 0}`);

  logger.info(
    `[rerollTeamColors] week_id=${week_id} year=${targetYear} old=[${oldColors.join(', ')}] new=[${selectedColors.join(', ')}] (${poolUsageSummary.join(', ')})`
  );

  return {
    success: true,
    weekId: week_id,
    year: targetYear,
    dateStr,
    oldColors,
    newColors: selectedColors,
    poolUsageSummary
  };
}

async function addTeamMemberWeek() {

  const week = await queryWeekID();
  let query = `select * from member_team_week_tbl where week_id=${week[0].id}`;
  let team_colors = await getTeamColorWeek(week[0].id);
  const members = await executeQuery(query);
  //logger.info(res) ;
  //return res ;
  if (members.length > 0) {
    let num = 0;
    //const test = members.filter(member => member.team_id !=0) ;
    if (members.filter(member => member.team_id != 0).length > 0) {
      logger.info("Team already created!");
      return 1;
    } else if (members.filter(member => member.team != 0).length == 0) {
      logger.info("No Team assigned!");
      return 2;
    }

    for (let i = 0; i < members.length; i++) {
      //newTeamColorWeek(colors[i], i+1, week[0].id)

      if (members[i].team > 0) {
        num = members[i].team - 1;
        logger.info(`${members[i].name} => ${team_colors[num].color}`)
        await updateMemberWeek(members[i].member_id, team_colors[num].id, 1);
      } else {
        logger.info(`${members[i].name} no team assigned`)
      }

    }
    return 0;
  }
}


async function ensureWeekTimeColumn() {
  try {
    await executeQuery("ALTER TABLE week_tbl ADD COLUMN IF NOT EXISTS time_range VARCHAR(50) NOT NULL DEFAULT '17:30-20:00'");
  } catch (err) {
    logger.error("Error ensuring time_range column in week_tbl:", err.message);
  }
}

async function updateWeekTimeRange(timeRangeStr, targetWeekId = 0) {
  await ensureWeekTimeColumn();
  let week_id = targetWeekId;
  if (week_id === 0) {
    const week = await queryWeekID(0);
    if (!week || week.length === 0) return { success: false, message: 'ไม่พบสัปดาห์ปัจจุบัน' };
    week_id = week[0].id;
  }
  const query = "UPDATE week_tbl SET time_range = ? WHERE id = ?";
  await executeQuery(query, [timeRangeStr, week_id]);

  // If match_stat_tbl has unplayed matches with an outdated start time, clear them so /schedule regenerates with updated time
  try {
    const played = await executeQuery(
      "SELECT 1 FROM match_stat_tbl WHERE week_id = ? AND (status IN ('finished', 'in_progress') OR team_a_goal IS NOT NULL) LIMIT 1",
      [week_id]
    );
    if (!played || played.length === 0) {
      const existingMatches = await executeQuery(
        "SELECT start_time FROM match_stat_tbl WHERE week_id = ? ORDER BY match_num ASC LIMIT 1",
        [week_id]
      );
      if (existingMatches && existingMatches.length > 0 && existingMatches[0].start_time) {
        const parts = timeRangeStr.split('-').map(s => s.trim().replace('.', ':'));
        if (parts.length >= 1 && parts[0] && parts[0] !== existingMatches[0].start_time) {
          await executeQuery("DELETE FROM match_stat_tbl WHERE week_id = ?", [week_id]);
          logger.info(`[updateWeekTimeRange] Cleared unplayed match_stat_tbl for week ${week_id} because start_time changed from ${existingMatches[0].start_time} to ${parts[0]}`);
        }
      }
    }
  } catch (cleanErr) {
    logger.error('[updateWeekTimeRange] Error checking/clearing unplayed match_stat_tbl:', cleanErr.message);
  }

  return { success: true, week_id, time_range: timeRangeStr };
}

async function newWeek(week_date, custom_time_range = null) {
  await ensureWeekTimeColumn();
  // Self-healing cleanup for any previous corrupted B.E. dates in week_tbl
  try {
    await executeQuery("UPDATE week_tbl SET date = date - INTERVAL '543 years' WHERE EXTRACT(YEAR FROM date) > 2400");
  } catch (e) { }

  const week = await queryWeekID();
  let y = week_date.getFullYear();
  if (y > 2400) y -= 543;
  const date_str = getShortDate(week_date);
  const last_week = getShortDate(new Date(week[0].date));
  let new_week_num = week[0].number;
  let target_week_id = null;
  const time_range = custom_time_range || '17:30-20:00';

  if (last_week != date_str) {
    new_week_num = week[0].number + 1;
    const insertQuery = "INSERT INTO week_tbl (number, date, location_id, year, max, cost, time_range) VALUES (?, ?, 2, ?, 24, 0, ?) RETURNING id";
    const res = await executeQuery(insertQuery, [new_week_num, date_str, y, time_range]);
    const new_week_id = res.insertId;
    target_week_id = new_week_id;

    // Auto-register members using autoreg_tbl, excluding those with outstanding debt
    try {
      await ensureAutoRegTable();
      const autoRegMembers = await executeQuery(`
        SELECT m.id, m.name, m.debt 
        FROM autoreg_tbl a 
        JOIN member_tbl m ON a.member_id = m.id 
        WHERE a.status = 1 
        ORDER BY a.id ASC, m.id ASC
      `);
      for (const member of autoRegMembers) {
        if (member.debt > 0) {
          logger.info(`[Auto-Reg] Skipped ${member.name} (ID: ${member.id}) due to outstanding debt of ${member.debt} baht`);
          continue;
        }
        // Check if member is already registered for this week to avoid duplicates
        const existQuery = "SELECT 1 FROM member_team_week_tbl WHERE week_id = ? AND member_id = ?";
        const existRes = await executeQuery(existQuery, [new_week_id, member.id]);
        if (existRes.length === 0) {
          const insertQuery = "insert into member_team_week_tbl (member_id, name, team_id, week_id, pay) values(?, ?, 0, ?, 0)";
          await executeQuery(insertQuery, [member.id, member.name, new_week_id]);
          logger.info(`[Auto-Reg] Registered ${member.name} (ID: ${member.id}) for week ID ${new_week_id}`);
        } else {
          logger.info(`[Auto-Reg] Member ${member.name} (ID: ${member.id}) already registered for week ID ${new_week_id}`);
        }
      }
    } catch (regErr) {
      logger.error('⚠️ Auto-registration failed:', regErr.message);
    }
  } else {
    logger.info(date_str + " already exist!");
    if (custom_time_range && week && week.length > 0) {
      await updateWeekTimeRange(custom_time_range, week[0].id);
    }
    if (week && week.length > 0) {
      target_week_id = week[0].id;
    }
  }
  await addTeamColorWeek(3, target_week_id);
}

async function updateMaxNumberWeek(max_number = 24) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    const query = "update week_tbl set max=? where id=?";
    const res = await executeQuery(query, [max_number, week_id]);

    if (max_number > 24) {
      await addTeamColorWeek(4, week_id);
    }

    // Auto-clean unplayed scheduled matches if team count configuration changed
    try {
      const played = await executeQuery(
        "SELECT 1 FROM match_stat_tbl WHERE week_id = ? AND (status IN ('finished', 'in_progress') OR team_a_goal IS NOT NULL) LIMIT 1",
        [week_id]
      );
      if (!played || played.length === 0) {
        const existingMatches = await executeQuery(
          "SELECT team_a_id, team_b_id FROM match_stat_tbl WHERE week_id = ?",
          [week_id]
        );
        if (existingMatches && existingMatches.length > 0) {
          const playingIds = new Set();
          existingMatches.forEach(m => {
            if (m.team_a_id) playingIds.add(m.team_a_id);
            if (m.team_b_id) playingIds.add(m.team_b_id);
          });
          const desiredTeams = max_number > 24 ? 4 : 3;
          if (playingIds.size !== desiredTeams) {
            await executeQuery("DELETE FROM match_stat_tbl WHERE week_id = ?", [week_id]);
            logger.info(`[updateMaxNumberWeek] Cleared unplayed match_stat_tbl for week ${week_id} because team count changed from ${playingIds.size} to ${desiredTeams}`);
          }
        }
      }
    } catch (cleanErr) {
      logger.error('[updateMaxNumberWeek] Error checking/clearing unplayed match_stat_tbl:', cleanErr.message);
    }

    return res;
  }
}

async function removeReserveMembers() {
  const week = await queryWeekID();
  if (week.length === 0) {
    return { success: false, message: 'ไม่พบสัปดาห์ปัจจุบัน' };
  }
  const week_id = week[0].id;
  const max_players = week[0].max;

  // Fetch all registered members for the week in order of registration
  const query = `
    SELECT mtw.id, mtw.member_id, mtw.team_id, mtw.name, m.team_id as member_team_id 
    FROM member_team_week_tbl mtw
    LEFT JOIN member_tbl m ON mtw.member_id = m.id
    WHERE mtw.week_id = ? 
    ORDER BY mtw.id ASC
  `;
  const registrations = await executeQuery(query, [week_id]);

  const teamColors = await getTeamColorWeek(week_id);
  const teamCount = (teamColors && teamColors.length > 0)
    ? teamColors.length
    : ((max_players > 24 || registrations.length > 24) ? 4 : 3);
  const max_goalies = Math.max(1, teamCount || 3);

  let nonGoalieCount = 0;
  let goalieCount = 0;
  const reservesToRemove = [];

  for (const reg of registrations) {
    const isGoalie = (Number(reg.member_team_id) === 100 || Number(reg.team_id) === 100);
    if (isGoalie) {
      goalieCount++;
      if (goalieCount > max_goalies) {
        reservesToRemove.push(reg);
      }
    } else {
      nonGoalieCount++;
      if (nonGoalieCount > max_players) {
        reservesToRemove.push(reg);
      }
    }
  }

  if (reservesToRemove.length === 0) {
    return { success: true, count: 0, message: 'ไม่มีรายชื่อสำรองในสัปดาห์นี้' };
  }

  // Delete all reserve registrations
  const idsToDelete = reservesToRemove.map(r => r.id);
  const deleteQuery = `DELETE FROM member_team_week_tbl WHERE id IN (${idsToDelete.join(',')})`;
  await executeQuery(deleteQuery);

  return {
    success: true,
    count: reservesToRemove.length,
    names: reservesToRemove.map(r => r.member_name)
  };
}

async function updateMemberDebt(member_id) {
  let query1 = ""

  query1 = "update member_tbl set debt=0 where id=?";
  const res1 = await executeQuery(query1, [member_id]);

  //logger.info(res) ;
  return res1;
}

async function updateMemberWeek(member_id, value, type = 0) {
  const week = await queryWeekID();
  if (week.length > 0) {
    let week_id = week[0].id;
    let query;
    let query1 = "";
    let finalPayVal = value;
    if (type == 0) {
      // Fallback: If member is not registered in active week_id, check if they have an unpaid registration in another active week
      const checkReg = await executeQuery("SELECT week_id FROM member_team_week_tbl WHERE member_id = ? AND week_id = ?", [member_id, week_id]);
      if (checkReg.length === 0) {
        const findUnpaid = await executeQuery("SELECT week_id FROM member_team_week_tbl WHERE member_id = ? AND pay = 0 ORDER BY week_id DESC LIMIT 1", [member_id]);
        if (findUnpaid.length > 0) {
          week_id = findUnpaid[0].week_id;
        }
      }

      query = "update member_team_week_tbl set pay=? where member_id=? and week_id=?";
      query1 = "update member_tbl set debt=? where id=?";
      const res1 = await executeQuery(query1, [0, member_id]);
    } else if (type == 1) {
      query = "update member_team_week_tbl set team_id=? where member_id=? and week_id=?";
    }

    const res = await executeQuery(query, [finalPayVal, member_id, week_id]);
    //logger.info(res) ;
    return res;
  }
}

/**
 * Returns true if a member is exempt from automatic pitch fee debt assignment.
 * Decoupled from `admin` so admins without `fee_exempt > 0` are billed normally.
 */
function isFeeExemptMember(member) {
  return Boolean(member && (Number(member.team_id) === 101 || Number(member.fee_exempt) > 0));
}

const UNPAID_MEMBER_FILTER = " and pay=0 and (member_tbl.fee_exempt IS NULL or member_tbl.fee_exempt <= 0) and (member_tbl.team_id IS NULL or member_tbl.team_id <> 101)";

async function setWeekCost(totalCost) {
  const week = await queryWeekID();
  if (week.length === 0) {
    return { success: false, message: 'ไม่พบข้อมูลสัปดาห์ปัจจุบัน' };
  }
  const week_id = week[0].id;
  const max_players = week[0].max || 24;

  // Query all members registered for this week in FIFO order
  const membersQuery = `
    SELECT mtw.member_id, mtw.pay, m.team_id, m.fee_exempt
    FROM member_team_week_tbl mtw
    INNER JOIN member_tbl m ON mtw.member_id = m.id
    WHERE mtw.week_id = ?
    ORDER BY mtw.id ASC
  `;
  const members = await executeQuery(membersQuery, [week_id]);
  if (members.length === 0) {
    return { success: false, message: 'ไม่มีสมาชิกที่ลงชื่อในสัปดาห์นี้' };
  }

  // Calculate team count for max goalkeepers
  const teamColors = await getTeamColorWeek(week_id);
  const teamCount = (teamColors && teamColors.length > 0)
    ? teamColors.length
    : ((max_players > 24 || members.length > 24) ? 4 : 3);
  const max_goalies = Math.max(1, teamCount || 3);

  // Separate field players and goalkeepers
  const fieldPlayers = members.filter(m => m.team_id !== 100);
  const goalies = members.filter(m => m.team_id === 100);

  // Field players capped at max_players (main field players)
  const mainFieldPlayers = fieldPlayers.slice(0, max_players);
  const count = mainFieldPlayers.length;

  if (count === 0) {
    return { success: false, message: 'ไม่มีสมาชิกที่ต้องชำระเงินในสัปดาห์นี้' };
  }

  // Goalkeepers capped at max_goalies (fixed fee 40 baht)
  const mainGoalies = goalies.slice(0, max_goalies);

  const sharedFee = Math.ceil((totalCost + 100) / count) + 35;

  await executeQuery(
    "UPDATE week_tbl SET cost = ? WHERE id = ?",
    [sharedFee, week_id]
  );

  // Update debt for main field players and main goalkeepers:
  // Non-exempt members get sharedFee (40 baht for goalies); exempt members (fee_exempt > 0 or team_id = 101) get 0
  const feeGroups = [
    { membersList: mainFieldPlayers, fee: sharedFee },
    { membersList: mainGoalies, fee: 40 }
  ];
  for (const { membersList, fee } of feeGroups) {
    for (const m of membersList) {
      const debtAmount = isFeeExemptMember(m) ? 0 : fee;
      await executeQuery(
        "UPDATE member_tbl SET debt = ? WHERE id = ?",
        [debtAmount, m.member_id]
      );
    }
  }

  // Ensure reserves have debt set to 0
  const reserveMembers = [
    ...fieldPlayers.slice(max_players),
    ...goalies.slice(max_goalies)
  ];
  for (const m of reserveMembers) {
    await executeQuery(
      "UPDATE member_tbl SET debt = 0 WHERE id = ?",
      [m.member_id]
    );
  }

  return { success: true, count, sharedFee, goalieCount: mainGoalies.length };
}

async function resetWeekDebt() {
  const week = await queryWeekID();
  if (week.length === 0) {
    return { success: false, message: 'ไม่พบข้อมูลสัปดาห์ปัจจุบัน' };
  }
  const week_id = week[0].id;

  // Query all members registered for this week
  const membersQuery = "SELECT member_id FROM member_team_week_tbl WHERE week_id = ?";
  const members = await executeQuery(membersQuery, [week_id]);
  if (members.length === 0) {
    return { success: false, message: 'ไม่มีสมาชิกที่ลงชื่อในสัปดาห์นี้' };
  }

  const memberIds = members.map(m => m.member_id);
  const placeholders = memberIds.map(() => '?').join(',');

  // Reset debt in member_tbl to 0 for these members
  await executeQuery(
    `UPDATE member_tbl SET debt = 0 WHERE id IN (${placeholders})`,
    memberIds
  );

  // Reset pay to 0 in member_team_week_tbl for this week
  await executeQuery(
    "UPDATE member_team_week_tbl SET pay = 0 WHERE week_id = ?",
    [week_id]
  );

  return { success: true, count: members.length };
}

async function setMemberDebt(member_id, amount) {
  const query = "UPDATE member_tbl SET debt = ? WHERE id = ?";
  const res = await executeQuery(query, [amount, member_id]);
  return res;
}

async function queryWeekDate(week_id = 0) {
  let query = "";
  if (week_id == 0) {
    query = "SELECT id, number, date FROM week_tbl ORDER BY id DESC LIMIT 1";
    return await executeQuery(query);
  } else {
    query = "SELECT id, number, date FROM week_tbl where id=?";
    return await executeQuery(query, [week_id]);
  }
}

async function queryWeekID(week_param = 0) {
  await ensureWeekTimeColumn();

  if (!week_param || week_param === 0 || String(week_param).trim() === '0') {
    const query = "SELECT id, number, TO_CHAR(date, 'FMDD Mon YYYY') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl ORDER BY id DESC LIMIT 1";
    return await executeQuery(query);
  }

  const strParam = String(week_param).trim();

  // 1. If numeric (e.g. 5, 12)
  if (/^\d+$/.test(strParam)) {
    const num = Number(strParam);
    const query = "SELECT id, number, TO_CHAR(date, 'FMDD Mon YYYY') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl WHERE id = ? OR number = ? ORDER BY id DESC LIMIT 1";
    const res = await executeQuery(query, [num, num]);
    if (res && res.length > 0) return res;
  }

  // 2. Format ISO YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  const isoMatch = strParam.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (isoMatch) {
    let year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (year > 2500) year -= 543;
    const query = "SELECT id, number, TO_CHAR(date, 'FMDD Mon YYYY') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl WHERE EXTRACT(DAY FROM date)::int = ? AND EXTRACT(MONTH FROM date)::int = ? AND EXTRACT(YEAR FROM date)::int = ? ORDER BY id DESC LIMIT 1";
    const res = await executeQuery(query, [day, month, year]);
    if (res && res.length > 0) return res;
  }

  // 3. Format DD/MM or DD-MM or DD.MM (e.g. 30/08, 30-8, 30.08)
  const slashMatch = strParam.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10);
    let year = slashMatch[3] ? parseInt(slashMatch[3], 10) : null;
    if (year) {
      if (year < 100) year += 2000;
      if (year > 2500) year -= 543;
    }

    let query = "SELECT id, number, TO_CHAR(date, 'FMDD Mon YYYY') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl WHERE EXTRACT(DAY FROM date)::int = ? AND EXTRACT(MONTH FROM date)::int = ?";
    const params = [day, month];
    if (year) {
      query += " AND EXTRACT(YEAR FROM date)::int = ?";
      params.push(year);
    }
    query += " ORDER BY id DESC LIMIT 1";

    const res = await executeQuery(query, params);
    if (res && res.length > 0) return res;
  }

  // 4. Format Thai Date (e.g. 30ส.ค., 30 ส.ค., 30สิงหาคม)
  const thaiMonths = {
    'ม.ค.': 1, 'มกรา': 1, 'มกราคม': 1,
    'ก.พ.': 2, 'กุมภา': 2, 'กุมภาพันธ์': 2,
    'มี.ค.': 3, 'มีนา': 3, 'มีนาคม': 3,
    'เม.ย.': 4, 'เมษา': 4, 'เมษายน': 4,
    'พ.ค.': 5, 'พฤษภา': 5, 'พฤษภาคม': 5,
    'มิ.ย.': 6, 'มิถุนา': 6, 'มิถุนายน': 6,
    'ก.ค.': 7, 'กรกฎา': 7, 'กรกฎาคม': 7,
    'ส.ค.': 8, 'สิงหา': 8, 'สิงหาคม': 8,
    'ก.ย.': 9, 'กันยา': 9, 'กันยายน': 9,
    'ต.ค.': 10, 'ตุลา': 10, 'ตุลาคม': 10,
    'พ.ย.': 11, 'พฤศจิกา': 11, 'พฤศจิกายน': 11,
    'ธ.ค.': 12, 'ธันวา': 12, 'ธันวาคม': 12
  };

  const thaiMatch = strParam.match(/^(\d{1,2})\s*([ก-ฮa-zA-Z\.]+)(?:\s*(\d{2,4}))?$/);
  if (thaiMatch) {
    const day = parseInt(thaiMatch[1], 10);
    const monthStr = thaiMatch[2].trim();
    let month = null;
    for (const [key, val] of Object.entries(thaiMonths)) {
      if (monthStr.startsWith(key) || key.startsWith(monthStr)) {
        month = val;
        break;
      }
    }
    if (month) {
      let year = thaiMatch[3] ? parseInt(thaiMatch[3], 10) : null;
      if (year) {
        if (year < 100) year += 2000;
        if (year > 2500) year -= 543;
      }

      let query = "SELECT id, number, TO_CHAR(date, 'FMDD Mon YYYY') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl WHERE EXTRACT(DAY FROM date)::int = ? AND EXTRACT(MONTH FROM date)::int = ?";
      const params = [day, month];
      if (year) {
        query += " AND EXTRACT(YEAR FROM date)::int = ?";
        params.push(year);
      }
      query += " ORDER BY id DESC LIMIT 1";

      const res = await executeQuery(query, params);
      if (res && res.length > 0) return res;
    }
  }

  // Fallback to latest week if nothing matched
  const fallbackQuery = "SELECT id, number, TO_CHAR(date, 'FMDD Mon YYYY') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl ORDER BY id DESC LIMIT 1";
  return await executeQuery(fallbackQuery);
}

async function unregisterMember(member_id) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    const query = "SELECT * from member_team_week_tbl where week_id=? and member_id=?";
    const res = await executeQuery(query, [week_id, member_id]);
    if (res.length > 0) {
      const team_id = res[0].team_id;
      const deleteQuery = "delete from member_team_week_tbl where member_id=? and week_id=?";
      await executeQuery(deleteQuery, [member_id, week_id]);
      return { success: true, team_id: team_id };
    } else {
      return { success: false, team_id: null };
    }
  }
  return { success: false, team_id: null };
}

async function IsMemberWeek(member_id) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    const query = `SELECT * from member_team_week_tbl where week_id=${week_id} and member_id=${member_id}`;
    const res = await executeQuery(query);
    //logger.info(`${res.length}`)
    if (res.length > 0) {
      //logger.info(`${week_id}`)
      return true;
    } else {
      return false;
    }
  }
}

async function ensureNYTable() {
  try {
    const createSql = `
      CREATE TABLE IF NOT EXISTS member_ny_week_tbl (
        id SERIAL PRIMARY KEY,
        datetime TIMESTAMP NOT NULL,
        member_id INTEGER NOT NULL,
        name VARCHAR(100) NULL,
        guests INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_datetime_member UNIQUE (datetime, member_id)
      )
    `;
    await executeQuery(createSql);
    await executeQuery("CREATE INDEX IF NOT EXISTS idx_datetime ON member_ny_week_tbl (datetime)");
    await executeQuery("ALTER TABLE member_ny_week_tbl ADD COLUMN IF NOT EXISTS datetime TIMESTAMP NOT NULL DEFAULT '2026-12-19 19:00:00'");
    await executeQuery("ALTER TABLE member_ny_week_tbl ADD COLUMN IF NOT EXISTS guests INTEGER NOT NULL DEFAULT 0");
  } catch (err) {
    logger.error("Error ensuring member_ny_week_tbl table:", err.message);
  }
}

async function getNYEventInfo() {
  let eventDatetime = '2026-12-19 19:00:00';
  let header = "ประกาศจัดงานเลี้ยงปีใหม่นะครับ \nวันเสาร์ที่ 19 ธันวาคม เวลา 19.00-24.00 น. หลังจากเตะบอล 17.00-19.00 น. นะครับ\nสถานที่: Waterside ห้องคาราโอกะ K5 Club Pool นะครับ \nขอเรียนเชิญทุกท่านที่มาร่วมงานพิมพ์ x1 เพื่อลงชื่อ หรือ x2 หากมีผู้ติดตามด้วยนะครับ\n\n";
  let heroUrl = null;
  let venue = 'Waterside ห้องคาราโอกะ K5 Club Pool';
  let note = 'หลังจากเตะบอล 17:00-19:00 น.';
  let title = '🎉 2026 New Year Party';
  let dateStr = 'เสาร์ที่ 19 ธ.ค. 2569';
  let timeStr = '19:00 - 24:00 น.';

  let images = [];
  let mapUrl = null;
  let mapLabel = null;
  let galleryUrl = null;
  let galleryLabel = null;
  let description = null;

  try {
    const tplRows = await executeQuery("SELECT * FROM template_tpl WHERE name IN ('ny_schedule', 'ny_party', 'new_year', 'ny_date', 'ny', 'ny_header', 'ny_party_header', 'party_header', 'ny_image', 'ny_venue', 'ny_location', 'ny_map', 'ny_title', 'ny_note', 'ny_description', 'ny_desc', 'ny_detail', 'ny_details', 'ny_gallery', 'ny_album') OR name LIKE 'ny_image%' OR name LIKE 'ny_img%' OR name LIKE 'ny_gallery%' OR name LIKE 'party_image%' OR name LIKE 'party_img%' ORDER BY id ASC");
    if (tplRows && tplRows.length > 0) {
      for (const row of tplRows) {
        let rowUrl = null;
        if (row.url && String(row.url).trim() !== '' && String(row.url).toLowerCase() !== 'null' && String(row.url).toLowerCase() !== 'none') {
          rowUrl = getFullUrl(String(row.url).trim());
        }

        // Helper to check if a URL is a web map link
        const isMapUrlOrLabel = (u, l) => {
          const str = `${u || ''} ${l || ''}`.toLowerCase();
          return str.includes('map') || str.includes('goo.gl/maps') || str.includes('maps.app') || str.includes('เส้นทาง') || str.includes('แผนที่') || str.includes('waze');
        };

        const parseFieldLink = (str) => {
          if (!str) return null;
          const trimStr = String(str).trim();
          if (!trimStr) return null;

          // BBCode: [url=URL]LABEL[/url]
          const bbMatch = /\[url=(https?:\/\/[^\]]+)\](.*?)\[\/url\]/i.exec(trimStr);
          if (bbMatch) {
            return { url: getFullUrl(bbMatch[1].trim()), label: bbMatch[2].trim() };
          }

          // BBCode: [url]URL[/url]
          const bbSimpleMatch = /\[url\](https?:\/\/[^\]]+)\[\/url\]/i.exec(trimStr);
          if (bbSimpleMatch) {
            return { url: getFullUrl(bbSimpleMatch[1].trim()), label: null };
          }

          // Markdown: [LABEL](URL)
          const mdMatch = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/i.exec(trimStr);
          if (mdMatch) {
            return { url: getFullUrl(mdMatch[2].trim()), label: mdMatch[1].trim() };
          }

          if (trimStr.startsWith('http://') || trimStr.startsWith('https://')) {
            return { url: getFullUrl(trimStr), label: null };
          }

          return { text: trimStr };
        };

        // Check value and code for links
        const parsedVal = parseFieldLink(row.value);
        const parsedCode = parseFieldLink(row.code);

        // 1. Process Map links (ny_map, ny_location)
        if (row.name === 'ny_map' || row.name === 'ny_location') {
          if (rowUrl) mapUrl = rowUrl;
          if (parsedVal && parsedVal.url) {
            mapUrl = parsedVal.url;
            if (parsedVal.label) mapLabel = parsedVal.label;
          } else if (parsedVal && parsedVal.text) {
            mapLabel = parsedVal.text;
          }
          if (parsedCode && parsedCode.url) {
            if (!mapUrl) mapUrl = parsedCode.url;
            if (parsedCode.label) mapLabel = parsedCode.label;
          } else if (parsedCode && parsedCode.text && !mapLabel) {
            mapLabel = parsedCode.text;
          }
        } else if (rowUrl) {
          // 2. Process Gallery / Image rows (ny_image, ny_gallery, ny_img%, party_image%, etc.)
          if (!heroUrl) heroUrl = rowUrl;
          images.push({
            url: rowUrl,
            title: row.value ? String(row.value).trim() : null,
            description: (row.code && !String(row.code).trim().startsWith('http')) ? String(row.code).trim() : null
          });
        } else if (row.name === 'ny_gallery' || row.name === 'ny_album') {
          // If ny_gallery has no image url, treat as external album link
          if (parsedVal && parsedVal.url) {
            galleryUrl = parsedVal.url;
            if (parsedVal.label) galleryLabel = parsedVal.label;
          }
          if (parsedCode && parsedCode.url) {
            if (!galleryUrl) galleryUrl = parsedCode.url;
            if (parsedCode.label) galleryLabel = parsedCode.label;
          }
        }

        if (row.name === 'ny_header' || row.name === 'ny_party_header' || row.name === 'party_header') {
          if (rowUrl) heroUrl = rowUrl;
        }
        if (row.name === 'ny_title' && row.value) {
          title = String(row.value).trim();
        }
        if ((row.name === 'ny_venue' || row.name === 'ny_location') && row.value) {
          venue = String(row.value).trim();
        }
        if (row.name === 'ny_note' && row.value) {
          note = String(row.value).trim();
        }
        if (row.name === 'ny_description' || row.name === 'ny_desc' || row.name === 'ny_detail' || row.name === 'ny_details') {
          description = (row.value && String(row.value).trim()) || (row.code && String(row.code).trim()) || null;
        }

        if (row.name === 'ny_schedule' || row.name === 'ny_date' || row.name === 'ny_party' || row.name === 'new_year' || row.name === 'ny') {
          if (row.value) {
            const valTrim = String(row.value).trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(valTrim) || !isNaN(new Date(valTrim).getTime())) {
              eventDatetime = valTrim.includes(' ') ? valTrim : `${valTrim} 19:00:00`;
            } else if (valTrim.includes('ประกาศ') || valTrim.includes('ปีใหม่')) {
              header = valTrim.endsWith('\n\n') ? valTrim : `${valTrim}\n\n`;
            }
          }
          if (row.code) {
            const codeTrim = String(row.code).trim();
            if (codeTrim.includes('ประกาศ') || codeTrim.includes('ปีใหม่')) {
              header = codeTrim.endsWith('\n\n') ? codeTrim : `${codeTrim}\n\n`;
            } else if (codeTrim.startsWith('http')) {
              const codeUrl = getFullUrl(codeTrim);
              if (!heroUrl) heroUrl = codeUrl;
              images.push({ url: codeUrl });
            } else if (codeTrim && !venue) {
              venue = codeTrim;
            }
          }
        }
      }
    }

    if (eventDatetime) {
      try {
        const d = new Date(eventDatetime);
        if (!isNaN(d.getTime())) {
          dateStr = await getFormatDate(d, 'short');
          const h = String(d.getHours()).padStart(2, '0');
          const m = String(d.getMinutes()).padStart(2, '0');
          timeStr = `${h}:${m} - 24:00 น.`;
        }
      } catch (e) { }
    }
  } catch (err) {
    logger.error("Error querying NY template:", err.message);
  }

  return { eventDatetime, header, heroUrl, venue, note, description, title, dateStr, timeStr, mapUrl, mapLabel, galleryUrl, galleryLabel, images };
}

async function registerNY(member_id, member_name = null, target_datetime = null, guests = 0) {
  await ensureNYTable();
  let eventDatetime = target_datetime;
  if (!eventDatetime) {
    const info = await getNYEventInfo();
    eventDatetime = info.eventDatetime;
  }

  const safeGuests = Math.max(0, parseInt(guests, 10) || 0);

  const query = `
    INSERT INTO member_ny_week_tbl (datetime, member_id, name, guests)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (datetime, member_id) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, member_ny_week_tbl.name),
      guests = EXCLUDED.guests,
      updated_at = CURRENT_TIMESTAMP
  `;
  await executeQuery(query, [eventDatetime, member_id, member_name, safeGuests]);
  return { success: true, datetime: eventDatetime, member_id, guests: safeGuests };
}

async function unregisterNY(member_id, target_datetime = null) {
  await ensureNYTable();
  let eventDatetime = target_datetime;
  if (!eventDatetime) {
    const info = await getNYEventInfo();
    eventDatetime = info.eventDatetime;
  }

  const query = "DELETE FROM member_ny_week_tbl WHERE (datetime = ? OR DATE(datetime) = DATE(?)) AND member_id = ?";
  await executeQuery(query, [eventDatetime, eventDatetime, member_id]);
  return { success: true, datetime: eventDatetime, member_id };
}

async function unregisterGuestNY(member_id, target_datetime = null) {
  await ensureNYTable();
  let eventDatetime = target_datetime;
  if (!eventDatetime) {
    const info = await getNYEventInfo();
    eventDatetime = info.eventDatetime;
  }

  const checkQuery = "SELECT id, guests FROM member_ny_week_tbl WHERE (datetime = ? OR DATE(datetime) = DATE(?)) AND member_id = ?";
  const rows = await executeQuery(checkQuery, [eventDatetime, eventDatetime, member_id]);
  if (!rows || rows.length === 0) {
    return { success: false, notRegistered: true, datetime: eventDatetime, member_id };
  }

  const query = "UPDATE member_ny_week_tbl SET guests = 0, updated_at = CURRENT_TIMESTAMP WHERE (datetime = ? OR DATE(datetime) = DATE(?)) AND member_id = ?";
  await executeQuery(query, [eventDatetime, eventDatetime, member_id]);
  return { success: true, datetime: eventDatetime, member_id, hadGuests: (rows[0].guests || 0) > 0 };
}

async function registerMember(member_id, member_name) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    const query = "SELECT * from member_team_week_tbl where week_id=? and member_id=?";
    const res = await executeQuery(query, [week_id, member_id]);
    const check = "SELECT * from member_tbl where id=?";
    const check_res = await executeQuery(check, [member_id]);
    if (check_res.length > 0) {
      const debt = check_res[0].debt;
      //logger.info(`ยอดค้าง ${debt}`);
      if (debt > 0) return debt;
    }
    //logger.info(`${res.length}`)
    if (res.length > 0) {
      return 1;
    } else {
      const query = "insert into member_team_week_tbl (member_id, name, team_id, week_id, pay) values(?, ?, 0, ?, 0)";
      //logger.info(query) ;
      const reg_res = await executeQuery(query, [member_id, member_name, week_id]);
      //logger.info(reg_res) ;
      return 0;
    }
  }
  //logger.info(res) ;
  return 0;
}

async function queryMemberbyLineID(lineId) {
  const query = "SELECT * FROM member_tbl where line_user_id=?";
  const res = await executeQuery(query, [lineId]);
  return res;
}

async function queryMemberbyName(name) {
  const query = "SELECT * FROM member_tbl WHERE LOWER(name) = LOWER(?)";
  const res = await executeQuery(query, [name]);
  return res;
}

async function queryMatchGoal(match_id, goal_status = 0, groupId = null) {
  let status;
  let icon = "";
  if (goal_status == 0) {
    status = " <= 2";
    icon = "⚽";
  } else if (goal_status == 3) {
    status = " = 3";
    icon = "👟";
  }

  query = `SELECT member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id, goal_status_tbl.status, match_goal_tbl.status as statusid, count(*) as goal 
    FROM match_goal_tbl, member_tbl, goal_status_tbl 
    WHERE match_goal_tbl.match_id=${match_id} 
      AND match_goal_tbl.member_id = member_tbl.id 
      AND match_goal_tbl.status ${status} 
      AND match_goal_tbl.status=goal_status_tbl.id 
    GROUP BY member_tbl.id, goal_status_tbl.status, match_goal_tbl.status, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id`;

  const match_goals = await executeQuery(query);
  if (match_goals.length === 0) {
    return null;
  }

  await Promise.all(match_goals.map(member => ensureMemberPicture(member, groupId)));
  const assets = await fetchDisplayAssets();
  return flex.buildScorerRowFlex(icon, match_goals, goal_status, assets, resolveMemberDisplayInfo);
}

async function getTeamColorWeek(week_id) {
  const query = `SELECT team_color_week_tbl.id, team_color_week_tbl.color, template_tpl.url, template_tpl.code FROM team_color_week_tbl LEFT JOIN template_tpl ON LOWER(team_color_week_tbl.color) = LOWER(template_tpl.value) AND template_tpl.name = 'team_color_pools' WHERE team_color_week_tbl.week_id = ${week_id}`;

  let result = await executeQuery(query);
  if ((!result || result.length === 0) && week_id) {
    logger.info(`[Auto-Fix] Missing team_color_week for week_id=${week_id}. Generating team colors automatically...`);
    await addTeamColorWeek(3, week_id);
    result = await executeQuery(query);
  }
  if (result && result.length > 0) {
    return result;
  }
  return [];
}

async function getTemplate(name, value) {
  const query = `select * from template_tpl where name='${name}' and value='${value}'`;

  const result = await executeQuery(query);
  if (result.length > 0) {
    const row = result[0];
    if (row && row.url) {
      row.url = getFullUrl(row.url);
    }
    return row;
  }
}

async function getTeamColor(color) {
  query = `SELECT * FROM template_tpl WHERE name = 'team_color_pools' AND LOWER(value) = LOWER('${color}')`;

  const result = await executeQuery(query);
  if (result && result.length > 0) {
    return result[0];
  }
}

async function queryMatchWeek(week_id) {
  query = `SELECT * FROM match_stat_tbl where week_id = ${week_id} order by match_num`;

  const result = await executeQuery(query);
  if (result.length > 0) {
    return result;
  }
}

async function queryTableWeek(week_id) {
  const safeWeekId = parseInt(week_id, 10) || 0;
  const query = `SELECT team_color_week_tbl.color, table_week_tbl.*, table_week_tbl.g AS "G", table_week_tbl.a AS "A", (table_week_tbl.g - table_week_tbl.a) AS gd
    FROM table_week_tbl, team_color_week_tbl
    WHERE table_week_tbl.week_id = ?
      AND table_week_tbl.team_week_id = team_color_week_tbl.id
    ORDER BY table_week_tbl.pts DESC, (table_week_tbl.g - table_week_tbl.a) DESC, table_week_tbl.g DESC, table_week_tbl.w DESC`;

  const result = await executeQuery(query, [safeWeekId]);
  return result || [];
}

async function getTableWeek(week_id = 0) {

  res = await queryWeekID(week_id);

  if (res.length > 0) {
    if (week_id == 0) {
      week_id = res[0].id;
    }
    const week_tables = await queryTableWeek(week_id);

    if (week_tables.length > 0) {
      const bubble = JSON.parse(JSON.stringify(flex.tpl_bubble));
      bubble.size = "mega";
      bubble.hero.url = 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg';
      //bubble.hero.url = teamColor.url ;
      bubble.hero.aspectRatio = "12:6"

      const date = new Date(res[0].date);
      const date_str = await getFormatDate(date);
      const team_colors = await getTeamColorWeek(week_id);
      return flex.buildTableWeekFlex(date_str, week_tables, team_colors);
    }
  }
}

// ───────────────────────────── MVP Rating Engine (shared) ─────────────────────────────
// Fill order used when assigning a team-fit position to players without an explicit position
// (mirrors the generic fill order of allocateFormationSlots)
const MVP_POS_FILL_ORDER = ['MF', 'DW', 'DF', 'DM', 'AM', 'CF'];
// Minimum number of positive player-week samples before the P95 benchmark is trusted (else use MAX)
const MVP_BENCHMARK_MIN_SAMPLES = 20;
const MVP_BENCHMARK_PERCENTILE = 0.95;

function mvpPosNum(pos, keys, fallback) {
  for (const k of keys) {
    if (pos && pos[k] !== undefined && pos[k] !== null && pos[k] !== '') {
      const v = parseFloat(pos[k]);
      if (!isNaN(v)) return v;
    }
  }
  return fallback;
}

/**
 * Unified per-player MVP raw score formula (single source of truth).
 * RawTotal = G·goal + A·assist + CS·cs + W·win + D·draw − GA·conceded + max(0, GF − G)·team_goal − OG·og
 * Per-match raw = RawTotal / matches
 */
function computePlayerRawScore(stats, pos) {
  const g = Number(stats.g) || 0;
  const a = Number(stats.a) || 0;
  const og = Number(stats.og) || 0;
  const cs = Number(stats.cleanSheets) || 0;
  const w = Number(stats.wins) || 0;
  const d = Number(stats.draws) || 0;
  const gf = Number(stats.goalsScored) || 0;
  const ga = Number(stats.goalsConceded) || 0;
  const matches = Number(stats.matches) > 0 ? Number(stats.matches) : 1;

  const pts = {
    goal: mvpPosNum(pos, ['pts_goal'], 4.0),
    assist: mvpPosNum(pos, ['pts_assist'], 3.0),
    cs: mvpPosNum(pos, ['pts_clean_sheet'], 0.0),
    conceded: mvpPosNum(pos, ['pts_conceded', 'pts_goal_against'], 0.0),
    teamGoal: mvpPosNum(pos, ['pts_team_goal'], 0.0),
    og: mvpPosNum(pos, ['pts_og'], 2.0),
    win: mvpPosNum(pos, ['pts_wins', 'pts_win'], 3.0),
    draw: mvpPosNum(pos, ['pts_draws', 'pts_draw'], 1.0)
  };

  const teamGoalsExcl = Math.max(0, gf - g);
  const total = (g * pts.goal) + (a * pts.assist) + (cs * pts.cs) + (w * pts.win) + (d * pts.draw)
    - (ga * pts.conceded) + (teamGoalsExcl * pts.teamGoal) - (og * pts.og);
  const raw = total / matches;

  const breakdown = `(${g}G×${pts.goal}) + (${a}A×${pts.assist}) + (${cs}CS×${pts.cs}) + (${w}W×${pts.win}) + (${d}D×${pts.draw})` +
    ` − (${ga}GA×${pts.conceded}) + (${teamGoalsExcl}TeamGF×${pts.teamGoal}) − (${og}OG×${pts.og}) = ${total.toFixed(4)}`;

  return { total, raw, matches, pts, teamGoalsExcl, breakdown };
}

/**
 * Resolve the position for each player in a week. Explicit week position → member default position →
 * team-fit position (fills the team's unmet pos_tbl minimums first, then remaining capacity, in MVP_POS_FILL_ORDER).
 * Returns { [member_id]: { pos, isTeamFit } }
 */
function resolveWeekPlayerPositions(players, posMap, allPositions) {
  const byCode = {};
  allPositions.forEach(p => { byCode[(p.code || '').toUpperCase()] = p; });
  const fallbackPos = byCode.MF || byCode.CF || allPositions[0] || { code: 'MF', pts_goal: 5, pts_assist: 3, pts_clean_sheet: 0.5, pts_team_goal: 0.5, pts_og: 2, pts_wins: 3, pts_draws: 1 };

  const result = {};
  const teams = {};
  players.forEach(m => {
    const key = m.member_id || m.id;
    let pos = null;
    if (m.week_pos_id > 0 && posMap[m.week_pos_id]) pos = posMap[m.week_pos_id];
    else if (m.member_pos_id > 0 && posMap[m.member_pos_id]) pos = posMap[m.member_pos_id];
    const tId = Number(m.team_id) || 0;
    if (!teams[tId]) teams[tId] = { counts: {}, unassigned: [], size: 0 };
    teams[tId].size++;
    if (pos) {
      const c = (pos.code || '').toUpperCase();
      teams[tId].counts[c] = (teams[tId].counts[c] || 0) + 1;
      result[key] = { pos, isTeamFit: false };
    } else {
      teams[tId].unassigned.push(key);
    }
  });

  Object.values(teams).forEach(team => {
    if (team.unassigned.length === 0) return;
    const is8 = team.size >= 8;
    const lim = (code) => {
      const p = byCode[code] || {};
      const min = is8 && p.min_8 !== null && p.min_8 !== undefined ? Number(p.min_8) : Number(p.min || 0);
      const max = is8 && p.max_8 !== null && p.max_8 !== undefined ? Number(p.max_8) : Number(p.max !== undefined ? p.max : 2);
      return { min: isNaN(min) ? 0 : min, max: isNaN(max) ? 2 : max };
    };
    team.unassigned.sort((x, y) => Number(x) - Number(y));
    team.unassigned.forEach(key => {
      let chosen = MVP_POS_FILL_ORDER.find(c => byCode[c] && (team.counts[c] || 0) < lim(c).min);
      if (!chosen) chosen = MVP_POS_FILL_ORDER.find(c => byCode[c] && (team.counts[c] || 0) < lim(c).max);
      const pos = chosen ? byCode[chosen] : fallbackPos;
      const c = (pos.code || '').toUpperCase();
      team.counts[c] = (team.counts[c] || 0) + 1;
      result[key] = { pos, isTeamFit: true };
    });
  });
  return result;
}

function percentileBenchmark(values) {
  const vals = (values || []).map(Number).filter(v => !isNaN(v) && v > 0).sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  if (vals.length < MVP_BENCHMARK_MIN_SAMPLES) return vals[vals.length - 1];
  const idx = Math.max(0, Math.ceil(MVP_BENCHMARK_PERCENTILE * vals.length) - 1);
  return vals[idx];
}

/**
 * Year benchmark (rating 10.0 reference) = P95 of all positive per-match raw scores of the year.
 * extraRaws/excludeWeekId allow including the live (unsaved) week without double counting.
 */
async function getYearMvpBenchmark(year, extraRaws = [], excludeWeekId = null) {
  let rows = [];
  try {
    rows = await executeQuery(`
      SELECT m.raw_score FROM mvp_week_tbl m
      JOIN week_tbl w ON m.week_id = w.id
      WHERE EXTRACT(YEAR FROM w.date)::int = ? AND m.raw_score > 0 ${excludeWeekId ? 'AND m.week_id <> ?' : ''}
    `, excludeWeekId ? [year, excludeWeekId] : [year]);
  } catch (e) { }
  return percentileBenchmark([...(rows || []).map(r => r.raw_score), ...extraRaws]);
}

async function saveYearMvpBenchmark(year, bench) {
  const key = `max_mvp_score_${year}`;
  const ex = await executeQuery("SELECT id FROM template_tpl WHERE name = ?", [key]);
  if (ex && ex.length > 0) {
    await executeQuery("UPDATE template_tpl SET value = ? WHERE name = ?", [bench.toFixed(4), key]);
  } else {
    await executeQuery("INSERT INTO template_tpl (name, value) VALUES (?, ?)", [key, bench.toFixed(4)]);
  }
}

/** Re-normalize stored ratings (mvp_week_tbl + member_team_week_tbl) of a year against its benchmark */
async function renormalizeYearRatings(year, bench) {
  if (!bench || bench <= 0) return;
  await executeQuery(`
    UPDATE mvp_week_tbl m
    SET rating = CASE WHEN m.raw_score > 0 THEN LEAST(10.00, ROUND(((m.raw_score / ?::numeric) * 10)::numeric, 2)) ELSE 0 END
    FROM week_tbl w
    WHERE m.week_id = w.id
      AND EXTRACT(YEAR FROM w.date)::int = ?
  `, [bench, year]);
  await executeQuery(`
    UPDATE member_team_week_tbl mtw
    SET rating = m.rating
    FROM mvp_week_tbl m
    JOIN week_tbl w ON m.week_id = w.id
    WHERE m.week_id = mtw.week_id
      AND m.member_id = mtw.member_id
      AND EXTRACT(YEAR FROM w.date)::int = ?
  `, [year]);
}

/**
 * Compute change checksum for a week based on match statuses, scores, goals, assists, and rosters.
 * Returns null on error.
 */
async function computeWeekChangeChecksum(week_id) {
  try {
    const [matchStat] = await executeQuery(`
      SELECT 
        COUNT(*) as total_matches,
        COALESCE(SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END), 0) as finished_matches,
        COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) as live_matches,
        COALESCE(SUM(team_a_goal), 0) as goals_a,
        COALESCE(SUM(team_b_goal), 0) as goals_b,
        MAX(updated_at) as last_match_update
      FROM match_stat_tbl
      WHERE week_id = ?
    `, [week_id]);

    const [goalStat] = await executeQuery(`
      SELECT 
        COUNT(*) as total_goal_events,
        COALESCE(SUM(CASE WHEN mgt.status <= 1 THEN 1 ELSE 0 END), 0) as raw_goals,
        COALESCE(SUM(CASE WHEN mgt.status = 3 THEN 1 ELSE 0 END), 0) as raw_assists,
        COALESCE(SUM(mgt.member_id * 100 + mgt.status), 0) as goal_checksum
      FROM match_goal_tbl mgt
      JOIN match_stat_tbl mst ON mgt.match_id = mst.id
      WHERE mst.week_id = ?
    `, [week_id]);

    const [rosterStat] = await executeQuery(`
      SELECT 
        COUNT(*) as roster_count,
        COALESCE(SUM(member_id * 1000 + team_id * 10 + pos_id), 0) as roster_checksum
      FROM member_team_week_tbl
      WHERE week_id = ?
    `, [week_id]);

    const lastUpdate = matchStat?.last_match_update ? new Date(matchStat.last_match_update).getTime() : 0;
    return `${matchStat?.total_matches || 0}_${matchStat?.finished_matches || 0}_${matchStat?.live_matches || 0}_${matchStat?.goals_a || 0}_${matchStat?.goals_b || 0}_${goalStat?.raw_goals || 0}_${goalStat?.raw_assists || 0}_${goalStat?.goal_checksum || 0}_${rosterStat?.roster_checksum || 0}_${lastUpdate}`;
  } catch (err) {
    logger.warn(`Error computing week change checksum for week ${week_id}:`, err.message);
    return null;
  }
}

/**
 * Load finalized leader stats, player ratings, and TOTW directly from DB (mvp_week_tbl)
 * without re-running raw math or re-updating tables.
 */
async function loadSavedWeekLeaderStats(week_id, groupId = null) {
  try {
    const assets = await fetchDisplayAssets();
    await ensurePosTables();
    const allPositions = await getAllPositions();
    const posMap = {};
    allPositions.forEach(p => {
      posMap[p.id] = p;
      if (p.code) posMap[p.code.toUpperCase()] = p;
    });
    const defaultPos = allPositions.find(p => p.code === 'CF') || allPositions[0];

    const teamColors = await getTeamColorWeek(week_id);
    const teamColorMap = {};
    (teamColors || []).forEach(t => { teamColorMap[t.id] = t.color; });

    const rows = await executeQuery(`
      SELECT 
        m.week_id,
        m.member_id,
        m.member_name,
        m.goals,
        m.own_goals,
        m.assists,
        m.clean_sheet,
        m.conceded,
        m.wins,
        m.raw_score,
        m.rating,
        m.matches,
        m.pos_code as saved_pos_code,
        mtw.team_id,
        mtw.pos_id as week_pos_id,
        mem.id,
        mem.name,
        mem.alias,
        mem.rank,
        mem.admin,
        mem.donate,
        mem.picture_url,
        mem.line_user_id,
        mem.pos_id as member_pos_id
      FROM mvp_week_tbl m
      LEFT JOIN member_team_week_tbl mtw ON m.week_id = mtw.week_id AND m.member_id = mtw.member_id
      LEFT JOIN member_tbl mem ON m.member_id = mem.id
      WHERE m.week_id = ?
      ORDER BY m.raw_score DESC, m.rating DESC, m.goals DESC, m.assists DESC, m.id ASC
    `, [week_id]);

    if (!rows || rows.length === 0) return null;

    await Promise.all(rows.map(member => ensureMemberPicture(member, groupId)));

    // Fallback team matches map if matches column is unpopulated in older rows
    const matchScoresRaw = await executeQuery("SELECT * FROM match_stat_tbl WHERE week_id = ?", [week_id]);
    const teamMatchesMap = {};
    (matchScoresRaw || []).forEach(ms => {
      if (ms.status === 'finished' || ms.team_a_goal !== null) {
        if (ms.team_a_id) teamMatchesMap[ms.team_a_id] = (teamMatchesMap[ms.team_a_id] || 0) + 1;
        if (ms.team_b_id) teamMatchesMap[ms.team_b_id] = (teamMatchesMap[ms.team_b_id] || 0) + 1;
      }
    });

    const formattedList = rows.map(r => {
      const teamId = r.team_id || 0;
      const teamName = teamColorMap[teamId] || (teamId ? `ID ${teamId}` : '');

      let pos = null;
      if (r.saved_pos_code && posMap[String(r.saved_pos_code).toUpperCase()]) {
        pos = posMap[String(r.saved_pos_code).toUpperCase()];
      } else if (r.week_pos_id && posMap[r.week_pos_id]) {
        pos = posMap[r.week_pos_id];
      } else if (r.member_pos_id && posMap[r.member_pos_id]) {
        pos = posMap[r.member_pos_id];
      } else {
        pos = defaultPos;
      }

      const goals = Number(r.goals) || 0;
      const own_goals = Number(r.own_goals) || 0;
      const assists = Number(r.assists) || 0;
      const cleanSheets = Number(r.clean_sheet) || 0;
      const goalsConceded = Number(r.conceded) || 0;
      const wins = Number(r.wins) || 0;
      const matches = (r.matches && Number(r.matches) > 0) ? Number(r.matches) : (teamMatchesMap[teamId] || 1);
      const rawScore = Number(r.raw_score) || 0;
      const score = Number(r.rating) || 0;

      const info = resolveMemberDisplayInfo(r, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);

      return {
        ...r,
        goals,
        own_goals,
        assists,
        cleanSheets,
        wins,
        goalsConceded,
        matches,
        pos,
        pos_code: (pos?.code || 'MF').toUpperCase(),
        pos_icon: pos?.icon || '',
        teamName,
        rawScore,
        score,
        info
      };
    });

    let maxGoals = 0;
    let maxAssists = 0;
    let maxRawMvpScore = 0;

    formattedList.forEach(item => {
      if (item.goals > maxGoals) maxGoals = item.goals;
      if (item.assists > maxAssists) maxAssists = item.assists;
      if (item.rawScore > maxRawMvpScore && item.rawScore > 0) maxRawMvpScore = item.rawScore;
    });

    const topScorers = maxGoals > 0 ? formattedList.filter(item => item.goals === maxGoals) : [];
    const topAssists = maxAssists > 0 ? formattedList.filter(item => item.assists === maxAssists) : [];
    const mvps = maxRawMvpScore > 0 ? formattedList.filter(item => item.rawScore === maxRawMvpScore) : [];
    const maxMvpScore = mvps.length > 0 ? mvps[0].score : 0;

    // Compute Team of the Week (TOTW)
    let totw = [];
    try {
      let is8PlayerWeek = false;
      const teamCountsRes = await executeQuery(
        "SELECT team_id, COUNT(*) as cnt FROM member_team_week_tbl WHERE week_id = ? GROUP BY team_id",
        [week_id]
      );
      if (teamCountsRes && teamCountsRes.length > 0) {
        const maxCount = Math.max(...teamCountsRes.map(rc => Number(rc.cnt) || 0));
        if (maxCount >= 8) is8PlayerWeek = true;
      }

      const posLimitsMap = {};
      const posRows = await executeQuery("SELECT code, min, max, min_8, max_8 FROM pos_tbl");
      if (posRows && posRows.length > 0) {
        posRows.forEach(pr => {
          posLimitsMap[pr.code] = {
            min: Number(pr.min) || 0,
            max: Number(pr.max) || 0,
            min_8: Number(pr.min_8) || 0,
            max_8: Number(pr.max_8) || 0
          };
        });
      }

      totw = selectTeamOfTheWeekPlayers(formattedList, is8PlayerWeek, posLimitsMap);
    } catch (eTotw) {
      logger.warn('Failed to compute TOTW in loadSavedWeekLeaderStats:', eTotw.message);
    }

    return { topScorers, topAssists, mvps, maxGoals, maxAssists, maxMvpScore, allPlayerRatings: formattedList, totw };
  } catch (err) {
    logger.error(`Error loading saved leader stats for week ${week_id}:`, err.message);
    return null;
  }
}

async function getWeekLeaderStats(week_id, groupId = null, forceRefresh = false) {
  try {
    // 0. Change detection & freshness check: Skip full recalculation if week data is unchanged
    if (!forceRefresh) {
      const checksumKey = `mvp_checksum_${week_id}`;
      const chkRes = await executeQuery("SELECT value FROM template_tpl WHERE name = ?", [checksumKey]);
      const savedChecksum = (chkRes && chkRes.length > 0) ? chkRes[0].value : null;

      if (savedChecksum) {
        const currentChecksum = await computeWeekChangeChecksum(week_id);
        if (currentChecksum && currentChecksum === savedChecksum) {
          const countRes = await executeQuery("SELECT COUNT(*) as cnt FROM mvp_week_tbl WHERE week_id = ?", [week_id]);
          if (countRes && countRes[0] && countRes[0].cnt > 0) {
            const savedStats = await loadSavedWeekLeaderStats(week_id, groupId);
            if (savedStats && savedStats.allPlayerRatings && savedStats.allPlayerRatings.length > 0) {
              logger.debug(`[WeekLeaderStats] Week ${week_id} is unchanged (Checksum matched). Served from saved DB records.`);
              return savedStats;
            }
          }
        }
      }
    }
    const goalsQuery = `
      SELECT 
        mtw.member_id, 
        m.id,
        m.name, 
        m.alias,
        m.rank,
        m.admin,
        m.donate,
        m.picture_url,
        m.line_user_id,
        m.pos_id as member_pos_id,
        mtw.team_id,
        mtw.pos_id as week_pos_id,
        COALESCE(SUM(CASE WHEN mgt.status <= 1 THEN 1 ELSE 0 END), 0) as goals,
        COALESCE(SUM(CASE WHEN mgt.status = 2 THEN 1 ELSE 0 END), 0) as own_goals,
        COALESCE(SUM(CASE WHEN mgt.status = 3 THEN 1 ELSE 0 END), 0) as assists
      FROM member_team_week_tbl mtw
      JOIN member_tbl m ON mtw.member_id = m.id
      LEFT JOIN match_stat_tbl mst ON mtw.week_id = mst.week_id
      LEFT JOIN match_goal_tbl mgt ON mgt.match_id = mst.id AND mgt.member_id = mtw.member_id
      WHERE mtw.week_id = ? AND mtw.team_id > 0
      GROUP BY mtw.member_id, m.id, m.name, m.alias, m.rank, m.admin, m.donate, m.picture_url, m.line_user_id, m.pos_id, mtw.team_id, mtw.pos_id
    `;
    const goalRes = await executeQuery(goalsQuery, [week_id]);
    if (!goalRes || goalRes.length === 0) return null;

    await Promise.all(goalRes.map(member => ensureMemberPicture(member, groupId)));
    const assets = await fetchDisplayAssets();

    const tableRows = await queryTableWeek(week_id);
    const teamMvpFactorMap = {};
    const teamInfoMap = {};

    // Calculate actual Goals Against (GA), Clean Sheets, and Wins per team from match_stat_tbl for this week
    const teamGaMap = {};
    const teamCleanSheetsMap = {};
    const teamWinsMap = {};
    const teamDrawsMap = {};
    const teamGfMap = {};
    const matchScoresRaw = await executeQuery(
      "SELECT * FROM match_stat_tbl WHERE week_id = ?",
      [week_id]
    );
    const matchScores = (matchScoresRaw || []).filter(m => {
      if (m.status !== undefined && m.status !== null) {
        return m.status === 'finished' || m.status === 'in_progress';
      }
      return m.team_a_goal !== null && m.team_a_goal !== undefined;
    });
    if (matchScores && matchScores.length > 0) {
      matchScores.forEach(m => {
        const gaA = Number(m.team_b_goal) || 0;
        const gaB = Number(m.team_a_goal) || 0;
        const gA = Number(m.team_a_goal) || 0;
        const gB = Number(m.team_b_goal) || 0;

        if (m.team_a_id) {
          teamGaMap[m.team_a_id] = (teamGaMap[m.team_a_id] || 0) + gaA;
          teamGfMap[m.team_a_id] = (teamGfMap[m.team_a_id] || 0) + gA;
          if (gaA === 0) teamCleanSheetsMap[m.team_a_id] = (teamCleanSheetsMap[m.team_a_id] || 0) + 1;
          if (gA > gB) teamWinsMap[m.team_a_id] = (teamWinsMap[m.team_a_id] || 0) + 1;
          if (gA === gB) teamDrawsMap[m.team_a_id] = (teamDrawsMap[m.team_a_id] || 0) + 1;
        }
        if (m.team_b_id) {
          teamGaMap[m.team_b_id] = (teamGaMap[m.team_b_id] || 0) + gaB;
          teamGfMap[m.team_b_id] = (teamGfMap[m.team_b_id] || 0) + gB;
          if (gaB === 0) teamCleanSheetsMap[m.team_b_id] = (teamCleanSheetsMap[m.team_b_id] || 0) + 1;
          if (gB > gA) teamWinsMap[m.team_b_id] = (teamWinsMap[m.team_b_id] || 0) + 1;
          if (gA === gB) teamDrawsMap[m.team_b_id] = (teamDrawsMap[m.team_b_id] || 0) + 1;
        }
      });
    }

    // Query distinct matches where members participated (scored or assisted, including for other teams)
    const memberGoalMatchesRes = await executeQuery(`
      SELECT DISTINCT mgt.member_id, mgt.match_id 
      FROM match_goal_tbl mgt
      JOIN match_stat_tbl mst ON mgt.match_id = mst.id
      WHERE mst.week_id = ?
    `, [week_id]);
    const memberPlayedMatchIdsMap = {};
    if (memberGoalMatchesRes && memberGoalMatchesRes.length > 0) {
      memberGoalMatchesRes.forEach(r => {
        if (!memberPlayedMatchIdsMap[r.member_id]) {
          memberPlayedMatchIdsMap[r.member_id] = new Set();
        }
        memberPlayedMatchIdsMap[r.member_id].add(r.match_id);
      });
    }

    await ensurePosTables();
    const allPositions = await getAllPositions();
    const posMap = {};
    allPositions.forEach(p => { posMap[p.id] = p; });
    const defaultPos = allPositions.find(p => p.code === 'CF') || allPositions[0] || { code: 'CF', icon: '⚡', pts_goal: 4, pts_assist: 3, pts_clean_sheet: 0, pts_conceded: 0, pts_team_goal: 0.75, pts_og: 2.0, pts_wins: 3.0, pts_draws: 1.0 };

    logger.info(`\n=== [MVP Calculation Log] Week ID: ${week_id} (${forceRefresh ? 'Forced Refresh' : 'Data Changed / First Calculation'}) ===`);
    if (tableRows && tableRows.length > 0) {
      tableRows.forEach(row => {
        const teamId = row.team_week_id;
        const w = Number(row.w !== undefined ? row.w : (row.W || 0));
        if (w > 0) teamWinsMap[teamId] = w;
        const d = Number(row.d !== undefined ? row.d : (row.D || 0));
        const l = Number(row.l !== undefined ? row.l : (row.L || 0));
        const totalMatches = w + d + l;
        const pts = Number(row.pts !== undefined ? row.pts : (row.PTS || 0));

        const avgPts = totalMatches > 0 ? (pts / totalMatches) : pts;
        const goalsScored = Number(row.G !== undefined ? row.G : (row.g || 0));
        const goalsConceded = Number(row.A !== undefined ? row.A : (row.a || 0));
        const goalsAgainst = (teamGaMap[teamId] !== undefined && teamGaMap[teamId] > 0) ? teamGaMap[teamId] : goalsConceded;
        const divisor = goalsAgainst > 0 ? goalsAgainst : 1;
        const factor = avgPts / divisor;

        teamMvpFactorMap[teamId] = factor;
        teamInfoMap[teamId] = { color: row.color, w, d, l, matches: totalMatches, pts, avgPts, goalsAgainst, divisor, factor };

        logger.info(` [Team ${row.color || teamId} (ID: ${teamId})]`);
        logger.info(`   └─ Record: Wins (W): ${w}, Draws (D): ${d}, Losses (L): ${l} => Total Matches Played: ${totalMatches}`);
        logger.info(`   └─ Points (Pts): ${pts}`);
        logger.info(`   └─ Avg Pts Calculation: Points (${pts}) / Total Matches (${totalMatches > 0 ? totalMatches : 1}) = ${avgPts.toFixed(4)}`);
        logger.info(`   └─ Goals Against (A) [from match_stat_tbl]: ${goalsAgainst}`);
        logger.info(`   └─ Team Factor Calculation: Avg Pts (${avgPts.toFixed(4)}) / Goals Against (${divisor}) = ${factor.toFixed(4)}`);
        logger.info(`   => Team Factor = ${factor.toFixed(4)}`);
      });
    }

    // Pass 1: Compute raw MVP scores via the shared formula (computePlayerRawScore) with pos_tbl weights.
    // Players without an explicit position get a team-fit position (resolveWeekPlayerPositions)
    const resolvedPositions = resolveWeekPlayerPositions(goalRes.filter(m => !isTempReserveMember(m.name)), posMap, allPositions);
    const rawScoresList = goalRes.map(m => {
      if (isTempReserveMember(m.name)) return null;

      const g = Number(m.goals) || 0;
      const og = Number(m.own_goals) || 0;
      const a = Number(m.assists) || 0;
      const teamId = Number(m.team_id) || 0;

      const cleanSheets = teamCleanSheetsMap[teamId] || 0;
      const wins = teamWinsMap[teamId] || 0;
      const draws = teamDrawsMap[teamId] || 0;
      const goalsScored = teamGfMap[teamId] || 0;

      const memKey = m.member_id || m.id;
      const resolved = resolvedPositions[memKey];
      const pos = resolved ? resolved.pos : defaultPos;
      const isTeamFitPos = resolved ? resolved.isTeamFit : true;

      const goalsConceded = teamGaMap[teamId] || 0;
      const teamDetails = teamInfoMap[teamId];

      // Calculate total matches for this member: primary team matches + any extra matches where member scored/assisted for another team
      const primaryMatchIds = matchScores
        ? matchScores.filter(ms => ms.team_a_id === teamId || ms.team_b_id === teamId).map(ms => ms.id)
        : [];
      const allPlayerMatchIds = new Set(primaryMatchIds);
      if (memberPlayedMatchIdsMap[memKey]) {
        memberPlayedMatchIdsMap[memKey].forEach(mId => allPlayerMatchIds.add(mId));
      }
      const matches = allPlayerMatchIds.size > 0
        ? allPlayerMatchIds.size
        : ((teamDetails && teamDetails.matches > 0) ? teamDetails.matches : 1);

      const calc = computePlayerRawScore({ g, a, og, cleanSheets, wins, draws, goalsScored, goalsConceded, matches }, pos);

      return {
        member: m, g, og, a, cleanSheets, wins, draws, goalsScored, goalsConceded, matches, pos, isTeamFitPos,
        ptsGoal: calc.pts.goal, ptsAssist: calc.pts.assist, ptsCleanSheet: calc.pts.cs, ptsConceded: calc.pts.conceded,
        ptsTeamGoal: calc.pts.teamGoal, ptsOg: calc.pts.og, ptsWins: calc.pts.win, ptsDraws: calc.pts.draw,
        breakdown: calc.breakdown, rawScoreTotal: calc.total, rawScore: calc.raw
      };
    }).filter(item => item !== null);

    let maxGoals = 0;
    let maxAssists = 0;
    let maxRawMvpScore = 0;

    rawScoresList.forEach(item => {
      if (item.g > maxGoals) maxGoals = item.g;
      if (item.a > maxAssists) maxAssists = item.a;
      if (item.rawScore > maxRawMvpScore && item.rawScore > 0) maxRawMvpScore = item.rawScore;
    });

    // Determine the year for current week_id
    let weekYear = new Date().getFullYear();
    try {
      const weekRes = await executeQuery("SELECT date FROM week_tbl WHERE id = ?", [week_id]);
      if (weekRes && weekRes.length > 0 && weekRes[0].date) {
        weekYear = new Date(weekRes[0].date).getFullYear();
      }
    } catch (e) { }

    // Benchmark (rating 10.0 reference) = P95 of all positive per-match raw scores of this year,
    // including this (live) week's scores and excluding its previously saved copy
    await ensureMvpWeekTable();
    let prevBenchmark = 0;
    try {
      const tplRes = await executeQuery("SELECT value FROM template_tpl WHERE name = ?", [`max_mvp_score_${weekYear}`]);
      if (tplRes && tplRes.length > 0 && tplRes[0].value) {
        prevBenchmark = parseFloat(tplRes[0].value) || 0;
      }
    } catch (e) { }
    let refMaxScore = await getYearMvpBenchmark(weekYear, rawScoresList.map(r => r.rawScore), week_id);
    if (!refMaxScore || isNaN(refMaxScore) || refMaxScore <= 0) refMaxScore = maxRawMvpScore;
    // Benchmark moved noticeably (> 0.5%) → re-normalize the stored ratings of the whole year
    const benchmarkChanged = refMaxScore > 0 && (!prevBenchmark || Math.abs(refMaxScore - prevBenchmark) / prevBenchmark > 0.005);

    // Pass 2: Normalize to 1-10 rating scale against refMaxScore
    const formattedList = rawScoresList.map(item => {
      const m = item.member;
      const g = item.g;
      const og = item.og;
      const a = item.a;
      const cleanSheets = item.cleanSheets;
      const wins = item.wins;
      const goalsConceded = item.goalsConceded;
      const matches = item.matches;
      const pos = item.pos;
      const ptsGoal = item.ptsGoal;
      const ptsAssist = item.ptsAssist;
      const ptsCleanSheet = item.ptsCleanSheet;
      const ptsConceded = item.ptsConceded;
      const ptsOg = item.ptsOg;
      const ptsWins = item.ptsWins;
      const rawScoreTotal = item.rawScoreTotal;
      const rawScore = item.rawScore;
      const normalizedScore = (refMaxScore > 0 && rawScore > 0) ? Math.min(10.0, (rawScore / refMaxScore) * 10) : 0;

      const teamDetails = teamInfoMap[m.team_id];
      const teamName = teamDetails ? teamDetails.color : `ID ${m.team_id}`;

      logger.debug(` [Player ${m.name}] (Team: ${teamName}) [Position: ${pos.code} ${pos.icon || ''}${item.isTeamFitPos ? ' (team-fit)' : ''}]`);
      logger.debug(`   └─ Position Category Points: Goal: +${ptsGoal}, Assist: +${ptsAssist}, Clean Sheet: +${ptsCleanSheet}, Match Win: +${ptsWins}, Match Draw: +${item.ptsDraws}, Team Goal Bonus: +${item.ptsTeamGoal}, Goal Conceded Deduct: -${ptsConceded}, Own Goal Deduct: -${ptsOg}`);
      logger.debug(`   └─ Player Stats: Goals (G): ${g}, Own Goals (OG): ${og}, Assists (A): ${a}, Clean Sheets (CS): ${cleanSheets}, Wins (W): ${wins}, Draws (D): ${item.draws}, Team Goals For (GF): ${item.goalsScored}, Goals Against (GA): ${goalsConceded}, Matches Played (M): ${matches}`);
      logger.debug(`   └─ Raw MVP Score (Total): ${item.breakdown}`);
      logger.debug(`   └─ Per-Match Raw MVP Score: Total Raw (${rawScoreTotal.toFixed(4)}) / Matches Played (${matches}) = ${rawScore.toFixed(4)}`);
      logger.debug(`   └─ 1-10 Rating Normalization: (${rawScore.toFixed(4)} / P95 Benchmark ${refMaxScore.toFixed(4)}) * 10 = ${normalizedScore.toFixed(1)} / 10`);
      logger.debug(`   => Final MVP Rating = ${normalizedScore.toFixed(1)} / 10`);

      const info = resolveMemberDisplayInfo(m, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
      return {
        ...m,
        goals: g,
        own_goals: og,
        assists: a,
        cleanSheets,
        wins,
        draws: item.draws,
        goalsScored: item.goalsScored,
        goalsConceded,
        matches,
        pos,
        isTeamFitPos: item.isTeamFitPos,
        teamName,
        ptsGoal,
        ptsAssist,
        ptsCleanSheet,
        ptsConceded,
        ptsTeamGoal: item.ptsTeamGoal,
        ptsOg,
        ptsWins,
        ptsDraws: item.ptsDraws,
        rawScoreTotal,
        rawScore,
        score: normalizedScore,
        info
      };
    });

    const topScorers = maxGoals > 0 ? formattedList.filter(item => item.goals === maxGoals) : [];
    const topAssists = maxAssists > 0 ? formattedList.filter(item => item.assists === maxAssists) : [];
    const mvps = maxRawMvpScore > 0 ? formattedList.filter(item => item.rawScore === maxRawMvpScore) : [];
    const maxMvpScore = mvps.length > 0 ? mvps[0].score : 0;

    // Save/update all player week records into mvp_week_tbl
    if (formattedList && formattedList.length > 0) {
      await saveWeekMvpRecords(week_id, formattedList);
    }

    // Update player ratings into member_team_week_tbl for this week
    if (formattedList && formattedList.length > 0) {
      for (const item of formattedList) {
        const memId = item.member_id || item.id;
        if (memId && item.score !== undefined) {
          try {
            await executeQuery(
              "UPDATE member_team_week_tbl SET rating = ? WHERE week_id = ? AND member_id = ?",
              [Number(item.score).toFixed(2), week_id, memId]
            );
          } catch (e) { }
        }
      }
    }

    // P95 benchmark moved → persist it & re-normalize stored ratings of the whole year, then refresh the full year cache.
    // Otherwise only refresh the yearly cache of this week's members.
    try {
      if (benchmarkChanged) {
        await saveYearMvpBenchmark(weekYear, refMaxScore);
        await renormalizeYearRatings(weekYear, refMaxScore);
        logger.info(`📊 [Benchmark] Year ${weekYear} P95 benchmark ${prevBenchmark.toFixed(4)} → ${refMaxScore.toFixed(4)} (year ratings re-normalized)`);
        await updateYearStatCache(weekYear);
      } else if (formattedList && formattedList.length > 0) {
        const weekMemberIds = formattedList.map(item => item.member_id || item.id).filter(Boolean);
        await updateYearStatCache(weekYear, weekMemberIds);
      }
    } catch (e) {
      logger.error("Error updating MVP benchmark / year cache:", e.message);
    }

    logger.info(` [MVP Winner(s)] Max Raw: ${maxRawMvpScore.toFixed(4)} | Benchmark Ref: ${refMaxScore.toFixed(4)} | Leader Rating: ${maxMvpScore.toFixed(1)}/10 | Winner(s): ${mvps.length > 0 ? mvps.map(p => p.name).join(', ') : 'None'}`);
    logger.info(`=============================================\n`);

    // Compute Team of the Week (TOTW)
    let totw = [];
    try {
      let is8PlayerWeek = false;
      const teamCountsRes = await executeQuery(
        "SELECT team_id, COUNT(*) as cnt FROM member_team_week_tbl WHERE week_id = ? GROUP BY team_id",
        [week_id]
      );
      if (teamCountsRes && teamCountsRes.length > 0) {
        const maxCount = Math.max(...teamCountsRes.map(r => Number(r.cnt) || 0));
        if (maxCount >= 8) is8PlayerWeek = true;
      }

      const posLimitsMap = {};
      const posRows = await executeQuery("SELECT code, min, max, min_8, max_8 FROM pos_tbl");
      if (posRows && posRows.length > 0) {
        posRows.forEach(r => {
          posLimitsMap[r.code] = {
            min: Number(r.min) || 0,
            max: Number(r.max) || 0,
            min_8: Number(r.min_8) || 0,
            max_8: Number(r.max_8) || 0
          };
        });
      }

      totw = selectTeamOfTheWeekPlayers(formattedList, is8PlayerWeek, posLimitsMap);
    } catch (eTotw) {
      logger.warn('Failed to compute TOTW in getWeekLeaderStats:', eTotw.message);
    }

    // Persist current checksum to template_tpl so subsequent reads can skip re-computation
    try {
      const finalChecksum = await computeWeekChangeChecksum(week_id);
      if (finalChecksum) {
        const checksumKey = `mvp_checksum_${week_id}`;
        const exChk = await executeQuery("SELECT id FROM template_tpl WHERE name = ?", [checksumKey]);
        if (exChk && exChk.length > 0) {
          await executeQuery("UPDATE template_tpl SET value = ? WHERE name = ?", [finalChecksum, checksumKey]);
        } else {
          await executeQuery("INSERT INTO template_tpl (name, value) VALUES (?, ?)", [checksumKey, finalChecksum]);
        }
      }
    } catch (eChk) {
      logger.warn(`Failed to save checksum for week ${week_id}:`, eChk.message);
    }

    return { topScorers, topAssists, mvps, maxGoals, maxAssists, maxMvpScore, allPlayerRatings: formattedList, totw };
  } catch (err) {
    logger.error("Error calculating week leader stats:", err.message);
    return null;
  }
}

async function ensurePosTables() {
  try {
    const createPosSql = `
      CREATE TABLE IF NOT EXISTS pos_tbl (
        id SERIAL PRIMARY KEY,
        code VARCHAR(10) NOT NULL UNIQUE,
        name VARCHAR(50) NOT NULL,
        icon VARCHAR(10) DEFAULT '',
        pts_goal DECIMAL(6,2) DEFAULT 0.00,
        pts_assist DECIMAL(6,2) DEFAULT 0.00,
        pts_clean_sheet DECIMAL(6,2) DEFAULT 0.00,
        pts_conceded DECIMAL(6,2) DEFAULT 0.00
      )
    `;
    await executeQuery(createPosSql);

    const createMemberPosSql = `
      CREATE TABLE IF NOT EXISTS member_pos_tbl (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL,
        pos_id INTEGER NOT NULL,
        is_primary SMALLINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_member_pos UNIQUE (member_id, pos_id)
      )
    `;
    await executeQuery(createMemberPosSql);

    // Seed default positions with category points if empty
    const countRes = await executeQuery("SELECT COUNT(*) as count FROM pos_tbl");
    if (countRes && countRes[0] && Number(countRes[0].count) === 0) {
      await executeQuery(`
        INSERT INTO pos_tbl (code, name, icon, pts_goal, pts_assist, pts_clean_sheet, pts_conceded) VALUES
        ('GK', 'Goalkeeper', '🧤', 10.00, 6.00, 5.00, 1.00),
        ('DF', 'Defender', '🛡️', 6.00, 4.00, 4.00, 0.50),
        ('DW', 'Defensive Wing', '🏃', 5.00, 3.50, 2.00, 0.25),
        ('MF', 'Midfielder', '⚙️', 5.00, 3.00, 1.00, 0.00),
        ('CF', 'Center Forward', '⚡', 4.00, 3.00, 0.00, 0.00)
      `);
      logger.info("🌱 [Seed DB] Default positions (GK, DF, DW, MF, CF) with category points inserted into pos_tbl!");
    } else {
      // Set default points if unpopulated
      await executeQuery("UPDATE pos_tbl SET pts_goal = 10.00, pts_assist = 6.00, pts_clean_sheet = 5.00, pts_conceded = 1.00 WHERE UPPER(code) = 'GK' AND pts_goal = 0");
      await executeQuery("UPDATE pos_tbl SET pts_goal = 6.00, pts_assist = 4.00, pts_clean_sheet = 4.00, pts_conceded = 0.50 WHERE UPPER(code) = 'DF' AND pts_goal = 0");
      await executeQuery("UPDATE pos_tbl SET pts_goal = 5.00, pts_assist = 3.00, pts_clean_sheet = 1.00, pts_conceded = 0.00 WHERE UPPER(code) = 'MF' AND pts_goal = 0");
      await executeQuery("UPDATE pos_tbl SET pts_goal = 4.00, pts_assist = 3.00, pts_clean_sheet = 0.00, pts_conceded = 0.00 WHERE UPPER(code) = 'CF' AND pts_goal = 0");

      // Ensure DW is inserted if table already existed without it
      const dwCheck = await executeQuery("SELECT id FROM pos_tbl WHERE UPPER(code) = 'DW'");
      if (!dwCheck || dwCheck.length === 0) {
        await executeQuery("INSERT INTO pos_tbl (code, name, icon, pts_goal, pts_assist, pts_clean_sheet, pts_conceded) VALUES ('DW', 'Defensive Wing', '🏃', 5.00, 3.50, 2.00, 0.25)");
      }
    }

    // Ensure min, max, min_8, max_8 and MVP rating weight columns exist in pos_tbl
    try {
      await executeQuery(`
        ALTER TABLE pos_tbl
          ADD COLUMN IF NOT EXISTS min INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS max INTEGER DEFAULT 2,
          ADD COLUMN IF NOT EXISTS min_8 INTEGER DEFAULT NULL,
          ADD COLUMN IF NOT EXISTS max_8 INTEGER DEFAULT NULL,
          ADD COLUMN IF NOT EXISTS pts_og DECIMAL(6,2) DEFAULT 2.00,
          ADD COLUMN IF NOT EXISTS pts_wins DECIMAL(6,2) DEFAULT 3.00,
          ADD COLUMN IF NOT EXISTS pts_draws DECIMAL(6,2) DEFAULT 1.00,
          ADD COLUMN IF NOT EXISTS pts_team_goal DECIMAL(6,2) DEFAULT 0.00
      `);
    } catch (colErr) {
      logger.error("Error ensuring pos_tbl columns:", colErr.message);
    }

    // One-time migration to MVP rating weights v2 (flag stored in template_tpl so later admin edits are never overwritten)
    // conceded = deduction per team goal conceded, team_goal = bonus per team goal scored (excluding the player's own goals)
    try {
      const flag = await executeQuery("SELECT id FROM template_tpl WHERE name = 'pos_weights_v2'");
      if (!flag || flag.length === 0) {
        const weightsV2 = [
          // code, goal, assist, clean_sheet, conceded, team_goal, og, wins, draws
          ['GK', 10, 6, 5, 0.50, 0.00, 2, 3, 1],
          ['DF', 6, 3, 3, 0.50, 0.00, 2, 3, 1],
          ['DM', 6, 3, 2, 0.25, 0.25, 2, 3, 1],
          ['DW', 5, 3, 2, 0.25, 0.25, 2, 3, 1],
          ['MF', 5, 3, 0.5, 0.00, 0.50, 2, 3, 1],
          ['AM', 4, 3, 0, 0.00, 0.50, 2, 3, 1],
          ['CF', 5, 3, 0, 0.00, 0.75, 2, 3, 1]
        ];
        for (const [code, goal, assist, cs, conc, tg, og, wins, draws] of weightsV2) {
          await executeQuery(
            `UPDATE pos_tbl SET pts_goal = ?, pts_assist = ?, pts_clean_sheet = ?, pts_conceded = ?, pts_team_goal = ?, pts_og = ?, pts_wins = ?, pts_draws = ?
             WHERE UPPER(code) = ?`,
            [goal, assist, cs, conc, tg, og, wins, draws, code]
          );
        }
        await executeQuery("INSERT INTO template_tpl (name, value) VALUES ('pos_weights_v2', ?)", [new Date().toISOString()]);
        logger.info("🌱 [Migration] pos_tbl MVP rating weights updated to v2 (team goal bonus, draws, hybrid DM/DW)");
      }
    } catch (migErr) {
      logger.error("Error migrating pos_tbl weights v2:", migErr.message);
    }
  } catch (err) {
    logger.error("Error creating position tables:", err.message);
  }
}

async function setMemberWeekPosition(member_id, week_id, pos_code) {
  await ensurePosTables();
  try {
    let posId = 0;
    if (pos_code) {
      const posRes = await executeQuery("SELECT id FROM pos_tbl WHERE UPPER(code) = UPPER(?)", [pos_code]);
      if (posRes && posRes.length > 0) posId = posRes[0].id;
    }

    await executeQuery(
      "UPDATE member_team_week_tbl SET pos_id = ? WHERE member_id = ? AND week_id = ?",
      [posId, member_id, week_id]
    );

    return { success: true, member_id, week_id, pos_code: pos_code ? pos_code.toUpperCase() : 'DEFAULT', pos_id: posId };
  } catch (err) {
    logger.error("Error setting member week position:", err.message);
    return { success: false, error: err.message };
  }
}

async function getEffectiveMemberPosition(member_id, week_id = 0) {
  await ensurePosTables();
  try {
    // 1. Check week-specific position if week_id is provided
    if (week_id > 0) {
      const mtwRes = await executeQuery(
        "SELECT pos_id FROM member_team_week_tbl WHERE member_id = ? AND week_id = ?",
        [member_id, week_id]
      );
      if (mtwRes && mtwRes.length > 0 && mtwRes[0].pos_id > 0) {
        const posRes = await executeQuery(
          "SELECT id, code, name, icon, pts_goal, pts_assist, pts_clean_sheet, pts_conceded, pts_og FROM pos_tbl WHERE id = ?",
          [mtwRes[0].pos_id]
        );
        if (posRes && posRes.length > 0) {
          return { ...posRes[0], is_custom_week: true };
        }
      }
    }

    // 2. Check default position in member_tbl.pos_id
    const mRes = await executeQuery("SELECT pos_id FROM member_tbl WHERE id = ?", [member_id]);
    if (mRes && mRes.length > 0 && mRes[0].pos_id > 0) {
      const posRes = await executeQuery(
        "SELECT id, code, name, icon, pts_goal, pts_assist, pts_clean_sheet, pts_conceded, pts_og FROM pos_tbl WHERE id = ?",
        [mRes[0].pos_id]
      );
      if (posRes && posRes.length > 0) {
        return { ...posRes[0], is_custom_week: false };
      }
    }

    // 3. Fallback to member_pos_tbl primary position
    const defRes = await executeQuery(`
      SELECT p.id, p.code, p.name, p.icon, p.pts_goal, p.pts_assist, p.pts_clean_sheet, p.pts_conceded, p.pts_og 
      FROM member_pos_tbl mp
      JOIN pos_tbl p ON mp.pos_id = p.id
      WHERE mp.member_id = ? AND mp.is_primary = 1
      LIMIT 1
    `, [member_id]);
    if (defRes && defRes.length > 0) {
      return { ...defRes[0], is_custom_week: false };
    }

    // 4. Fallback to default position (first position in pos_tbl)
    const fallbackRes = await executeQuery("SELECT id, code, name, icon, pts_goal, pts_assist, pts_clean_sheet, pts_conceded, pts_og FROM pos_tbl ORDER BY id ASC LIMIT 1");
    return fallbackRes && fallbackRes.length > 0 ? { ...fallbackRes[0], is_custom_week: false } : null;
  } catch (err) {
    logger.error("Error getting effective position:", err.message);
    return null;
  }
}

async function updatePositionPoints(pos_code, pts_goal = 0, pts_assist = 0, pts_clean_sheet = 0, pts_conceded = 0, pts_og = 0, pts_wins = null, pts_draws = null, pts_team_goal = null) {
  await ensurePosTables();
  try {
    let sql = `
      UPDATE pos_tbl 
      SET pts_goal = ?, pts_assist = ?, pts_clean_sheet = ?, pts_conceded = ?, pts_og = ?
    `;
    const params = [pts_goal, pts_assist, pts_clean_sheet, pts_conceded, pts_og];
    if (pts_wins !== null && pts_wins !== undefined) {
      sql += ", pts_wins = ?";
      params.push(pts_wins);
    }
    if (pts_draws !== null && pts_draws !== undefined) {
      sql += ", pts_draws = ?";
      params.push(pts_draws);
    }
    if (pts_team_goal !== null && pts_team_goal !== undefined) {
      sql += ", pts_team_goal = ?";
      params.push(pts_team_goal);
    }
    sql += " WHERE UPPER(code) = UPPER(?)";
    params.push(pos_code);
    await executeQuery(sql, params);
    return { success: true, pos_code: pos_code.toUpperCase(), pts_goal, pts_assist, pts_clean_sheet, pts_conceded, pts_og, pts_wins, pts_draws, pts_team_goal };
  } catch (err) {
    logger.error("Error updating position points:", err.message);
    return { success: false, error: err.message };
  }
}

async function getAllPositions() {
  await ensurePosTables();
  try {
    return await executeQuery("SELECT * FROM pos_tbl ORDER BY id ASC");
  } catch (err) {
    logger.error("Error fetching positions:", err.message);
    return [];
  }
}

async function getMemberPositions(member_id) {
  await ensurePosTables();
  try {
    const sql = `
      SELECT p.id, p.code, p.name, p.icon, mp.is_primary
      FROM member_pos_tbl mp
      JOIN pos_tbl p ON mp.pos_id = p.id
      WHERE mp.member_id = ?
      ORDER BY mp.is_primary DESC, p.id ASC
    `;
    return await executeQuery(sql, [member_id]);
  } catch (err) {
    logger.error("Error fetching member positions:", err.message);
    return [];
  }
}

async function setMemberPosition(member_id, pos_code, is_primary = 1) {
  await ensurePosTables();
  try {
    const posRes = await executeQuery("SELECT id FROM pos_tbl WHERE UPPER(code) = UPPER(?)", [pos_code]);
    if (!posRes || posRes.length === 0) return { success: false, message: `Unknown position code: ${pos_code}` };
    const posId = posRes[0].id;

    if (is_primary) {
      await executeQuery("UPDATE member_pos_tbl SET is_primary = 0 WHERE member_id = ?", [member_id]);
    }

    await executeQuery(`
      INSERT INTO member_pos_tbl (member_id, pos_id, is_primary)
      VALUES (?, ?, ?)
      ON CONFLICT (member_id, pos_id) DO UPDATE SET
        is_primary = EXCLUDED.is_primary,
        updated_at = CURRENT_TIMESTAMP
    `, [member_id, posId, is_primary ? 1 : 0]);

    return { success: true, member_id, pos_code: pos_code.toUpperCase(), pos_id: posId };
  } catch (err) {
    logger.error("Error setting member position:", err.message);
    return { success: false, error: err.message };
  }
}

function isTempReserveMember(name) {
  if (!name) return true;
  const n = String(name).trim().toLowerCase();
  return n.startsWith('@team') || n.startsWith('+team') || /^@?\+?team\d+/i.test(n);
}

async function ensureMvpWeekTable() {
  try {
    const createSql = `
      CREATE TABLE IF NOT EXISTS mvp_week_tbl (
        id SERIAL PRIMARY KEY,
        week_id INTEGER NOT NULL,
        member_id INTEGER DEFAULT 0,
        member_name VARCHAR(255) DEFAULT '',
        goals INTEGER DEFAULT 0,
        own_goals INTEGER DEFAULT 0,
        assists INTEGER DEFAULT 0,
        clean_sheet INTEGER DEFAULT 0,
        conceded INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        matches INTEGER DEFAULT 0,
        pos_code VARCHAR(10) DEFAULT '',
        raw_score DECIMAL(10,4) DEFAULT 0.0000,
        rating DECIMAL(4,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_mvp_week_member UNIQUE (week_id, member_id)
      )
    `;
    await executeQuery(createSql);

    try {
      await executeQuery(`
        ALTER TABLE mvp_week_tbl
          ADD COLUMN IF NOT EXISTS matches INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS pos_code VARCHAR(10) DEFAULT ''
      `);
    } catch (eCol) { }

    // Cleanup temporary reserve slot records (@team1+1, @team1+7, +team1+2, etc.)
    try {
      await executeQuery("DELETE FROM mvp_week_tbl WHERE member_name LIKE '@team%' OR member_name LIKE 'team%' OR member_name LIKE '+team%'");
    } catch (e) { }
  } catch (err) {
    logger.error("Error creating mvp_week_tbl table:", err.message);
  }
}

async function saveWeekMvpRecords(week_id, mvpList) {
  await ensureMvpWeekTable();
  if (!mvpList || mvpList.length === 0) return;

  for (const item of mvpList) {
    const memId = item.id || item.member_id || 0;
    const name = item.name || '';
    const g = Number(item.goals) || 0;
    const og = Number(item.own_goals !== undefined ? item.own_goals : (item.og || 0));
    const a = Number(item.assists) || 0;
    const cs = Number(item.cleanSheets !== undefined ? item.cleanSheets : (item.clean_sheet || 0)) || 0;
    const ga = Number(item.goalsConceded !== undefined ? item.goalsConceded : (item.conceded !== undefined ? item.conceded : (item.ga || 0))) || 0;
    const w = Number(item.wins || 0);
    const m = Number(item.matches || 0);
    const posCode = (item.pos?.code || item.pos_code || '').toUpperCase();
    const raw = parseFloat(Number(item.rawScore !== undefined ? item.rawScore : (item.score || 0)).toFixed(4));
    const rat = parseFloat(Number(item.score || 0).toFixed(2));

    await executeQuery(`
      INSERT INTO mvp_week_tbl (week_id, member_id, member_name, goals, own_goals, assists, clean_sheet, conceded, wins, matches, pos_code, raw_score, rating)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (week_id, member_id) DO UPDATE SET
        member_name = EXCLUDED.member_name,
        goals = EXCLUDED.goals,
        own_goals = EXCLUDED.own_goals,
        assists = EXCLUDED.assists,
        clean_sheet = EXCLUDED.clean_sheet,
        conceded = EXCLUDED.conceded,
        wins = EXCLUDED.wins,
        matches = EXCLUDED.matches,
        pos_code = EXCLUDED.pos_code,
        raw_score = EXCLUDED.raw_score,
        rating = EXCLUDED.rating,
        updated_at = CURRENT_TIMESTAMP
    `, [week_id, memId, name, g, og, a, cs, ga, w, m, posCode, raw, rat]);
  }
}

async function ensureMemberYearStatTable() {
  try {
    const createSql = `
      CREATE TABLE IF NOT EXISTS member_year_stat_tbl (
        member_id INTEGER NOT NULL,
        year INTEGER NOT NULL,
        total_rating DECIMAL(8,2) DEFAULT 0.00,
        avg_rating DECIMAL(4,2) DEFAULT 0.00,
        max_rating DECIMAL(4,2) DEFAULT 0.00,
        total_goals INTEGER DEFAULT 0,
        total_assists INTEGER DEFAULT 0,
        weeks_played INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (member_id, year)
      )
    `;
    await executeQuery(createSql);
    await executeQuery("ALTER TABLE member_year_stat_tbl ADD COLUMN IF NOT EXISTS total_rating DECIMAL(8,2) DEFAULT 0.00");
  } catch (err) {
    logger.error("Error creating member_year_stat_tbl table:", err.message);
  }
}

async function updateYearStatCache(year = null, memberIds = null) {
  try {
    await ensureMemberYearStatTable();

    // Determine list of years to sync
    let yearsToSync = [];
    if (year) {
      yearsToSync = [Number(year)];
    } else {
      const distinctYearsRes = await executeQuery(`
        SELECT DISTINCT COALESCE(CASE WHEN TRIM(w.year::text) ~ '^[0-9]+$' THEN TRIM(w.year::text)::int ELSE NULL END, EXTRACT(YEAR FROM w.date)::int) as yr 
        FROM week_tbl w 
        WHERE w.date IS NOT NULL OR (TRIM(COALESCE(w.year::text, '')) ~ '^[0-9]+$' AND TRIM(w.year::text)::int > 0)
        ORDER BY yr ASC
      `);
      yearsToSync = (distinctYearsRes || []).map(r => Number(r.yr)).filter(y => y > 0);
      if (yearsToSync.length === 0) {
        yearsToSync = [new Date().getFullYear()];
      }
    }

    // Build optional member filter clause for incremental updates
    let memFilterMtw = "";
    let memFilterMgt = "";
    let memFilterMvp = "";
    const cleanMemberIds = Array.isArray(memberIds) && memberIds.length > 0
      ? memberIds.map(Number).filter(id => id > 0)
      : null;

    if (cleanMemberIds && cleanMemberIds.length > 0) {
      const idList = cleanMemberIds.join(',');
      memFilterMtw = ` AND mtw.member_id IN (${idList})`;
      memFilterMgt = ` AND mgt.member_id IN (${idList})`;
      memFilterMvp = ` AND m.member_id IN (${idList})`;
    }

    // Query member ranks and names from member_tbl (quote reserved keyword "rank")
    const memberRows = await executeQuery('SELECT id, "rank", name FROM member_tbl');
    const memberRankMap = {};
    const memberNameMap = {};
    if (memberRows) {
      memberRows.forEach(r => {
        memberRankMap[r.id] = parseFloat(r.rank || 0) || 0;
        memberNameMap[r.id] = r.name || `ID ${r.id}`;
      });
    }

    // Sync ratings from mvp_week_tbl into member_team_week_tbl for consistency
    try {
      const memSyncClause = cleanMemberIds && cleanMemberIds.length > 0
        ? ` AND m.member_id IN (${cleanMemberIds.join(',')})`
        : '';
      await executeQuery(`
        UPDATE member_team_week_tbl mtw
        SET rating = m.rating
        FROM mvp_week_tbl m
        WHERE mtw.week_id = m.week_id
          AND mtw.member_id = m.member_id
          AND m.rating > 0${memSyncClause}
      `);
      logger.info(`[Cache] Synchronized ratings from mvp_week_tbl into member_team_week_tbl (Incremental: ${cleanMemberIds ? cleanMemberIds.length + ' members' : 'all'})`);
    } catch (e) { }

    logger.info(`[Cache] Starting member_year_stat_tbl sync for years: [${yearsToSync.join(', ')}] (Incremental: ${cleanMemberIds ? cleanMemberIds.length + ' members' : 'all'})`);

    for (const targetYear of yearsToSync) {
      logger.info(`\n======================================================`);
      logger.info(`📊 [Cache Sync] Updating member_year_stat_tbl for Year: ${targetYear} ${cleanMemberIds ? `(Incremental ${cleanMemberIds.length} members)` : ''}`);
      logger.info(`======================================================`);

      // 1. Query actual weeks played & ratings from member_team_week_tbl (ground truth for participation)
      const weeksRes = await executeQuery(`
        SELECT 
          mtw.member_id,
          COUNT(DISTINCT mtw.week_id) as weeks_played,
          COALESCE(SUM(CASE WHEN mtw.rating > 0 THEN mtw.rating ELSE 0 END), 0) as mtw_total_rating,
          MAX(CASE WHEN mtw.rating > 0 THEN mtw.rating ELSE 0 END) as mtw_max_rating
        FROM member_team_week_tbl mtw
        JOIN week_tbl w ON mtw.week_id = w.id
        WHERE (w.year::text = ?::text OR EXTRACT(YEAR FROM w.date)::int = ?) AND mtw.member_id > 0 AND mtw.team_id > 0${memFilterMtw}
        GROUP BY mtw.member_id
      `, [targetYear, targetYear]);

      // 2. Query total goals and assists from match_goal_tbl
      const goalsRes = await executeQuery(`
        SELECT 
          mgt.member_id,
          COALESCE(SUM(CASE WHEN mgt.status <= 1 THEN 1 ELSE 0 END), 0) as total_goals,
          COALESCE(SUM(CASE WHEN mgt.status = 3 THEN 1 ELSE 0 END), 0) as total_assists
        FROM match_goal_tbl mgt
        JOIN match_stat_tbl mst ON mgt.match_id = mst.id
        JOIN week_tbl w ON mst.week_id = w.id
        WHERE (w.year::text = ?::text OR EXTRACT(YEAR FROM w.date)::int = ?) AND mgt.member_id > 0${memFilterMgt}
        GROUP BY mgt.member_id
      `, [targetYear, targetYear]);

      // 3. Query MVP accumulated ratings from mvp_week_tbl
      const mvpRes = await executeQuery(`
        SELECT 
          m.member_id,
          COALESCE(SUM(CASE WHEN m.rating > 0 THEN m.rating ELSE 0 END), 0) as mvp_total_rating,
          MAX(CASE WHEN m.rating > 0 THEN m.rating ELSE 0 END) as mvp_max_rating,
          COUNT(DISTINCT CASE WHEN m.rating > 0 THEN m.week_id ELSE NULL END) as rated_weeks
        FROM mvp_week_tbl m
        JOIN week_tbl w ON m.week_id = w.id
        WHERE (w.year::text = ?::text OR EXTRACT(YEAR FROM w.date)::int = ?) AND m.member_id > 0${memFilterMvp}
        GROUP BY m.member_id
      `, [targetYear, targetYear]);

      const goalsMap = {};
      if (goalsRes) {
        goalsRes.forEach(r => {
          goalsMap[r.member_id] = {
            goals: Number(r.total_goals) || 0,
            assists: Number(r.total_assists) || 0
          };
        });
      }

      const mvpMap = {};
      if (mvpRes) {
        mvpRes.forEach(r => {
          mvpMap[r.member_id] = {
            totalRating: parseFloat(r.mvp_total_rating || 0),
            maxRating: parseFloat(r.mvp_max_rating || 0),
            ratedWeeks: Number(r.rated_weeks || 0)
          };
        });
      }

      // Merge into member_year_stat_tbl
      if (weeksRes && weeksRes.length > 0) {
        for (const row of weeksRes) {
          const mId = row.member_id;
          const mName = memberNameMap[mId] || `Member #${mId}`;
          const weeksPlayed = Number(row.weeks_played) || 0;
          const gStat = goalsMap[mId] || { goals: 0, assists: 0 };
          const mStat = mvpMap[mId] || { totalRating: 0, maxRating: 0, ratedWeeks: 0 };
          const mtwTotal = parseFloat(row.mtw_total_rating || 0);
          const mtwMax = parseFloat(row.mtw_max_rating || 0);
          const mRank = memberRankMap[mId] || 0;

          // Accumulated MVP rating: sum from mvp_week_tbl or mtw_total or (mRank * weeksPlayed)
          let totalRating = mStat.totalRating > 0
            ? mStat.totalRating
            : (mtwTotal > 0 ? mtwTotal : (mRank > 0 ? (mRank * weeksPlayed) : 0));

          let maxRating = mStat.maxRating > 0
            ? mStat.maxRating
            : (mtwMax > 0 ? mtwMax : mRank);

          let avgRating = weeksPlayed > 0 ? (totalRating / weeksPlayed) : 0.0;

          await executeQuery(`
            INSERT INTO member_year_stat_tbl (member_id, year, total_rating, avg_rating, max_rating, total_goals, total_assists, weeks_played)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (member_id, year) DO UPDATE SET
              total_rating = EXCLUDED.total_rating,
              avg_rating = EXCLUDED.avg_rating,
              max_rating = EXCLUDED.max_rating,
              total_goals = EXCLUDED.total_goals,
              total_assists = EXCLUDED.total_assists,
              weeks_played = EXCLUDED.weeks_played,
              updated_at = CURRENT_TIMESTAMP
          `, [
            mId,
            targetYear,
            totalRating.toFixed(2),
            avgRating.toFixed(2),
            maxRating.toFixed(2),
            gStat.goals,
            gStat.assists,
            weeksPlayed
          ]);

          logger.info(`  👤 [${mName}] (ID: ${mId}) -> Weeks: ${weeksPlayed}, Accu Rating: ${totalRating.toFixed(2)}, Avg: ${avgRating.toFixed(2)}, Max: ${maxRating.toFixed(2)}, Goals: ${gStat.goals}, Assists: ${gStat.assists}`);
        }
        logger.info(`✅ [Year ${targetYear}] Synced ${weeksRes.length} players into member_year_stat_tbl`);
      } else {
        logger.info(`ℹ️ [Year ${targetYear}] No player records found in member_team_week_tbl`);
      }
    }
    logger.info(`\n======================================================`);
    logger.info(`🎉 [Cache Sync] Complete sync finished for all target years`);
    logger.info(`======================================================\n`);
  } catch (err) {
    logger.error("Error updating member_year_stat_tbl cache:", err.message);
  }
}

async function calculateWeekRawMvp(week_id, verbose = false) {
  const goalsQuery = `
    SELECT 
      mtw.member_id, 
      m.name, 
      m.pos_id as member_pos_id,
      mtw.team_id,
      mtw.pos_id as week_pos_id,
      COALESCE(SUM(CASE WHEN mgt.status <= 1 THEN 1 ELSE 0 END), 0) as goals,
      COALESCE(SUM(CASE WHEN mgt.status = 2 THEN 1 ELSE 0 END), 0) as own_goals,
      COALESCE(SUM(CASE WHEN mgt.status = 3 THEN 1 ELSE 0 END), 0) as assists
    FROM member_team_week_tbl mtw
    JOIN member_tbl m ON mtw.member_id = m.id
    LEFT JOIN match_stat_tbl mst ON mtw.week_id = mst.week_id
    LEFT JOIN match_goal_tbl mgt ON mgt.match_id = mst.id AND mgt.member_id = mtw.member_id
    WHERE mtw.week_id = ? AND mtw.team_id > 0
    GROUP BY mtw.member_id, m.name, m.pos_id, mtw.team_id, mtw.pos_id
  `;
  const goalRes = await executeQuery(goalsQuery, [week_id]);
  if (!goalRes || goalRes.length === 0) return [];

  const tableRows = await queryTableWeek(week_id);
  if (!tableRows || tableRows.length === 0) return [];

  const teamGaMap = {};
  const teamCleanSheetsMap = {};
  const teamWinsMap = {};
  const teamDrawsMap = {};
  const teamGfMap = {};
  const matchScoresRaw = await executeQuery(
    "SELECT * FROM match_stat_tbl WHERE week_id = ?",
    [week_id]
  );
  const matchScores = (matchScoresRaw || []).filter(m => {
    if (m.status !== undefined && m.status !== null) {
      return m.status === 'finished' || m.status === 'in_progress';
    }
    return m.team_a_goal !== null && m.team_a_goal !== undefined;
  });
  if (matchScores && matchScores.length > 0) {
    matchScores.forEach(m => {
      const gaA = Number(m.team_b_goal) || 0;
      const gaB = Number(m.team_a_goal) || 0;
      const gA = Number(m.team_a_goal) || 0;
      const gB = Number(m.team_b_goal) || 0;

      if (m.team_a_id) {
        teamGaMap[m.team_a_id] = (teamGaMap[m.team_a_id] || 0) + gaA;
        teamGfMap[m.team_a_id] = (teamGfMap[m.team_a_id] || 0) + gA;
        if (gaA === 0) teamCleanSheetsMap[m.team_a_id] = (teamCleanSheetsMap[m.team_a_id] || 0) + 1;
        if (gA > gB) teamWinsMap[m.team_a_id] = (teamWinsMap[m.team_a_id] || 0) + 1;
        if (gA === gB) teamDrawsMap[m.team_a_id] = (teamDrawsMap[m.team_a_id] || 0) + 1;
      }
      if (m.team_b_id) {
        teamGaMap[m.team_b_id] = (teamGaMap[m.team_b_id] || 0) + gaB;
        teamGfMap[m.team_b_id] = (teamGfMap[m.team_b_id] || 0) + gB;
        if (gaB === 0) teamCleanSheetsMap[m.team_b_id] = (teamCleanSheetsMap[m.team_b_id] || 0) + 1;
        if (gB > gA) teamWinsMap[m.team_b_id] = (teamWinsMap[m.team_b_id] || 0) + 1;
        if (gA === gB) teamDrawsMap[m.team_b_id] = (teamDrawsMap[m.team_b_id] || 0) + 1;
      }
    });
  }

  // Query distinct matches where members participated (scored or assisted, including for other teams)
  const memberGoalMatchesRes = await executeQuery(`
    SELECT DISTINCT mgt.member_id, mgt.match_id 
    FROM match_goal_tbl mgt
    JOIN match_stat_tbl mst ON mgt.match_id = mst.id
    WHERE mst.week_id = ?
  `, [week_id]);
  const memberPlayedMatchIdsMap = {};
  if (memberGoalMatchesRes && memberGoalMatchesRes.length > 0) {
    memberGoalMatchesRes.forEach(r => {
      if (!memberPlayedMatchIdsMap[r.member_id]) {
        memberPlayedMatchIdsMap[r.member_id] = new Set();
      }
      memberPlayedMatchIdsMap[r.member_id].add(r.match_id);
    });
  }

  await ensurePosTables();
  const allPositions = await getAllPositions();
  const posMap = {};
  allPositions.forEach(p => { posMap[p.id] = p; });
  const defaultPos = allPositions.find(p => p.code === 'CF') || allPositions[0] || { code: 'CF', icon: '⚡', pts_goal: 4, pts_assist: 3, pts_clean_sheet: 0, pts_conceded: 0, pts_team_goal: 0.75, pts_og: 2.0, pts_wins: 3.0, pts_draws: 1.0 };

  const teamMvpFactorMap = {};
  const teamDetailsMap = {};
  tableRows.forEach(row => {
    const teamId = row.team_week_id;
    const w = Number(row.w !== undefined ? row.w : (row.W || 0));
    if (w > 0) teamWinsMap[teamId] = w;
    const d = Number(row.d !== undefined ? row.d : (row.D || 0));
    const l = Number(row.l !== undefined ? row.l : (row.L || 0));
    const totalMatches = w + d + l;
    const pts = Number(row.pts !== undefined ? row.pts : (row.PTS || 0));

    const avgPts = totalMatches > 0 ? (pts / totalMatches) : pts;
    const goalsConceded = Number(row.A !== undefined ? row.A : (row.a || 0));
    const goalsAgainst = (teamGaMap[teamId] !== undefined && teamGaMap[teamId] > 0) ? teamGaMap[teamId] : goalsConceded;
    const divisor = goalsAgainst > 0 ? goalsAgainst : 1;
    const factor = avgPts / divisor;

    teamMvpFactorMap[teamId] = factor;
    teamDetailsMap[teamId] = {
      teamName: row.color || `ID ${teamId}`,
      w,
      d,
      l,
      matches: totalMatches,
      pts,
      avgPts,
      goalsAgainst,
      factor
    };
  });

  // Players without an explicit position get a team-fit position (same rule as getWeekLeaderStats)
  const resolvedPositions = resolveWeekPlayerPositions(goalRes.filter(m => !isTempReserveMember(m.name)), posMap, allPositions);

  return goalRes.map(m => {
    if (isTempReserveMember(m.name)) return null;

    const g = Number(m.goals) || 0;
    const og = Number(m.own_goals) || 0;
    const a = Number(m.assists) || 0;
    const teamId = Number(m.team_id) || 0;

    const cleanSheets = teamCleanSheetsMap[teamId] || 0;
    const wins = teamWinsMap[teamId] || 0;
    const draws = teamDrawsMap[teamId] || 0;
    const goalsScored = teamGfMap[teamId] || 0;

    const memKey = m.member_id || m.id;
    const resolved = resolvedPositions[memKey];
    const pos = resolved ? resolved.pos : defaultPos;
    const isTeamFitPos = resolved ? resolved.isTeamFit : true;

    const goalsConceded = teamGaMap[teamId] || 0;
    const td = teamDetailsMap[teamId] || { teamName: '?', w: 0, d: 0, l: 0, matches: 1, pts: 0, avgPts: 0, goalsAgainst: 0, factor: 1 };

    // Calculate total matches for this member: primary team matches + any extra matches where member scored/assisted for another team
    const primaryMatchIds = matchScores
      ? matchScores.filter(ms => ms.team_a_id === teamId || ms.team_b_id === teamId).map(ms => ms.id)
      : [];
    const allPlayerMatchIds = new Set(primaryMatchIds);
    if (memberPlayedMatchIdsMap[memKey]) {
      memberPlayedMatchIdsMap[memKey].forEach(mId => allPlayerMatchIds.add(mId));
    }
    const matches = allPlayerMatchIds.size > 0
      ? allPlayerMatchIds.size
      : ((td && td.matches > 0) ? td.matches : 1);

    // Shared formula (single source of truth)
    const calc = computePlayerRawScore({ g, a, og, cleanSheets, wins, draws, goalsScored, goalsConceded, matches }, pos);
    const rawScoreTotal = calc.total;
    const rawScore = calc.raw;

    if (verbose) {
      logger.info(` [Player ${m.name}] (Team: ${td.teamName}) [Position: ${pos.code} ${pos.icon || ''}${isTeamFitPos ? ' (team-fit)' : ''}]`);
      logger.info(`   └─ Raw MVP Score (Total): ${calc.breakdown}`);
      logger.info(`   └─ Per-Match Raw MVP Score: Total Raw (${rawScoreTotal.toFixed(4)}) / Matches (${matches}) = ${rawScore.toFixed(4)}`);
    }

    return {
      week_id,
      member_id: m.member_id,
      name: m.name,
      goals: g,
      own_goals: og,
      assists: a,
      cleanSheets,
      wins,
      draws,
      goalsScored,
      goalsConceded,
      matches,
      teamName: td.teamName,
      posCode: pos.code,
      posIcon: pos.icon || '',
      isTeamFitPos,
      ptsGoal: calc.pts.goal,
      ptsAssist: calc.pts.assist,
      ptsCleanSheet: calc.pts.cs,
      ptsConceded: calc.pts.conceded,
      ptsTeamGoal: calc.pts.teamGoal,
      ptsOg: calc.pts.og,
      ptsWins: calc.pts.win,
      ptsDraws: calc.pts.draw,
      breakdown: calc.breakdown,
      rawScoreTotal,
      rawScore,
    };
  }).filter(p => p !== null && p.member_id > 0);
}

async function calcAndSaveMaxMvpScore(options = {}) {
  try {
    await ensureMvpWeekTable();

    // Handle options object or legacy number limit
    let year = null;
    let reset = false;

    if (typeof options === 'object' && options !== null) {
      year = options.year || null;
      reset = !!options.reset;
    } else if (typeof options === 'number') {
      year = null;
      reset = false;
    }

    if (reset) {
      if (year) {
        await executeQuery(
          "DELETE FROM mvp_week_tbl m USING week_tbl w WHERE m.week_id = w.id AND EXTRACT(YEAR FROM w.date)::int = ?",
          [year]
        );
        logger.info(`[MVP Sync] Force reset mvp_week_tbl records for year ${year}`);
      } else {
        await executeQuery("TRUNCATE TABLE mvp_week_tbl");
        logger.info(`[MVP Sync] Force reset all mvp_week_tbl records`);
      }
    }

    let weekSql = "SELECT id, date FROM week_tbl";
    let weekParams = [];
    if (year) {
      weekSql += " WHERE EXTRACT(YEAR FROM date)::int = ?";
      weekParams.push(year);
    }
    weekSql += " ORDER BY date DESC";

    const weeks = await executeQuery(weekSql, weekParams);
    if (!weeks || weeks.length === 0) {
      return { maxRawScore: 0, topPerformances: [], weeksChecked: 0, newInserted: 0, skipped: 0, year };
    }

    // Query list of week_ids already fully synced in mvp_week_tbl (more than 1 player)
    const weekCountRes = await executeQuery("SELECT week_id, COUNT(*) as cnt FROM mvp_week_tbl GROUP BY week_id");
    const fullySyncedWeekIds = new Set((weekCountRes || []).filter(r => r.cnt >= 4).map(r => r.week_id));

    logger.info(`\n======================================================`);
    logger.info(`🚀 [MVP Sync Started] Total Weeks: ${weeks.length} | Year Filter: ${year || 'ALL'} | Reset Mode: ${reset}`);
    logger.info(`======================================================`);

    let skippedCount = 0;
    let newInsertedCount = 0;
    let currIdx = 0;
    const weekScoresCache = {};
    const affectedYears = new Set();
    if (year) affectedYears.add(Number(year));

    for (const w of weeks) {
      currIdx++;
      const dateStr = await getFormatDate(new Date(w.date), 'short');
      const wDate = w.date ? new Date(w.date) : new Date();
      const wYear = wDate.getFullYear();

      if (!reset && fullySyncedWeekIds.has(w.id)) {
        skippedCount++;
        logger.info(` ⏩ [${currIdx}/${weeks.length}] Week ID ${w.id} (${dateStr}) -> Already fully synced in mvp_week_tbl (Skipped)`);
        continue;
      }

      affectedYears.add(wYear);
      logger.info(` ⚙️ [${currIdx}/${weeks.length}] Processing Week ID ${w.id} (${dateStr})...`);
      const playerScores = await calculateWeekRawMvp(w.id);
      weekScoresCache[w.id] = playerScores;
      if (playerScores && playerScores.length > 0) {
        playerScores.sort((a, b) => b.rawScore - a.rawScore);
        const maxRawForWeek = playerScores[0].rawScore;
        await saveWeekMvpRecords(w.id, playerScores);
        newInsertedCount++;
        logger.info(`    ✅ Synced ${playerScores.length} player(s) for Week ID ${w.id} (Top Per-Match Raw Score: ${maxRawForWeek.toFixed(4)})`);
      } else {
        logger.info(`    ⚠️ No valid team members (team_id > 0) scored in Week ID ${w.id}`);
      }
    }

    // Compute P95 percentile benchmark for each year from mvp_week_tbl (ratings scale: 10.0 at P95)
    let yearlyScoresSql = `
      SELECT EXTRACT(YEAR FROM w.date)::int as yr, m.raw_score
      FROM mvp_week_tbl m
      JOIN week_tbl w ON m.week_id = w.id
      WHERE m.raw_score > 0
    `;
    let yearlyScoresParams = [];
    if (year) {
      yearlyScoresSql += " AND EXTRACT(YEAR FROM w.date)::int = ?";
      yearlyScoresParams.push(year);
    }
    yearlyScoresSql += " ORDER BY yr ASC, m.raw_score ASC";

    const allYearRawsRes = await executeQuery(yearlyScoresSql, yearlyScoresParams);
    const yearlyScoresMap = {};
    if (allYearRawsRes && allYearRawsRes.length > 0) {
      for (const r of allYearRawsRes) {
        if (!yearlyScoresMap[r.yr]) yearlyScoresMap[r.yr] = [];
        yearlyScoresMap[r.yr].push(parseFloat(r.raw_score));
      }
    }

    const yearlyBenchMap = {};
    for (const [yr, scores] of Object.entries(yearlyScoresMap)) {
      const bench = percentileBenchmark(scores);
      yearlyBenchMap[yr] = bench;
      await saveYearMvpBenchmark(yr, bench);
      await renormalizeYearRatings(yr, bench);
      logger.info(`📌 [P95 Benchmark] Year ${yr}: ${bench.toFixed(4)} (N=${scores.length} samples, ratings re-normalized)`);
    }

    // Determine overall reference benchmark
    const currentCalYear = year || new Date().getFullYear();
    const maxRawScore = yearlyBenchMap[currentCalYear] || (Object.values(yearlyBenchMap)[0] || 0);
    if (maxRawScore > 0) {
      const existing = await executeQuery("SELECT id FROM template_tpl WHERE name = 'max_mvp_score'");
      if (existing && existing.length > 0) {
        await executeQuery("UPDATE template_tpl SET value = ? WHERE name = 'max_mvp_score'", [maxRawScore.toFixed(4)]);
      } else {
        await executeQuery("INSERT INTO template_tpl (name, value) VALUES ('max_mvp_score', ?)", [maxRawScore.toFixed(4)]);
      }
    }

    // Update member_year_stat_tbl cache incrementally (only affected years)
    if (year) {
      await updateYearStatCache(year);
    } else if (affectedYears.size > 0) {
      for (const aYr of affectedYears) {
        await updateYearStatCache(aYr);
      }
    } else {
      await updateYearStatCache();
    }

    // ── Sync best MVP winner(s) of each year into hof_tbl (Hall of Fame) ──
    try {
      const yearlyBestMvpRes = await executeQuery(`
        SELECT EXTRACT(YEAR FROM w.date)::int as yr, m.member_id, m.raw_score
        FROM mvp_week_tbl m
        JOIN week_tbl w ON m.week_id = w.id
        WHERE m.raw_score > 0
        ORDER BY m.raw_score DESC
      `);

      const yearlyBestMvpMap = {};
      if (yearlyBestMvpRes && yearlyBestMvpRes.length > 0) {
        for (const r of yearlyBestMvpRes) {
          const yr = r.yr;
          if (!yearlyBestMvpMap[yr]) {
            yearlyBestMvpMap[yr] = { maxScore: parseFloat(r.raw_score), memberIds: [] };
          }
          if (parseFloat(r.raw_score) === yearlyBestMvpMap[yr].maxScore) {
            if (!yearlyBestMvpMap[yr].memberIds.includes(r.member_id)) {
              yearlyBestMvpMap[yr].memberIds.push(r.member_id);
            }
          }
        }

        for (const [yr, data] of Object.entries(yearlyBestMvpMap)) {
          if (year && Number(yr) !== Number(year)) continue;
          await syncHofRecords('best_mvp', Number(yr), data.memberIds);
          logger.info(`🏆 [HOF Sync] Updated best_mvp in hof_tbl for year ${yr}: Member IDs [${data.memberIds.join(', ')}] (Score: ${data.maxScore.toFixed(4)})`);
        }
      }
    } catch (hofErr) {
      logger.error('⚠️ [HOF Sync] Error syncing best_mvp to hof_tbl:', hofErr.message);
    }

    let topSql = `
      SELECT m.*, w.date 
      FROM mvp_week_tbl m
      LEFT JOIN week_tbl w ON m.week_id = w.id
    `;
    let topParams = [];
    if (year) {
      topSql += " WHERE EXTRACT(YEAR FROM w.date)::int = ?";
      topParams.push(year);
    }
    topSql += " ORDER BY m.raw_score DESC LIMIT 5";

    const topDbPerformances = await executeQuery(topSql, topParams);

    let topPerformances = [];
    if (topDbPerformances && topDbPerformances.length > 0) {
      for (const p of topDbPerformances) {
        const pDate = p.date ? new Date(p.date) : null;
        const pYear = pDate ? pDate.getFullYear() : (year || new Date().getFullYear());
        const dateStr = pDate ? await getFormatDate(pDate, 'short') : '';
        const yrBenchmark = yearlyBenchMap[pYear] || maxRawScore;
        const normalizedRating = yrBenchmark > 0 ? Math.min(10.0, (parseFloat(p.raw_score) / yrBenchmark) * 10) : parseFloat(p.rating || 0);

        topPerformances.push({
          week_id: p.week_id,
          member_id: p.member_id,
          name: p.member_name,
          goals: p.goals,
          assists: p.assists,
          cleanSheets: Number(p.clean_sheet) || 0,
          conceded: Number(p.conceded) || 0,
          rawScore: parseFloat(p.raw_score),
          score: normalizedRating,
          yrBenchmark,
          dateStr
        });
      }
    }

    logger.info(`\n======================================================`);
    logger.info(`🏆 ALL-TIME TOP 5 RAW MVP SCORES (CHECKED ${weeks.length} WEEKS - NEW: ${newInsertedCount}, SKIPPED: ${skippedCount}, YEAR: ${year || 'ALL'})`);
    logger.info(`======================================================`);
    for (let i = 0; i < topPerformances.length; i++) {
      const p = topPerformances[i];
      const rating = p.score > 0 ? p.score.toFixed(1) : '0.0';
      const refBench = p.yrBenchmark || maxRawScore;

      // Retrieve full player score details for this week
      let detail = null;
      try {
        const weekScores = await calculateWeekRawMvp(p.week_id);
        if (weekScores && weekScores.length > 0) {
          detail = weekScores.find(item => item.member_id === p.member_id || item.name === p.name);
        }
      } catch (e) { }

      if (detail) {
        logger.info(`#${i + 1} [Player ${detail.name}] (${p.dateStr}) [Week ID: ${p.week_id}] (Team: ${detail.teamName}) [Position: ${detail.posCode} ${detail.posIcon}]`);
        logger.info(`   └─ Position Category Points: Goal: +${detail.ptsGoal}, Assist: +${detail.ptsAssist}, Clean Sheet: +${detail.ptsCleanSheet}, Match Win: +${detail.ptsWins}, Match Draw: +${detail.ptsDraws}, Team Goal Bonus: +${detail.ptsTeamGoal}, Goal Conceded Deduct: -${detail.ptsConceded}, Own Goal Deduct: -${detail.ptsOg}`);
        logger.info(`   └─ Player Stats: Goals (G): ${detail.goals}, Own Goals (OG): ${detail.own_goals}, Assists (A): ${detail.assists}, Clean Sheets (CS): ${detail.cleanSheets}, Match Wins (W): ${detail.wins}, Draws (D): ${detail.draws}, Goals For (GF): ${detail.goalsScored}, Goals Against (GA): ${detail.goalsConceded}, Matches Played (M): ${detail.matches}`);
        logger.info(`   └─ Raw MVP Score (Total): ${detail.breakdown || (detail.rawScoreTotal ? detail.rawScoreTotal.toFixed(4) : '')}`);
        logger.info(`   └─ Per-Match Raw MVP Score: ${(detail.rawScoreTotal || (detail.rawScore * detail.matches)).toFixed(4)} / ${detail.matches} = ${detail.rawScore.toFixed(4)}`);
        logger.info(`   └─ 1-10 Rating Normalization: (${detail.rawScore.toFixed(4)} / Year P95 Benchmark ${refBench.toFixed(4)}) * 10 = ${rating} / 10`);
        logger.info(`   => Final MVP Rating = ${rating} / 10\n`);
      } else {
        logger.info(`#${i + 1} ${p.name} (${p.dateStr}) [Week ID: ${p.week_id}]`);
        logger.info(`   └─ Player Stats: Goals (G): ${p.goals}, Assists (A): ${p.assists}, CleanSheets (CS): ${p.cleanSheets}, Conceded (GA): ${p.conceded}`);
        logger.info(`   └─ Per-Match Raw MVP Score: ${p.rawScore.toFixed(4)}`);
        logger.info(`   => Normalized 1-10 Rating = ${rating} / 10\n`);
      }
    }
    logger.info(`📌 Benchmark P95 Raw Score Saved to DB (10.00 Ref): ${maxRawScore.toFixed(4)}`);
    logger.info(`======================================================\n`);

    return { maxRawScore, topPerformances, weeksChecked: weeks.length, newInserted: newInsertedCount, skipped: skippedCount, year };
  } catch (err) {
    logger.error("Error calculating max MVP score across weeks:", err.message);
    return { maxRawScore: 0, topPerformances: [], weeksChecked: 0, newInserted: 0, skipped: 0, year: null, error: err.message };
  }
}

/**
 * Select the best players of the week for Team of the Week (TOTW)
 * based on position limits from pos_tbl (min_8/max_8 for 8-player teams, min/max for 7-player teams)
 * and player performance points (MVP scores).
 */
function selectTeamOfTheWeekPlayers(allPlayers, is8PlayerWeek, posLimitsMap) {
  if (!allPlayers || allPlayers.length === 0) return [];

  const defaultLimits = {
    DF: { min: 1, max: 2, min_8: 1, max_8: 3 },
    DW: { min: 2, max: 2, min_8: 2, max_8: 2 },
    DM: { min: 0, max: 1, min_8: 0, max_8: 1 },
    MF: { min: 1, max: 2, min_8: 1, max_8: 3 },
    AM: { min: 0, max: 1, min_8: 0, max_8: 2 },
    CF: { min: 0, max: 1, min_8: 0, max_8: 2 },
    GK: { min: 0, max: 1, min_8: 0, max_8: 1 }
  };

  const getLimit = (pos) => {
    const lim = posLimitsMap[pos] || {};
    const def = defaultLimits[pos] || { min: 0, max: 2, min_8: 0, max_8: 2 };
    if (is8PlayerWeek) {
      return {
        min: lim.min_8 !== undefined && !isNaN(lim.min_8) ? Number(lim.min_8) : (lim.min !== undefined && !isNaN(lim.min) ? Number(lim.min) : (def.min_8 !== undefined ? def.min_8 : def.min)),
        max: lim.max_8 !== undefined && !isNaN(lim.max_8) ? Number(lim.max_8) : (lim.max !== undefined && !isNaN(lim.max) ? Number(lim.max) : (def.max_8 !== undefined ? def.max_8 : def.max))
      };
    }
    return {
      min: lim.min !== undefined && !isNaN(lim.min) ? Number(lim.min) : def.min,
      max: lim.max !== undefined && !isNaN(lim.max) ? Number(lim.max) : def.max
    };
  };

  // Sort all players by score / rawScore descending
  const sortedPlayers = [...allPlayers].sort((a, b) => {
    const scoreDiff = (Number(b.score) || 0) - (Number(a.score) || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (Number(b.rawScore) || 0) - (Number(a.rawScore) || 0);
  });

  // Group by posCode
  const byPos = {};
  for (const p of sortedPlayers) {
    const code = (p.pos?.code || p.pos_code || 'MF').toUpperCase();
    if (!byPos[code]) byPos[code] = [];
    byPos[code].push(p);
  }

  const selectedMembers = [];
  const selectedIds = new Set();
  const selectedPosCounts = {};

  const addPlayer = (p) => {
    selectedMembers.push(p);
    selectedIds.add(p.member_id || p.id);
    const code = (p.pos?.code || p.pos_code || 'MF').toUpperCase();
    selectedPosCounts[code] = (selectedPosCounts[code] || 0) + 1;
  };

  const targetSize = is8PlayerWeek ? 7 : 6;

  // 1. Mandatory positions (min) in priority order: GK, DW, DF, MF, DM, AM, CF
  const mandatoryPositions = ['GK', 'DW', 'DF', 'MF', 'DM', 'AM', 'CF'];
  for (const pos of mandatoryPositions) {
    const lim = getLimit(pos);
    const neededMin = lim.min;
    const candidates = byPos[pos] || [];
    for (const p of candidates) {
      if ((selectedPosCounts[pos] || 0) >= neededMin) break;
      if (!selectedIds.has(p.member_id || p.id)) {
        addPlayer(p);
      }
    }
  }

  // 2. Fill remaining positions up to targetSize by highest rating without exceeding position max
  for (const p of sortedPlayers) {
    if (selectedMembers.length >= targetSize) break;
    const pId = p.member_id || p.id;
    if (selectedIds.has(pId)) continue;

    const code = (p.pos?.code || p.pos_code || 'MF').toUpperCase();
    const lim = getLimit(code);
    if ((selectedPosCounts[code] || 0) < lim.max) {
      addPlayer(p);
    }
  }

  // 3. Fallback: if slots still remain (due to strict limits), fill with remaining highest rated players
  for (const p of sortedPlayers) {
    if (selectedMembers.length >= targetSize) break;
    const pId = p.member_id || p.id;
    if (!selectedIds.has(pId)) {
      addPlayer(p);
    }
  }

  return selectedMembers;
}

async function getTotwFormationData(week_id, groupId = null, precomputedLeaders = null) {
  const leaders = precomputedLeaders || await getWeekLeaderStats(week_id, groupId);
  if (!(leaders && leaders.allPlayerRatings && leaders.allPlayerRatings.length > 0)) {
    return null;
  }

  let is8PlayerWeek = false;
  const teamCountsRes = await executeQuery(
    "SELECT team_id, COUNT(*) as cnt FROM member_team_week_tbl WHERE week_id = ? GROUP BY team_id",
    [week_id]
  );
  if (teamCountsRes && teamCountsRes.length > 0) {
    const maxCount = Math.max(...teamCountsRes.map(r => Number(r.cnt) || 0));
    if (maxCount >= 8) is8PlayerWeek = true;
  }

  const posLimitsMap = {};
  try {
    const posRows = await executeQuery("SELECT code, min, max, min_8, max_8 FROM pos_tbl");
    if (posRows && posRows.length > 0) {
      posRows.forEach(r => {
        const code = (r.code || '').toUpperCase();
        posLimitsMap[code] = {
          min: r.min !== null && r.min !== undefined ? Number(r.min) : undefined,
          max: r.max !== null && r.max !== undefined ? Number(r.max) : undefined,
          min_8: r.min_8 !== null && r.min_8 !== undefined ? Number(r.min_8) : undefined,
          max_8: r.max_8 !== null && r.max_8 !== undefined ? Number(r.max_8) : undefined
        };
      });
    }
  } catch (ePos) { }

  const totwRawMembers = selectTeamOfTheWeekPlayers(leaders.allPlayerRatings, is8PlayerWeek, posLimitsMap);
  if (!totwRawMembers || totwRawMembers.length === 0) {
    return null;
  }

  const formattedTotwMembers = totwRawMembers.map(m => {
    const wRating = m.score ? parseFloat(m.score).toFixed(1) : '-';
    return {
      id: m.member_id || m.id,
      member_id: m.member_id || m.id,
      name: m.name,
      alias: m.alias,
      rank: m.rank,
      picture_url: m.picture_url,
      line_user_id: m.line_user_id,
      pos_code: (m.pos?.code || m.pos_code || 'MF').toUpperCase(),
      pos_name: m.pos?.name || m.pos_name || '',
      pos_icon: m.pos?.icon || m.pos_icon || '',
      weekStats: { rating: wRating, goals: m.goals || 0, assists: m.assists || 0 },
      yearStats: { rating: wRating, goals: m.goals || 0, assists: m.assists || 0 }
    };
  });

  const allocation = allocateFormationSlots(formattedTotwMembers, is8PlayerWeek, posLimitsMap);
  return [{
    teamId: 'totw',
    teamColor: '🌟 Team of the Week 🌟',
    colorCode: '#EAB308',
    url: null,
    formationName: allocation.formationName,
    slots: allocation.slots,
    totalPlayers: allocation.totalPlayers,
    members: formattedTotwMembers
  }];
}

async function recalculateMatchScore(matchId) {
  const safeMatchId = parseInt(matchId, 10);
  if (!safeMatchId) return;
  const rows = await executeQuery(
    `SELECT ms.team_a_id, ms.team_b_id,
            COALESCE(SUM(CASE WHEN mg.team_week_id = ms.team_a_id AND mg.status <> 3 THEN 1 ELSE 0 END), 0) AS team_a_goal,
            COALESCE(SUM(CASE WHEN mg.team_week_id = ms.team_b_id AND mg.status <> 3 THEN 1 ELSE 0 END), 0) AS team_b_goal
     FROM match_stat_tbl ms
     LEFT JOIN match_goal_tbl mg ON mg.match_id = ms.id
     WHERE ms.id = ?
     GROUP BY ms.id, ms.team_a_id, ms.team_b_id`,
    [safeMatchId]
  );
  if (rows && rows.length > 0) {
    const gA = Number(rows[0].team_a_goal || 0);
    const gB = Number(rows[0].team_b_goal || 0);
    await executeQuery(
      "UPDATE match_stat_tbl SET team_a_goal = ?, team_b_goal = ? WHERE id = ?",
      [gA, gB, safeMatchId]
    );
  }
}

async function recalculateTableWeek(weekId) {
  const safeWeekId = parseInt(weekId, 10);
  if (!safeWeekId) return { success: false };

  const teamRows = await executeQuery("SELECT id FROM team_color_week_tbl WHERE week_id = ?", [safeWeekId]);
  const stats = {};
  for (const t of teamRows || []) {
    stats[t.id] = { w: 0, d: 0, l: 0, g: 0, a: 0, pts: 0 };
  }

  const allMatches = await executeQuery("SELECT * FROM match_stat_tbl WHERE week_id = ?", [safeWeekId]);
  const finishedMatches = (allMatches || []).filter(m => {
    if (m.status !== undefined && m.status !== null) return m.status === 'finished';
    return m.team_a_goal !== null && m.team_a_goal !== undefined;
  });

  for (const m of finishedMatches) {
    const aId = m.team_a_id;
    const bId = m.team_b_id;
    const gA = Number(m.team_a_goal || 0);
    const gB = Number(m.team_b_goal || 0);
    if (stats[aId]) { stats[aId].g += gA; stats[aId].a += gB; }
    if (stats[bId]) { stats[bId].g += gB; stats[bId].a += gA; }
    if (gA === gB) {
      if (stats[aId]) stats[aId].d++;
      if (stats[bId]) stats[bId].d++;
    } else if (gA > gB) {
      if (stats[aId]) stats[aId].w++;
      if (stats[bId]) stats[bId].l++;
    } else {
      if (stats[aId]) stats[aId].l++;
      if (stats[bId]) stats[bId].w++;
    }
  }

  for (const tidStr of Object.keys(stats)) {
    const tid = Number(tidStr);
    const r = stats[tid];
    r.pts = (r.w * 3) + r.d;
    const existing = await executeQuery(
      "SELECT id FROM table_week_tbl WHERE team_week_id = ? AND week_id = ? LIMIT 1",
      [tid, safeWeekId]
    );
    if (existing && existing.length > 0) {
      await executeQuery(
        "UPDATE table_week_tbl SET w = ?, d = ?, l = ?, g = ?, a = ?, pts = ? WHERE team_week_id = ? AND week_id = ?",
        [r.w, r.d, r.l, r.g, r.a, r.pts, tid, safeWeekId]
      );
    } else {
      await executeQuery(
        "INSERT INTO table_week_tbl (team_week_id, week_id, w, d, l, g, a, pts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [tid, safeWeekId, r.w, r.d, r.l, r.g, r.a, r.pts]
      );
    }
  }
  return { success: true };
}

/**
 * When /matchweek is called after play time ends:
 * 1) Finish any remaining 'in_progress' match (scorekeepers often forget closing the final match)
 * 2) Remove unplayed 'scheduled' matches so only actual played matches remain
 * 3) Recalculate standings and invalidate cached leader stats
 */
async function finalizeWeekMatchesAndStandings(weekId) {
  const safeWeekId = parseInt(weekId, 10);
  if (!safeWeekId) return { changed: false, finishedCount: 0, deletedScheduledCount: 0 };

  const inProgressRows = await executeQuery(
    "SELECT id, match_num FROM match_stat_tbl WHERE week_id = ? AND status = 'in_progress' ORDER BY match_num ASC",
    [safeWeekId]
  );
  const scheduledRows = await executeQuery(
    "SELECT id, match_num FROM match_stat_tbl WHERE week_id = ? AND status = 'scheduled' ORDER BY match_num ASC",
    [safeWeekId]
  );

  let finishedCount = 0;
  for (const m of inProgressRows || []) {
    await recalculateMatchScore(m.id);
    await executeQuery("UPDATE match_stat_tbl SET status = 'finished' WHERE id = ?", [m.id]);
    finishedCount++;
  }

  let deletedScheduledCount = 0;
  if (scheduledRows && scheduledRows.length > 0) {
    const schedIds = scheduledRows.map(r => Number(r.id)).filter(Boolean);
    if (schedIds.length > 0) {
      const ph = schedIds.map(() => '?').join(',');
      await executeQuery(`DELETE FROM match_goal_tbl WHERE match_id IN (${ph})`, schedIds);
      await executeQuery(`DELETE FROM match_stat_tbl WHERE id IN (${ph})`, schedIds);
      deletedScheduledCount = schedIds.length;
    }
  }

  const changed = finishedCount > 0 || deletedScheduledCount > 0;
  if (changed) {
    await recalculateTableWeek(safeWeekId);
    invalidateLeaderStatsCache(safeWeekId);
    logger.info(`[/matchweek Auto-Finalize] Week ${safeWeekId}: finished ${finishedCount} in-progress match(es), removed ${deletedScheduledCount} unplayed scheduled match(es).`);
  }

  return { changed, finishedCount, deletedScheduledCount };
}

async function getMatchWeek(week_id = 0, groupId = null) {
  const res = await queryWeekID(week_id);
  if (res && res.length > 0) {
    if (week_id == 0) {
      week_id = res[0].id;
    }
    const endInfo = getWeekEndInfo(res[0].date, res[0].time_range);
    let forceLeaderRefresh = false;
    if (endInfo.ended) {
      try {
        const finRes = await finalizeWeekMatchesAndStandings(week_id);
        forceLeaderRefresh = Boolean(finRes && finRes.changed);
      } catch (eFin) {
        logger.warn(`[/matchweek Auto-Finalize Error]: ${eFin.message}`);
      }
    }
    const assets = await fetchDisplayAssets();
    const theme = await getTheme();
    const imgTpl = await getTemplate('matchweek', 'header');
    const headerUrl = imgTpl ? imgTpl.url : null;

    const date = new Date(res[0].date);
    const date_str = await getFormatDate(date);
    const team_colors = await getTeamColorWeek(week_id);
    const tableRows = await queryTableWeek(week_id);
    const leaders = await getWeekLeaderStats(week_id, groupId, forceLeaderRefresh);
    const rawMatches = await queryMatchWeek(week_id);
    const matches = (rawMatches || []).filter(m => {
      if (m.status !== undefined && m.status !== null) {
        return m.status === 'finished' || m.status === 'in_progress';
      }
      return m.team_a_goal !== null && m.team_a_goal !== undefined;
    });

    // Pre-fetch goal and assist boxes for matches
    const matchDetailsMap = {};
    if (matches && matches.length > 0) {
      for (const match of matches) {
        const goalBox = await queryMatchGoal(match.id, 0, groupId);
        const assistBox = await queryMatchGoal(match.id, 3, groupId);
        matchDetailsMap[match.id] = { goalBox, assistBox };
      }
    }

    // ── Build TOTW + Team Formation images in parallel ──
    let totwBubble = null;
    let formationBubbles = null;

    // Step 1: prepare both datasets concurrently (DB queries, slot allocation)
    let totwFormationData = null;
    let formationData = null;

    const tPrepStart = Date.now();
    await Promise.all([
      // TOTW data prep
      (async () => {
        try {
          totwFormationData = await getTotwFormationData(week_id, groupId, leaders);
        } catch (eTotw) {
          logger.error('[MatchWeek] TOTW data prep failed:', eTotw);
        }
      })(),
      // Team formation data prep
      (async () => {
        try {
          formationData = await getTeamFormationData('', groupId, { weekId: week_id });
        } catch (eFormation) {
          logger.warn('[MatchWeek] getTeamFormationData failed:', eFormation.message);
        }
      })()
    ]);
    logger.info(`  [MatchWeek] Data prep (TOTW + formations)  : ${Date.now() - tPrepStart} ms`);

    // Step 2: generate all 1.5x pitch-only images in parallel via renderAsync (TOTW + all teams, 1 image per card)
    const teamImgMod = require('./team_img');
    const imageEntries = [];
    if (totwFormationData) {
      imageEntries.push({
        team: totwFormationData[0],
        dateStr: date_str,
        timeRange: res[0].time_range || '',
        label: 'TOTW                      '
      });
    }
    if (formationData && formationData.formationsData && formationData.formationsData.length > 0) {
      for (const team of formationData.formationsData) {
        imageEntries.push({
          team,
          dateStr: formationData.dateStr,
          timeRange: formationData.timeRange,
          label: `Team ${team.teamId} (${team.teamColor || '-'})  `
        });
      }
    }
    await populatePitchFormationImages(imageEntries, teamImgMod, '[/matchweek Image Generation — TOTW + All Teams in Parallel]');

    // Step 3: build flex bubbles (CPU only, fast)
    if (totwFormationData) {
      try {
        const totwBubbles = flex.buildFormationFlex(totwFormationData, theme, date_str, res[0].time_range || '', res[0].date, res[0].id);
        if (totwBubbles && totwBubbles.length > 0) totwBubble = totwBubbles[0];
      } catch (e) {
        logger.warn('[MatchWeek] TOTW flex build failed:', e.message);
      }
    }

    if (formationData && formationData.formationsData && formationData.formationsData.length > 0) {
      try {
        const tFlexStart = Date.now();
        formationBubbles = flex.buildFormationFlex(
          formationData.formationsData, formationData.theme,
          formationData.dateStr, formationData.timeRange,
          formationData.weekDate, formationData.weekId
        );
        logger.info(`  Flex JSON Builder                          : ${Date.now() - tFlexStart} ms`);
      } catch (e) {
        logger.warn('[MatchWeek] Formation flex build failed:', e.message);
      }
    }


    return flex.buildMatchWeekMessages({
      dateStr: date_str,
      tableRows,
      leaders,
      matches,
      teamColors: team_colors,
      theme,
      assets,
      headerUrl,
      matchDetailsMap,
      totwBubble,
      formationBubbles
    });
  }
  return null;
}


// Maps team color name → a readable display color on dark backgrounds
function teamDisplayColor(colorName, code) {
  const n = (colorName || '').toLowerCase();
  if (n === 'black') return '#999999';
  if (n === 'white') return '#ffffff';
  if (n === 'red') return '#ff5566';
  if (n === 'green') return '#44cc66';
  if (!code || code.length < 7) return '#ffffff';
  const r = parseInt(code.slice(1, 3), 16);
  const g = parseInt(code.slice(3, 5), 16);
  const b = parseInt(code.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.40 ? '#ffffff' : code;
}

async function getTeamWeek(week_id = 0, groupId = null) {

  let query = "";
  let res;

  res = await queryWeekID(week_id);

  if (res.length > 0) {
    if (week_id == 0) {
      week_id = res[0].id;
    }

    const team_colors = await getTeamColorWeek(week_id);
    const date = new Date(res[0].date);
    const date_str = await getFormatDate(date);

    if (team_colors.length > 0) {
      const theme = await getTheme();
      const assets = await fetchDisplayAssets();
      const teamMembersMap = {};

      for (const team of team_colors) {
        team.teamColor = await getTeamColor(team.color);
        query = `select member_team_week_tbl.*, member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id from member_team_week_tbl left join member_tbl on member_team_week_tbl.member_id = member_tbl.id where member_team_week_tbl.week_id=${week_id} and member_team_week_tbl.team_id=${team.id}`;
        const team_members = await executeQuery(query);
        if (team_members && team_members.length > 0) {
          await Promise.all(team_members.map(member => ensureMemberPicture(member, groupId)));
        }
        teamMembersMap[team.id] = team_members || [];
      }

      return flex.buildTeamWeekFlex(team_colors, teamMembersMap, theme, assets, resolveMemberDisplayInfo);
    }

  }

}

async function getDonateBadge(donate = 0) {
  if (donate < 100) {
    return "";
  } else if (donate > 599) {
    return "👑";
  } else if (donate > 499) {
    return "👑";
  } else if (donate > 299) {
    return "⭐";
  } else if (donate > 199) {
    return "✨";
  } else if (donate > 99) {
    return "🎗️";
  }

}

async function getMemberNY(isFlex = true, groupId = null, highlightMemberId = null, target_datetime = null) {
  await ensureNYTable();
  const info = await getNYEventInfo();
  const eventDatetime = target_datetime || info.eventDatetime;
  const headerText = info.header;

  const query = `
    SELECT ny.id as reg_id, ny.datetime, ny.member_id, COALESCE(ny.guests, 0) as guests, m.id, m.name, m.alias, m.rank, m.admin, m.donate, m.picture_url, m.line_user_id, ny.created_at
    FROM member_ny_week_tbl ny
    INNER JOIN member_tbl m ON m.id = ny.member_id
    WHERE ny.datetime = ? OR DATE(ny.datetime) = DATE(?)
    ORDER BY ny.id ASC
  `;

  const result = await executeQuery(query, [eventDatetime, eventDatetime]);

  if (isFlex) {
    const assets = await fetchDisplayAssets();
    if (result && result.length > 0) {
      await Promise.all(result.map(member => ensureMemberPicture(member, groupId)));
    }

    const members = (result || []).map(member => {
      const displayInfo = resolveMemberDisplayInfo(member, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
      const isCurrent = highlightMemberId ? (
        String(member.id) === String(highlightMemberId) ||
        String(member.member_id) === String(highlightMemberId) ||
        String(member.line_user_id) === String(highlightMemberId)
      ) : false;

      const guests = Number(member.guests) || 0;
      const nameWithGuests = guests > 0 ? `${displayInfo.name} (+${guests})` : displayInfo.name;

      return {
        ...displayInfo,
        name: nameWithGuests,
        guests,
        donate: '',
        isCurrent
      };
    });

    const totalMembers = members.length;
    const totalGuests = members.reduce((sum, m) => sum + (Number(m.guests) || 0), 0);
    const totalAttendees = totalMembers + totalGuests;

    const theme = await getTheme();
    const heroUrl = info.heroUrl || 'https://bearbit.org/pic/party_header.jpg';

    const partyData = {
      title: info.title || '🎉 2026 New Year Party',
      dateStr: info.dateStr || 'เสาร์ที่ 19 ธ.ค. 2569',
      timeStr: info.timeStr || '19:00 - 24:00 น.',
      venue: info.venue || 'Waterside ห้องคาราโอกะ K5 Club Pool',
      note: info.note || '⚽ หลังจากเตะบอล 17:00-19:00 น.',
      description: info.description,
      heroUrl: heroUrl,
      mapUrl: info.mapUrl,
      mapLabel: info.mapLabel,
      galleryUrl: info.galleryUrl,
      galleryLabel: info.galleryLabel,
      images: info.images || [],
      members: members,
      totalAttendees,
      totalGuests,
      totalMembers
    };

    const flexJson = flex.buildPartyFlex(partyData, theme);
    const altText = totalGuests > 0
      ? `🎉 งานเลี้ยงปีใหม่ (ร่วมงาน ${totalAttendees} คน: สมาชิก ${totalMembers} + ผู้ติดตาม ${totalGuests})`
      : `🎉 งานเลี้ยงปีใหม่ (ลงชื่อแล้ว ${totalMembers} คน)`;
    return [flexJson, null, altText];
  } else {
    // Plain text mode
    if (result && result.length > 0) {
      let body = "";
      let i = 0;
      let totalAttendees = 0;
      let totalGuests = 0;
      for (const member of result) {
        const donate = await getDonateBadge(member.donate);
        const guests = Number(member.guests) || 0;
        const guestText = guests > 0 ? ` (+${guests} ผู้ติดตาม)` : "";
        body += (i + 1) + ". " + donate + member.name + guestText + "\n";
        totalGuests += guests;
        totalAttendees += (1 + guests);
        i++;
      }
      const attendeeCountStr = totalGuests > 0 
        ? `+${totalAttendees} (สมาชิก ${i} คน + ผู้ติดตาม ${totalGuests} คน)` 
        : `+${i}`;
      let str = headerText + `${attendeeCountStr} พิมพ์ x1 หรือ x2 เพื่อลงชื่อครับ\n` + body;
      if (info.galleryUrl) {
        str += `\n📸 ${info.galleryLabel || 'อัลบั้มรูปภาพ'}: ${info.galleryUrl}\n`;
      }
      return [str, null, null];
    } else {
      return [headerText, null, null];
    }
  }
}

async function getAutoRegCount(groupId = null) {
  try {
    await ensureAutoRegTable();
    let query = `
      SELECT COUNT(DISTINCT m.id) as count 
      FROM member_tbl m 
      INNER JOIN autoreg_tbl a ON m.id = a.member_id 
      WHERE a.status = 1
    `;
    const params = [];
    if (groupId) {
      query += " AND (a.group_id IS NULL OR a.group_id = '' OR a.group_id = ?)";
      params.push(groupId);
    }
    const autoRegRes = await executeQuery(query, params);
    return autoRegRes.length > 0 ? autoRegRes[0].count : 0;
  } catch (err) {
    logger.error("Error getting autoRegCount:", err.message);
    return 0;
  }
}

async function fetchLineProfile(lineUserId, groupId = null) {
  return await lineClient.fetchUserProfile(lineUserId, groupId);
}

async function updateMemberPictureUrl(memberId, pictureUrl) {
  const query = "update member_tbl set picture_url = ? where id = ?";
  return await executeQuery(query, [pictureUrl, memberId]);
}

async function getMemberWeek0(type = 0, isFlex = true, groupId = null, highlightMemberId = null) {
  let header = "";
  let body = "";
  let sub = {};
  let query = "";
  let start = "";
  const res = await queryWeekID();

  if (res.length > 0) {
    const week_id = res[0].id;
    await addTeamColorWeek(3, week_id);
    const max_players = res[0].max;
    const date = new Date(res[0].date);
    const time_range = res[0].time_range || '17:30-20:00';

    query = `SELECT member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.team_id as member_team_id, member_team_week_tbl.team_id, member_team_week_tbl.team, member_team_week_tbl.pay, member_tbl.avoid_ids, member_tbl.id, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id FROM member_team_week_tbl INNER JOIN member_tbl ON member_tbl.id = member_team_week_tbl.member_id where member_team_week_tbl.week_id = ${week_id}`;
    if (type == 0) {
      header = "คนที่ยังไมได้จ่ายค่าสนาม";
      query += UNPAID_MEMBER_FILTER;
    } else if (type == 1) {
      header = "ลงชื่อเตะบอล";
      start = "+";
    }
    query += " ORDER BY member_team_week_tbl.id ASC";

    const result = await executeQuery(query);
    if (result.length > 0) {
      const teamColors = await getTeamColorWeek(week_id);
      const teamCount = (teamColors && teamColors.length > 0)
        ? teamColors.length
        : ((max_players > 24 || result.length > 24) ? 4 : 3);
      const max_goalies = Math.max(1, teamCount || 3);

      if (isFlex) {
        const players = [];
        const reserves = [];
        const goalies = [];
        const dateStr = await getFormatDate(date, 'short');
        const titleText = type === 0 ? "สมาชิกที่ยังไม่จ่ายค่าสนาม" : "ลงชื่อ";

        const assets = await fetchDisplayAssets();

        await Promise.all(result.map(member => ensureMemberPicture(member, groupId)));

        for (const member of result) {
          const info = resolveMemberDisplayInfo(member, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
          const name_display = info.name;
          const badgeUrl = info.badgeUrl;
          const badgeSize = info.badgeSize;
          const nameColor = info.nameColor;
          const hofCount = info.hofCount;
          const hofBadgeUrl = info.hofBadgeUrl;
          const hofBadgeSize = info.hofBadgeSize;
          const donate = '';
          const isCurrent = highlightMemberId ? (
            String(member.id) === String(highlightMemberId) ||
            String(member.member_id) === String(highlightMemberId) ||
            String(member.line_user_id) === String(highlightMemberId)
          ) : false;

          const memberItem = { name: name_display, donate, badgeUrl, badgeSize, nameColor, hofCount, hofBadgeUrl, hofBadgeSize, hofBadges: info.hofBadges, pictureUrl: info.pictureUrl, isCurrent };

          if (type == 1) {
            const isGoalie = (Number(member.member_team_id) === 100 || Number(member.team_id) === 100);
            if (isGoalie) {
              if (goalies.length < max_goalies) {
                goalies.push(memberItem);
              } else {
                const reserveName = (!name_display.includes('(โกล์)') && !name_display.includes('(GK)')) ? `${name_display} (โกล์)` : name_display;
                reserves.push({ ...memberItem, name: reserveName });
              }
            } else {
              if (players.length < max_players) {
                players.push(memberItem);
              } else {
                reserves.push(memberItem);
              }
            }
          } else {
            players.push(memberItem);
          }
        }

        const theme = await getTheme();
        const autoRegCount = await getAutoRegCount(groupId);

        const flexJson = flex.buildMemberWeekFlex(titleText, dateStr, max_players, players, reserves, goalies, theme, autoRegCount, time_range, max_goalies);
        let altHeader = `+${players.length}`;
        if (goalies.length > 0) altHeader += `(${goalies.length})`;
        if (reserves.length > 0) altHeader += `(${reserves.length})`;
        const altText = `${altHeader} ${titleText} เสาร์ที่ ${dateStr} @ ${time_range} น.`;
        return [flexJson, sub, altText];
      }

      header = `${header} เสาร์ที่ ${await getFormatDate(date, 'short')}\n\n`;
      let i = 0;
      let player = 0;
      let reserve = 0;
      let reserve_str = "\n=== รายชื่อสำรอง ===\n";
      let goal = 0;
      let goal_str = "\n=== รายชื่อโกล์ ===\n";
      for (const member of result) {
        //let donate = await getDonateBadge(member.donate);
        let donate = '';
        let name_display = (member.id == 116 || member.id == 16) ? member.alias : member.name;
        name_display = (name_display || '').replace('@', '');

        if (type == 1) {
          const isGoalie = (Number(member.member_team_id) === 100 || Number(member.team_id) === 100);
          if (isGoalie) {
            if (goal < max_goalies) {
              goal++;
              goal_str += (goal) + ". " + donate + name_display + "\n";
            } else {
              reserve++;
              const reserveName = (!name_display.includes('(โกล์)') && !name_display.includes('(GK)')) ? `${name_display} (โกล์)` : name_display;
              reserve_str += (reserve) + ". " + donate + reserveName + "\n";
            }
          } else {
            if (player < max_players) {
              player++;
              body += (player) + ". " + donate + name_display + "\n";
            } else {
              reserve++;
              reserve_str += (reserve) + ". " + donate + name_display + "\n";
            }
          }
        } else {
          body += (i + 1) + ". " + donate + name_display + "\n";
          player++;
        }
        i++;
      }
      let str = header + body;
      header = `+${player}`;
      if (goal > 0) str += goal_str;
      if (reserve > 0) str += reserve_str;
      if (goal > 0) header += `(${goal})`;
      if (reserve > 0) header += `(${reserve})`;

      str = `${header} ${str}`;

      return [str, sub, null];
    } else {
      if (type == 0) {
        header = `จ่ายครบหมดแล้ว เสาร์ที่ ${await getFormatDate(date)}`;
      } else if (type == 1) {
        header = `ลงชื่อเตะบอล เสาร์ที่ ${await getFormatDate(date)} ได้`;
      }
      return [header, sub, null];
    }
  } else {
    header = "ยังไม่มีข้อมูลสำหรับสัปดาห์นี้";
    return [header, sub, null];
  }
}

async function getMemberWeek(type = 0) {
  let header = "";
  let body = "";
  let query = "";
  let start = ""
  const res = await queryWeekID();

  if (res.length > 0) {
    const week_id = res[0].id;
    const max_players = res[0].max || 24;
    query = `SELECT member_tbl.name, member_tbl.alias, member_tbl.team_id as member_team_id, member_team_week_tbl.team_id, member_team_week_tbl.team, member_team_week_tbl.pay, member_tbl.avoid_ids, member_tbl.id, member_tbl.donate FROM member_team_week_tbl INNER JOIN member_tbl ON member_tbl.id = member_team_week_tbl.member_id where member_team_week_tbl.week_id = ${week_id}`;
    if (type == 0) {
      header = "คนที่ยังไมได้จ่ายค่าสนาม";
      query += UNPAID_MEMBER_FILTER;
    } else if (type == 1) {
      header = "ลงชื่อเตะบอล";
      start = "+"
    }
    query += " ORDER BY member_team_week_tbl.id ASC";

    const result = await executeQuery(query);
    if (result.length > 0) {
      const date = new Date(res[0].date);
      const teamColors = await getTeamColorWeek(week_id);
      const teamCount = (teamColors && teamColors.length > 0)
        ? teamColors.length
        : ((max_players > 24 || result.length > 24) ? 4 : 3);
      const max_goalies = Math.max(1, teamCount || 3);

      header = `${header} เสาร์ที่ ${await getFormatDate(date, 'short')}\n\n`;
      let i = 0;
      let player = 0;
      let reserve = 0;
      let reserve_str = "\n=== รายชื่อสำรอง ===\n";
      let goal = 0;
      let goal_str = "\n=== รายชื่อโกล์ ===\n";
      let index = 0;
      for (const member of result) {
        //let donate = await getDonateBadge(member.donate);
        let donate = '';
        let member_name = (member.id == 116 || member.id == 16) ? member.alias : member.name;
        member_name = (member_name || '').replace('@', '');

        if (type == 1) {
          const isGoalie = (Number(member.member_team_id) === 100 || Number(member.team_id) === 100);
          if (isGoalie) {
            if (goal < max_goalies) {
              goal++;
              goal_str += (goal) + ". " + donate + member_name + "\n";
            } else {
              reserve++;
              const reserveName = (!member_name.includes('(โกล์)') && !member_name.includes('(GK)')) ? `${member_name} (โกล์)` : member_name;
              reserve_str += (reserve) + ". " + donate + reserveName + "\n";
            }
          } else {
            if (player < max_players) {
              player++;
              body += (player) + ". " + donate + member_name + "\n";
            } else {
              reserve++;
              reserve_str += (reserve) + ". " + donate + member_name + "\n";
            }
          }
        } else {
          body += (i + 1) + ". " + donate + member_name + "\n";
          player++;
        }
        i++;
      }
      //logger.info(`player: ${player} reserve: ${reserve} goal: ${goal}`);
      let str = header + body;
      header = `+${player}`;
      if (goal > 0) str += goal_str;
      if (reserve > 0) str += reserve_str;
      if (goal > 0) header += `(${goal})`;
      if (reserve > 0) header += `(${reserve})`;

      str = `${header} ${str}`;

      return str;
    }
  } else {
    if (type == 0) {
      header = `จ่ายครบหมดแล้ว เสาร์ที่ ${await getFormatDate(date)}`;
    } else if (type == 1) {
      header = `ลงชื่อเตะบอล เสาร์ที่ ${await getFormatDate(date)} ได้`;
    }
    return header;
  }

}

async function getMemberWeek2(type = 0, useMention = true) {
  let header = "";
  let body = "";
  let sub = {};
  let user_json = "";
  let query = "";
  let start = ""
  let merber_count = 0;
  const res = await queryWeekID();

  if (res.length > 0) {
    const week_id = res[0].id;
    const date = new Date(res[0].date);
    query = `SELECT member_tbl.name, member_tbl.line_user_id, member_tbl.alias, member_team_week_tbl.team_id, member_team_week_tbl.team, member_team_week_tbl.pay, member_tbl.debt, member_tbl.id, member_tbl.donate, member_tbl.avoid_ids FROM member_team_week_tbl INNER JOIN member_tbl ON member_tbl.id = member_team_week_tbl.member_id where member_team_week_tbl.week_id = ${week_id}`;
    if (type == 0) {
      header = "คนที่ยังไมได้จ่ายค่าสนาม";
      query += UNPAID_MEMBER_FILTER;
    } else if (type == 1) {
      header = "ลงชื่อเตะบอล";
      start = "+"
    }

    const result = await executeQuery(query);
    if (result.length > 0) {


      header = `${header} เสาร์ที่ ${await getFormatDate(date, 'short')}\n\n`;
      let i = 0;
      let player = 0;
      let reserve = 0;
      let reserve_str = "\n=== รายชื่อสำรอง ===\n";
      let goal = 0;
      let goal_str = "\n=== รายชื่อโกล์ ===\n";
      let index = 0;
      merber_count = result.length;
      for (const member of result) {
        //let donate = await getDonateBadge(member.donate);
        let donate = '';
        let member_name = member.name;
        if (type == 1) {
          if (member.debt == 1000) {
            goal++;
            goal_str += (goal) + ". " + donate + member_name + "\n";
          } else {

            //index = player ;
            if (player < 24) {
              player++;
              body += (player) + ". " + donate + member_name + "\n";
            } else {
              reserve++;
              reserve_str += (reserve) + ". " + donate + member_name + "\n";
            }
          }
        } else {
          //logger.info(`user count: ${i+1}:${result.length}`)
          if (result.length < 21 && useMention) {
            let line_id = member.line_user_id;
            //line_id = "Ud734c89ea67da2ed0a16d8dfa6538ecc"
            let name = member_name;
            if (line_id != null && line_id != "") {
              name = `user${index + 1}`;
              body += `${i + 1}. ${donate}{${name}} \n`;
              if (index > 0) user_json += ',';
              sub[name] = {
                "type": "mention",
                "mentionee":
                {
                  "type": "user",
                  "userId": line_id
                }
              };
              index++;
            } else {
              body += (i + 1) + ". " + donate + member_name + "\n";
            }


          } else {
            body += (i + 1) + ". " + donate + member_name + "\n";
          }
          player++;
        }
        i++;
        //if (i > 1) break ;
      }
      //user_json = "{" + user_json + "}" ;
      //logger.info(user_json.replace(/\s/g, "")) ;
      //sub = JSON.parse(user_json.replace(/\s/g, "")) 
      //logger.info(`player: ${player} reserve: ${reserve} goal: ${goal}`) ;
      let str = header + body;
      header = `\n+${player}`;
      if (reserve > 0) str += reserve_str;
      if (goal > 0) str += goal_str;
      if (reserve > 0) header += `(${reserve})`;
      if (goal > 0) header += `(${goal})`;

      str = `${header} ${str}`;
      //logger.info(sub) ;
      return [str, sub, merber_count, (res && res[0] && res[0].cost) ? res[0].cost : 0];
    } else {
      if (type == 0) {
        header = `จ่ายครบหมดแล้ว เสาร์ที่ ${await getFormatDate(date)}`;
      } else if (type == 1) {
        header = `ลงชื่อเตะบอล เสาร์ที่ ${await getFormatDate(date)} ได้`;
      }
      //return header ;
      //logger.info(`header: ${header} sub: ${sub} merber_count: ${merber_count}`) ;
      return [header, sub, merber_count, (res && res[0] && res[0].cost) ? res[0].cost : 0];
    }
  }
  return ['', {}, 0, 0];
}

// ── Shared query builders (used by both getTopStat and updateHof) ──

function buildGoalQuery(statusCondition, year, limit = null) {
  let sql = `SELECT member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id,
    goal_status_tbl.status, match_goal_tbl.status as statusid, COUNT(*) as goal
    FROM match_goal_tbl
    JOIN member_tbl ON match_goal_tbl.member_id = member_tbl.id
    JOIN goal_status_tbl ON match_goal_tbl.status = goal_status_tbl.id
    JOIN match_stat_tbl ON match_goal_tbl.match_id = match_stat_tbl.id
    JOIN week_tbl ON match_stat_tbl.week_id = week_tbl.id
    WHERE match_goal_tbl.status ${statusCondition}
      AND EXTRACT(YEAR FROM week_tbl.date)::int = ${year}
      AND member_tbl.id <> 121 AND member_tbl.id <> 169
      AND member_tbl.team_id <> 101
    GROUP BY member_tbl.id, goal_status_tbl.status, match_goal_tbl.status, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id
    ORDER BY goal DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  return sql;
}

function buildAvgMvpPtsQuery(year, limit = null) {
  let sql = `SELECT * FROM (
    SELECT 
      member_tbl.id,
      member_tbl.name, 
      member_tbl.alias, 
      member_tbl.rank,
      member_tbl.admin,
      member_tbl.donate,
      member_tbl.picture_url,
      member_tbl.line_user_id,
      ROUND(
        (SUM(CASE WHEN m.rating > 0 THEN m.rating ELSE (CASE WHEN mtw.rating > 0 THEN mtw.rating ELSE 0 END) END)::numeric
        / NULLIF(SUM(tw.w + tw.d + tw.l), 0)::numeric),
        2
      ) as goal,
      SUM(tw.w + tw.d + tw.l) as matches
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.week_id = tw.week_id AND mtw.team_id = tw.team_week_id
    JOIN member_tbl ON mtw.member_id = member_tbl.id
    JOIN week_tbl w ON mtw.week_id = w.id
    LEFT JOIN mvp_week_tbl m ON mtw.week_id = m.week_id AND mtw.member_id = m.member_id
    WHERE (w.year::text = '${year}' OR EXTRACT(YEAR FROM w.date)::int = ${year})
      AND member_tbl.id <> 121 AND member_tbl.id <> 169
      AND member_tbl.team_id <> 101
    GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id
  ) sub
  WHERE matches > 0 AND goal > 0
  ORDER BY goal DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  return sql;
}

function buildMvpCountQuery(year, limit = null) {
  let sql = `SELECT * FROM (
    SELECT 
      member_tbl.id,
      member_tbl.name, 
      member_tbl.alias, 
      member_tbl.rank,
      member_tbl.admin,
      member_tbl.donate,
      member_tbl.picture_url,
      member_tbl.line_user_id,
      COUNT(*) as goal
    FROM mvp_week_tbl m
    JOIN week_tbl w ON m.week_id = w.id
    JOIN member_tbl ON m.member_id = member_tbl.id
    WHERE (w.year::text = '${year}' OR EXTRACT(YEAR FROM w.date)::int = ${year})
      AND m.raw_score > 0
      AND member_tbl.id <> 121 AND member_tbl.id <> 169
      AND member_tbl.team_id <> 101
      AND m.raw_score = (
        SELECT MAX(m2.raw_score)
        FROM mvp_week_tbl m2
        WHERE m2.week_id = m.week_id
          AND m2.member_id > 0
          AND m2.member_name NOT LIKE '@team%'
          AND m2.member_name NOT LIKE '+team%'
          AND m2.member_name NOT LIKE 'team%'
      )
    GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id
  ) sub
  WHERE goal > 0
  ORDER BY goal DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  return sql;
}

function buildMostPtsQuery(year, limit = null) {
  let sql = `SELECT * FROM (
    SELECT 
      member_tbl.id,
      member_tbl.name, 
      member_tbl.alias, 
      member_tbl.rank,
      member_tbl.admin,
      member_tbl.donate,
      member_tbl.picture_url,
      member_tbl.line_user_id,
      SUM(table_week_tbl.pts) as goal
    FROM member_team_week_tbl
    JOIN table_week_tbl ON member_team_week_tbl.team_id = table_week_tbl.team_week_id
    JOIN member_tbl     ON member_team_week_tbl.member_id = member_tbl.id
    JOIN week_tbl       ON table_week_tbl.week_id = week_tbl.id
    WHERE (week_tbl.year::text = '${year}' OR EXTRACT(YEAR FROM week_tbl.date)::int = ${year})
      AND member_tbl.id <> 121 AND member_tbl.id <> 169
      AND member_tbl.team_id <> 101
    GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id
  ) sub
  WHERE goal > 0
  ORDER BY goal DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  return sql;
}

function buildAvgPtsQuery(year, limit = null) {
  let sql = `SELECT * FROM (
    SELECT 
      member_tbl.id,
      member_tbl.name, 
      member_tbl.alias, 
      member_tbl.rank,
      member_tbl.admin,
      member_tbl.donate,
      member_tbl.picture_url,
      member_tbl.line_user_id,
      ROUND(
        (SUM(CASE WHEN m.raw_score > 0 THEN m.raw_score ELSE 0 END)::numeric
        / NULLIF(COUNT(DISTINCT mtw.week_id), 0)::numeric),
        2
      ) AS goal,
      SUM(CASE WHEN m.raw_score > 0 THEN m.raw_score ELSE 0 END) AS total_raw,
      COUNT(DISTINCT mtw.week_id) AS weeks,
      COUNT(DISTINCT mtw.week_id) AS m
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.week_id = tw.week_id AND mtw.team_id = tw.team_week_id
    JOIN member_tbl ON mtw.member_id = member_tbl.id
    JOIN week_tbl w ON mtw.week_id = w.id
    LEFT JOIN mvp_week_tbl m ON mtw.week_id = m.week_id AND mtw.member_id = m.member_id
    WHERE (w.year::text = '${year}' OR EXTRACT(YEAR FROM w.date)::int = ${year})
      AND member_tbl.id <> 121 AND member_tbl.id <> 169
      AND member_tbl.team_id <> 101
    GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id
  ) sub
  WHERE weeks > (
      SELECT COUNT(*) * 0.5
      FROM week_tbl
      WHERE (week_tbl.year::text = '${year}' OR EXTRACT(YEAR FROM week_tbl.date)::int = ${year})
  )
  AND goal > 0
  ORDER BY goal DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  return sql;
}

function buildBottomQuery(year, limit = null) {
  let sql = `
    SELECT 
      member_tbl.id,
      member_tbl.name, 
      member_tbl.alias, 
      member_tbl.rank,
      member_tbl.admin,
      member_tbl.donate,
      member_tbl.picture_url,
      member_tbl.line_user_id,
      COUNT(*) as goal
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.week_id = tw.week_id AND mtw.team_id = tw.team_week_id
    JOIN member_tbl ON mtw.member_id = member_tbl.id
    JOIN week_tbl w ON mtw.week_id = w.id
    WHERE (w.year::text = '${year}' OR EXTRACT(YEAR FROM w.date)::int = ${year})
      AND member_tbl.id <> 121 AND member_tbl.id <> 169 AND member_tbl.team_id <> 101
      AND tw.team_week_id = (
        SELECT t2.team_week_id
        FROM table_week_tbl t2
        WHERE t2.week_id = tw.week_id
        ORDER BY t2.pts ASC, (t2.g - t2.a) ASC
        LIMIT 1
      )
    GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id
    ORDER BY goal DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  return sql;
}

function buildLuckyColorQuery(year) {
  return `
    SELECT 
      t_col.color,
      SUM(tw.w) as wins,
      SUM(tw.w + tw.d + tw.l) as matches
    FROM table_week_tbl tw
    JOIN team_color_week_tbl t_col ON tw.team_week_id = t_col.id
    JOIN week_tbl w ON tw.week_id = w.id
    WHERE (w.year::text = '${year}' OR EXTRACT(YEAR FROM w.date)::int = ${year})
    GROUP BY t_col.color
    ORDER BY (SUM(tw.w)::numeric / NULLIF(SUM(tw.w + tw.d + tw.l), 0)::numeric) DESC, SUM(tw.w + tw.d + tw.l) DESC
  `;
}

async function getTopStat(limit = 10, type = 0, groupId = null) {
  let header = "";
  let icon = "";
  let query = "";
  let status = "";
  const res = await getTemplate('top', type);
  let url = res ? res.url : '';
  if (url) {
    url = getFullUrl(url);
  }

  const currentYear = new Date().getFullYear();

  if (type == 0) {
    status = "< 2";
    header = `Top ${limit} Scorer`;
    icon = "⚽";
    query = buildGoalQuery(status, currentYear, limit);
  } else if (type == 1) {
    status = "= 3";
    header = `Top ${limit} Assist`;
    icon = "👟";
    query = buildGoalQuery(status, currentYear, limit);
  } else if (type == 2) {
    status = "= 2";
    header = `สปายฝั่งตรงข้าม`;
    icon = "🥅";
    query = buildGoalQuery(status, currentYear, limit);
  } else if (type == 3) {
    header = `Top ${limit} Avg MVP`;
    icon = "⭐";
    query = buildAvgMvpPtsQuery(currentYear, limit);
  } else if (type == 4) {
    header = `Top ${limit} Avg Pts`;
    icon = "📊";
    query = buildAvgPtsQuery(currentYear, limit);
  } else if (type == 5) {
    header = `ซึมเศร้าสะสม`;
    icon = "📉";
    query = buildBottomQuery(currentYear, limit);
  } else if (type == 6) {
    header = `Lucky Colors`;
    icon = "🎨";
    query = buildLuckyColorQuery(currentYear);
  } else if (type == 7) {
    header = `Top ${limit} Most MVP`;
    icon = "👑";
    query = buildMvpCountQuery(currentYear, limit);
  }

  const result = await executeQuery(query);
  if (result.length > 0) {
    if (type != 6) {
      await Promise.all(result.slice(0, 3).map(member => ensureMemberPicture(member, groupId)));
    }
    const assets = await fetchDisplayAssets();
    const theme = await getTheme();
    return flex.buildTopStatFlex(result, type, header, icon, url, theme, assets, resolveMemberDisplayInfo);
  }
}

async function getDebtList(type = 0) {
  logger.info(`[getDebtList] Called with type = ${type} (0=daily auto, 1=manual)`);
  let debt_str = "=== สมาชิกที่มียอดค้าง ===\n\n";
  let debt_count = 0;
  let sub = {};
  let proceed = false;
  let debt_val = 0;
  let debt_members = [];

  if (type == 0) {
    const debt_call = `SELECT value from template_tpl where name = 'call'`;
    const debt_call_res = await executeQuery(debt_call);
    logger.info(`[getDebtList] template_tpl 'call' query result:`, debt_call_res);
    if (debt_call_res.length > 0) {
      if (debt_call_res[0].value == 0) {
        proceed = true;
      } else {
        logger.info(`[getDebtList] proceed=false because call value is ${debt_call_res[0].value} (already alerted today)`);
      }
    } else {
      logger.warn(`[getDebtList] template_tpl 'call' row not found in DB`);
    }
  } else {
    proceed = true;
    logger.info(`[getDebtList] proceed=true (type != 0, manual request)`);
  }

  if (proceed) {
    const check = `SELECT * from member_tbl where debt > 0`;
    const check_res = await executeQuery(check);
    logger.info(`[getDebtList] Query 'member_tbl where debt > 0' returned ${check_res.length} row(s)`);

    if (check_res.length > 0) {
      debt_members = check_res;
      for (const member of check_res) {
        debt_count++;
        let name = member.name;
        let line_id = member.line_user_id;
        const currentSubCount = Object.keys(sub).length;
        if (line_id != null && line_id !== "" && currentSubCount < 20) {
          name = `user${debt_count}`;
          debt_str += `${debt_count}. {${name}} - ${member.debt} บาท\n`;
          sub[name] = {
            "type": "mention",
            "mentionee":
            {
              "type": "user",
              "userId": line_id
            }
          };
        } else {
          debt_str += `${debt_count}. ${name} - ${member.debt} บาท\n`;
        }
        logger.info(`[getDebtList] Member #${debt_count}: id=${member.id}, name=${member.name}, debt=${member.debt}, line_id=${line_id || 'none'}, mentionUsed=${name.startsWith('user')}`);
      }
      if (type == 0) {
        logger.info(`[getDebtList] Updating template_tpl 'call' value to 1 (daily alert flag)`);
        await updateAlertCall(1);
      }
      const uniqueDebts = [...new Set(check_res.map(m => Number(m.debt)).filter(d => !isNaN(d) && d > 0))];
      debt_val = uniqueDebts.length > 0 ? uniqueDebts[0] : 0;
      logger.info(`[getDebtList] Calculated uniqueDebts:`, uniqueDebts, `debt_val:`, debt_val);
    } else {
      logger.info(`[getDebtList] No members found with debt > 0`);
      if (type != 0) {
        debt_str += "ไม่มีสมาชิกค้างชำระ 🎉\n\n";
      }
    }
  }

  debt_str += "** ข้อความแจ้งเตือนวันละครั้ง **\n";
  debt_str += "สมาชิกจะยังลงชื่อไม่ได้ในสัปดาห์นี้ และจะไม่ถูกเพิ่มจากการลงทะเบียนอัตโนมัติ ถ้ามีการเปิดสัปดาห์ใหม่";
  logger.info(`[getDebtList] Finished. Summary: proceed=${proceed}, debt_count=${debt_count}, debt_val=${debt_val}, debt_members=${debt_members.length}, subKeys=${Object.keys(sub).length}`);
  return [debt_str, sub, debt_count, proceed, debt_val, debt_members];

}

function isMatchPlayed(row) {
  if (!row) return false;
  if (row.status === 'finished' || row.status === 'in_progress') return true;
  const hasGoal = (row.team_a_goal !== null && row.team_a_goal !== undefined) ||
    (row.team_b_goal !== null && row.team_b_goal !== undefined);
  if (row.status === undefined || row.status === null) return hasGoal;
  return Number(row.team_a_goal) > 0 || Number(row.team_b_goal) > 0;
}

function parseTimeToMins(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).trim().replace('.', ':').split(':').map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  if (parts[0] < 0 || parts[0] > 23 || parts[1] < 0 || parts[1] > 59) return null;
  return parts[0] * 60 + parts[1];
}

function formatMinsToTime(mins) {
  const total = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function insertScheduleMatchRow(week_id, matchNum, round, startTime, endTime, teamAId, teamBId, status = 'scheduled') {
  try {
    await executeQuery(
      "INSERT INTO match_stat_tbl (week_id, match_num, round, start_time, end_time, team_a_id, team_b_id, team_a_goal, team_b_goal, status) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
      [week_id, matchNum, round, startTime, endTime, teamAId, teamBId, status]
    );
  } catch (insertColErr) {
    try {
      await executeQuery(
        "INSERT INTO match_stat_tbl (week_id, match_num, team_a_id, team_b_id, team_a_goal, team_b_goal) VALUES (?, ?, ?, ?, NULL, NULL)",
        [week_id, matchNum, teamAId, teamBId]
      );
    } catch (i2) {
      try {
        await executeQuery(
          "INSERT INTO match_stat_tbl (week_id, match_num, team_a_id, team_b_id) VALUES (?, ?, ?, ?)",
          [week_id, matchNum, teamAId, teamBId]
        );
      } catch (i3) {
        await executeQuery(
          "INSERT INTO match_stat_tbl (week_id, match_num, team_a_id, team_b_id, team_a_goal, team_b_goal) VALUES (?, ?, ?, ?, 0, 0)",
          [week_id, matchNum, teamAId, teamBId]
        );
      }
    }
  }
}

async function saveScheduleToDb(week_id, scheduleMatches, forceRegen = false) {
  if (!week_id || !Array.isArray(scheduleMatches) || scheduleMatches.length === 0) return false;

  try {
    // Ensure schedule schema columns exist
    await ensureMatchStatScheduleColumns();

    // 1. Query existing records for this week
    const existing = await executeQuery(
      "SELECT * FROM match_stat_tbl WHERE week_id = ? ORDER BY match_num ASC",
      [week_id]
    );

    const existingMap = new Map();
    if (existing && existing.length > 0) {
      for (const row of existing) {
        existingMap.set(row.match_num, row);
      }
    }

    // Build color to ID mapping as fallback if teamAId / teamBId is missing in fixture
    const colorToIdMap = new Map();
    try {
      const colors = await getTeamColorWeek(week_id);
      if (colors && colors.length > 0) {
        for (const c of colors) {
          if (c.color) colorToIdMap.set(String(c.color).trim().toLowerCase(), c.id);
        }
      }
    } catch (colErr) { }

    // 2. Insert or update fixtures
    for (const m of scheduleMatches) {
      const matchNum = m.matchNo;
      const ex = existingMap.get(matchNum);
      const round = m.round || 1;
      const startTime = m.startTime || null;
      const endTime = m.endTime || null;
      let teamAId = m.teamAId || (m.teamA ? colorToIdMap.get(String(m.teamA).trim().toLowerCase()) : null) || null;
      let teamBId = m.teamBId || (m.teamB ? colorToIdMap.get(String(m.teamB).trim().toLowerCase()) : null) || null;

      if (ex) {
        const isPlayed = isMatchPlayed(ex);
        if (isPlayed) {
          // Hard lock: never overwrite or reset a match that has already been played/scored
          if (!forceRegen) {
            try {
              await executeQuery(
                "UPDATE match_stat_tbl SET round = ?, start_time = ?, end_time = ? WHERE id = ?",
                [round, startTime, endTime, ex.id]
              );
            } catch (e) { }
          }
        } else {
          // Overwrite/update scheduled fixture
          try {
            await executeQuery(
              "UPDATE match_stat_tbl SET round = ?, start_time = ?, end_time = ?, team_a_id = ?, team_b_id = ?, team_a_goal = NULL, team_b_goal = NULL, status = 'scheduled' WHERE id = ?",
              [round, startTime, endTime, teamAId, teamBId, ex.id]
            );
          } catch (updateColErr) {
            try {
              await executeQuery(
                "UPDATE match_stat_tbl SET team_a_id = ?, team_b_id = ?, team_a_goal = NULL, team_b_goal = NULL WHERE id = ?",
                [teamAId, teamBId, ex.id]
              );
            } catch (u2) {
              await executeQuery(
                "UPDATE match_stat_tbl SET team_a_id = ?, team_b_id = ? WHERE id = ?",
                [teamAId, teamBId, ex.id]
              );
            }
          }
        }
      } else {
        // Insert new match row
        await insertScheduleMatchRow(week_id, matchNum, round, startTime, endTime, teamAId, teamBId);
      }
    }

    // 3. Clean up extra scheduled matches if team count decreased (e.g. from 18 to 9 matches)
    if (existing && existing.length > scheduleMatches.length) {
      for (const row of existing) {
        if (row.match_num > scheduleMatches.length) {
          if (!isMatchPlayed(row)) {
            await executeQuery("DELETE FROM match_stat_tbl WHERE id = ?", [row.id]);
          }
        }
      }
    }

    logger.info(`[schedule] Saved ${scheduleMatches.length} matches into match_stat_tbl for week ${week_id}`);
    return true;
  } catch (err) {
    logger.warn('[schedule] Failed to save schedule into match_stat_tbl (run migrations/match_stat_schedule.sql):', err.message);
    return false;
  }
}

// ── Database Schedule Builder ──
// Loads the week schedule directly from match_stat_tbl and team_color_week_tbl (SSOT)
async function getScheduleFromDb(week_id) {
  if (!week_id) return null;

  try {
    const weekRows = await queryWeekID(week_id);
    if (!weekRows || weekRows.length === 0) return null;
    const weekRow = weekRows[0];

    const dbMatches = await queryMatchWeek(week_id);
    if (!dbMatches || dbMatches.length === 0) return null;

    const teamColors = await getTeamColorWeek(week_id);
    const colorMap = new Map();
    if (teamColors && teamColors.length > 0) {
      teamColors.forEach(c => colorMap.set(c.id, c.color));
    }
    const teams = teamColors && teamColors.length > 0 ? teamColors.map(c => c.color) : [];

    // Find the teams actually playing in dbMatches
    const playingTeamIdSet = new Set();
    const playingTeamColorSet = new Set();
    dbMatches.forEach(r => {
      if (r.team_a_id) {
        playingTeamIdSet.add(r.team_a_id);
        const c = colorMap.get(r.team_a_id);
        if (c) playingTeamColorSet.add(c);
      }
      if (r.team_b_id) {
        playingTeamIdSet.add(r.team_b_id);
        const c = colorMap.get(r.team_b_id);
        if (c) playingTeamColorSet.add(c);
      }
    });

    // Use actual playing teams to determine cycles, resting teams, and team count
    const playingTeams = playingTeamColorSet.size > 0
      ? teams.filter(t => playingTeamColorSet.has(t))
      : teams;
    const numTeams = playingTeams.length || teams.length || 4;
    const cycleLen = (numTeams * (numTeams - 1)) / 2 || 6;

    const scheduleMatches = dbMatches.map((r, i) => {
      const teamA = colorMap.get(r.team_a_id) || `ทีม ${r.team_a_id}`;
      const teamB = colorMap.get(r.team_b_id) || `ทีม ${r.team_b_id}`;
      return {
        matchNo: r.match_num,
        round: r.round || Math.floor(i / cycleLen) + 1,
        startTime: r.start_time || '',
        endTime: r.end_time || '',
        teamA,
        teamAId: r.team_a_id,
        teamB,
        teamBId: r.team_b_id,
        resting: playingTeams.filter(t => t !== teamA && t !== teamB),
        status: r.status,
        team_a_goal: r.team_a_goal,
        team_b_goal: r.team_b_goal
      };
    });

    let currentMatchNo = 1;
    let nextMatchNo = Math.min(2, scheduleMatches.length);
    let matchStatus = 'scheduled';
    const hasStatusCol = dbMatches.some(r => r.status !== undefined && r.status !== null);

    if (hasStatusCol) {
      const inProg = dbMatches.find(r => r.status === 'in_progress');
      if (inProg) {
        currentMatchNo = inProg.match_num;
        matchStatus = 'in_progress';
        const nextSched = dbMatches.find(r => r.status === 'scheduled' && r.match_num > currentMatchNo);
        nextMatchNo = nextSched ? nextSched.match_num : Math.min(currentMatchNo + 1, scheduleMatches.length);
      } else {
        const firstSched = dbMatches.find(r => r.status === 'scheduled');
        if (firstSched) {
          currentMatchNo = firstSched.match_num;
          matchStatus = 'scheduled';
          const nextSched = dbMatches.find(r => r.status === 'scheduled' && r.match_num > currentMatchNo);
          nextMatchNo = nextSched ? nextSched.match_num : Math.min(currentMatchNo + 1, scheduleMatches.length);
        } else {
          currentMatchNo = scheduleMatches.length;
          matchStatus = 'all_finished';
          nextMatchNo = currentMatchNo;
        }
      }
    } else {
      const maxDbMatchNum = Math.max(...dbMatches.map(r => r.match_num));
      currentMatchNo = maxDbMatchNum;
      nextMatchNo = Math.min(maxDbMatchNum + 1, scheduleMatches.length);
    }

    const currentMatch = scheduleMatches.find(m => m.matchNo === currentMatchNo) || scheduleMatches[0];
    const nextMatch = scheduleMatches.find(m => m.matchNo === nextMatchNo) || null;

    let dateStr = '';
    if (weekRow.date) {
      const dateObj = new Date(weekRow.date);
      dateStr = `${dateObj.getDate()} ${thaiMonthsShort[dateObj.getMonth()]} ${String(dateObj.getFullYear()).slice(-2)}`;
    }

    const firstMatch = scheduleMatches[0];
    const lastMatch = scheduleMatches[scheduleMatches.length - 1];
    const startTimeStr = firstMatch?.startTime || '17:30';
    const endTimeStr = lastMatch?.endTime || '20:00';

    let matchMin = 8;
    if (firstMatch && firstMatch.startTime && firstMatch.endTime) {
      const [sh, sm] = firstMatch.startTime.replace('.', ':').split(':').map(Number);
      const [eh, em] = firstMatch.endTime.replace('.', ':').split(':').map(Number);
      const diff = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
      if (diff > 0) matchMin = diff;
    }

    let breakMin = 2;
    if (scheduleMatches.length > 1 && scheduleMatches[0].endTime && scheduleMatches[1].startTime) {
      const [e1h, e1m] = scheduleMatches[0].endTime.replace('.', ':').split(':').map(Number);
      const [s2h, s2m] = scheduleMatches[1].startTime.replace('.', ':').split(':').map(Number);
      const bDiff = (s2h * 60 + (s2m || 0)) - (e1h * 60 + (e1m || 0));
      if (bDiff >= 0) breakMin = bDiff;
    }

    const [startH, startM] = startTimeStr.replace('.', ':').split(':').map(Number);
    const [endH, endM] = endTimeStr.replace('.', ':').split(':').map(Number);
    let totalMins = (endH * 60 + (endM || 0)) - (startH * 60 + (startM || 0));
    if (totalMins < 0) totalMins += 1440;
    const totalHours = Number((totalMins / 60).toFixed(2));
    const totalRounds = Math.ceil(scheduleMatches.length / cycleLen);

    let imageUrl = null;
    try {
      const imgTpl = await getTemplate('schedule', 'header');
      if (imgTpl && imgTpl.url) imageUrl = imgTpl.url;
    } catch (err) { }

    return {
      weekId: week_id,
      date: dateStr,
      startTime: startTimeStr,
      endTime: endTimeStr,
      matchMinutes: matchMin,
      breakMinutes: breakMin,
      totalHours: totalHours,
      teams: playingTeams,
      allWeekTeams: teams,
      playingTeamCount: playingTeamIdSet.size,
      totalMatches: scheduleMatches.length,
      totalRounds: totalRounds,
      currentMatch,
      nextMatch,
      imageUrl,
      dbMatches,
      matches: scheduleMatches,
      matchStatus
    };
  } catch (err) {
    logger.error('[schedule] failed to build schedule from DB:', err.message);
    return null;
  }
}

// Formats schedule lines for text display
function formatScheduleLines(sched) {
  if (!sched || !Array.isArray(sched.matches)) return '';
  const lines = [];
  lines.push(`⚽ ตารางแข่งขัน เสาร์ที่ ${sched.date}`);
  const breakInfo = (sched.breakMinutes && sched.breakMinutes > 0) ? ` (พัก ~${Number(sched.breakMinutes).toFixed(1).replace('.0', '')} นาที)` : '';
  lines.push(`🕐 เริ่ม ${sched.startTime} น. - ${sched.endTime} น. | ${sched.matchMinutes} นาที/แมตช์${breakInfo}`);
  const displayHours = Number(Number(sched.totalHours || 2.5).toFixed(2));
  const numTeams = (sched.teams || []).length || 4;
  const cycleLen = (numTeams * (numTeams - 1)) / 2 || 6;
  const totalRounds = sched.totalRounds || Math.ceil(sched.matches.length / cycleLen);
  const totalTeamSlots = sched.matches.length * 2;
  const equalMatches = totalTeamSlots % numTeams === 0;
  const matchesPerTeamText = equalMatches
    ? `ทีมละ ${totalTeamSlots / numTeams} แมตช์เท่ากัน`
    : `ทีมละ ~${Math.floor(totalTeamSlots / numTeams)}-${Math.ceil(totalTeamSlots / numTeams)} แมตช์`;
  lines.push(`👥 ${numTeams} ทีม | ${sched.matches.length} แมตช์ (${totalRounds} รอบ • ${matchesPerTeamText}) | ${displayHours} ชม.`);
  lines.push(`⚠️ เล่น/พักติดต่อกันได้สูงสุด 2 แมตช์เท่านั้น`);
  lines.push('─'.repeat(30));

  sched.matches.forEach((m, i) => {
    if (i % cycleLen === 0) {
      lines.push(`▶ รอบที่ ${Math.floor(i / cycleLen) + 1}`);
    }
    const restingStr = Array.isArray(m.resting) ? m.resting.join(', ') : '';
    lines.push(`[${m.matchNo || i + 1}] ${m.startTime}-${m.endTime}  ${m.teamA} vs ${m.teamB}${restingStr ? `  (พัก: ${restingStr})` : ''}`);
  });

  lines.push('─'.repeat(30));
  lines.push(`สิ้นสุด ${sched.endTime} น.`);
  return lines.join('\n');
}

async function getScheduleText(startTimeStr = null, matchMin = null, breakMin = null, totalHours = null, endTimeStr = null, forceRegen = false, targetTeamCount = null) {
  // Fetch current week team colors
  const week = await queryWeekID();
  if (!week || week.length === 0) return ['ยังไม่มีข้อมูลสัปดาห์นี้', null];

  const week_id = week[0].id;

  // Determine desired team count:
  // If targetTeamCount is explicitly provided (e.g. 3 or 4, or player count like 24 or 32), use it.
  // Otherwise, automatically check the number of registered players for this week:
  // If registered members > 24 (or week max > 24) -> 4 teams, otherwise -> 3 teams.
  let desiredTeamCount = null;
  if (targetTeamCount) {
    const parsedTarget = parseInt(targetTeamCount, 10);
    if (!isNaN(parsedTarget)) {
      if (parsedTarget > 6) {
        desiredTeamCount = parsedTarget > 24 ? 4 : 3;
      } else if (parsedTarget >= 2) {
        desiredTeamCount = parsedTarget;
      }
    }
  }

  let registeredCount = 0;
  try {
    const regRes = await executeQuery(
      "SELECT COUNT(*) as cnt FROM member_team_week_tbl WHERE week_id = ?",
      [week_id]
    );
    registeredCount = regRes?.[0]?.cnt || 0;
  } catch (err) {
    logger.error('[schedule] failed to query registered members count:', err.message);
  }

  if (!desiredTeamCount) {
    const maxQuota = (week[0] && week[0].max) ? Number(week[0].max) : 24;
    if (registeredCount > 24 || maxQuota > 24) {
      desiredTeamCount = 4;
    } else {
      desiredTeamCount = 3;
    }
  }

  // 1. Primary: Load existing schedule directly from DB match_stat_tbl (SSOT)
  // Hard lock: if ANY match has already started or finished, never regenerate even when forceRegen=true.
  try {
    const dbSched = await getScheduleFromDb(week_id);
    if (dbSched && Array.isArray(dbSched.matches) && dbSched.matches.length > 0) {
      const hasPlayedMatches = dbSched.matches.some(isMatchPlayed);
      if (hasPlayedMatches) {
        const lines = formatScheduleLines(dbSched);
        return [lines, { ...dbSched, lockedByPlayedMatches: Boolean(forceRegen) }];
      }

      if (!forceRegen) {
        const dbPlayingTeamCount = dbSched.playingTeamCount || (dbSched.teams ? dbSched.teams.length : 0);
        const allDesiredTeamsPlay = dbPlayingTeamCount === desiredTeamCount;
        const cycleLen = (desiredTeamCount * (desiredTeamCount - 1)) / 2;
        const isFullCycles = (dbSched.matches.length % cycleLen === 0);

        let timeRangeMismatch = false;
        if (week[0]?.time_range && dbSched.startTime) {
          const parts = week[0].time_range.split('-').map(s => s.trim().replace('.', ':'));
          if (parts.length >= 1 && parts[0] && parts[0] !== dbSched.startTime) {
            timeRangeMismatch = true;
          }
        }

        if (allDesiredTeamsPlay && isFullCycles && !timeRangeMismatch) {
          const lines = formatScheduleLines(dbSched);
          return [lines, dbSched];
        }
      }
    }
  } catch (err) {
    logger.error('[schedule] failed to load schedule from DB:', err.message);
  }

  // Ensure enough team colors are generated for desiredTeamCount
  let team_colors = await getTeamColorWeek(week_id);
  if (!team_colors || team_colors.length < desiredTeamCount) {
    await addTeamColorWeek(desiredTeamCount, week_id);
    team_colors = await getTeamColorWeek(week_id);
  }

  if (!team_colors || team_colors.length < 2) {
    return ['ยังไม่มีข้อมูลทีมในสัปดาห์นี้ (ใช้คำสั่ง randomteam ก่อน)', null];
  }

  // Parse default time_range from DB if not provided
  let weekStartTime = '17:30';
  let weekEndTime = '20:00';
  if (week[0].time_range) {
    const parts = week[0].time_range.split('-').map(s => s.trim().replace('.', ':'));
    if (parts.length >= 2) {
      weekStartTime = parts[0];
      weekEndTime = parts[1];
    } else if (parts.length === 1 && parts[0]) {
      weekStartTime = parts[0];
    }
  }

  if (startTimeStr && startTimeStr.includes('-')) {
    const parts = startTimeStr.split('-').map(s => s.trim().replace('.', ':'));
    if (parts.length >= 2) {
      startTimeStr = parts[0];
      if (!endTimeStr) endTimeStr = parts[1];
    }
  }

  if (!startTimeStr) {
    startTimeStr = weekStartTime;
  }
  if (!endTimeStr && !totalHours) {
    endTimeStr = weekEndTime;
  }

  // Pick exactly desiredTeamCount colors
  const activeColors = team_colors.slice(0, desiredTeamCount);
  const shuffledColors = shuffleArray([...activeColors]);

  // Build team list
  const teams = shuffledColors.map(t => t.color);
  const numTeams = teams.length;

  // Number of unique pairs in one round-robin cycle
  const cycleLen = (numTeams * (numTeams - 1)) / 2; // = 6 for 4 teams, 3 for 3 teams

  // Parse start time and calculate total time window
  const [startH, startM] = startTimeStr.replace('.', ':').split(':').map(Number);
  const startTotal = startH * 60 + (startM || 0);

  let calculatedTotalHours = totalHours;
  if (endTimeStr) {
    const [endH, endM] = endTimeStr.replace('.', ':').split(':').map(Number);
    let endTotal = endH * 60 + (endM || 0);
    if (endTotal < startTotal) {
      endTotal += 1440; // wrap around midnight
    }
    calculatedTotalHours = (endTotal - startTotal) / 60;
  } else if (!calculatedTotalHours) {
    calculatedTotalHours = 2.5;
  }

  const totalMinutes = calculatedTotalHours * 60;

  // Dynamic match duration calculation based on team count and time range
  if (!matchMin || isNaN(Number(matchMin)) || Number(matchMin) <= 0) {
    if (numTeams >= 4) {
      matchMin = calculatedTotalHours <= 2.5 ? 6 : 7;
    } else {
      // 3 teams: default 8 mins/match (+2 mins changeover = 10 mins/slot)
      matchMin = 8;
    }
  } else {
    matchMin = parseInt(matchMin, 10);
  }

  // Reserve minimum transition/changeover break between matches (default 2 mins/match)
  const minBreak = (breakMin !== null && breakMin !== undefined && !isNaN(Number(breakMin)) && Number(breakMin) >= 0)
    ? Number(breakMin)
    : 2;

  // Ensure every team has an equal number of matches:
  // Each cycle of cycleLen matches gives every team an equal number of matches.
  // Calculate how many full cycles fit into the available time including minBreak per match.
  const cycleSlotMinutes = cycleLen * (matchMin + minBreak);
  let fullRounds = Math.floor(totalMinutes / cycleSlotMinutes);
  if (fullRounds < 1) fullRounds = 1;

  const maxMatches = fullRounds * cycleLen;
  const actualSlotMin = totalMinutes / maxMatches;
  const calculatedBreakMin = Math.max(0, actualSlotMin - matchMin);

  // Build pool using a rotating-anchor approach (matching the reference schedule).
  //
  // Each successive round picks the NEXT team as the "anchor".
  // Within a round's cycle the anchor plays FIRST in every sub-round,
  // followed by the other two teams' match:
  //
  //   Round 1 anchor=T0:  (T0,T1),(T2,T3) | (T0,T2),(T1,T3) | (T0,T3),(T1,T2)
  //   Round 2 anchor=T1:  (T1,T0),(T2,T3) | (T1,T2),(T0,T3) | (T1,T3),(T0,T2)
  //   Round 3 anchor=T2:  (T2,T0),(T1,T3) | (T2,T1),(T0,T3) | (T2,T3),(T0,T1)
  //
  // This guarantees each round starts with a completely different team
  // and the boundary between rounds never causes a team to rest 3+ in a row.
  const pool = [];
  let poolRound = 0;
  while (pool.length < maxMatches) {
    const anchor = poolRound % numTeams;
    const others = Array.from({ length: numTeams }, (_, i) => (anchor + 2 + i) % numTeams)
      .filter(t => t !== anchor);

    for (let j = 0; j < others.length && pool.length < maxMatches; j++) {
      const opp = others[j];                        // anchor's opponent this sub-round
      const pair = others.filter((_, k) => k !== j); // the other two teams

      pool.push([anchor, opp]);                       // anchor's match first
      if (pool.length < maxMatches) {
        pool.push([pair[0], pair[1]]);                // then the other pair
      }
    }
    poolRound++;
  }

  // -----------------------------------------------------------
  // Backtracking scheduler: enforce hard constraints, guarantee round-robin unique matchups,
  // ensure distinct starting matches for each round, and perfectly balance 2-match streaks.
  // -----------------------------------------------------------
  const allPairs = [];
  for (let i = 0; i < numTeams; i++) {
    for (let j = i + 1; j < numTeams; j++) {
      allPairs.push([i, j]);
    }
  }
  // Shuffle the candidate matchup pairs to randomise search order and schedule variety
  shuffleArray(allPairs);

  let bestSchedule = null;
  let bestMaxStreak = Infinity;
  let bestStreakDiff = Infinity;
  let steps = 0;
  const maxSteps = 200000;

  const schedule = [];
  const totalRoundsCount = Math.ceil(maxMatches / cycleLen);
  const roundUsedPairs = Array.from({ length: totalRoundsCount }, () => new Set());
  const roundStarts = new Array(totalRoundsCount).fill(-1);

  const consecPlay = new Array(numTeams).fill(0);
  const lastPlay = new Array(numTeams).fill(-2);
  const consecRest = new Array(numTeams).fill(0);
  const lastRest = new Array(numTeams).fill(-2);

  function backtrack(slot) {
    steps++;
    if (steps > maxSteps) return false;

    if (slot === maxMatches) {
      // Calculate streaks for the candidate schedule
      const streaks = new Array(numTeams).fill(0);
      const tempPlay = new Array(numTeams).fill(0);
      const tempLast = new Array(numTeams).fill(-2);
      for (let s = 0; s < maxMatches; s++) {
        const [a, b] = schedule[s];
        for (let t = 0; t < numTeams; t++) {
          if (t === a || t === b) {
            if (tempLast[t] === s - 1) {
              tempPlay[t]++;
              if (tempPlay[t] === 2) streaks[t]++;
            } else {
              tempPlay[t] = 1;
            }
            tempLast[t] = s;
          }
        }
      }

      const maxStr = Math.max(...streaks);
      const minStr = Math.min(...streaks);
      const diff = maxStr - minStr;

      if (maxStr < bestMaxStreak || (maxStr === bestMaxStreak && diff < bestStreakDiff)) {
        bestMaxStreak = maxStr;
        bestStreakDiff = diff;
        bestSchedule = [...schedule];
      }

      // If we find a perfectly balanced solution (all teams play exactly the same number of streaks), stop early
      if (maxStr <= 2 && diff === 0) {
        return true;
      }
      return false;
    }

    const roundIdx = Math.floor(slot / cycleLen);
    const isRoundStart = (slot % cycleLen === 0);

    for (let pIdx = 0; pIdx < allPairs.length; pIdx++) {
      if (roundUsedPairs[roundIdx].has(pIdx)) continue;

      const [a, b] = allPairs[pIdx];
      // Ensure distinct starting matchups for each round
      if (isRoundStart) {
        let duplicateStart = false;
        for (let r = 0; r < roundIdx; r++) {
          if (roundStarts[r] === pIdx) {
            duplicateStart = true;
            break;
          }
        }
        if (duplicateStart) continue;
      }

      // Hard play constraint: no team plays 3 in a row
      const aC = lastPlay[a] === slot - 1 ? consecPlay[a] : 0;
      const bC = lastPlay[b] === slot - 1 ? consecPlay[b] : 0;
      if (aC >= 2 || bC >= 2) continue;

      // Hard constraint: no consecutive matches can have the exact same pairing
      if (slot > 0) {
        const [prevA, prevB] = schedule[slot - 1];
        if ((a === prevA && b === prevB) || (a === prevB && b === prevA)) {
          continue;
        }
      }

      // Special constraint: match 1 and match 2 of each round must not share any team (no 2-streak between match 1 & 2)
      if (numTeams >= 4 && slot % cycleLen === 1) {
        const [prevA, prevB] = schedule[slot - 1];
        if (a === prevA || a === prevB || b === prevA || b === prevB) continue;
      }

      // Special constraint: opening match of Round 2 must not share any team with Round 1 opening match
      if (numTeams >= 4 && slot === cycleLen) {
        const [prevStartA, prevStartB] = schedule[0];
        if (a === prevStartA || a === prevStartB || b === prevStartA || b === prevStartB) continue;
      }

      // Hard rest constraint: no team rests 3 in a row
      let restOk = true;
      for (let t = 0; t < numTeams; t++) {
        if (t === a || t === b) continue;
        const tR = lastRest[t] === slot - 1 ? consecRest[t] : 0;
        if (tR >= 2) { restOk = false; break; }
      }
      if (!restOk) continue;

      // Save state
      const prevPlay = [...consecPlay];
      const prevLastPlay = [...lastPlay];
      const prevRest = [...consecRest];
      const prevLastRest = [...lastRest];

      // Update state
      for (let t = 0; t < numTeams; t++) {
        if (t === a || t === b) {
          consecPlay[t] = lastPlay[t] === slot - 1 ? consecPlay[t] + 1 : 1;
          lastPlay[t] = slot;
          consecRest[t] = 0;
        } else {
          consecRest[t] = lastRest[t] === slot - 1 ? consecRest[t] + 1 : 1;
          lastRest[t] = slot;
          consecPlay[t] = 0;
        }
      }

      schedule.push([a, b]);
      roundUsedPairs[roundIdx].add(pIdx);
      if (isRoundStart) roundStarts[roundIdx] = pIdx;

      if (backtrack(slot + 1)) return true;

      // Backtrack
      schedule.pop();
      roundUsedPairs[roundIdx].delete(pIdx);
      if (isRoundStart) roundStarts[roundIdx] = -1;
      for (let t = 0; t < numTeams; t++) {
        consecPlay[t] = prevPlay[t];
        lastPlay[t] = prevLastPlay[t];
        consecRest[t] = prevRest[t];
        lastRest[t] = prevLastRest[t];
      }
    }
    return false;
  }

  let matchups = [];
  if (numTeams === 3) {
    const cycle = [
      [0, 1],
      [1, 2],
      [2, 0]
    ];
    for (let i = 0; i < maxMatches; i++) {
      matchups.push([...cycle[i % 3]]);
    }
  } else {
    backtrack(0);

    if (bestSchedule) {
      matchups = bestSchedule;
    } else {
      // Fallback: original rotating anchor generator
      logger.warn('[schedule] Backtracking solver found no solution, using fallback rotating anchor pool.');
      const pool = [];
      let poolRound = 0;
      while (pool.length < maxMatches) {
        const anchor = poolRound % numTeams;
        const others = Array.from({ length: numTeams }, (_, i) => (anchor + 2 + i) % numTeams)
          .filter(t => t !== anchor);

        for (let j = 0; j < others.length && pool.length < maxMatches; j++) {
          const opp = others[j];
          const pair = others.filter((_, k) => k !== j);

          pool.push([anchor, opp]);
          if (pool.length < maxMatches) {
            pool.push([pair[0], pair[1]]);
          }
        }
        poolRound++;
      }
      matchups = pool;
    }
  }

  // Post-process matchups to ensure consecutive playing teams remain on the same side (Left or Right)
  for (let i = 1; i < matchups.length; i++) {
    const [prevA, prevB] = matchups[i - 1];
    const [currA, currB] = matchups[i];

    if (currB === prevA || currA === prevB) {
      matchups[i] = [currB, currA];
    }
  }

  const totalRounds = Math.ceil(maxMatches / cycleLen);

  const toTime = (mins) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // Format output
  const thaiMonthsShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const dateObj = new Date(week[0].date || Date.now());
  const dateStr = `${dateObj.getDate()} ${thaiMonthsShort[dateObj.getMonth()]} ${String(dateObj.getFullYear()).slice(-2)}`;
  const displayEndTime = endTimeStr ? endTimeStr.replace('.', ':') : toTime(Math.round(startTotal + matchups.length * actualSlotMin));

  const lines = [];
  lines.push(`⚽ ตารางแข่งขัน เสาร์ที่ ${dateStr}`);
  const breakInfo = calculatedBreakMin > 0 ? ` (พัก ~${calculatedBreakMin.toFixed(1).replace('.0', '')} นาที)` : '';
  lines.push(`🕐 เริ่ม ${startTimeStr} น. - ${displayEndTime} น. | ${matchMin} นาที/แมตช์${breakInfo}`);
  const displayHours = Number(calculatedTotalHours.toFixed(2));
  const matchesPerTeam = Math.round((matchups.length * 2) / numTeams);
  lines.push(`👥 ${numTeams} ทีม | ${matchups.length} แมตช์ (${totalRounds} รอบ • ทีมละ ${matchesPerTeam} แมตช์เท่ากัน) | ${displayHours} ชม.`);
  lines.push(`⚠️ เล่น/พักติดต่อกันได้สูงสุด 2 แมตช์เท่านั้น`);
  lines.push('─'.repeat(30));

  matchups.forEach((m, i) => {
    // New round header every cycleLen matches
    if (i % cycleLen === 0) {
      lines.push(`▶ รอบที่ ${Math.floor(i / cycleLen) + 1}`);
    }

    const slotStart = Math.round(startTotal + i * actualSlotMin);
    const resting = teams.filter((_, idx) => idx !== m[0] && idx !== m[1]).join(', ');
    lines.push(`[${i + 1}] ${toTime(slotStart)}-${toTime(slotStart + matchMin)}  ${teams[m[0]]} vs ${teams[m[1]]}  (พัก: ${resting})`);
  });

  lines.push('─'.repeat(30));
  lines.push(`สิ้นสุด ${displayEndTime} น.`);

  // ── Build schedule JSON ──
  const scheduleMatches = matchups.map((m, i) => {
    const slotStart = Math.round(startTotal + i * actualSlotMin);
    return {
      matchNo: i + 1,
      round: Math.floor(i / cycleLen) + 1,
      startTime: toTime(slotStart),
      endTime: toTime(slotStart + matchMin),
      teamA: teams[m[0]],
      teamAId: shuffledColors[m[0]].id,
      teamB: teams[m[1]],
      teamBId: shuffledColors[m[1]].id,
      resting: teams.filter((_, idx) => idx !== m[0] && idx !== m[1])
    };
  });

  // ── Save to match_stat_tbl & Sync to find current & next match ──
  let currentMatchNo = 1;
  let nextMatchNo = 2;
  let dbMatches = [];
  try {
    await saveScheduleToDb(week_id, scheduleMatches, forceRegen);

    const rows = await queryMatchWeek(week_id);
    if (rows && rows.length > 0) {
      dbMatches = rows;
      const inProg = dbMatches.find(r => r.status === 'in_progress');
      if (inProg) {
        currentMatchNo = inProg.match_num;
        const nextSched = dbMatches.find(r => r.status === 'scheduled' && r.match_num > currentMatchNo);
        nextMatchNo = nextSched ? nextSched.match_num : Math.min(currentMatchNo + 1, scheduleMatches.length);
      } else {
        const firstSched = dbMatches.find(r => r.status === 'scheduled');
        if (firstSched) {
          currentMatchNo = firstSched.match_num;
          const nextSched = dbMatches.find(r => r.status === 'scheduled' && r.match_num > currentMatchNo);
          nextMatchNo = nextSched ? nextSched.match_num : Math.min(currentMatchNo + 1, scheduleMatches.length);
        } else {
          const maxDbMatchNum = Math.max(...dbMatches.map(r => r.match_num));
          currentMatchNo = maxDbMatchNum;
          nextMatchNo = Math.min(maxDbMatchNum + 1, scheduleMatches.length);
        }
      }
    }
  } catch (err) {
    logger.error('[schedule] failed to save/sync with match_stat_tbl:', err.message);
  }

  const currentMatch = scheduleMatches.find(m => m.matchNo === currentMatchNo) || scheduleMatches[0];
  const nextMatch = scheduleMatches.find(m => m.matchNo === nextMatchNo) || null;

  let imageUrl = null;
  try {
    const imgTpl = await getTemplate('schedule', 'header');
    imageUrl = imgTpl ? imgTpl.url : null;
  } catch (err) {
    logger.error('[schedule] failed to query template image:', err.message);
  }

  const scheduleJson = {
    generatedAt: new Date().toISOString(),
    weekId: week_id,
    date: dateStr,
    startTime: startTimeStr,
    matchMinutes: matchMin,
    breakMinutes: Number(calculatedBreakMin.toFixed(1)),
    totalHours: Number(calculatedTotalHours.toFixed(2)),
    teams: teams,
    totalMatches: scheduleMatches.length,
    totalRounds: totalRounds,
    endTime: displayEndTime,
    currentMatch,
    nextMatch,
    imageUrl,
    dbMatches,
    matches: scheduleMatches
  };

  try {
    const jsonPath = path.join(__dirname, 'schedule.json');
    fs.writeFileSync(jsonPath, JSON.stringify(scheduleJson, null, 2), 'utf8');
    logger.info(`[schedule] saved → current: match ${currentMatchNo}, next: match ${nextMatchNo}`);
  } catch (err) {
    logger.error('[schedule] failed to save JSON:', err.message);
  }

  return [lines.join('\n'), scheduleJson];
}

function parseExtendArgs(param = '') {
  const tokens = String(param || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { mode: 'empty' };

  for (const rawToken of tokens) {
    const token = rawToken.trim();

    // 1. Explicit end time: HH:MM or HH.MM (e.g. 21:00, 20.30)
    const timeMatch = token.match(/^(\d{1,2})[:.](\d{2})$/);
    if (timeMatch) {
      const h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return { mode: 'end_time', endTimeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
      }
    }

    // 2. Explicit rounds: e.g. 1รอบ, 2r, 1round
    const roundMatch = token.match(/^(\d+)\s*(?:รอบ|r|round|rounds)$/i);
    if (roundMatch) {
      const rounds = parseInt(roundMatch[1], 10);
      if (rounds > 0) return { mode: 'rounds', extraRounds: Math.min(rounds, 6) };
    }

    // 3. Explicit match count: e.g. 6นัด, 4แมตช์, 6matches
    const matchCountMatch = token.match(/^(\d+)\s*(?:นัด|แมตช์|match|matches)$/i);
    if (matchCountMatch) {
      const count = parseInt(matchCountMatch[1], 10);
      if (count > 0) return { mode: 'matches', extraMatches: Math.min(count, 36) };
    }

    // 4. Hours: e.g. 1ชม, +1h, 1.5ชม
    const hourMatch = token.match(/^\+?(\d+(?:\.\d+)?)\s*(?:ชม\.?|ชั่วโมง|h|hr|hrs|hour|hours)$/i);
    if (hourMatch) {
      const hrs = parseFloat(hourMatch[1]);
      if (hrs > 0) return { mode: 'minutes', addMinutes: Math.min(Math.round(hrs * 60), 360) };
    }

    // 5. Minutes (default for bare numbers and +Nm / Nนาที): e.g. 30, +30, 30m, +45นาที
    const minMatch = token.match(/^\+?(\d+)\s*(?:m|min|mins|นาที)?$/i);
    if (minMatch) {
      const mins = parseInt(minMatch[1], 10);
      if (mins > 0) return { mode: 'minutes', addMinutes: Math.min(mins, 360) };
    }
  }

  return { mode: 'invalid' };
}

function solveExtendedMatchups(numTeams, existingPairs, extraMatches) {
  if (extraMatches <= 0 || numTeams < 2) return [];

  const cycleLen = (numTeams * (numTeams - 1)) / 2;
  const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

  const allPairs = [];
  for (let i = 0; i < numTeams; i++) {
    for (let j = i + 1; j < numTeams; j++) {
      allPairs.push([i, j]);
    }
  }
  shuffleArray(allPairs);

  const baseLen = existingPairs.length;
  const consecPlay = new Array(numTeams).fill(0);
  const lastPlay = new Array(numTeams).fill(-2);
  const consecRest = new Array(numTeams).fill(0);
  const lastRest = new Array(numTeams).fill(-2);
  const teamMatchCounts = new Array(numTeams).fill(0);
  const roundUsedPairs = new Map();

  for (let s = 0; s < baseLen; s++) {
    const [a, b] = existingPairs[s];
    const rIdx = Math.floor(s / cycleLen);
    if (!roundUsedPairs.has(rIdx)) roundUsedPairs.set(rIdx, new Set());
    roundUsedPairs.get(rIdx).add(pairKey(a, b));

    teamMatchCounts[a]++;
    teamMatchCounts[b]++;
    for (let t = 0; t < numTeams; t++) {
      if (t === a || t === b) {
        consecPlay[t] = lastPlay[t] === s - 1 ? consecPlay[t] + 1 : 1;
        lastPlay[t] = s;
        consecRest[t] = 0;
      } else {
        consecRest[t] = lastRest[t] === s - 1 ? consecRest[t] + 1 : 1;
        lastRest[t] = s;
        consecPlay[t] = 0;
      }
    }
  }

  const totalTargetMatches = baseLen + extraMatches;
  const optimalMatchSpread = ((totalTargetMatches * 2) % numTeams === 0) ? 0 : 1;

  let bestSchedule = null;
  let bestMatchSpread = Infinity;
  let bestStreakSpread = Infinity;
  let bestMaxStreak = Infinity;
  let steps = 0;
  const maxSteps = 200000;
  const chosen = [];

  function evaluateSolution() {
    const minCnt = Math.min(...teamMatchCounts);
    const maxCnt = Math.max(...teamMatchCounts);
    const matchSpread = maxCnt - minCnt;

    const streaks = new Array(numTeams).fill(0);
    const tPlay = new Array(numTeams).fill(0);
    const tLast = new Array(numTeams).fill(-2);
    for (let s = 0; s < chosen.length; s++) {
      const [a, b] = chosen[s];
      for (let t = 0; t < numTeams; t++) {
        if (t === a || t === b) {
          tPlay[t] = tLast[t] === s - 1 ? tPlay[t] + 1 : 1;
          if (tPlay[t] === 2) streaks[t]++;
          tLast[t] = s;
        }
      }
    }
    const maxStr = Math.max(...streaks);
    const streakSpread = maxStr - Math.min(...streaks);

    const isBetter =
      matchSpread < bestMatchSpread ||
      (matchSpread === bestMatchSpread && streakSpread < bestStreakSpread) ||
      (matchSpread === bestMatchSpread && streakSpread === bestStreakSpread && maxStr < bestMaxStreak);

    if (isBetter) {
      bestMatchSpread = matchSpread;
      bestStreakSpread = streakSpread;
      bestMaxStreak = maxStr;
      bestSchedule = chosen.map(p => [...p]);
    }

    return matchSpread <= optimalMatchSpread && streakSpread <= 1;
  }

  function backtrack(offset) {
    steps++;
    if (steps > maxSteps) return false;
    if (offset === extraMatches) {
      return evaluateSolution();
    }

    const slot = baseLen + offset;
    const roundIdx = Math.floor(slot / cycleLen);
    if (!roundUsedPairs.has(roundIdx)) roundUsedPairs.set(roundIdx, new Set());
    const usedSet = roundUsedPairs.get(roundIdx);

    const prevPair = offset > 0
      ? chosen[offset - 1]
      : (baseLen > 0 ? existingPairs[baseLen - 1] : null);

    // Prioritize pairs whose teams currently have fewer matches to converge immediately on fair totals
    const candidates = allPairs
      .filter(([a, b]) => !usedSet.has(pairKey(a, b)))
      .sort(([a1, b1], [a2, b2]) => (teamMatchCounts[a1] + teamMatchCounts[b1]) - (teamMatchCounts[a2] + teamMatchCounts[b2]));

    for (const [a, b] of candidates) {
      if ((lastPlay[a] === slot - 1 ? consecPlay[a] : 0) >= 2) continue;
      if ((lastPlay[b] === slot - 1 ? consecPlay[b] : 0) >= 2) continue;

      if (prevPair && ((a === prevPair[0] && b === prevPair[1]) || (a === prevPair[1] && b === prevPair[0]))) {
        continue;
      }

      let restOk = true;
      for (let t = 0; t < numTeams; t++) {
        if (t === a || t === b) continue;
        if ((lastRest[t] === slot - 1 ? consecRest[t] : 0) >= 2) {
          restOk = false;
          break;
        }
      }
      if (!restOk) continue;

      const prevPlay = [...consecPlay];
      const prevLastPlay = [...lastPlay];
      const prevRest = [...consecRest];
      const prevLastRest = [...lastRest];
      const pKey = pairKey(a, b);

      for (let t = 0; t < numTeams; t++) {
        if (t === a || t === b) {
          consecPlay[t] = lastPlay[t] === slot - 1 ? consecPlay[t] + 1 : 1;
          lastPlay[t] = slot;
          consecRest[t] = 0;
        } else {
          consecRest[t] = lastRest[t] === slot - 1 ? consecRest[t] + 1 : 1;
          lastRest[t] = slot;
          consecPlay[t] = 0;
        }
      }
      teamMatchCounts[a]++;
      teamMatchCounts[b]++;
      usedSet.add(pKey);
      chosen.push([a, b]);

      if (backtrack(offset + 1)) return true;

      chosen.pop();
      usedSet.delete(pKey);
      teamMatchCounts[a]--;
      teamMatchCounts[b]--;
      for (let t = 0; t < numTeams; t++) {
        consecPlay[t] = prevPlay[t];
        lastPlay[t] = prevLastPlay[t];
        consecRest[t] = prevRest[t];
        lastRest[t] = prevLastRest[t];
      }
    }
    return false;
  }

  backtrack(0);

  let matchups = bestSchedule;
  if (!matchups) {
    // Greedy fallback when existing DB history already has manually-created streak constraints
    logger.warn('[extendSchedule] Strict backtrack found no valid continuation, using greedy balanced fallback.');
    matchups = [];
    for (let offset = 0; offset < extraMatches; offset++) {
      const slot = baseLen + offset;
      const roundIdx = Math.floor(slot / cycleLen);
      if (!roundUsedPairs.has(roundIdx)) roundUsedPairs.set(roundIdx, new Set());
      const usedSet = roundUsedPairs.get(roundIdx);
      const prevPair = offset > 0
        ? matchups[offset - 1]
        : (baseLen > 0 ? existingPairs[baseLen - 1] : null);

      const poolPairs = allPairs.filter(([a, b]) => !usedSet.has(pairKey(a, b)));
      const searchList = poolPairs.length > 0 ? poolPairs : allPairs;

      let picked = searchList[0];
      let bestScore = Infinity;
      for (const [a, b] of searchList) {
        let penalty = (teamMatchCounts[a] + teamMatchCounts[b]) * 10;
        if ((lastPlay[a] === slot - 1 ? consecPlay[a] : 0) >= 2) penalty += 1000;
        if ((lastPlay[b] === slot - 1 ? consecPlay[b] : 0) >= 2) penalty += 1000;
        for (let t = 0; t < numTeams; t++) {
          if (t !== a && t !== b && (lastRest[t] === slot - 1 ? consecRest[t] : 0) >= 2) penalty += 500;
        }
        if (prevPair && ((a === prevPair[0] && b === prevPair[1]) || (a === prevPair[1] && b === prevPair[0]))) {
          penalty += 2000;
        }
        if (penalty < bestScore) {
          bestScore = penalty;
          picked = [a, b];
        }
      }

      const [pa, pb] = picked;
      usedSet.add(pairKey(pa, pb));
      teamMatchCounts[pa]++;
      teamMatchCounts[pb]++;
      for (let t = 0; t < numTeams; t++) {
        if (t === pa || t === pb) {
          consecPlay[t] = lastPlay[t] === slot - 1 ? consecPlay[t] + 1 : 1;
          lastPlay[t] = slot;
          consecRest[t] = 0;
        } else {
          consecRest[t] = lastRest[t] === slot - 1 ? consecRest[t] + 1 : 1;
          lastRest[t] = slot;
          consecPlay[t] = 0;
        }
      }
      matchups.push([pa, pb]);
    }
  }

  // Keep continuing teams on the same Left/Right side from the last existing match onward
  for (let i = 0; i < matchups.length; i++) {
    const prev = i === 0 ? (baseLen > 0 ? existingPairs[baseLen - 1] : null) : matchups[i - 1];
    if (!prev) continue;
    const [prevA, prevB] = prev;
    const [currA, currB] = matchups[i];
    if (currB === prevA || currA === prevB) {
      matchups[i] = [currB, currA];
    }
  }

  return matchups;
}

async function extendSchedule(param = '', options = {}) {
  const parsed = parseExtendArgs(param);
  if (parsed.mode === 'empty' || parsed.mode === 'invalid') {
    return {
      success: false,
      message: '⏱️ รูปแบบคำสั่งไม่ถูกต้อง ลองใช้เช่น:\n• /extend 30 หรือ /extend +30m (เพิ่มเวลาเป็นนาที)\n• /extend 21:00 (ต่อเวลาถึง 21:00 น.)\n• /extend 1รอบ หรือ /extend 6นัด'
    };
  }

  let week;
  const requestedWeekId = options && Number(options.weekId) > 0 ? Number(options.weekId) : 0;
  if (requestedWeekId > 0) {
    await ensureWeekTimeColumn();
    week = await executeQuery(
      "SELECT id, number, TO_CHAR(date, 'FMDD Mon YYYY') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl WHERE id = ? LIMIT 1",
      [requestedWeekId]
    );
  } else {
    week = await queryWeekID(0);
  }
  if (!week || week.length === 0) {
    return { success: false, message: 'ยังไม่มีข้อมูลสัปดาห์นี้' };
  }
  const week_id = week[0].id;

  const dbSched = await getScheduleFromDb(week_id);
  if (!dbSched || !Array.isArray(dbSched.matches) || dbSched.matches.length === 0) {
    return { success: false, message: 'ยังไม่มีตารางแข่งขันเดิม กรุณาใช้คำสั่ง /schedule ก่อนนะครับ' };
  }

  const teamColors = await getTeamColorWeek(week_id);
  const playingSet = new Set(dbSched.teams || []);
  const playingTeamList = (teamColors || []).filter(c => playingSet.size === 0 || playingSet.has(c.color));
  if (playingTeamList.length < 2) {
    return { success: false, message: 'ไม่พบข้อมูลทีมในตารางแข่งขันเดิม' };
  }

  const numTeams = playingTeamList.length;
  const cycleLen = (numTeams * (numTeams - 1)) / 2;
  const idToIdx = new Map();
  playingTeamList.forEach((t, idx) => idToIdx.set(t.id, idx));

  const existingPairs = [];
  let maxMatchNum = 0;
  for (const r of dbSched.dbMatches || []) {
    if (r.match_num > maxMatchNum) maxMatchNum = r.match_num;
    const ia = idToIdx.get(r.team_a_id);
    const ib = idToIdx.get(r.team_b_id);
    if (ia !== undefined && ib !== undefined) {
      existingPairs.push([ia, ib]);
    }
  }

  const matches = dbSched.matches;
  const firstMatch = matches[0];
  const lastMatch = matches[matches.length - 1];
  const firstStartTotal = parseTimeToMins(firstMatch.startTime) ?? (17 * 60 + 30);
  let lastStartTotal = parseTimeToMins(lastMatch.startTime) ?? firstStartTotal;
  if (lastStartTotal < firstStartTotal) lastStartTotal += 1440;
  let lastEndTotal = parseTimeToMins(lastMatch.endTime) ?? (lastStartTotal + (dbSched.matchMinutes || 7));
  if (lastEndTotal < lastStartTotal) lastEndTotal += 1440;

  const matchMin = dbSched.matchMinutes || 7;
  const breakMin = (typeof dbSched.breakMinutes === 'number' && dbSched.breakMinutes >= 0) ? dbSched.breakMinutes : 2;
  const avgStep = (matches.length >= 2 && lastStartTotal > firstStartTotal)
    ? Math.max(matchMin, (lastStartTotal - firstStartTotal) / (matches.length - 1))
    : (matchMin + breakMin);

  const nextStartTotal = Math.max(
    lastEndTotal + (breakMin > 0 ? 1 : 0),
    Math.round(lastStartTotal + avgStep)
  );

  // Align base end time with week_tbl.time_range end if it sits within the trailing gap after the last match
  let baseEndTotal = lastEndTotal;
  if (week[0].time_range && week[0].time_range.includes('-')) {
    const parts = week[0].time_range.split('-').map(s => s.trim());
    let weekEnd = parseTimeToMins(parts[1]);
    if (weekEnd !== null) {
      if (weekEnd < firstStartTotal) weekEnd += 1440;
      if (weekEnd >= lastEndTotal && weekEnd <= lastEndTotal + Math.ceil(avgStep - matchMin) + 2) {
        baseEndTotal = weekEnd;
      }
    }
  }

  let extraMatches = 0;
  if (parsed.mode === 'minutes' || parsed.mode === 'end_time') {
    let targetEndTotal;
    if (parsed.mode === 'minutes') {
      targetEndTotal = baseEndTotal + parsed.addMinutes;
    } else {
      targetEndTotal = parseTimeToMins(parsed.endTimeStr);
      if (targetEndTotal <= firstStartTotal && targetEndTotal < 360) targetEndTotal += 1440;
      if (targetEndTotal <= lastEndTotal) {
        return {
          success: false,
          message: `⚠️ เวลาสิ้นสุดใหม่ (${parsed.endTimeStr} น.) ต้องมากกว่าเวลาจบเดิม (${lastMatch.endTime} น.)`
        };
      }
    }

    let k = 0;
    while (k < 36) {
      const slotStart = Math.round(nextStartTotal + k * avgStep);
      if (slotStart + matchMin <= targetEndTotal) {
        k++;
      } else {
        break;
      }
    }
    if (k === 0) {
      const minNeeded = (nextStartTotal - baseEndTotal) + matchMin;
      return {
        success: false,
        message: `⚠️ เวลาที่เพิ่มยังไม่พอสำหรับเพิ่ม 1 แมตช์ (ต้องเพิ่มอย่างน้อย ${Math.max(matchMin, minNeeded)} นาที หรือสิ้นสุดตั้งแต่ ${formatMinsToTime(nextStartTotal + matchMin)} น. ขึ้นไป)`
      };
    }
    extraMatches = k;
  } else if (parsed.mode === 'rounds') {
    extraMatches = parsed.extraRounds * cycleLen;
  } else if (parsed.mode === 'matches') {
    extraMatches = parsed.extraMatches;
  }

  extraMatches = Math.max(1, Math.min(extraMatches, 36));

  const newMatchups = solveExtendedMatchups(numTeams, existingPairs, extraMatches);
  await ensureMatchStatScheduleColumns();

  const hasUnfinished = (dbSched.dbMatches || []).some(r => r.status !== 'finished');
  const addedMatches = [];
  let extendedEndTotal = lastEndTotal;
  for (let i = 0; i < newMatchups.length; i++) {
    const [a, b] = newMatchups[i];
    const slotStart = Math.round(nextStartTotal + i * avgStep);
    const slotEnd = slotStart + matchMin;
    extendedEndTotal = slotEnd;

    const matchNum = maxMatchNum + 1 + i;
    const round = Math.floor((maxMatchNum + i) / cycleLen) + 1;
    const startTime = formatMinsToTime(slotStart);
    const endTime = formatMinsToTime(slotEnd);
    const teamA = playingTeamList[a];
    const teamB = playingTeamList[b];
    const matchStatus = (i === 0 && !hasUnfinished) ? 'in_progress' : 'scheduled';

    await insertScheduleMatchRow(week_id, matchNum, round, startTime, endTime, teamA.id, teamB.id, matchStatus);
    addedMatches.push({
      matchNo: matchNum,
      round,
      startTime,
      endTime,
      teamA: teamA.color,
      teamAId: teamA.id,
      teamB: teamB.color,
      teamBId: teamB.id,
      status: matchStatus
    });
  }

  const extendedEndTime = formatMinsToTime(extendedEndTotal);
  try {
    await ensureWeekTimeColumn();
    await executeQuery("UPDATE week_tbl SET time_range = ? WHERE id = ?", [`${dbSched.startTime}-${extendedEndTime}`, week_id]);
  } catch (err) {
    logger.warn('[extendSchedule] failed to update week_tbl.time_range:', err.message);
  }

  const updatedSched = await getScheduleFromDb(week_id);
  if (updatedSched) {
    try {
      const jsonPath = path.join(__dirname, 'schedule.json');
      fs.writeFileSync(jsonPath, JSON.stringify(updatedSched, null, 2), 'utf8');
    } catch (err) {
      logger.warn('[extendSchedule] failed to update schedule.json:', err.message);
    }
  }

  logger.info(`[extendSchedule] Appended ${addedMatches.length} matches for week ${week_id} (new end: ${extendedEndTime})`);
  return {
    success: true,
    sched: updatedSched,
    addedMatches,
    extendedEndTime
  };
}

async function getMatchScorersAndAssists(matchId, assets, groupId) {
  const scorerQ = `SELECT member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id, match_goal_tbl.status as statusid, count(*) as goal
    FROM match_goal_tbl
    JOIN member_tbl ON match_goal_tbl.member_id = member_tbl.id
    WHERE match_goal_tbl.match_id = ${matchId} AND match_goal_tbl.status <= 2
    GROUP BY member_tbl.id, goal_status_tbl.status, match_goal_tbl.status, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id`;

  const assistQ = `SELECT member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id, count(*) as assist
    FROM match_goal_tbl
    JOIN member_tbl ON match_goal_tbl.member_id = member_tbl.id
    WHERE match_goal_tbl.match_id = ${matchId} AND match_goal_tbl.status = 3
    GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.admin, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id`;

  const [scorerRows, assistRows] = await Promise.all([
    executeQuery(scorerQ),
    executeQuery(assistQ)
  ]);

  await Promise.all([
    ...scorerRows.map(r => ensureMemberPicture(r, groupId)),
    ...assistRows.map(r => ensureMemberPicture(r, groupId))
  ]);

  const scorers = scorerRows.map(r => {
    const info = resolveMemberDisplayInfo(r, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
    return {
      name: info.name,
      goal: r.goal,
      ownGoal: r.statusid === 2,
      badgeUrl: info.badgeUrl,
      badgeSize: info.badgeSize,
      nameColor: info.nameColor,
      hofCount: info.hofCount,
      hofBadgeUrl: info.hofBadgeUrl,
      hofBadgeSize: info.hofBadgeSize,
      hofBadges: info.hofBadges,
      pictureUrl: info.pictureUrl
    };
  });

  const assists = assistRows.map(r => {
    const info = resolveMemberDisplayInfo(r, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
    return {
      name: info.name,
      assist: r.assist,
      badgeUrl: info.badgeUrl,
      badgeSize: info.badgeSize,
      nameColor: info.nameColor,
      hofCount: info.hofCount,
      hofBadgeUrl: info.hofBadgeUrl,
      hofBadgeSize: info.hofBadgeSize,
      hofBadges: info.hofBadges,
      pictureUrl: info.pictureUrl
    };
  });

  return { scorers, assists };
}

// ── Live current/next match lookup ──
// Reads the schedule directly from MySQL (match_stat_tbl) as SSOT
async function getCurrentMatch(groupId = null) {
  const week = await queryWeekID();
  if (!week || week.length === 0) return null;
  const weekId = week[0].id;

  // 1. Primary: Load schedule directly from MySQL (match_stat_tbl)
  const sched = await getScheduleFromDb(weekId);
  if (!sched || !sched.matches || sched.matches.length === 0) return null;

  const schedMatches = sched.matches;
  const dbMatches = sched.dbMatches || [];
  const currentMatchNo = sched.currentMatch ? sched.currentMatch.matchNo : 1;
  const nextMatchNo = sched.nextMatch ? sched.nextMatch.matchNo : Math.min(2, schedMatches.length);
  const currentMatch = sched.currentMatch;
  const nextMatch = sched.nextMatch;
  const matchStatus = sched.matchStatus || 'scheduled';
  const currentDbRow = dbMatches.find(r => r.match_num === currentMatchNo) || null;

  const nextMatch2No = Math.min(currentMatchNo + 2, schedMatches.length);
  const nextMatch2 = (nextMatch2No !== currentMatchNo && nextMatch2No !== nextMatchNo)
    ? (schedMatches.find(m => m.matchNo === nextMatch2No) || null)
    : null;

  // ── Live score & recent match details (last 3 played matches) ──
  let score = null;
  let scorers = [];
  let assists = [];
  const recentMatchDetails = {};

  const assets = await fetchDisplayAssets();

  if (currentDbRow) {
    if (matchStatus === 'in_progress' || matchStatus === 'all_finished' || currentDbRow.status === 'finished') {
      score = {
        teamA: currentDbRow.team_a_goal ?? 0,
        teamB: currentDbRow.team_b_goal ?? 0
      };
    } else if (matchStatus === 'scheduled') {
      score = null;
    } else if (currentDbRow.team_a_goal !== null && currentDbRow.team_a_goal !== undefined) {
      score = {
        teamA: currentDbRow.team_a_goal ?? 0,
        teamB: currentDbRow.team_b_goal ?? 0
      };
    }
  }

  if (dbMatches && dbMatches.length > 0) {
    // Sort descending by match_num to pick the latest 3 played matches
    const playedDbMatches = dbMatches.filter(r => r.status === 'finished' || r.status === 'in_progress' || (r.status === undefined && r.team_a_goal !== null && r.team_a_goal !== undefined));
    const sortedDbMatches = [...playedDbMatches].sort((a, b) => b.match_num - a.match_num);
    const recentDbMatches = sortedDbMatches.slice(0, 3);

    for (const matchRow of recentDbMatches) {
      const details = await getMatchScorersAndAssists(matchRow.id, assets, groupId);
      recentMatchDetails[matchRow.match_num] = details;
      if (currentDbRow && matchRow.id === currentDbRow.id) {
        scorers = details.scorers;
        assists = details.assists;
      }
    }
  }

  // ── Week table (team, GD, pts) ──
  let table = [];
  if (week && week.length > 0) {
    const tableRows = await queryTableWeek(week[0].id);
    if (tableRows && tableRows.length > 0) {
      table = tableRows.map(r => ({
        team: r.color,
        w: r.w,
        d: r.d,
        l: r.l,
        gd: Number(r.G ?? r.g ?? 0) - Number(r.A ?? r.a ?? 0),
        pts: r.pts
      }));
    }
  }

  const imgTpl = await getTemplate('live', 'header');
  const imageUrl = imgTpl ? imgTpl.url : null;

  const webLiveUrl = getLiveWebUrl();
  return { sched, currentMatch, nextMatch, nextMatch2, score, scorers, assists, table, dbMatches, recentMatchDetails, weekId: sched.weekId, date: sched.date, imageUrl, teamColors: assets.teamColors, webLiveUrl, matchStatus };
}

async function getTheme() {
  try {
    const query = "SELECT value FROM template_tpl WHERE name = 'theme'";
    const result = await executeQuery(query);
    if (result && result.length > 0) {
      return result[0].value;
    }
  } catch (err) {
    logger.error('Failed to get theme, defaulting to black:', err.message);
  }
  return 'black';
}

async function setTheme(themeName) {
  const theme = themeName.toLowerCase() === 'white' ? 'white' : 'black';
  const checkQuery = "SELECT id FROM template_tpl WHERE name = 'theme'";
  const rows = await executeQuery(checkQuery);
  if (rows.length > 0) {
    const updateQuery = "UPDATE template_tpl SET value = ? WHERE name = 'theme'";
    return await executeQuery(updateQuery, [theme]);
  } else {
    const insertQuery = "INSERT INTO template_tpl (name, value) VALUES ('theme', ?)";
    return await executeQuery(insertQuery, [theme]);
  }
}

async function syncHofRecords(type, year, newMemberIds) {
  // 1. Fetch existing records for this type and year
  const existing = await executeQuery(
    "SELECT id, member_id FROM hof_tbl WHERE type = ? AND year::text = ?::text ORDER BY id ASC",
    [type, String(year)]
  );

  const numExisting = existing.length;
  const numNew = newMemberIds.length;

  // 2. Update existing records with the new member IDs
  const minCount = Math.min(numExisting, numNew);
  for (let i = 0; i < minCount; i++) {
    if (existing[i].member_id !== newMemberIds[i]) {
      await executeQuery(
        "UPDATE hof_tbl SET member_id = ? WHERE id = ?",
        [newMemberIds[i], existing[i].id]
      );
    }
  }

  // 3. If there are more new member IDs than existing records, INSERT the remaining
  if (numNew > numExisting) {
    for (let i = numExisting; i < numNew; i++) {
      await executeQuery(
        "INSERT INTO hof_tbl (member_id, type, year) VALUES (?, ?, ?)",
        [newMemberIds[i], type, year]
      );
    }
  }

  // 4. If there are fewer new member IDs than existing records, DELETE the extra records
  if (numExisting > numNew) {
    const idsToDelete = existing.slice(numNew).map(r => r.id);
    await executeQuery(
      `DELETE FROM hof_tbl WHERE id IN (${idsToDelete.join(',')})`
    );
  }
}

async function updateHof() {
  try {
    const currentYear = new Date().getFullYear();

    // Reuse the same shared query builders as getTopStat (no LIMIT to get all)
    const scorers = await executeQuery(buildGoalQuery('< 2', currentYear));
    const assists = await executeQuery(buildGoalQuery('= 3', currentYear));
    const ownGoals = await executeQuery(buildGoalQuery('= 2', currentYear));
    const players = await executeQuery(buildMostPtsQuery(currentYear));
    const avgPtsList = await executeQuery(buildAvgPtsQuery(currentYear));
    const bottomList = await executeQuery(buildBottomQuery(currentYear));
    const mvpCountList = await executeQuery(buildMvpCountQuery(currentYear));

    // Find max counts and filter — shared queries return 'goal' column for counts, 'id' for member
    let topScorers = [];
    if (scorers && scorers.length > 0) {
      const maxGoals = Math.max(...scorers.map(s => s.goal));
      if (maxGoals > 0) {
        topScorers = scorers.filter(s => s.goal === maxGoals).map(s => s.id);
      }
    }

    let topAssists = [];
    if (assists && assists.length > 0) {
      const maxAssists = Math.max(...assists.map(a => a.goal));
      if (maxAssists > 0) {
        topAssists = assists.filter(a => a.goal === maxAssists).map(a => a.id);
      }
    }

    let topOwnGoals = [];
    if (ownGoals && ownGoals.length > 0) {
      const maxOwnGoals = Math.max(...ownGoals.map(o => o.goal));
      if (maxOwnGoals > 0) {
        topOwnGoals = ownGoals.filter(o => o.goal === maxOwnGoals).map(o => o.id);
      }
    }

    let topPlayers = [];
    if (players && players.length > 0) {
      const validPlayers = players.map(p => ({
        id: p.id,
        pts: parseFloat(p.goal !== undefined ? p.goal : p.pts)
      })).filter(p => !isNaN(p.pts));

      if (validPlayers.length > 0) {
        const maxPts = Math.max(...validPlayers.map(p => p.pts));
        if (maxPts > 0) {
          topPlayers = validPlayers.filter(p => p.pts === maxPts).map(p => p.id);
        }
      }
    }

    let topAvgPts = [];
    if (avgPtsList && avgPtsList.length > 0) {
      const validAvgPts = avgPtsList.map(p => ({
        id: p.id,
        pts: parseFloat(p.goal !== undefined ? p.goal : 0)
      })).filter(p => !isNaN(p.pts));

      if (validAvgPts.length > 0) {
        const maxAvgPts = Math.max(...validAvgPts.map(p => p.pts));
        if (maxAvgPts > 0) {
          topAvgPts = validAvgPts.filter(p => p.pts === maxAvgPts).map(p => p.id);
        }
      }
    }

    let topBottom = [];
    if (bottomList && bottomList.length > 0) {
      const maxBottom = Math.max(...bottomList.map(b => b.goal));
      if (maxBottom > 0) {
        topBottom = bottomList.filter(b => b.goal === maxBottom).map(b => b.id);
      }
    }

    let topMvpCounts = [];
    if (mvpCountList && mvpCountList.length > 0) {
      const maxMvpCount = Math.max(...mvpCountList.map(m => m.goal));
      if (maxMvpCount > 0) {
        topMvpCounts = mvpCountList.filter(m => m.goal === maxMvpCount).map(m => m.id);
      }
    }

    // Sync best MVP of current year into hof_tbl
    const bestMvpRes = await executeQuery(`
      SELECT m.member_id, m.raw_score
      FROM mvp_week_tbl m
      JOIN week_tbl w ON m.week_id = w.id
      WHERE EXTRACT(YEAR FROM w.date)::int = ? AND m.raw_score > 0
      ORDER BY m.raw_score DESC
    `, [currentYear]);

    let topBestMvp = [];
    if (bestMvpRes && bestMvpRes.length > 0) {
      const maxMvpScore = parseFloat(bestMvpRes[0].raw_score);
      if (maxMvpScore > 0) {
        topBestMvp = bestMvpRes.filter(r => parseFloat(r.raw_score) === maxMvpScore).map(r => r.member_id);
      }
    }

    // Sync HOF records instead of deleting and recreating
    await syncHofRecords('scorer', currentYear, topScorers);
    await syncHofRecords('assist', currentYear, topAssists);
    //await syncHofRecords('own_goal', currentYear, topOwnGoals);
    //await syncHofRecords('most_pts', currentYear, topPlayers);
    await syncHofRecords('avg_pts', currentYear, topAvgPts);
    await syncHofRecords('most_mvp', currentYear, topMvpCounts);
    //await syncHofRecords('bottom', currentYear, topBottom);
    await syncHofRecords('best_mvp', currentYear, topBestMvp);

    logger.info(`[HOF] Updated HOF for year ${currentYear}. Top Scorers: ${topScorers.join(', ')}, Top Assists: ${topAssists.join(', ')}, Top Own Goals: ${topOwnGoals.join(', ')}, Top Players (Most Pts): ${topPlayers.join(', ')}, Top Avg Pts: ${topAvgPts.join(', ')}, Top MVP Count: ${topMvpCounts.join(', ')}, Top Bottom: ${topBottom.join(', ')}, Best MVP: ${topBestMvp.join(', ')}`);
  } catch (err) {
    logger.error('Error updating HOF records:', err.message);
  }
}

async function ensureAutoRegTable() {
  try {
    const createSql = `
      CREATE TABLE IF NOT EXISTS autoreg_tbl (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL,
        group_id VARCHAR(100) NOT NULL DEFAULT '',
        priority_order INTEGER DEFAULT 0,
        status SMALLINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_member_group UNIQUE (member_id, group_id)
      )
    `;
    await executeQuery(createSql);
    await executeQuery("CREATE INDEX IF NOT EXISTS idx_status_priority ON autoreg_tbl (status, priority_order, created_at)");

    // Normalize any legacy NULL group_id to empty string
    await executeQuery("UPDATE autoreg_tbl SET group_id = '' WHERE group_id IS NULL");
  } catch (err) {
    logger.error("Error ensuring autoreg_tbl table:", err.message);
  }
}

async function updateMemberAutoReg(member_id, auto_reg, groupId = null) {
  await ensureAutoRegTable();
  const targetGroup = groupId || '';
  if (Number(auto_reg) === 1) {
    const insertQuery = `
      INSERT INTO autoreg_tbl (member_id, group_id, status)
      VALUES (?, ?, 1)
      ON CONFLICT (member_id, group_id) DO UPDATE SET
        status = 1,
        updated_at = CURRENT_TIMESTAMP
    `;
    await executeQuery(insertQuery, [member_id, targetGroup]);
  } else {
    const deleteQuery = "DELETE FROM autoreg_tbl WHERE member_id = ?";
    await executeQuery(deleteQuery, [member_id]);
  }
}

async function getAutoRegList(groupId = null) {
  await ensureAutoRegTable();
  let query = `
    SELECT m.*, 
           COALESCE(a.id, 0) as autoreg_id, 
           COALESCE(a.priority_order, 0) as priority_order, 
           COALESCE(a.status, 1) as autoreg_status, 
           COALESCE(a.created_at, CURRENT_TIMESTAMP) as autoreg_created_at
    FROM member_tbl m
    INNER JOIN autoreg_tbl a ON m.id = a.member_id
    WHERE a.status = 1
  `;
  const params = [];
  if (groupId) {
    query += " AND (a.group_id IS NULL OR a.group_id = '' OR a.group_id = ?)";
    params.push(groupId);
  }
  query += " ORDER BY CASE WHEN a.id IS NULL OR a.id = 0 THEN 99999999 ELSE a.id END ASC, m.id ASC";

  const result = await executeQuery(query, params);
  if (result.length > 0) {
    await Promise.all(result.map(member => ensureMemberPicture(member, groupId)));
    const assets = await fetchDisplayAssets();
    return result.map(member => {
      const displayInfo = resolveMemberDisplayInfo(member, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
      displayInfo.autoreg_created_at = member.autoreg_created_at;
      displayInfo.priority_order = member.priority_order;
      return displayInfo;
    });
  }
  return [];
}

async function getMemberDisplayInfo(memberId, groupId = null) {
  const query = "SELECT * FROM member_tbl WHERE id = ?";
  const result = await executeQuery(query, [memberId]);
  if (result.length > 0) {
    await ensureMemberPicture(result[0], groupId);
    const assets = await fetchDisplayAssets();
    return resolveMemberDisplayInfo(result[0], assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
  }
  return null;
}

async function getMemberStats(memberId, groupId = null) {
  const memberInfo = await getMemberDisplayInfo(memberId, groupId);
  if (!memberInfo) return null;

  // Query goals, assists, own goals
  const goalQuery = `
    SELECT 
      SUM(CASE WHEN mgt.status < 2 AND w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text THEN 1 ELSE 0 END) as goals_year,
      SUM(CASE WHEN mgt.status < 2 THEN 1 ELSE 0 END) as goals_alltime,
      SUM(CASE WHEN mgt.status = 3 AND w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text THEN 1 ELSE 0 END) as assists_year,
      SUM(CASE WHEN mgt.status = 3 THEN 1 ELSE 0 END) as assists_alltime,
      SUM(CASE WHEN mgt.status = 2 AND w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text THEN 1 ELSE 0 END) as owngoals_year,
      SUM(CASE WHEN mgt.status = 2 THEN 1 ELSE 0 END) as owngoals_alltime
    FROM match_goal_tbl mgt
    JOIN match_stat_tbl mst ON mgt.match_id = mst.id
    JOIN week_tbl w ON mst.week_id = w.id
    WHERE mgt.member_id = ?
  `;

  // Query pts, matches, weeks, wins
  const ptQuery = `
    SELECT 
      SUM(CASE WHEN w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text THEN tw.pts ELSE 0 END) as pts_year,
      SUM(CASE WHEN w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text THEN (tw.w + tw.d + tw.l) ELSE 0 END) as matches_year,
      COUNT(DISTINCT CASE WHEN w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text THEN w.id ELSE NULL END) as weeks_year,
      SUM(CASE WHEN w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text THEN tw.w ELSE 0 END) as wins_year,
      SUM(tw.pts) as pts_alltime,
      SUM(tw.w + tw.d + tw.l) as matches_alltime,
      COUNT(DISTINCT w.id) as weeks_alltime,
      SUM(tw.w) as wins_alltime
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.team_id = tw.team_week_id
    JOIN week_tbl w ON tw.week_id = w.id
    WHERE mtw.member_id = ?
  `;

  const dateQuery = `
    SELECT MIN(w.date) as first_match_date
    FROM member_team_week_tbl mtw
    JOIN week_tbl w ON mtw.week_id = w.id
    WHERE mtw.member_id = ?
  `;

  const bottomQuery = `
    SELECT 
      SUM(CASE WHEN w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text THEN 1 ELSE 0 END) as bottom_year,
      COUNT(*) as bottom_alltime
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.week_id = tw.week_id AND mtw.team_id = tw.team_week_id
    JOIN week_tbl w ON mtw.week_id = w.id
    WHERE mtw.member_id = ? AND tw.team_week_id = (
      SELECT t2.team_week_id
      FROM table_week_tbl t2
      WHERE t2.week_id = tw.week_id
      ORDER BY t2.pts ASC, (t2.g - t2.a) ASC
      LIMIT 1
    )
  `;

  const champQuery = `
    SELECT 
      SUM(CASE WHEN w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text THEN 1 ELSE 0 END) as champ_year,
      COUNT(*) as champ_alltime
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.week_id = tw.week_id AND mtw.team_id = tw.team_week_id
    JOIN week_tbl w ON mtw.week_id = w.id
    WHERE mtw.member_id = ? AND tw.team_week_id = (
      SELECT t2.team_week_id
      FROM table_week_tbl t2
      WHERE t2.week_id = tw.week_id
      ORDER BY t2.pts DESC, (t2.g - t2.a) DESC
      LIMIT 1
    )
  `;

  const colorQuery = `
    SELECT 
      t_col.color,
      SUM(tw.w) as wins,
      SUM(tw.w + tw.d + tw.l) as matches
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.team_id = tw.team_week_id
    JOIN team_color_week_tbl t_col ON tw.team_week_id = t_col.id
    WHERE mtw.member_id = ?
    GROUP BY t_col.color
  `;

  const mvpQuery = `
    SELECT 
      SUM(CASE WHEN (w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text OR EXTRACT(YEAR FROM w.date)::int = EXTRACT(YEAR FROM CURRENT_DATE)::int) THEN 1 ELSE 0 END) as mvp_year,
      COUNT(*) as mvp_alltime
    FROM mvp_week_tbl m
    JOIN week_tbl w ON m.week_id = w.id
    WHERE m.member_id = ?
      AND m.raw_score > 0
      AND m.raw_score = (
        SELECT MAX(m2.raw_score)
        FROM mvp_week_tbl m2
        WHERE m2.week_id = m.week_id
          AND m2.member_id > 0
          AND m2.member_name NOT LIKE '@team%'
          AND m2.member_name NOT LIKE '+team%'
          AND m2.member_name NOT LIKE 'team%'
      )
  `;

  const ratingQuery = `
    SELECT 
      MAX(CASE WHEN (w.year::text = EXTRACT(YEAR FROM CURRENT_DATE)::text OR EXTRACT(YEAR FROM w.date)::int = EXTRACT(YEAR FROM CURRENT_DATE)::int) THEN mtw.rating ELSE 0 END) as best_rating_year,
      MAX(mtw.rating) as best_rating_alltime
    FROM member_team_week_tbl mtw
    JOIN week_tbl w ON mtw.week_id = w.id
    WHERE mtw.member_id = ?
  `;

  const [goalResult, ptResult, dateResult, bottomResult, champResult, colorResult, mvpResult, ratingResult] = await Promise.all([
    executeQuery(goalQuery, [memberId]),
    executeQuery(ptQuery, [memberId]),
    executeQuery(dateQuery, [memberId]),
    executeQuery(bottomQuery, [memberId]),
    executeQuery(champQuery, [memberId]),
    executeQuery(colorQuery, [memberId]),
    executeQuery(mvpQuery, [memberId]),
    executeQuery(ratingQuery, [memberId])
  ]);

  const goals = goalResult[0] || {};
  const pts = ptResult[0] || {};
  const firstMatchDate = dateResult[0] ? dateResult[0].first_match_date : null;
  const bottom = bottomResult[0] || {};
  const champ = champResult[0] || {};
  const mvp = (mvpResult && mvpResult[0]) ? mvpResult[0] : {};
  const ratingRow = (ratingResult && ratingResult[0]) ? ratingResult[0] : {};

  const bottomYear = Number(bottom.bottom_year || 0);
  const bottomAllTime = Number(bottom.bottom_alltime || 0);
  const champYear = Number(champ.champ_year || 0);
  const champAllTime = Number(champ.champ_alltime || 0);
  const mvpYear = Number(mvp.mvp_year || 0);
  const mvpAllTime = Number(mvp.mvp_alltime || 0);
  const bestRatingYear = parseFloat(ratingRow.best_rating_year || 0);
  const bestRatingAlltime = parseFloat(ratingRow.best_rating_alltime || 0);
  const weeksYear = Number(pts.weeks_year || 0);
  const weeksAlltime = Number(pts.weeks_alltime || 0);

  const winsYear = Number(pts.wins_year || 0);
  const winsAlltime = Number(pts.wins_alltime || 0);
  const matchesYear = Number(pts.matches_year || 0);
  const matchesAlltime = Number(pts.matches_alltime || 0);

  const colorStats = (colorResult || []).map(row => {
    const color = row.color;
    const wins = Number(row.wins || 0);
    const matches = Number(row.matches || 0);
    const winRate = matches > 0 ? Number(((wins / matches) * 100).toFixed(1)) : 0;
    return {
      color,
      wins,
      matches,
      winRate
    };
  });

  colorStats.sort((a, b) => {
    if (b.winRate !== a.winRate) {
      return b.winRate - a.winRate;
    }
    return b.matches - a.matches;
  });

  const luckyColor = colorStats.length > 0 && colorStats[0].winRate > 0 ? colorStats[0].color : null;

  return {
    member: memberInfo,
    firstMatchDate,
    stats: {
      goals: {
        year: Number(goals.goals_year || 0),
        alltime: Number(goals.goals_alltime || 0)
      },
      assists: {
        year: Number(goals.assists_year || 0),
        alltime: Number(goals.assists_alltime || 0)
      },
      owngoals: {
        year: Number(goals.owngoals_year || 0),
        alltime: Number(goals.owngoals_alltime || 0)
      },
      mvp: {
        year: mvpYear,
        yearPct: weeksYear > 0 ? Number((mvpYear / weeksYear * 100).toFixed(1)) : 0,
        alltime: mvpAllTime,
        alltimePct: weeksAlltime > 0 ? Number((mvpAllTime / weeksAlltime * 100).toFixed(1)) : 0
      },
      bestRating: {
        year: bestRatingYear > 0 ? bestRatingYear.toFixed(1) : '0.0',
        alltime: bestRatingAlltime > 0 ? bestRatingAlltime.toFixed(1) : '0.0'
      },
      matches: {
        year: matchesYear,
        alltime: matchesAlltime
      },
      weeks: {
        year: weeksYear,
        alltime: weeksAlltime
      },
      avgpts: {
        year: matchesYear > 0 ? Number((pts.pts_year / matchesYear).toFixed(2)) : 0,
        alltime: matchesAlltime > 0 ? Number((pts.pts_alltime / matchesAlltime).toFixed(2)) : 0
      },
      bottom: {
        year: bottomYear,
        yearPct: weeksYear > 0 ? Number((bottomYear / weeksYear * 100).toFixed(1)) : 0,
        alltime: bottomAllTime,
        alltimePct: weeksAlltime > 0 ? Number((bottomAllTime / weeksAlltime * 100).toFixed(1)) : 0
      },
      champ: {
        year: champYear,
        yearPct: weeksYear > 0 ? Number((champYear / weeksYear * 100).toFixed(1)) : 0,
        alltime: champAllTime,
        alltimePct: weeksAlltime > 0 ? Number((champAllTime / weeksAlltime * 100).toFixed(1)) : 0
      },
      win: {
        yearPct: matchesYear > 0 ? Number((winsYear / matchesYear * 100).toFixed(1)) : 0,
        alltimePct: matchesAlltime > 0 ? Number((winsAlltime / matchesAlltime * 100).toFixed(1)) : 0
      }
    },
    colorStats,
    luckyColor
  };
}

async function getMvpList(targetYear = null, groupId = null) {
  const currentYear = new Date().getFullYear();
  const year = targetYear && !isNaN(Number(targetYear)) && Number(targetYear) > 2000 ? Number(targetYear) : currentYear;

  await ensureMvpWeekTable();
  await ensurePosTables();
  const assets = await fetchDisplayAssets();

  // 1. Fetch benchmark max score and best rating for that year
  let bestRating = 0;
  let bestRaw = 0;
  try {
    const bestRes = await executeQuery(`
      SELECT MAX(m.rating) as best_rating, MAX(m.raw_score) as best_raw
      FROM mvp_week_tbl m
      JOIN week_tbl w ON m.week_id = w.id
      WHERE EXTRACT(YEAR FROM w.date)::int = ?
    `, [year]);
    if (bestRes && bestRes[0]) {
      bestRating = parseFloat(bestRes[0].best_rating || 0);
      bestRaw = parseFloat(bestRes[0].best_raw || 0);
    }
  } catch (e) { }

  let yrBenchmark = bestRaw;
  try {
    const tplRes = await executeQuery("SELECT value FROM template_tpl WHERE name = ?", [`max_mvp_score_${year}`]);
    if (tplRes && tplRes.length > 0 && tplRes[0].value) {
      yrBenchmark = parseFloat(tplRes[0].value);
    }
  } catch (e) { }

  // 2. Query all MVP winners of each week for that year
  const mvpRows = await executeQuery(`
    SELECT 
      m.week_id,
      m.member_id,
      m.member_name,
      m.goals,
      m.assists,
      m.clean_sheet,
      m.conceded,
      m.raw_score,
      m.rating,
      w.date,
      mtw.team_id,
      mem.id,
      mem.name,
      mem.alias,
      mem.rank,
      mem.admin,
      mem.donate,
      mem.picture_url,
      mem.line_user_id
    FROM mvp_week_tbl m
    JOIN week_tbl w ON m.week_id = w.id
    LEFT JOIN member_team_week_tbl mtw ON m.week_id = mtw.week_id AND m.member_id = mtw.member_id
    LEFT JOIN member_tbl mem ON m.member_id = mem.id
    WHERE EXTRACT(YEAR FROM w.date)::int = ?
    ORDER BY w.date DESC, m.raw_score DESC, m.rating DESC, (m.goals * 4 + m.assists * 3 + m.clean_sheet * 3) DESC
  `, [year]);

  if (!mvpRows || mvpRows.length === 0) {
    return { year, bestRating, bestRaw, yrBenchmark, totalWeeks: 0, weeks: [] };
  }

  // Group by week_id preserving chronological order (newest to oldest)
  // Only include the top MVP winner(s) of each week (highest raw_score/rating for that week)
  const weekMap = new Map();
  for (const row of mvpRows) {
    const wId = row.week_id;
    const rawScore = parseFloat(row.raw_score || 0);
    const rating = parseFloat(row.rating || 0);
    const g = Number(row.goals) || 0;
    const a = Number(row.assists) || 0;
    const cs = Number(row.clean_sheet) || 0;
    const rowPoints = (g * 4) + (a * 3) + (cs * 3);

    if (!weekMap.has(wId)) {
      const wDate = row.date ? new Date(row.date) : null;
      const dateStr = wDate ? await getFormatDate(wDate, 'short') : `สัปดาห์ ${wId}`;
      weekMap.set(wId, {
        week_id: wId,
        date: row.date,
        dateStr,
        team_id: row.team_id || null,
        maxScore: rawScore,
        maxRating: rating,
        maxPoints: rowPoints,
        mvps: []
      });
    }

    const weekEntry = weekMap.get(wId);
    // Prevent duplicate entries for the same member in the same week
    const memId = row.member_id || (row.id || 0);
    const memName = (row.member_name || row.name || '').trim();
    if (weekEntry.mvps.some(m => (memId > 0 && m.member_id === memId) || (memName && m.name.trim().toLowerCase() === memName.toLowerCase()))) {
      continue;
    }

    // Only accept players who strictly tied for the true top MVP winner of this week
    if (weekEntry.mvps.length > 0) {
      // If a top MVP is already selected for this week, a second player is ONLY added if they genuinely tied on all top metrics
      if (weekEntry.maxScore > 0) {
        if (Math.abs(rawScore - weekEntry.maxScore) > 0.0001) {
          continue;
        }
      } else if (weekEntry.maxRating > 0) {
        if (Math.abs(rating - weekEntry.maxRating) > 0.0001 || rowPoints !== weekEntry.maxPoints) {
          continue;
        }
      } else {
        // No valid positive score -> do not add multiple players
        continue;
      }

      // Further verify that match contributions match the top player
      if (g !== weekEntry.maxGoals || a !== weekEntry.maxAssists) {
        continue;
      }
    }

    const isYearBest = (bestRaw > 0 && rawScore >= bestRaw - 0.0001) || (bestRating > 0 && rating >= bestRating - 0.0001);
    if (isYearBest) {
      weekEntry.isBestMvp = true;
    }

    const info = resolveMemberDisplayInfo(
      row.id ? row : { name: row.member_name, id: row.member_id, picture_url: null, rank: null, donate: null, line_user_id: null },
      assets.badges,
      assets.donateColors,
      assets.hofCounts,
      assets.hofBadge,
      assets.hofAwards
    );

    const goals = Number(row.goals) || 0;
    const assists = Number(row.assists) || 0;
    const cleanSheets = Number(row.clean_sheet) || 0;
    const conceded = Number(row.conceded) || 0;

    weekEntry.mvps.push({
      member_id: memId,
      name: memName,
      team_id: row.team_id || null,
      isBestMvp: isYearBest,
      info,
      goals,
      assists,
      cleanSheets,
      conceded,
      rawScore,
      rating
    });
  }

  // Find best MVP player(s) of the year for prominent display
  const bestMvpPlayers = [];
  if (bestRaw > 0) {
    for (const row of mvpRows) {
      if (parseFloat(row.raw_score) >= bestRaw - 0.0001) {
        const wDate = row.date ? new Date(row.date) : null;
        const dateStr = wDate ? await getFormatDate(wDate, 'short') : `สัปดาห์ ${row.week_id}`;
        const info = resolveMemberDisplayInfo(
          row.id ? row : { name: row.member_name, id: row.member_id, picture_url: null, rank: null, donate: null, line_user_id: null },
          assets.badges,
          assets.donateColors,
          assets.hofCounts,
          assets.hofBadge,
          assets.hofAwards
        );
        bestMvpPlayers.push({
          member_id: row.member_id,
          name: row.member_name || (row.name || ''),
          week_id: row.week_id,
          date: row.date,
          dateStr,
          team_id: row.team_id || null,
          info,
          goals: Number(row.goals) || 0,
          assists: Number(row.assists) || 0,
          cleanSheets: Number(row.clean_sheet) || 0,
          conceded: Number(row.conceded) || 0,
          rawScore: parseFloat(row.raw_score || 0),
          rating: parseFloat(row.rating || 0)
        });
      }
    }
  }

  // Sort weeks from new to old
  const weeksList = Array.from(weekMap.values()).sort((a, b) => {
    const timeA = a.date ? new Date(a.date).getTime() : 0;
    const timeB = b.date ? new Date(b.date).getTime() : 0;
    if (timeB !== timeA) return timeB - timeA;
    return b.week_id - a.week_id;
  });

  let bestMvpBadgeUrl = null;
  if (assets.hofBadge) {
    const badgeObj = assets.hofBadge['best_mvp'] || assets.hofBadge['mvp'] || assets.hofBadge['top_mvp'] || assets.hofBadge['default'] || Object.values(assets.hofBadge)[0];
    if (badgeObj && badgeObj.url && badgeObj.url.toLowerCase() !== 'none') {
      bestMvpBadgeUrl = getFullUrl(badgeObj.url.trim());
    }
  }
  if (!bestMvpBadgeUrl || !bestMvpBadgeUrl.startsWith('https://')) {
    bestMvpBadgeUrl = 'https://bearbit.org/pic/crown.gif';
  }

  return {
    year,
    bestRating,
    bestRaw,
    yrBenchmark,
    bestMvpBadgeUrl,
    bestMvpPlayers,
    totalWeeks: weeksList.length,
    weeks: weeksList
  };
}

/**
 * Distribute players into 5 tactical lines (CF, MF, DW, DF, GK)
 * Specifically configured for 7-player (6+1) and 8-player (7+1) teams.
 */
function allocateFormationSlots(members, is8PlayerWeek = false, posLimitsMap = {}) {
  const count = members.length;
  const isReserve = (name) => /^\+\s*\(?\d+\)?/.test((name || '').trim());

  const explicitReserves = [];
  const regulars = [];

  for (const m of members) {
    if (isReserve(m.name) || isReserve(m.alias)) {
      explicitReserves.push(m);
    } else {
      regulars.push(m);
    }
  }

  // Determine if this team is configured for 8 players
  const is8Player = is8PlayerWeek || regulars.length >= 8 || count >= 8;

  // Group regular players by explicit pos_code from DB
  const assigned = {
    GK: [],
    DF: [],
    DW: [],
    DM: [],
    MF: [],
    AM: [],
    CF: []
  };
  const unassigned = [];

  for (const m of regulars) {
    const code = (m.pos_code || '').toUpperCase();
    if (assigned[code]) {
      assigned[code].push(m);
    } else {
      unassigned.push(m);
    }
  }

  const hasGK = assigned.GK.length > 0;

  // Dynamic starters on pitch based on role constraints (from pos_tbl: min_8/max_8 for 8-player teams, min/max for 7-player teams):
  const defaultLimits = {
    DF: { min: 1, max: 2, min_8: 1, max_8: 3 },
    DW: { min: 2, max: 2, min_8: 2, max_8: 2 },
    DM: { min: 0, max: 1, min_8: 0, max_8: 1 },
    MF: { min: 1, max: 2, min_8: 1, max_8: 3 },
    AM: { min: 0, max: 1, min_8: 0, max_8: 2 },
    CF: { min: 0, max: 1, min_8: 0, max_8: 2 },
    GK: { min: 0, max: 1, min_8: 0, max_8: 1 }
  };

  const getLimit = (pos) => {
    const lim = posLimitsMap[pos] || {};
    const def = defaultLimits[pos] || { min: 0, max: 2, min_8: 0, max_8: 2 };
    if (is8Player) {
      return {
        min: lim.min_8 !== undefined && !isNaN(lim.min_8) ? Number(lim.min_8) : (lim.min !== undefined && !isNaN(lim.min) ? Number(lim.min) : (def.min_8 !== undefined ? def.min_8 : def.min)),
        max: lim.max_8 !== undefined && !isNaN(lim.max_8) ? Number(lim.max_8) : (lim.max !== undefined && !isNaN(lim.max) ? Number(lim.max) : (def.max_8 !== undefined ? def.max_8 : def.max))
      };
    }
    return {
      min: lim.min !== undefined && !isNaN(lim.min) ? Number(lim.min) : def.min,
      max: lim.max !== undefined && !isNaN(lim.max) ? Number(lim.max) : def.max
    };
  };

  const limDF = getLimit('DF');
  const limDW = getLimit('DW');
  const limDM = getLimit('DM');
  const limMF = getLimit('MF');
  const limAM = getLimit('AM');
  const limCF = getLimit('CF');
  const limGK = getLimit('GK');

  // Rule: If team lacks natural DF but has natural DM, DM can be DF (to satisfy mandatory DF without forcing MF to DF)
  let dmForDFCount = 0;
  if (assigned.DF.length < limDF.min && assigned.DM.length > 0) {
    dmForDFCount = Math.min(assigned.DM.length, limDF.min - assigned.DF.length);
  }
  // DM players remaining for the DM slot(s) after some are used to fill DF shortage
  const remainingDMCount = Math.max(0, assigned.DM.length - dmForDFCount);

  let targetDF = limDF.min;
  let targetDW = limDW.min;
  let targetDM = limDM.min;
  let targetMF = limMF.min;
  let targetAM = limAM.min;
  let targetCF = limCF.min;
  let targetGK = hasGK ? Math.min(1, limGK.max) : (limGK.min || 0);

  const baseOutfield = targetDF + targetDW + targetDM + targetMF + targetAM + targetCF;
  const targetOutfieldTotal = is8Player ? 7 : 6;
  let needed = Math.max(0, targetOutfieldTotal - baseOutfield);

  // 1. Phase A: Allocate 1 starter slot for every natural position present in the team
  // Priority: CF, AM, DM, DF, DW, MF (give specialised roles a starter slot whenever natural players exist)
  const presentRoles = ['CF', 'AM', 'DM', 'DF', 'DW', 'MF'];
  for (const pos of presentRoles) {
    const lim = getLimit(pos);
    const countForPos = pos === 'DM' ? remainingDMCount : (pos === 'DF' ? (assigned.DF.length + dmForDFCount) : assigned[pos].length);
    let curTarget = pos === 'CF' ? targetCF : (pos === 'AM' ? targetAM : (pos === 'DM' ? targetDM : (pos === 'DW' ? targetDW : (pos === 'MF' ? targetMF : targetDF))));
    if (countForPos > curTarget && curTarget < lim.max && needed > 0) {
      curTarget++;
      needed--;
      if (pos === 'CF') targetCF = curTarget;
      else if (pos === 'AM') targetAM = curTarget;
      else if (pos === 'DM') targetDM = curTarget;
      else if (pos === 'DW') targetDW = curTarget;
      else if (pos === 'MF') targetMF = curTarget;
      else if (pos === 'DF') targetDF = curTarget;
    }
  }

  // Phase B: Expand slots for positions with surplus natural players (e.g. 2nd CF if team has 2 CFs, 2nd AM, 2nd DF, 2nd/3rd MF)
  for (const pos of presentRoles) {
    const lim = getLimit(pos);
    const countForPos = pos === 'DM' ? remainingDMCount : (pos === 'DF' ? (assigned.DF.length + dmForDFCount) : assigned[pos].length);
    let curTarget = pos === 'CF' ? targetCF : (pos === 'AM' ? targetAM : (pos === 'DM' ? targetDM : (pos === 'DW' ? targetDW : (pos === 'MF' ? targetMF : targetDF))));
    while (countForPos > curTarget && curTarget < lim.max && needed > 0) {
      curTarget++;
      needed--;
      if (pos === 'CF') targetCF = curTarget;
      else if (pos === 'AM') targetAM = curTarget;
      else if (pos === 'DM') targetDM = curTarget;
      else if (pos === 'DW') targetDW = curTarget;
      else if (pos === 'MF') targetMF = curTarget;
      else if (pos === 'DF') targetDF = curTarget;
    }
  }

  // Phase C: Tactical fill if needed still > 0
  // First pass: expand slots for positions that still have surplus natural players waiting
  // (e.g. if 3 MF players exist but only 2 MF slots were allocated, add a 3rd MF slot before adding a CF slot)
  const surplusOrder = ['MF', 'DW', 'DF', 'DM', 'AM', 'CF'];
  for (const pos of surplusOrder) {
    if (needed <= 0) break;
    const lim = getLimit(pos);
    const remaining = pos === 'DM' ? remainingDMCount : (pos === 'DF' ? (assigned.DF.length + dmForDFCount) : assigned[pos].length);
    let curTarget = pos === 'CF' ? targetCF : (pos === 'AM' ? targetAM : (pos === 'DM' ? targetDM : (pos === 'DW' ? targetDW : (pos === 'MF' ? targetMF : targetDF))));
    // Only expand this slot if there are natural players for this position still unaccounted for
    while (remaining > curTarget && curTarget < lim.max && needed > 0) {
      curTarget++;
      needed--;
      if (pos === 'CF') targetCF = curTarget;
      else if (pos === 'AM') targetAM = curTarget;
      else if (pos === 'DM') targetDM = curTarget;
      else if (pos === 'DW') targetDW = curTarget;
      else if (pos === 'MF') targetMF = curTarget;
      else if (pos === 'DF') targetDF = curTarget;
    }
  }

  // Second pass: if still needed (e.g. unassigned/generic players), fill MF→DW→DF→DM→AM→CF
  // Avoid adding CF slots for non-CF players
  const genericFillOrder = ['MF', 'DW', 'DF', 'DM', 'AM', 'CF'];
  for (const pos of genericFillOrder) {
    if (needed <= 0) break;
    const lim = getLimit(pos);
    let curTarget = pos === 'CF' ? targetCF : (pos === 'AM' ? targetAM : (pos === 'DM' ? targetDM : (pos === 'DW' ? targetDW : (pos === 'MF' ? targetMF : targetDF))));
    while (curTarget < lim.max && needed > 0) {
      curTarget++;
      needed--;
      if (pos === 'CF') targetCF = curTarget;
      else if (pos === 'AM') targetAM = curTarget;
      else if (pos === 'DM') targetDM = curTarget;
      else if (pos === 'DW') targetDW = curTarget;
      else if (pos === 'MF') targetMF = curTarget;
      else if (pos === 'DF') targetDF = curTarget;
    }
  }

  const target = {
    CF: targetCF,
    AM: targetAM,
    MF: targetMF,
    DM: targetDM,
    DW: targetDW,
    DF: targetDF,
    GK: targetGK
  };

  const totalStarters = targetCF + targetAM + targetMF + targetDM + targetDW + targetDF + targetGK;
  const altCount = Math.max(0, count - totalStarters);

  const formationParts = [];
  if (targetCF > 0) formationParts.push(targetCF);
  if (targetAM > 0) formationParts.push(targetAM);
  if (targetMF > 0) formationParts.push(targetMF);
  if (targetDM > 0) formationParts.push(targetDM);
  if (targetDW > 0) formationParts.push(targetDW);
  if (targetDF > 0) formationParts.push(targetDF);
  if (targetGK > 0) formationParts.push(targetGK);
  const formationName = `แผน ${formationParts.join('-')}`;

  const getPlayerScore = (p) => {
    if (!p) return 0;
    const weekPriority = Number(p.week_priority);
    const priorityTier = (!isNaN(weekPriority) && weekPriority > 0)
      ? weekPriority
      : (Number(p.priority !== undefined ? p.priority : (p.member_priority !== undefined ? p.member_priority : p.member_team_id)) || 0);
    const priorityBonus = priorityTier === 1 ? 10000 : (priorityTier === 2 ? 5000 : 0);
    // Primary score strictly by yearly avg rating -> rank -> week rating
    const yAvg = parseFloat(p.yearStats?.avgRating || 0) || 0;
    const yRating = parseFloat(p.yearStats?.rating || 0) || 0;
    const rankScore = parseFloat(p.rank || 0) || 0;
    const wScore = parseFloat(p.weekStats?.rating || 0) || 0;
    const baseScore = yAvg > 0 ? yAvg : (yRating > 0 ? yRating : (rankScore > 0 ? rankScore : wScore));
    return priorityBonus + baseScore;
  };

  // Sort assigned categories and unassigned from highest to lowest score
  for (const r of ['GK', 'DF', 'DW', 'DM', 'MF', 'AM', 'CF']) {
    assigned[r].sort((a, b) => getPlayerScore(b) - getPlayerScore(a));
  }
  unassigned.sort((a, b) => getPlayerScore(b) - getPlayerScore(a));

  const finalSlots = {
    CF: Array.from({ length: target.CF }, () => ({ primary: null, alternate: null })),
    AM: Array.from({ length: target.AM }, () => ({ primary: null, alternate: null })),
    MF: Array.from({ length: target.MF }, () => ({ primary: null, alternate: null })),
    DM: Array.from({ length: target.DM }, () => ({ primary: null, alternate: null })),
    DW: Array.from({ length: target.DW }, () => ({ primary: null, alternate: null })),
    DF: Array.from({ length: target.DF }, () => ({ primary: null, alternate: null })),
    GK: Array.from({ length: target.GK }, () => ({ primary: null, alternate: null })),
    alternates: []
  };

  const tacticalFitPreference = {
    CF: ['CF', 'AM', 'MF', 'DW', 'DF'],
    AM: ['AM', 'CF', 'MF', 'DW', 'DF'],
    MF: ['MF', 'DM', 'AM', 'CF', 'DW', 'DF'],
    DM: ['DM', 'DF', 'MF', 'DW', 'AM', 'CF'],
    DW: ['DW', 'DF', 'DM', 'MF', 'CF', 'AM'],
    DF: ['DF', 'DM', 'DW', 'MF']
  };

  // 1. Assign GK
  if (hasGK && assigned.GK.length > 0) {
    const gkPlayer = assigned.GK.shift();
    gkPlayer.effectivePos = 'GK';
    if (finalSlots.GK.length > 0) {
      finalSlots.GK[0].primary = gkPlayer;
    }
    while (assigned.GK.length > 0) {
      unassigned.push(assigned.GK.shift());
    }
  }

  // 1.5. If DF is lacking and we identified natural DM for DF, assign DM to DF first
  if (dmForDFCount > 0 && finalSlots.DF.length > 0 && assigned.DM.length > 0) {
    for (let i = 0; i < dmForDFCount && finalSlots.DF.length > 0 && assigned.DM.length > 0; i++) {
      const dmPlayer = assigned.DM.shift();
      dmPlayer.effectivePos = 'DF';
      const emptyDfSlot = finalSlots.DF.find(s => s.primary === null);
      if (emptyDfSlot) {
        emptyDfSlot.primary = dmPlayer;
      }
    }
  }

  // 2. Exact Natural Position Match for Primary Starters (Specialised roles first)
  const outfieldRoles = ['CF', 'AM', 'DM', 'DF', 'DW', 'MF'];
  for (const r of outfieldRoles) {
    for (const slot of finalSlots[r]) {
      if (slot.primary === null && assigned[r].length > 0) {
        const starter = assigned[r].shift();
        starter.effectivePos = r;
        slot.primary = starter;
      }
    }
  }

  // 3. Fill Vacant Primary Slots using Tactical Versatility & Compatibility (BEFORE assigning alternates)
  for (const r of outfieldRoles) {
    for (const slot of finalSlots[r]) {
      if (slot.primary === null) {
        // Search compatible roles for surplus players (e.g. DM/DW/MF for DF)
        const candidates = tacticalFitPreference[r] || outfieldRoles;
        for (const candRole of candidates) {
          if (assigned[candRole] && assigned[candRole].length > 0) {
            const p = assigned[candRole].shift();
            p.effectivePos = r;
            slot.primary = p;
            break;
          }
        }
        // If still empty, draw from unassigned pool
        if (slot.primary === null && unassigned.length > 0) {
          const p = unassigned.shift();
          p.effectivePos = r;
          slot.primary = p;
        }
      }
    }
  }

  // 3.5. Tactical Re-allocation for Mandatory Defence (DF):
  // If DF is still vacant: Borrow from DM first, then DW, then MF!
  for (const slot of finalSlots.DF) {
    if (slot.primary === null) {
      const borrowRoles = ['DM', 'DW', 'MF'];
      for (const bRole of borrowRoles) {
        if (finalSlots[bRole] && finalSlots[bRole].length > 0) {
          // Only borrow from non-fixed players (priority tier not 1 and not 2)
          const filledSlots = finalSlots[bRole].filter(s => {
            if (!s.primary) return false;
            const weekPriority = Number(s.primary.week_priority);
            const pTier = (!isNaN(weekPriority) && weekPriority > 0)
              ? weekPriority
              : (Number(s.primary.priority !== undefined ? s.primary.priority : (s.primary.member_priority !== undefined ? s.primary.member_priority : s.primary.member_team_id)) || 0);
            return pTier !== 1 && pTier !== 2;
          });
          if (filledSlots.length > 0) {
            filledSlots.sort((a, b) => getPlayerScore(a.primary) - getPlayerScore(b.primary));
            const donorSlot = filledSlots[0];
            const movedPlayer = donorSlot.primary;
            donorSlot.primary = null;

            movedPlayer.effectivePos = 'DF';
            slot.primary = movedPlayer;

            // Fill the newly vacated slot in bRole from available surplus roles (e.g. CF, AM, unassigned)
            const fillCandidates = tacticalFitPreference[bRole] || outfieldRoles;
            for (const cRole of fillCandidates) {
              if (assigned[cRole] && assigned[cRole].length > 0) {
                const newStarter = assigned[cRole].shift();
                newStarter.effectivePos = bRole;
                donorSlot.primary = newStarter;
                break;
              }
            }
            if (donorSlot.primary === null && unassigned.length > 0) {
              const newStarter = unassigned.shift();
              newStarter.effectivePos = bRole;
              donorSlot.primary = newStarter;
            }
            break;
          }
        }
      }
    }
  }

  // 4. Pair ALL remaining players as alternates directly onto pitch slots
  const allAlternates = [
    ...(assigned.CF || []),
    ...(assigned.AM || []),
    ...(assigned.MF || []),
    ...(assigned.DM || []),
    ...(assigned.DW || []),
    ...(assigned.DF || []),
    ...unassigned,
    ...explicitReserves
  ];
  allAlternates.sort((a, b) => getPlayerScore(b) - getPlayerScore(a));

  for (const p of allAlternates) {
    p.isAlternate = true;
    const preferredRole = (p.pos_code || '').toUpperCase();

    // 1. Try to pair to a slot in their preferred natural role
    let targetSlot = finalSlots[preferredRole] && finalSlots[preferredRole].find(s => s.alternate === null);

    // 2. If already filled, try compatible roles
    if (!targetSlot) {
      const prefRoles = tacticalFitPreference[preferredRole] || outfieldRoles;
      for (const candRole of prefRoles) {
        targetSlot = finalSlots[candRole] && finalSlots[candRole].find(s => s.alternate === null);
        if (targetSlot) {
          p.effectivePos = candRole;
          break;
        }
      }
    } else {
      p.effectivePos = preferredRole;
    }

    if (targetSlot) {
      targetSlot.alternate = p;
    } else {
      // If all slots have alternates, pair to CF or first available slot
      p.effectivePos = preferredRole || 'CF';
      if (finalSlots[p.effectivePos] && finalSlots[p.effectivePos].length > 0) {
        finalSlots[p.effectivePos][0].alternate = p;
      }
    }
    finalSlots.alternates.push(p);
  }

  // 5. Ensure for each paired slot, the player with the higher avg rating is primary starter and the lower rating is alternate
  for (const r of ['GK', 'CF', 'AM', 'MF', 'DM', 'DW', 'DF']) {
    if (finalSlots[r]) {
      for (const slot of finalSlots[r]) {
        if (slot.primary && slot.alternate) {
          if (getPlayerScore(slot.alternate) > getPlayerScore(slot.primary)) {
            const temp = slot.primary;
            slot.primary = slot.alternate;
            slot.alternate = temp;
            slot.primary.isAlternate = false;
            slot.alternate.isAlternate = true;
            slot.primary.effectivePos = r;
            slot.alternate.effectivePos = r;
          }
        }
      }
    }
  }

  return {
    formationName,
    slots: finalSlots,
    totalPlayers: count
  };
}

function isLikelyDateStr(str) {
  if (!str) return false;
  const s = String(str).trim();
  // 1. DD/MM, DD-MM, DD.MM, YYYY-MM-DD, YYYY/MM/DD
  if (/^(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})$/.test(s)) {
    return true;
  }
  // 2. Thai date e.g. 30ส.ค., 7 ก.ย., 7ก.ย.2026, 7 กันยายน
  if (/^\d{1,2}\s*[ก-๙a-zA-Z\.]+(?:\s*\d{2,4})?$/.test(s)) {
    return true;
  }
  return false;
}

function parseTeamAndWeekArgs(param = '', defaultWeekId = 0) {
  const trimmed = String(param !== null && param !== undefined ? param : '').trim();
  let teamArg = null;
  let weekArg = defaultWeekId || 0;

  if (trimmed) {
    if (isLikelyDateStr(trimmed)) {
      weekArg = trimmed;
    } else {
      const parts = trimmed.split(/\s+/).filter(Boolean);
      const isKnownTeam = (t) => /^(team\d+|[1-4]|yellow|red|green|blue|black|white|orange|pink|purple|เหลือง|แดง|เขียว|น้ำเงิน|ฟ้า|ส้ม|ชมพู|ม่วง|ดำ|ขาว|all|\d+)$/i.test(t);

      if (parts.length === 1) {
        if (isLikelyDateStr(parts[0])) {
          weekArg = parts[0];
        } else {
          teamArg = parts[0];
        }
      } else {
        const firstToken = parts[0];
        const lastToken = parts[parts.length - 1];
        if (isKnownTeam(firstToken) && isLikelyDateStr(parts.slice(1).join(' '))) {
          teamArg = firstToken;
          weekArg = parts.slice(1).join(' ').trim();
        } else if (isKnownTeam(lastToken) && isLikelyDateStr(parts.slice(0, -1).join(' '))) {
          teamArg = lastToken;
          weekArg = parts.slice(0, -1).join(' ').trim();
        } else if (isKnownTeam(firstToken)) {
          teamArg = firstToken;
          weekArg = parts.slice(1).join(' ').trim();
        } else if (isKnownTeam(lastToken)) {
          teamArg = lastToken;
          weekArg = parts.slice(0, -1).join(' ').trim();
        } else if (isLikelyDateStr(parts.slice(1).join(' '))) {
          teamArg = firstToken;
          weekArg = parts.slice(1).join(' ').trim();
        } else if (isLikelyDateStr(parts.slice(0, -1).join(' '))) {
          teamArg = lastToken;
          weekArg = parts.slice(0, -1).join(' ').trim();
        } else {
          teamArg = firstToken;
          weekArg = parts.slice(1).join(' ').trim();
        }
      }
    }
  }

  return { teamArg, weekArg };
}

/**
 * Checks if the /teamweek command is allowed to run for the specified week parameter.
 * For the current/latest week, access is only permitted after 20:00 (8:00 PM) on Friday.
 * Past weeks are always accessible.
 * @param {string} param 
 * @returns {Promise<{ allowed: boolean, message?: string }>}
 */
async function checkTeamWeekAccess(param = '') {
  try {
    const { weekArg } = parseTeamAndWeekArgs(param);
    const targetWeek = await queryWeekID(weekArg || 0);
    if (!targetWeek || targetWeek.length === 0) {
      return { allowed: true };
    }

    const latestWeek = await queryWeekID(0);
    if (!latestWeek || latestWeek.length === 0) {
      return { allowed: true };
    }

    // If target week is NOT the current week (i.e. past week), allow viewing anytime
    if (targetWeek[0].id !== latestWeek[0].id) {
      return { allowed: true };
    }

    // It is the current week. Check if current time in Bangkok is after Friday 20:00
    const bkk = getBangkokCurrent();
    const matchDateObj = parseDateInput(latestWeek[0].date);

    if (matchDateObj && !isNaN(matchDateObj.getTime())) {
      const matchDow = matchDateObj.getDay();
      const diffToFriday = (matchDow >= 5) ? (matchDow - 5) : (matchDow + 2);
      const fridayDate = new Date(matchDateObj.getTime());
      fridayDate.setDate(fridayDate.getDate() - diffToFriday);

      const fridayYear = fridayDate.getFullYear();
      const fridayMonth = String(fridayDate.getMonth() + 1).padStart(2, '0');
      const fridayDay = String(fridayDate.getDate()).padStart(2, '0');
      const cutoffDateTimeStr = `${fridayYear}-${fridayMonth}-${fridayDay} 20:01:00`;

      if (bkk.currentDateTimeStr < cutoffDateTimeStr) {
        return {
          allowed: false,
          message: '⚠️ ระบบจะทำการสุ่มทีมในวันศุกร์ เวลา 20:00 น. ครับ'
        };
      }
      return { allowed: true };
    }

    // Fallback if match date cannot be parsed: check Bangkok current day of week and time
    // dow: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    if (bkk.dow === 5) {
      if (bkk.currentTimeStr < '20:00') {
        return {
          allowed: false,
          message: '⚠️ ระบบจะทำการสุ่มทีมในวันศุกร์ เวลา 20:00 น. ครับ'
        };
      }
      return { allowed: true };
    } else if (bkk.dow === 6 || bkk.dow === 0) {
      return { allowed: true };
    } else {
      return {
        allowed: false,
        message: '⚠️ ระบบจะทำการสุ่มทีมในวันศุกร์ เวลา 20:00 น. ครับ'
      };
    }
  } catch (err) {
    logger.error('[checkTeamWeekAccess] Error checking access:', err.message || err);
    return { allowed: true };
  }
}

async function getTeamFormationData(param = '', groupId = null, options = {}) {
  const tTotalStart = Date.now();

  // 1. DDL Checks
  const tDdlStart = Date.now();
  await ensurePosTables();
  const ddlDuration = Date.now() - tDdlStart;

  // 2. Metadata (Theme, Week, Colors)
  const tMetaStart = Date.now();
  const theme = await getTheme();
  const { teamArg, weekArg } = parseTeamAndWeekArgs(param, options.weekId);

  const week = await queryWeekID(weekArg || 0);
  if (!week || week.length === 0) return null;

  const weekId = week[0].id;
  const dateStr = week[0].date ? await getFormatDate(week[0].date, 'short') : '';
  const timeRange = week[0].time_range || '';
  const rawYear = week[0].date ? new Date(week[0].date).getFullYear() : new Date().getFullYear();
  const matchYear = normalizeCalendarYear(rawYear);

  const teamColors = await getTeamColorWeek(weekId);
  if (!teamColors || teamColors.length === 0) return null;

  let colorStats = null;
  try {
    colorStats = await getYearlyColorStatsCached(matchYear);
  } catch (e) {}

  let teamsToRender = teamColors;
  if (teamArg && teamArg.toLowerCase() !== 'all') {
    const lowerArg = teamArg.toLowerCase().trim().replace(/^ทีม\s*/i, '');
    const matched = teamColors.filter(t => {
      if (String(t.id) === teamArg) return true;
      const tColorLower = String(t.color || '').toLowerCase().trim();
      if (tColorLower === lowerArg || tColorLower.replace(/^ทีม\s*/i, '') === lowerArg) return true;
      if (tColorLower.includes(lowerArg)) return true;
      const num = parseInt(teamArg, 10);
      if (!isNaN(num) && num >= 1 && num <= teamColors.length) {
        return teamColors[num - 1].id === t.id;
      }
      return false;
    });
    if (matched.length > 0) {
      teamsToRender = matched;
    }
  }
  const metaDuration = Date.now() - tMetaStart;

  // 3. Current week stats directly from mvp_week_tbl
  const tWeekStatsStart = Date.now();
  const weekStatsMap = {};
  try {
    const weekRows = await executeQuery(
      "SELECT member_id, rating, goals, assists FROM mvp_week_tbl WHERE week_id = ?",
      [weekId]
    );
    if (weekRows && weekRows.length > 0) {
      weekRows.forEach(r => {
        weekStatsMap[r.member_id] = {
          rating: r.rating && Number(r.rating) > 0 ? parseFloat(r.rating).toFixed(1) : '-',
          goals: Number(r.goals) || 0,
          assists: Number(r.assists) || 0
        };
      });
    }
  } catch (e) { }
  const weekStatsDuration = Date.now() - tWeekStatsStart;

  // 4. Cached cumulative yearly stats from member_year_stat_tbl
  const tYearStatsStart = Date.now();
  const yearStatsMap = {};
  try {
    await ensureMemberYearStatTable();
    let yearRows = await executeQuery(
      "SELECT member_id, total_rating, avg_rating, max_rating, total_goals, total_assists, weeks_played FROM member_year_stat_tbl WHERE year = ?",
      [matchYear]
    );
    if (!yearRows || yearRows.length === 0) {
      // Seed cache on demand if not yet populated
      await updateYearStatCache(matchYear);
      yearRows = await executeQuery(
        "SELECT member_id, total_rating, avg_rating, max_rating, total_goals, total_assists, weeks_played FROM member_year_stat_tbl WHERE year = ?",
        [matchYear]
      );
    }
    if (yearRows && yearRows.length > 0) {
      yearRows.forEach(r => {
        const totalRating = parseFloat(r.total_rating || 0);
        const weeksPlayed = Number(r.weeks_played) || 0;
        const avg = weeksPlayed > 0 ? (totalRating / weeksPlayed).toFixed(1) : (r.avg_rating && Number(r.avg_rating) > 0 ? parseFloat(r.avg_rating).toFixed(1) : '-');

        yearStatsMap[r.member_id] = {
          totalRating: totalRating.toFixed(1),
          avgRating: avg !== '0.0' ? avg : '-',
          maxRating: r.max_rating && Number(r.max_rating) > 0 ? parseFloat(r.max_rating).toFixed(1) : '-',
          goals: Number(r.total_goals) || 0,
          assists: Number(r.total_assists) || 0,
          weeksCount: weeksPlayed
        };
      });
    }
  } catch (e) { }
  const yearStatsDuration = Date.now() - tYearStatsStart;

  // 4.5 Detect if this specific week has an 8-player team (max players in any team >= 8)
  let is8PlayerWeek = false;
  try {
    const teamCountsRes = await executeQuery(
      "SELECT team_id, COUNT(*) as cnt FROM member_team_week_tbl WHERE week_id = ? GROUP BY team_id",
      [weekId]
    );
    if (teamCountsRes && teamCountsRes.length > 0) {
      const maxCount = Math.max(...teamCountsRes.map(r => Number(r.cnt) || 0));
      if (maxCount >= 8) {
        is8PlayerWeek = true;
      }
    }
  } catch (e) { }

  // 4.6 Position Min/Max Limits from pos_tbl
  const posLimitsMap = {};
  try {
    const posRows = await executeQuery("SELECT code, min, max, min_8, max_8 FROM pos_tbl");
    if (posRows && posRows.length > 0) {
      posRows.forEach(r => {
        const code = (r.code || '').toUpperCase();
        posLimitsMap[code] = {
          min: r.min !== null && r.min !== undefined ? Number(r.min) : undefined,
          max: r.max !== null && r.max !== undefined ? Number(r.max) : undefined,
          min_8: r.min_8 !== null && r.min_8 !== undefined ? Number(r.min_8) : undefined,
          max_8: r.max_8 !== null && r.max_8 !== undefined ? Number(r.max_8) : undefined
        };
      });
    }
  } catch (e) {
    try {
      const posRows = await executeQuery("SELECT * FROM pos_tbl");
      if (posRows && posRows.length > 0) {
        posRows.forEach(r => {
          const code = (r.code || '').toUpperCase();
          posLimitsMap[code] = {
            min: r.min !== null && r.min !== undefined ? Number(r.min) : undefined,
            max: r.max !== null && r.max !== undefined ? Number(r.max) : undefined,
            min_8: r.min_8 !== null && r.min_8 !== undefined ? Number(r.min_8) : undefined,
            max_8: r.max_8 !== null && r.max_8 !== undefined ? Number(r.max_8) : undefined
          };
        });
      }
    } catch (e2) { }
  }

  // 5. Team Members Query & Line Avatar Check
  let totalMembersQueryDuration = 0;
  let totalLineAvatarDuration = 0;
  let totalTacticsDuration = 0;

  const formationsData = [];
  for (const team of teamsToRender) {
    const tMemSqlStart = Date.now();
    const memberSql = `
      SELECT 
        mtw.member_id,
        mtw.team_id,
        mtw.pos_id as week_pos_id,
        mtw.priority as week_priority,
        m.id,
        m.name,
        m.alias,
        m.rank,
        m.donate,
        m.picture_url,
        m.line_user_id,
        m.priority as member_priority,
        COALESCE(NULLIF(mtw.priority, 0), m.priority, 0) as priority,
        m.team_id as member_team_id,
        m.pos_id as member_pos_id,
        COALESCE(p_week.code, p_mem.code, '') as pos_code,
        COALESCE(p_week.name, p_mem.name, '') as pos_name,
        COALESCE(p_week.icon, p_mem.icon, '') as pos_icon
      FROM member_team_week_tbl mtw
      LEFT JOIN member_tbl m ON mtw.member_id = m.id
      LEFT JOIN pos_tbl p_week ON mtw.pos_id = p_week.id
      LEFT JOIN pos_tbl p_mem ON m.pos_id = p_mem.id
      WHERE mtw.week_id = ? AND mtw.team_id = ?
      ORDER BY mtw.id ASC
    `;
    const members = await executeQuery(memberSql, [weekId, team.id]);
    totalMembersQueryDuration += (Date.now() - tMemSqlStart);

    const tAvatarStart = Date.now();
    if (members && members.length > 0) {
      await Promise.all(members.map(m => ensureMemberPicture(m, groupId)));
    }
    totalLineAvatarDuration += (Date.now() - tAvatarStart);

    // Attach weekStats and yearStats to each member
    (members || []).forEach(m => {
      const wStat = weekStatsMap[m.id] || { rating: '-', goals: 0, assists: 0 };
      const yStat = yearStatsMap[m.id] || { avgRating: '-', maxRating: '-', goals: 0, assists: 0, weeksCount: 0 };

      m.weekStats = {
        rating: wStat.rating || '-',
        goals: wStat.goals || 0,
        assists: wStat.assists || 0
      };

      // Year rating fallback order: 1) member_year_stat_tbl avg_rating, 2) m.rank, 3) wStat.rating
      let resolvedYearRating = '-';
      if (yStat.avgRating && yStat.avgRating !== '-' && Number(yStat.avgRating) > 0) {
        resolvedYearRating = yStat.avgRating;
      } else if (m.rank && Number(m.rank) > 0) {
        resolvedYearRating = parseFloat(m.rank).toFixed(1);
      } else if (wStat.rating && wStat.rating !== '-' && Number(wStat.rating) > 0) {
        resolvedYearRating = wStat.rating;
      }

      m.yearStats = {
        rating: resolvedYearRating,
        avgRating: (yStat.avgRating && yStat.avgRating !== '-' && Number(yStat.avgRating) > 0) ? yStat.avgRating : resolvedYearRating,
        goals: yStat.goals || 0,
        assists: yStat.assists || 0,
        weeksCount: yStat.weeksCount || 0
      };
    });

    const tTacticsStart = Date.now();
    const isTeam8Player = (members && members.length >= 8) || is8PlayerWeek;
    const allocation = allocateFormationSlots(members || [], isTeam8Player, posLimitsMap);
    totalTacticsDuration += (Date.now() - tTacticsStart);

    const aliasMap = YEARLY_COLOR_USAGE_ALIASES[matchYear] || {};
    const rawColorKey = String(team.color || '').trim().toLowerCase();
    const canonicalColorKey = aliasMap[rawColorKey] || rawColorKey;
    const colorUsagePct = (colorStats && colorStats.percentages && colorStats.percentages[canonicalColorKey] !== undefined)
      ? colorStats.percentages[canonicalColorKey]
      : null;

    formationsData.push({
      teamId: team.id,
      teamColor: team.color,
      colorCode: team.code,
      colorUsagePct,
      url: team.url,
      formationName: allocation.formationName,
      slots: allocation.slots,
      totalPlayers: allocation.totalPlayers,
      members: members || []
    });
  }

  const totalDuration = Date.now() - tTotalStart;

  logger.info(`\n======================================================`);
  logger.info(`⏱️ [/formation Data Performance Breakdown]`);
  logger.info(`======================================================`);
  logger.info(`  1. Schema / DDL Check (ensurePosTables)      : ${ddlDuration} ms`);
  logger.info(`  2. Week & Theme Metadata Queries            : ${metaDuration} ms`);
  logger.info(`  3. Current Week Stats (mvp_week_tbl)         : ${weekStatsDuration} ms`);
  logger.info(`  4. Yearly Cumulative Stats (member_year_stat): ${yearStatsDuration} ms`);
  logger.info(`  5. Team Members SQL (${teamsToRender.length} teams)           : ${totalMembersQueryDuration} ms`);
  logger.info(`  6. LINE API Profile Avatars (if missing)    : ${totalLineAvatarDuration} ms`);
  logger.info(`  7. Tactical Slot Allocation (In-Memory)     : ${totalTacticsDuration} ms`);
  logger.info(`------------------------------------------------------`);
  logger.info(`  🚀 Total Data Server Time                   : ${totalDuration} ms`);
  logger.info(`======================================================\n`);

  return {
    formationsData,
    theme,
    dateStr,
    timeRange,
    weekId,
    weekDate: week[0].date
  };
}

async function populatePitchFormationImages(entries, teamImgMod, headerLabel = '[/formation Image Generation Performance]') {
  const tImgStart = Date.now();
  const teamDurations = [];
  let cachedImageCount = 0;
  let totalImageCount = 0;
  logger.info(`\n======================================================`);
  logger.info(`⏱️ ${headerLabel}`);
  logger.info(`======================================================`);

  const formatImgStatus = (url, cached) => {
    if (!url) return '❌';
    return cached ? '✅ (used cached image)' : '✅ (generated)';
  };

  await Promise.all((entries || []).map(async ({ team, dateStr, timeRange, label }) => {
    const tTeamStart = Date.now();
    try {
      const pitchRes = await teamImgMod.generateTeamImage(team, dateStr, timeRange, { pitchOnly: true, returnMeta: true });
      const dur = Date.now() - tTeamStart;
      teamDurations.push(dur);
      const pitchUrl = pitchRes?.url || pitchRes;
      const pitchCached = !!pitchRes?.cached;
      if (pitchUrl) {
        team.pitchImageUrl = pitchUrl;
        totalImageCount++;
        if (pitchCached) cachedImageCount++;
      }
      logger.info(`  ${label} Pitch: ${dur} ms  pitch=${formatImgStatus(pitchUrl, pitchCached)}`);
    } catch (eImg) {
      logger.warn(`  ${label.trim()} ❌ image failed: ${eImg.message}`);
    }
  }));

  const tImgWallClock = Date.now() - tImgStart;
  const tImgSum = teamDurations.reduce((a, b) => a + b, 0);
  logger.info(`------------------------------------------------------`);
  logger.info(`  🖼️  Wall-clock (parallel)   : ${tImgWallClock} ms  ← actual wait time`);
  logger.info(`  ∑   Sum (sequential equiv.) : ${tImgSum} ms  ← saved ${tImgSum - tImgWallClock} ms by running in parallel`);
  if (totalImageCount > 0) {
    logger.info(`  ⚡  Image Cache Status      : ${cachedImageCount}/${totalImageCount} images used cached (${totalImageCount - cachedImageCount} freshly generated)`);
  }
  logger.info(`======================================================\n`);
}

async function getTeamFormation(param = '', groupId = null) {
  const data = await getTeamFormationData(param, groupId);
  if (!data || !data.formationsData || data.formationsData.length === 0) return null;

  // Pre-generate high-res (1.5x) pitch-only tactical formation images in parallel (1 image per team via renderAsync)
  try {
    const teamImg = require('./team_img');
    const entries = data.formationsData.map(team => ({
      team,
      dateStr: data.dateStr,
      timeRange: data.timeRange,
      label: `Team ${team.teamId} (${team.teamColor || '-'}) `
    }));
    await populatePitchFormationImages(entries, teamImg, '[/formation Image Generation Performance]');
  } catch (err) {
    logger.warn('[getTeamFormation] team_img module error:', err.message);
  }

  const tFlexStart = Date.now();
  const flexMsg = flex.buildFormationFlex(data.formationsData, data.theme, data.dateStr, data.timeRange, data.weekDate, data.weekId);
  const flexDuration = Date.now() - tFlexStart;
  logger.info(`  8. LINE Flex JSON Builder                   : ${flexDuration} ms`);
  logger.info(`======================================================\n`);

  return flexMsg;
}

/**
 * Randomize registered players for the week into balanced teams by position & rating,
 * ensuring priority players (member_tbl.priority = 1) for the same position are placed in separate teams.
 * Rules:
 *  - Registered members <= 24 -> 3 teams
 *  - Registered members > 24 -> 4 teams
 *  - Team sizes: 7 or 8 players depending on count
 */
async function randomTeamByPosition(targetWeekId = 0, groupId = null) {
  let weekId = targetWeekId;
  if (!weekId || weekId === 0) {
    const weekRes = await queryWeekID(0);
    if (!weekRes || weekRes.length === 0) {
      return { status: 'NO_WEEK', message: 'ไม่พบสัปดาห์ปัจจุบัน' };
    }
    weekId = weekRes[0].id;
  }

  const weekInfo = await queryWeekID(weekId);
  const matchDate = weekInfo?.[0]?.date ? new Date(weekInfo[0].date) : new Date();
  const matchYear = matchDate.getFullYear() > 2400 ? matchDate.getFullYear() - 543 : matchDate.getFullYear();

  // 1. Fetch all registered members for this week
  const query = `
    SELECT 
      mtw.id as mtw_id,
      mtw.member_id,
      mtw.team_id,
      mtw.team as week_team,
      mtw.pos_id as week_pos_id,
      mtw.priority as week_priority,
      m.id,
      m.name,
      m.alias,
      m.rank,
      m.picture_url,
      m.line_user_id,
      m.avoid_ids,
      m.priority as member_priority,
      COALESCE(NULLIF(mtw.priority, 0), m.priority, 0) as priority,
      m.team_id as member_team_id,
      m.pos_id as member_pos_id,
      COALESCE(p_week.code, p_mem.code, '') as pos_code,
      COALESCE(p_week.name, p_mem.name, '') as pos_name
    FROM member_team_week_tbl mtw
    LEFT JOIN member_tbl m ON mtw.member_id = m.id
    LEFT JOIN pos_tbl p_week ON mtw.pos_id = p_week.id
    LEFT JOIN pos_tbl p_mem ON m.pos_id = p_mem.id
    WHERE mtw.week_id = ?
    ORDER BY mtw.id ASC
  `;
  const allRegistered = await executeQuery(query, [weekId]);
  if (!allRegistered || allRegistered.length === 0) {
    return { status: 'NO_PLAYERS', message: 'ยังไม่มีผู้เล่นลงทะเบียนในสัปดาห์นี้' };
  }

  // Separate goalkeepers (team_id = 100 in member_tbl) and outfield players.
  // Goalkeepers must NOT be assigned to any team in /randomteam.
  const isGoalie = (m) => Number(m.member_team_id) === 100;
  const goalieMembers = allRegistered.filter(isGoalie);
  const outfieldRegistered = allRegistered.filter(m => !isGoalie(m));

  // Ensure all goalkeepers have team_id = 0 (unassigned)
  if (goalieMembers.length > 0) {
    const goalieMtwIds = goalieMembers.map(r => r.mtw_id).filter(Boolean);
    if (goalieMtwIds.length > 0) {
      await executeQuery(
        `UPDATE member_team_week_tbl SET team_id = 0 WHERE id IN (${goalieMtwIds.join(',')})`
      );
    }
    logger.info(`[randomteam] Excluded ${goalieMembers.length} goalkeeper(s) (team_id=100) from team assignment: ${goalieMembers.map(r => r.name).join(', ')}`);
  }

  // Limit randomization strictly to outfield players within maxweek quota (FIFO by mtw.id ASC)
  const maxPlayers = (weekInfo && weekInfo[0] && weekInfo[0].max) ? Number(weekInfo[0].max) : 24;
  const registeredMembers = outfieldRegistered.slice(0, maxPlayers);
  const reserveMembers = outfieldRegistered.slice(maxPlayers);

  // Ensure any excess outfield reserve members beyond quota have no team assigned (team_id = 0)
  if (reserveMembers.length > 0) {
    const reserveMtwIds = reserveMembers.map(r => r.mtw_id).filter(Boolean);
    if (reserveMtwIds.length > 0) {
      await executeQuery(
        `UPDATE member_team_week_tbl SET team_id = 0 WHERE id IN (${reserveMtwIds.join(',')})`
      );
    }
    logger.info(`[randomteam] Capped strictly at max ${maxPlayers}. ${reserveMembers.length} reserve player(s) left unassigned: ${reserveMembers.map(r => r.name).join(', ')}`);
  }

  const N = registeredMembers.length;
  // Rule: maxweek > 24 or registered outfield > 24 -> 4 teams, otherwise 3 teams
  const K = (maxPlayers > 24 || N > 24) ? 4 : 3;

  // Check if all players within maxweek quota already have teams assigned
  const allHadTeam = registeredMembers.length > 0 && registeredMembers.every(m => Number(m.team_id) > 0);
  if (allHadTeam) {
    logger.info(`[randomteam] All ${registeredMembers.length} players (<= max ${maxPlayers}) already have teams. Skipping re-randomization.`);
    return {
      status: 'ALREADY_ASSIGNED',
      alreadyAssigned: true,
      weekId,
      teamCount: K,
      totalPlayers: N
    };
  }

  // 1.5 Build bidirectional avoidMap for multi-player conflict avoidance (supports single ID, '12', or comma-separated '12,25,38')
  const avoidMap = new Map();
  for (const m of registeredMembers) {
    const mId = Number(m.member_id || m.id);
    if (!avoidMap.has(mId)) avoidMap.set(mId, new Set());
    if (m.avoid_ids !== null && m.avoid_ids !== undefined && String(m.avoid_ids).trim() !== '') {
      const raw = String(m.avoid_ids);
      const targetIds = raw.split(/[,;\s]+/).map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0 && n !== mId);
      for (const targetId of targetIds) {
        avoidMap.get(mId).add(targetId);
        if (!avoidMap.has(targetId)) avoidMap.set(targetId, new Set());
        avoidMap.get(targetId).add(mId);
      }
    }
  }

  const countAvoidConflicts = (team, group) => {
    let conflicts = 0;
    const players = Array.isArray(group) ? group : [group];
    for (const p of players) {
      const pId = Number(p.member_id || p.id);
      const pAvoids = avoidMap.get(pId);
      if (!pAvoids || pAvoids.size === 0) continue;
      for (const tm of team.members) {
        const tmId = Number(tm.member_id || tm.id);
        if (pAvoids.has(tmId)) conflicts++;
      }
    }
    return conflicts;
  };

  const hasAvoidRule = (playerOrGroup) => {
    const players = Array.isArray(playerOrGroup) ? playerOrGroup : [playerOrGroup];
    return players.some(p => {
      const pId = Number(p.member_id || p.id);
      const pAvoids = avoidMap.get(pId);
      return pAvoids && pAvoids.size > 0;
    });
  };

  // 2. Ensure team colors for this week (K teams)
  await addTeamColorWeek(K, weekId);
  const teamColors = await getTeamColorWeek(weekId);
  if (!teamColors || teamColors.length < K) {
    return { status: 'ERROR', message: 'ไม่สามารถสร้างสีทีมได้ครบตามจำนวน' };
  }
  const activeTeams = teamColors.slice(0, K);

  // 3. Fetch yearly ratings for player score balancing
  const yearStatsMap = {};
  try {
    await ensureMemberYearStatTable();
    let yearRows = await executeQuery(
      "SELECT member_id, total_rating, avg_rating, max_rating, weeks_played FROM member_year_stat_tbl WHERE year = ?",
      [matchYear]
    );
    if (!yearRows || yearRows.length === 0) {
      await updateYearStatCache(matchYear);
      yearRows = await executeQuery(
        "SELECT member_id, total_rating, avg_rating, max_rating, weeks_played FROM member_year_stat_tbl WHERE year = ?",
        [matchYear]
      );
    }
    if (yearRows && yearRows.length > 0) {
      yearRows.forEach(r => {
        const weeksPlayed = Number(r.weeks_played) || 0;
        const totalRating = parseFloat(r.total_rating) || 0;
        const avg = parseFloat(r.avg_rating) || (weeksPlayed > 0 ? (totalRating / weeksPlayed) : 0);
        yearStatsMap[r.member_id] = avg > 0 ? avg : 0;
      });
    }
  } catch (e) { }

  // 3.5 Position Min/Max Limits & ID mapping from pos_tbl (for 7-player: min/max, for 8-player: min_8/max_8)
  await ensurePosTables();
  const posLimitsMap = {};
  const posCodeToIdMap = {};
  const posCodeToNameMap = {};
  try {
    const posRows = await executeQuery("SELECT id, code, name, min, max, min_8, max_8 FROM pos_tbl");
    if (posRows && posRows.length > 0) {
      posRows.forEach(r => {
        const code = (r.code || '').toUpperCase();
        if (r.id) posCodeToIdMap[code] = Number(r.id);
        if (r.name) posCodeToNameMap[code] = r.name;
        posLimitsMap[code] = {
          min: r.min !== null && r.min !== undefined ? Number(r.min) : undefined,
          max: r.max !== null && r.max !== undefined ? Number(r.max) : undefined,
          min_8: r.min_8 !== null && r.min_8 !== undefined ? Number(r.min_8) : undefined,
          max_8: r.max_8 !== null && r.max_8 !== undefined ? Number(r.max_8) : undefined
        };
      });
    }
  } catch (e) {
    try {
      const posRows = await executeQuery("SELECT * FROM pos_tbl");
      if (posRows && posRows.length > 0) {
        posRows.forEach(r => {
          const code = (r.code || '').toUpperCase();
          if (r.id) posCodeToIdMap[code] = Number(r.id);
          if (r.name) posCodeToNameMap[code] = r.name;
          posLimitsMap[code] = {
            min: r.min !== null && r.min !== undefined ? Number(r.min) : undefined,
            max: r.max !== null && r.max !== undefined ? Number(r.max) : undefined,
            min_8: r.min_8 !== null && r.min_8 !== undefined ? Number(r.min_8) : undefined,
            max_8: r.max_8 !== null && r.max_8 !== undefined ? Number(r.max_8) : undefined
          };
        });
      }
    } catch (e2) { }
  }

  // Ensure goalkeepers have GK pos_id in member_team_week_tbl if available
  if (goalieMembers.length > 0 && posCodeToIdMap['GK']) {
    const goalieMtwIds = goalieMembers.map(r => r.mtw_id).filter(Boolean);
    if (goalieMtwIds.length > 0) {
      await executeQuery(
        `UPDATE member_team_week_tbl SET pos_id = ? WHERE id IN (${goalieMtwIds.join(',')}) AND (pos_id IS NULL OR pos_id = 0)`,
        [posCodeToIdMap['GK']]
      );
    }
  }

  const defaultLimits = {
    DF: { min: 1, max: 2, min_8: 1, max_8: 3 },
    DW: { min: 2, max: 2, min_8: 2, max_8: 2 },
    DM: { min: 0, max: 1, min_8: 0, max_8: 1 },
    MF: { min: 1, max: 2, min_8: 1, max_8: 3 },
    AM: { min: 0, max: 1, min_8: 0, max_8: 2 },
    CF: { min: 0, max: 1, min_8: 0, max_8: 2 },
    GK: { min: 0, max: 1, min_8: 0, max_8: 1 }
  };

  const getTeamPosLimit = (team, pos) => {
    const is8 = team.maxCapacity >= 8;
    const lim = posLimitsMap[pos] || {};
    const def = defaultLimits[pos] || { min: 0, max: 2, min_8: 0, max_8: 2 };
    if (is8) {
      return {
        min: lim.min_8 !== undefined && !isNaN(lim.min_8) ? Number(lim.min_8) : (lim.min !== undefined && !isNaN(lim.min) ? Number(lim.min) : (def.min_8 !== undefined ? def.min_8 : def.min)),
        max: lim.max_8 !== undefined && !isNaN(lim.max_8) ? Number(lim.max_8) : (lim.max !== undefined && !isNaN(lim.max) ? Number(lim.max) : (def.max_8 !== undefined ? def.max_8 : def.max))
      };
    }
    return {
      min: lim.min !== undefined && !isNaN(lim.min) ? Number(lim.min) : def.min,
      max: lim.max !== undefined && !isNaN(lim.max) ? Number(lim.max) : def.max
    };
  };

  // Attach rating to each member
  for (const m of registeredMembers) {
    const yAvg = yearStatsMap[m.member_id] || 0;
    const rankVal = parseFloat(m.rank || 0) || 0;
    m.rating = yAvg > 0 ? yAvg : (rankVal > 0 ? rankVal : 0);
    m.yearStats = {
      avgRating: yAvg > 0 ? yAvg.toFixed(1) : (m.rating > 0 ? m.rating.toFixed(1) : '-'),
      rating: m.rating > 0 ? m.rating.toFixed(1) : '-'
    };
    m.posCode = (m.pos_code || 'MF').toUpperCase();
  }

  // 4. Calculate team capacities & shuffle team color assignment for variety
  const baseCap = Math.floor(N / K);
  const extraCount = N % K;

  const shuffledTeamColors = shuffleArray([...activeTeams]);
  const teams = shuffledTeamColors.map((tc, idx) => ({
    teamColorObj: tc,
    teamId: tc.id,
    teamIndex: tc.index || (idx + 1),
    color: tc.color,
    maxCapacity: idx < extraCount ? (baseCap + 1) : baseCap,
    members: [],
    positionCounts: { GK: 0, DF: 0, DW: 0, DM: 0, MF: 0, AM: 0, CF: 0, OTHER: 0 },
    ratingSum: 0
  }));

  const assignedMemberIds = new Set();
  const addPlayerToTeam = (player, team) => {
    team.members.push(player);
    const pos = team.positionCounts[player.posCode] !== undefined ? player.posCode : 'OTHER';
    team.positionCounts[pos]++;
    team.ratingSum += player.rating;
    assignedMemberIds.add(player.member_id);
  };

  const getMemberPriority = (m) => {
    const weekPriority = Number(m.week_priority);
    if (!isNaN(weekPriority) && weekPriority > 0) return weekPriority;
    return Number(m.priority !== undefined ? m.priority : (m.member_priority !== undefined ? m.member_priority : m.member_team_id)) || 0;
  };

  // Helper to retrieve all unassigned members belonging to the same strict group (mtw.team > 0)
  const getUnassignedGroup = (player) => {
    const groupNum = Number(player.week_team);
    if (!isNaN(groupNum) && groupNum > 0) {
      return registeredMembers.filter(m => !assignedMemberIds.has(m.member_id) && Number(m.week_team) === groupNum);
    }
    return assignedMemberIds.has(player.member_id) ? [] : [player];
  };

  const placeGroupIntoTeam = (group, team) => {
    for (const p of group) {
      addPlayerToTeam(p, team);
    }
  };

  // Helper to find best candidate teams with enough capacity for a group
  const findCandidateTeamsForGroup = (groupLength) => {
    let candidateTeams = teams.filter(t => t.members.length + groupLength <= t.maxCapacity);
    if (candidateTeams.length === 0) {
      // Fallback: teams with the most available room
      candidateTeams = [...teams].sort((a, b) => (b.maxCapacity - b.members.length) - (a.maxCapacity - a.members.length));
    }
    return candidateTeams;
  };

  // Standard position order for distribution (Outfield positions only, no GK selection)
  const posOrder = ['DF', 'DW', 'DM', 'MF', 'AM', 'CF'];

  // Helper to pick the best candidate team with balanced capacity, position room, zero avoid conflicts, and randomized tie-breaking
  const pickBestTeam = (candidatePool, group, playerPos, isPriority1 = false) => {
    if (!candidatePool || candidatePool.length === 0) return null;

    let pool = candidatePool;

    // Filter teams that have zero avoid conflicts
    if (hasAvoidRule(group)) {
      const minConflicts = Math.min(...pool.map(t => countAvoidConflicts(t, group)));
      const zeroConflictPool = pool.filter(t => countAvoidConflicts(t, group) === minConflicts);
      if (zeroConflictPool.length > 0) {
        pool = zeroConflictPool;
      }
    }

    // If Priority 1, prefer teams that do NOT already have a Priority 1 in this same position
    if (isPriority1 && playerPos) {
      const withoutP1InPos = pool.filter(t => !t.members.some(m => getMemberPriority(m) === 1 && m.posCode === playerPos));
      if (withoutP1InPos.length > 0) {
        pool = withoutP1InPos;
      }
    }

    // Shuffle pool for high variance across runs
    const shuffledPool = shuffleArray([...pool]);
    shuffledPool.sort((a, b) => {
      // 1. Conflict difference (fewest avoid conflicts)
      const confDiff = countAvoidConflicts(a, group) - countAvoidConflicts(b, group);
      if (confDiff !== 0) return confDiff;

      // 2. Position count difference (balance position counts)
      if (playerPos) {
        const posDiff = (a.positionCounts[playerPos] || 0) - (b.positionCounts[playerPos] || 0);
        if (posDiff !== 0) return posDiff;
      }

      // 3. Team member count difference (balance team sizes)
      const countDiff = a.members.length - b.members.length;
      if (countDiff !== 0) return countDiff;

      // 4. Rating difference (balance overall skill)
      const ratingDiff = a.ratingSum - b.ratingSum;
      if (Math.abs(ratingDiff) > 1.2) return ratingDiff;

      // 5. Random tie-break
      return 0;
    });

    return shuffledPool[0];
  };

  // =========================================================================
  // Phase 0: Lock in Pre-assigned Members (players who already have a team)
  // Rule: ถ้ามีทีมอยู่แล้ว เวลา /randomteam ไม่ต้องเปลี่ยนทีม
  // =========================================================================
  const preassignedMembers = registeredMembers.filter(m => Number(m.team_id) > 0 && Number(m.team_id) !== 100);
  for (const m of preassignedMembers) {
    const tId = Number(m.team_id);
    const existingTeam = teams.find(t => t.teamId === tId) || teams.find(t => t.teamIndex === tId);
    if (existingTeam) {
      addPlayerToTeam(m, existingTeam);
      logger.info(`[randomteam] Preserved pre-assigned team ${existingTeam.color} for player ${m.name || m.alias} (id: ${m.member_id})`);
    }
  }

  // Ensure team capacities accommodate pre-assigned players and remaining unassigned players
  for (const t of teams) {
    if (t.members.length > t.maxCapacity) {
      t.maxCapacity = t.members.length;
    }
  }
  const unassignedCount = registeredMembers.filter(m => !assignedMemberIds.has(m.member_id)).length;
  let remainingCapacity = teams.reduce((sum, t) => sum + Math.max(0, t.maxCapacity - t.members.length), 0);
  while (remainingCapacity < unassignedCount) {
    const candidateTeam = [...teams].sort((a, b) => a.members.length - b.members.length)[0];
    candidateTeam.maxCapacity++;
    remainingCapacity++;
  }

  // =========================================================================
  // Phase 1: Place Bound Groups First (member_team_week_tbl.team > 0)
  // Members sharing the same team number must be placed on the same team
  // =========================================================================
  const boundGroupsMap = {};
  for (const m of registeredMembers) {
    const gNum = Number(m.week_team);
    if (!isNaN(gNum) && gNum > 0) {
      if (!boundGroupsMap[gNum]) boundGroupsMap[gNum] = [];
      boundGroupsMap[gNum].push(m);
    }
  }

  const boundGroupNums = shuffleArray(Object.keys(boundGroupsMap).map(Number));
  // Sort descending by size so larger bound groups get placed first
  boundGroupNums.sort((a, b) => boundGroupsMap[b].length - boundGroupsMap[a].length);

  for (const gNum of boundGroupNums) {
    const group = boundGroupsMap[gNum].filter(m => !assignedMemberIds.has(m.member_id));
    if (group.length === 0) continue;

    // If any member of this bound group was already pre-assigned to a team, place the remaining members in that same team
    const alreadyAssignedMember = boundGroupsMap[gNum].find(m => assignedMemberIds.has(m.member_id));
    let preassignedGroupTeam = null;
    if (alreadyAssignedMember) {
      preassignedGroupTeam = teams.find(t => t.members.some(tm => tm.member_id === alreadyAssignedMember.member_id));
    }

    if (preassignedGroupTeam) {
      placeGroupIntoTeam(group, preassignedGroupTeam);
    } else {
      const candidateTeams = findCandidateTeamsForGroup(group.length);
      const bestTeam = pickBestTeam(candidateTeams, group, group[0]?.posCode, false);
      if (bestTeam) {
        placeGroupIntoTeam(group, bestTeam);
      }
    }
  }

  // =========================================================================
  // Phase 2: Place Priority 1 for each position
  // =========================================================================
  const allPositionsShuffled = shuffleArray([...posOrder]);
  for (const pos of allPositionsShuffled) {
    const p1InPos = registeredMembers.filter(m => !assignedMemberIds.has(m.member_id) && getMemberPriority(m) === 1 && m.posCode === pos);
    shuffleArray(p1InPos);

    for (const player of p1InPos) {
      if (assignedMemberIds.has(player.member_id)) continue;
      const group = getUnassignedGroup(player);
      if (group.length === 0) continue;

      const candidateTeams = findCandidateTeamsForGroup(group.length);
      const teamsUnderPosMax = candidateTeams.filter(t => (t.positionCounts[pos] || 0) < getTeamPosLimit(t, pos).max);
      const pool = teamsUnderPosMax.length > 0 ? teamsUnderPosMax : candidateTeams;

      const bestTeam = pickBestTeam(pool, group, pos, true);
      if (bestTeam) {
        placeGroupIntoTeam(group, bestTeam);
      }
    }
  }

  // =========================================================================
  // Phase 3: Push avoid_ids (Players with conflict avoidance constraints)
  // =========================================================================
  const avoidPlayers = registeredMembers.filter(m => !assignedMemberIds.has(m.member_id) && hasAvoidRule(m));
  shuffleArray(avoidPlayers);

  for (const player of avoidPlayers) {
    if (assignedMemberIds.has(player.member_id)) continue;
    const group = getUnassignedGroup(player);
    if (group.length === 0) continue;

    const candidateTeams = findCandidateTeamsForGroup(group.length);
    const teamsUnderPosMax = candidateTeams.filter(t => (t.positionCounts[player.posCode] || 0) < getTeamPosLimit(t, player.posCode).max);
    const pool = teamsUnderPosMax.length > 0 ? teamsUnderPosMax : candidateTeams;

    const bestTeam = pickBestTeam(pool, group, player.posCode, false);
    if (bestTeam) {
      placeGroupIntoTeam(group, bestTeam);
    }
  }

  // =========================================================================
  // Phase 4: Push remaining members in positions by priority (Priority 2, then Priority 0/Regular)
  // =========================================================================
  const remainingTiers = [2, 0];
  for (const tier of remainingTiers) {
    const positionsInTier = shuffleArray([...posOrder]);
    for (const pos of positionsInTier) {
      const playersInTier = registeredMembers.filter(m =>
        !assignedMemberIds.has(m.member_id) &&
        (tier === 0 ? (getMemberPriority(m) !== 1 && getMemberPriority(m) !== 2) : getMemberPriority(m) === tier) &&
        m.posCode === pos
      );
      shuffleArray(playersInTier);

      for (const player of playersInTier) {
        if (assignedMemberIds.has(player.member_id)) continue;
        const group = getUnassignedGroup(player);
        if (group.length === 0) continue;

        const candidateTeams = findCandidateTeamsForGroup(group.length);
        const teamsUnderPosMax = candidateTeams.filter(t => (t.positionCounts[pos] || 0) < getTeamPosLimit(t, pos).max);
        const pool = teamsUnderPosMax.length > 0 ? teamsUnderPosMax : candidateTeams;

        const bestTeam = pickBestTeam(pool, group, pos, false);
        if (bestTeam) {
          placeGroupIntoTeam(group, bestTeam);
        }
      }
    }
  }

  // =========================================================================
  // Phase 5: Fallback for any unassigned player
  // =========================================================================
  for (const player of registeredMembers) {
    if (!assignedMemberIds.has(player.member_id)) {
      const group = getUnassignedGroup(player);
      if (group.length === 0) continue;
      const candidateTeams = findCandidateTeamsForGroup(group.length);
      const bestTeam = pickBestTeam(candidateTeams.length > 0 ? candidateTeams : teams, group, player.posCode, false);
      if (bestTeam) {
        placeGroupIntoTeam(group, bestTeam);
      }
    }
  }

  // 9. Allocate Tactical Formation Positions & Persist Team + Position Assignments into Database (member_team_week_tbl)
  const is8PlayerWeek = teams.some(t => t.members.length >= 8);
  for (const team of teams) {
    const isTeam8Player = (team.members.length >= 8) || is8PlayerWeek;
    allocateFormationSlots(team.members, isTeam8Player, posLimitsMap);

    team.positionCounts = { GK: 0, DF: 0, DW: 0, DM: 0, MF: 0, AM: 0, CF: 0, OTHER: 0 };
    for (const member of team.members) {
      const assignedPosCode = (member.effectivePos || member.posCode || member.pos_code || 'MF').toUpperCase();
      const assignedPosId = posCodeToIdMap[assignedPosCode] || Number(member.week_pos_id) || Number(member.member_pos_id) || 0;

      member.posCode = assignedPosCode;
      member.pos_code = assignedPosCode;
      member.week_pos_id = assignedPosId;
      if (posCodeToNameMap[assignedPosCode]) {
        member.pos_name = posCodeToNameMap[assignedPosCode];
      }

      const countKey = team.positionCounts[assignedPosCode] !== undefined ? assignedPosCode : 'OTHER';
      team.positionCounts[countKey]++;

      await executeQuery(
        "UPDATE member_team_week_tbl SET team_id = ?, pos_id = ? WHERE member_id = ? AND week_id = ?",
        [team.teamId, assignedPosId, member.member_id, weekId]
      );
    }
  }

  return {
    status: 'SUCCESS',
    weekId,
    teamCount: K,
    totalPlayers: N,
    teams: teams.map(t => ({
      teamId: t.teamId,
      teamIndex: t.teamIndex,
      color: t.color,
      playerCount: t.members.length,
      avgRating: t.members.length > 0 ? (t.ratingSum / t.members.length).toFixed(2) : '0.00',
      positionCounts: t.positionCounts,
      members: t.members
    }))
  };
}

async function saveActiveGroupId(groupId) {
  if (!groupId || typeof groupId !== 'string') return;
  lastGroupId = groupId;
  try {
    const existing = await executeQuery("SELECT id FROM template_tpl WHERE name = 'active_group_id'");
    if (existing.length > 0) {
      await executeQuery("UPDATE template_tpl SET value = ? WHERE name = 'active_group_id'", [groupId]);
    } else {
      await executeQuery("INSERT INTO template_tpl (name, value) VALUES ('active_group_id', ?)", [groupId]);
    }
  } catch (err) {
    logger.error('Error saving active_group_id in template_tpl:', err.message);
  }
}

async function getActiveGroupId() {
  if (process.env.LINE_GROUP_ID) {
    return process.env.LINE_GROUP_ID;
  }
  if (lastGroupId) {
    return lastGroupId;
  }
  try {
    const res = await executeQuery("SELECT value FROM template_tpl WHERE name = 'active_group_id'");
    if (res.length > 0 && res[0].value) {
      lastGroupId = res[0].value;
      return res[0].value;
    }
  } catch (err) {
    logger.error('Error querying active_group_id from template_tpl:', err.message);
  }
  return null;
}

let lastPersistedBaseUrl = null;

async function saveBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return;
  let clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean.startsWith('http://')) {
    clean = clean.replace(/^http:\/\//i, 'https://');
  }
  if (lastPersistedBaseUrl === clean) return;
  lastPersistedBaseUrl = clean;

  try {
    const existing = await executeQuery("SELECT id FROM template_tpl WHERE name = 'base_webhook_url'");
    if (existing.length > 0) {
      await executeQuery("UPDATE template_tpl SET value = ? WHERE name = 'base_webhook_url'", [clean]);
    } else {
      await executeQuery("INSERT INTO template_tpl (name, value) VALUES ('base_webhook_url', ?)", [clean]);
    }
  } catch (err) {
    logger.error('Error saving base_webhook_url in template_tpl:', err.message);
  }
}

async function getBaseUrlFromDb() {
  if (global.baseWebhookUrl) {
    return global.baseWebhookUrl;
  }
  if (process.env.BASE_WEBHOOK_URL) {
    return process.env.BASE_WEBHOOK_URL;
  }
  if (lastPersistedBaseUrl) {
    return lastPersistedBaseUrl;
  }
  try {
    const res = await executeQuery("SELECT value FROM template_tpl WHERE name = 'base_webhook_url'");
    if (res.length > 0 && res[0].value) {
      lastPersistedBaseUrl = res[0].value;
      return res[0].value;
    }
  } catch (err) {
    logger.error('Error querying base_webhook_url from template_tpl:', err.message);
  }
  return null;
}

async function getTaskGroupId(taskId) {
  if (!taskId || typeof taskId !== 'string') return null;

  // 1. Check environment variables (e.g. GROUP_ID_DEBT_CALL or DEBT_CALL_GROUP_ID)
  const normalized = taskId.toUpperCase();
  if (process.env[`GROUP_ID_${normalized}`]) return await resolveLineGroupId(process.env[`GROUP_ID_${normalized}`]);
  if (process.env[`${normalized}_GROUP_ID`]) return await resolveLineGroupId(process.env[`${normalized}_GROUP_ID`]);

  // 2. Query template_tpl by task identifier keys
  const key1 = `group_id_${taskId.toLowerCase()}`;
  const key2 = `${taskId.toLowerCase()}_group_id`;
  const key3 = taskId.toLowerCase();

  try {
    const res = await executeQuery(
      "SELECT value FROM template_tpl WHERE name IN (?, ?, ?) ORDER BY CASE name WHEN ? THEN 1 WHEN ? THEN 2 WHEN ? THEN 3 ELSE 4 END LIMIT 1",
      [key1, key2, key3, key1, key2, key3]
    );
    if (res.length > 0 && res[0].value) {
      return await resolveLineGroupId(res[0].value);
    }
  } catch (err) {
    logger.error(`Error querying task group_id for '${taskId}' from template_tpl:`, err.message);
  }
  return null;
}

async function saveTaskGroupId(taskId, groupId) {
  if (!taskId || !groupId || typeof groupId !== 'string') return;
  const key = `group_id_${taskId.toLowerCase()}`;
  try {
    const existing = await executeQuery("SELECT id FROM template_tpl WHERE name = ?", [key]);
    if (existing.length > 0) {
      await executeQuery("UPDATE template_tpl SET value = ? WHERE name = ?", [groupId, key]);
    } else {
      await executeQuery("INSERT INTO template_tpl (name, value) VALUES (?, ?)", [key, groupId]);
    }
  } catch (err) {
    logger.error(`Error saving ${key} in template_tpl:`, err.message);
  }
}

/**
 * Saves or updates a LINE group profile in line_group_id_tbl.
 * @param {string} lineGroupId 
 * @param {string|null} [groupName=null] 
 * @param {number|null} [memberCount=null] 
 * @param {string|null} [pictureUrl=null] 
 * @returns {Promise<Object|null>}
 */
async function saveGroupProfile(lineGroupId, groupName = null, memberCount = null, pictureUrl = null) {
  if (!lineGroupId || typeof lineGroupId !== 'string') return null;
  const cleanId = lineGroupId.trim();
  if (!cleanId) return null;
  const cleanName = (groupName && typeof groupName === 'string') ? groupName.trim() : null;
  const cleanCount = typeof memberCount === 'number' ? memberCount : null;
  const cleanPic = (pictureUrl && typeof pictureUrl === 'string') ? pictureUrl.trim() : null;

  // Optimistically update in-memory cache immediately
  const existing = groupCache.get(cleanId);
  updateGroupCache({
    id: existing ? existing.id : undefined,
    line_group_id: cleanId,
    group_name: cleanName || (existing ? existing.group_name : null),
    member_count: cleanCount !== null ? cleanCount : (existing ? existing.member_count : null),
    picture_url: cleanPic || (existing ? existing.picture_url : null)
  });

  try {
    const sql = `
      INSERT INTO line_group_id_tbl (line_group_id, group_name, member_count, picture_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (line_group_id) DO UPDATE SET
        group_name = COALESCE(EXCLUDED.group_name, line_group_id_tbl.group_name),
        member_count = COALESCE(EXCLUDED.member_count, line_group_id_tbl.member_count),
        picture_url = COALESCE(EXCLUDED.picture_url, line_group_id_tbl.picture_url),
        updated_at = CURRENT_TIMESTAMP
    `;
    await executeQuery(sql, [cleanId, cleanName, cleanCount, cleanPic]);

    const rows = await executeQuery("SELECT * FROM line_group_id_tbl WHERE line_group_id = ?", [cleanId]);
    if (rows.length > 0) {
      const record = rows[0];
      updateGroupCache(record);
      return record;
    }
  } catch (err) {
    logger.error(`Error saving group profile for ${cleanId}:`, err.message);
  }
  return null;
}

/**
 * Gets a group profile by line_group_id or numeric line_group_id_tbl.id.
 * @param {string|number} groupIdOrId 
 * @returns {Promise<Object|null>}
 */
async function getGroupProfile(groupIdOrId) {
  if (!groupIdOrId) return null;
  const key = String(groupIdOrId).trim();
  if (groupCache.has(key)) {
    return groupCache.get(key);
  }

  try {
    if (/^\d+$/.test(key)) {
      const rows = await executeQuery("SELECT * FROM line_group_id_tbl WHERE id = ?", [parseInt(key, 10)]);
      if (rows.length > 0) {
        updateGroupCache(rows[0]);
        return rows[0];
      }
    }
    const rows = await executeQuery("SELECT * FROM line_group_id_tbl WHERE line_group_id = ?", [key]);
    if (rows.length > 0) {
      updateGroupCache(rows[0]);
      return rows[0];
    }
  } catch (err) {
    logger.error(`Error fetching group profile for ${groupIdOrId}:`, err.message);
  }
  return null;
}

/**
 * Resolves a group identifier (which may be a numeric line_group_id_tbl.id or a raw line_group_id string)
 * to the actual LINE group ID string.
 * @param {string|number} groupIdOrId 
 * @returns {Promise<string|null>}
 */
async function resolveLineGroupId(groupIdOrId) {
  if (!groupIdOrId) return null;
  const key = String(groupIdOrId).trim();
  if (groupCache.has(key)) {
    return groupCache.get(key).line_group_id;
  }

  try {
    if (/^\d+$/.test(key)) {
      const rows = await executeQuery("SELECT line_group_id FROM line_group_id_tbl WHERE id = ?", [parseInt(key, 10)]);
      if (rows.length > 0 && rows[0].line_group_id) {
        return rows[0].line_group_id;
      }
    }
    const rows = await executeQuery("SELECT line_group_id FROM line_group_id_tbl WHERE line_group_id = ?", [key]);
    if (rows.length > 0 && rows[0].line_group_id) {
      return rows[0].line_group_id;
    }
  } catch (err) {
    logger.error(`Error resolving line_group_id for ${groupIdOrId}:`, err.message);
  }
  return key;
}

/**
 * Returns a formatted group tag for logging with automatic group name truncation.
 * Example: ' [Group: บอลเสาร์-อาทิต...]' or ' [Direct]'
 * @param {string|number} [groupId] 
 * @param {number} [maxLength=18] 
 * @returns {string}
 */
function getGroupTag(groupId, maxLength = 18) {
  if (!groupId) return ' [Direct]';
  const key = String(groupId).trim();
  const cached = groupCache.get(key);

  if (cached && cached.group_name) {
    let name = cached.group_name.trim();
    if (name.length > maxLength) {
      name = name.substring(0, maxLength - 1) + '…';
    }
    return `[${name}]`;
  }

  // Fallback to shortened group ID if group name not cached yet
  if (key.length > 12) {
    const shortId = `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
    return ` [Group: ${shortId}]`;
  }
  return ` [Group: ${key}]`;
}

/**
 * Periodically or on-demand syncs group profile from LINE API and updates DB.
 * @param {string} lineGroupId 
 * @param {Object} lineClient 
 * @param {boolean} [force=false] 
 */
async function syncGroupProfile(lineGroupId, lineClient, force = false) {
  if (!lineGroupId || typeof lineGroupId !== 'string') return;
  const cleanId = lineGroupId.trim();
  if (!cleanId || cleanId.startsWith('U') || cleanId.startsWith('R')) return; // Ignore user IDs or room IDs

  const now = Date.now();
  const last = lastGroupSync.get(cleanId) || 0;
  if (!force && (now - last < GROUP_SYNC_INTERVAL_MS)) return;
  lastGroupSync.set(cleanId, now);

  try {
    if (!lineClient || typeof lineClient.fetchGroupProfile !== 'function') return;
    const profile = await lineClient.fetchGroupProfile(cleanId);
    if (profile && (profile.groupName || profile.memberCount !== null)) {
      await saveGroupProfile(cleanId, profile.groupName, profile.memberCount, profile.pictureUrl);
    }
  } catch (err) {
    logger.error(`Error syncing group profile for ${cleanId}:`, err.message);
  }
}

/**
 * Retrieves scheduled tasks from scheduled_task_tbl.
 * Resolves group_id against line_group_id_tbl.id if numeric or mapped.
 * @param {boolean} [onlyEnabled=false] 
 * @returns {Promise<Array<Object>>}
 */
async function getScheduledTasks(onlyEnabled = false) {
  try {
    const sql = onlyEnabled
      ? "SELECT * FROM scheduled_task_tbl WHERE enabled = 1 ORDER BY id ASC"
      : "SELECT * FROM scheduled_task_tbl ORDER BY id ASC";
    const tasks = await executeQuery(sql);
    for (const t of tasks) {
      if (t.group_id) {
        t.raw_group_id = t.group_id;
        t.group_id = await resolveLineGroupId(t.group_id);
      }
    }
    return tasks;
  } catch (err) {
    logger.error('Error querying scheduled_task_tbl:', err.message);
    return [];
  }
}

/**
 * Retrieves a scheduled task by ID or task_key.
 * Resolves group_id against line_group_id_tbl.id if numeric or mapped.
 * @param {string|number} keyOrId 
 * @returns {Promise<Object|null>}
 */
async function getScheduledTaskByKey(keyOrId) {
  if (!keyOrId) return null;
  try {
    const sql = "SELECT * FROM scheduled_task_tbl WHERE task_key = ? OR id = ? LIMIT 1";
    const rows = await executeQuery(
      sql,
      [String(keyOrId), isNaN(Number(keyOrId)) ? -1 : Number(keyOrId)]
    );
    if (rows.length > 0) {
      const task = rows[0];
      if (task.group_id) {
        task.group_id = await resolveLineGroupId(task.group_id);
      }
      return task;
    }
    return null;
  } catch (err) {
    logger.error(`Error querying scheduled task '${keyOrId}':`, err.message);
    return null;
  }
}

/**
 * Adds a new scheduled task to scheduled_task_tbl.
 * @param {Object} taskData 
 * @returns {Promise<Object>}
 */
async function addScheduledTask(taskData) {
  const {
    task_key,
    task_name,
    task_type = 'command',
    command = null,
    text_message = null,
    schedule_days = '*',
    schedule_time = '20:00',
    group_id = null,
    delivery_mode = 'push',
    expire_minutes = 60,
    enabled = 1
  } = taskData;

  const sql = `
    INSERT INTO scheduled_task_tbl 
      (task_key, task_name, task_type, command, text_message, schedule_days, schedule_time, group_id, delivery_mode, expire_minutes, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `;
  const result = await executeQuery(sql, [
    task_key,
    task_name || task_key,
    task_type,
    command,
    text_message,
    schedule_days,
    schedule_time,
    group_id,
    delivery_mode || 'push',
    expire_minutes !== undefined ? expire_minutes : 60,
    enabled ? 1 : 0
  ]);
  return { success: true, insertId: result.insertId };
}

/**
 * Updates a scheduled task by ID or task_key.
 * @param {string|number} keyOrId 
 * @param {Object} taskData 
 * @returns {Promise<boolean>}
 */
async function updateScheduledTask(keyOrId, taskData) {
  if (!keyOrId || !taskData || typeof taskData !== 'object') return false;
  const fields = [];
  const values = [];

  const allowedCols = ['task_key', 'task_name', 'task_type', 'command', 'text_message', 'schedule_days', 'schedule_time', 'group_id', 'delivery_mode', 'expire_minutes', 'enabled', 'last_run_date'];
  for (const col of allowedCols) {
    if (taskData[col] !== undefined) {
      fields.push(`"${col}" = ?`);
      values.push(taskData[col]);
    }
  }

  if (fields.length === 0) return false;

  values.push(String(keyOrId));
  values.push(isNaN(Number(keyOrId)) ? -1 : Number(keyOrId));

  const sql = `UPDATE scheduled_task_tbl SET ${fields.join(', ')} WHERE task_key = ? OR id = ?`;
  await executeQuery(sql, values);
  return true;
}

/**
 * Deletes a scheduled task by ID or task_key.
 * @param {string|number} keyOrId 
 * @returns {Promise<boolean>}
 */
async function deleteScheduledTask(keyOrId) {
  if (!keyOrId) return false;
  const sql = "DELETE FROM scheduled_task_tbl WHERE task_key = ? OR id = ?";
  const result = await executeQuery(sql, [String(keyOrId), isNaN(Number(keyOrId)) ? -1 : Number(keyOrId)]);
  return result.affectedRows > 0;
}

/**
 * Updates last_run_date for a scheduled task with full datetime (YYYY-MM-DD HH:mm:ss).
 * @param {string|number} keyOrId 
 * @param {string|null} [dateOrDateTimeStr=null] - Optional datetime string, defaults to Bangkok current datetime
/**
 * Sets last_run_date for a scheduled task by task_key or database id.
 * @param {string|number} keyOrId 
 * @param {string|null} [dateOrDateTimeStr=null] 
 * @param {number|null} [fallbackId=null]
 * @returns {Promise<boolean>}
 */
async function setScheduledTaskLastRun(keyOrId, dateOrDateTimeStr = null, fallbackId = null) {
  if (!keyOrId && !fallbackId) return false;
  const val = dateOrDateTimeStr || getBangkokCurrent().currentDateTimeStr;
  const sql = "UPDATE scheduled_task_tbl SET last_run_date = ? WHERE task_key = ? OR id = ? OR id = ?";
  const numKey = !isNaN(Number(keyOrId)) ? Number(keyOrId) : -1;
  const numFallback = fallbackId && !isNaN(Number(fallbackId)) ? Number(fallbackId) : -1;
  await executeQuery(sql, [val, String(keyOrId || ''), numKey, numFallback]);
  return true;
}

/**
 * Toggles or sets enabled status for a scheduled task.
 * @param {string|number} keyOrId 
 * @param {boolean|number|null} [forcedStatus=null] 
 * @returns {Promise<boolean|null>}
 */
async function toggleScheduledTask(keyOrId, forcedStatus = null) {
  if (!keyOrId) return null;
  const task = await getScheduledTaskByKey(keyOrId);
  if (!task) return null;

  const newStatus = forcedStatus !== null ? (forcedStatus ? 1 : 0) : (task.enabled ? 0 : 1);
  await executeQuery(
    "UPDATE scheduled_task_tbl SET enabled = ? WHERE id = ?",
    [newStatus, task.id]
  );
  return Boolean(newStatus);
}

const SCHEDULE_DAY_MAP = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6
};

function matchesScheduleDay(scheduleDays, currentDow) {
  if (scheduleDays === '*' || scheduleDays == null || scheduleDays === 'all' || scheduleDays === 'daily' || scheduleDays === 'everyday') {
    return true;
  }

  if (Array.isArray(scheduleDays)) {
    return scheduleDays.some(d => matchesScheduleDay(d, currentDow));
  }

  if (typeof scheduleDays === 'number') {
    return scheduleDays === currentDow;
  }

  if (typeof scheduleDays === 'string') {
    const s = scheduleDays.toLowerCase().trim();
    if (s === '*' || s === 'all' || s === 'daily' || s === 'everyday') return true;

    const parts = s.split(',').map(p => p.trim()).filter(Boolean);
    return parts.some(p => {
      if (p === '*' || p === 'all' || p === 'daily' || p === 'everyday') return true;
      if (p === 'weekdays' || p === 'mon-fri' || p === '1-5') return currentDow >= 1 && currentDow <= 5;
      if (p === 'weekends' || p === 'sat-sun' || p === '6,0' || p === '0,6') return currentDow === 0 || currentDow === 6;

      if (SCHEDULE_DAY_MAP[p] !== undefined) {
        return SCHEDULE_DAY_MAP[p] === currentDow;
      }

      const rangeMatch = p.match(/^([a-z0-9]+)\s*-\s*([a-z0-9]+)$/);
      if (rangeMatch) {
        const start = SCHEDULE_DAY_MAP[rangeMatch[1]] !== undefined ? SCHEDULE_DAY_MAP[rangeMatch[1]] : parseInt(rangeMatch[1], 10);
        const end = SCHEDULE_DAY_MAP[rangeMatch[2]] !== undefined ? SCHEDULE_DAY_MAP[rangeMatch[2]] : parseInt(rangeMatch[2], 10);
        if (!isNaN(start) && !isNaN(end)) {
          if (start <= end) {
            return currentDow >= start && currentDow <= end;
          } else {
            return currentDow >= start || currentDow <= end;
          }
        }
      }

      return parseInt(p, 10) === currentDow;
    });
  }

  return false;
}

function getBangkokCurrent() {
  const tz = process.env.TIMEZONE || process.env.TZ || 'Asia/Bangkok';
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short'
    });
    const parts = formatter.formatToParts(new Date());
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    let h = map.hour === '24' ? '00' : String(map.hour).padStart(2, '0');
    let m = String(map.minute).padStart(2, '0');
    let s = String(map.second || '00').padStart(2, '0');
    const currentTimeStr = `${h}:${m}`;
    const todayDateStr = `${map.year}-${map.month}-${map.day}`;
    const currentDateTimeStr = `${todayDateStr} ${h}:${m}:${s}`;
    const weekdayShort = (map.weekday || '').toLowerCase();
    const dow = SCHEDULE_DAY_MAP[weekdayShort] !== undefined ? SCHEDULE_DAY_MAP[weekdayShort] : (new Date()).getDay();
    return { dow, currentTimeStr, todayDateStr, currentDateTimeStr };
  } catch (e) {
    const d = new Date(Date.now() + (7 * 3600 * 1000) + (new Date().getTimezoneOffset() * 60 * 1000));
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const todayDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      dow: d.getDay(),
      currentTimeStr: `${h}:${m}`,
      todayDateStr,
      currentDateTimeStr: `${todayDateStr} ${h}:${m}:${s}`
    };
  }
}

/**
 * Retrieves scheduled tasks whose delivery_mode = 'reply_on_chat' currently queued in memory
 * waiting to be sent using the next chat replyToken in the group.
 * @param {string} groupId 
 * @returns {Promise<Array<Object>>}
 */
async function getPendingReplyTasks(groupId) {
  if (!groupId) return [];
  try {
    const pendingManager = require('./scheduler/pendingManager');
    return await pendingManager.getPendingForGroup(groupId);
  } catch (err) {
    logger.error('[PendingManager] Error fetching pending reply tasks:', err.message);
    return [];
  }
}

/**
 * Resolves and formats all pending reply_on_chat scheduled tasks for a group from the in-memory queue.
 * Each task generates its own separate message object (up to LINE's 5-message limit per reply request),
 * sent together in a single API call with zero push quota consumed.
 * Marks the tasks as executed in MySQL with full datetime and removes from memory queue.
 * @param {string} groupId 
 * @param {Object} [triggeringMember] 
 * @returns {Promise<Array<Object>>} Array of message objects to send via replyMessage
 */
async function dispatchPendingReplyTasks(groupId, triggeringMember = null) {
  if (!groupId) return [];
  const pendingManager = require('./scheduler/pendingManager');
  const pendingTasks = await pendingManager.getPendingForGroup(groupId);
  if (!pendingTasks || pendingTasks.length === 0) return [];

  const { currentDateTimeStr } = getBangkokCurrent();
  const finalMessages = [];
  const systemBotMember = {
    id: 0,
    line_user_id: 'SYSTEM_BOT',
    name: 'System',
    admin: 2,
    debt: 0
  };

  const executedTaskIds = [];

  logger.info(`[Scheduler] Consuming ${pendingTasks.length} pending reply_on_chat task(s) from memory queue for group ${groupId}: [${pendingTasks.map(t => t.id).join(', ')}]`);

  for (const task of pendingTasks) {
    const taskIdKey = task.id;
    try {
      let taskMsgCount = 0;

      // 1. If messages were pre-resolved at schedule time (Standard Approach 1), deliver directly!
      if (task.preparedMessages && Array.isArray(task.preparedMessages) && task.preparedMessages.length > 0) {
        logger.info(`[Scheduler] Delivering ${task.preparedMessages.length} pre-resolved message(s) for pending task '${taskIdKey}' via chat reply (instant delivery, zero re-run)...`);
        for (const item of task.preparedMessages) {
          if (finalMessages.length < 5) {
            finalMessages.push(item);
            taskMsgCount++;
          }
        }
        executedTaskIds.push(taskIdKey);
      } else if (task.type === 'command') {
        const cmdModule = require('./cmd');
        const rawCmd = (task.command || '').trim();
        const cleanCmd = rawCmd.startsWith('/') ? rawCmd.substring(1) : rawCmd;
        if (cleanCmd) {
          logger.info(`[Scheduler] Executing pending task '${taskIdKey}' (command: '${cleanCmd}') via chat reply...`);
          const textMsg = (task.text_message || '').trim();
          if (textMsg) {
            const resolvedObj = await resolveScheduleTemplateText(textMsg, groupId);
            if (resolvedObj && (resolvedObj.text || resolvedObj.contents)) {
              if (finalMessages.length < 5) {
                finalMessages.push(resolvedObj);
                taskMsgCount++;
              }
            }
          }

          const res = await cmdModule.process_cmd(cleanCmd, systemBotMember, null, groupId);
          if (res) {
            const list = Array.isArray(res) ? res : [res];
            for (const item of list) {
              if (finalMessages.length < 5) {
                finalMessages.push(item);
                taskMsgCount++;
              }
            }
          }
          executedTaskIds.push(taskIdKey);
        }
      } else if (task.type === 'text') {
        const textMsg = (task.text_message || '').trim();
        if (textMsg) {
          logger.info(`[Scheduler] Executing pending task '${taskIdKey}' (template text) via chat reply...`);
          const resolvedObj = await resolveScheduleTemplateText(textMsg, groupId);
          if (resolvedObj && (resolvedObj.text || resolvedObj.contents)) {
            if (finalMessages.length < 5) {
              finalMessages.push(resolvedObj);
              taskMsgCount++;
            }
          }
          executedTaskIds.push(taskIdKey);
        }
      }

      // Mark executed in DB with datetime (using task.id and task.dbId fallback)
      await setScheduledTaskLastRun(task.id, currentDateTimeStr, task.dbId);
      // Remove from in-memory pending queue
      pendingManager.remove(task.id);
      // Notify scheduler supervisor & worker thread so in-memory registry updates immediately
      try {
        const scheduler = require('./scheduler');
        if (scheduler && typeof scheduler.notifyTaskExecuted === 'function') {
          scheduler.notifyTaskExecuted(task.id, currentDateTimeStr);
          if (task.dbId && String(task.dbId) !== String(task.id)) {
            scheduler.notifyTaskExecuted(task.dbId, currentDateTimeStr);
          }
        }
      } catch (notifyErr) {
        logger.debug('[Scheduler] Could not notify worker of task execution:', notifyErr.message);
      }
      logger.info(`[Scheduler] Task '${taskIdKey}' executed (${taskMsgCount} message(s) generated), marked completed in DB and dequeued from memory.`);
    } catch (taskErr) {
      logger.error(`[Scheduler] Error resolving pending scheduled task '${taskIdKey}':`, taskErr.message);
    }
  }

  if (executedTaskIds.length > 0) {
    logger.info(`[Scheduler] Prepared ${executedTaskIds.length} pending reply_on_chat task(s) [${executedTaskIds.join(', ')}] as ${finalMessages.length} separate message(s) in a single reply request for group ${groupId} (0 push quota used)`);
  }

  return finalMessages;
}

/**
 * Evaluates a condition string against the template context.
 * Supports binary comparisons (>=, <=, ==, !=, =, >, <) and single variable truthy checks.
 * @param {string} exprStr 
 * @param {Object} ctx 
 * @returns {boolean}
 */
function evaluateCondition(exprStr, ctx) {
  if (!exprStr) return false;
  const expr = exprStr.trim();

  // 1. Try binary operators: >=, <=, ==, !=, =, >, <
  const opMatch = expr.match(/^([a-zA-Z0-9_]+)\s*(>=|<=|==|!=|=|>|<)\s*(.+)$/);
  if (opMatch) {
    const leftRaw = opMatch[1].trim();
    const leftKey = leftRaw.toLowerCase();
    const op = opMatch[2];
    const rightRaw = opMatch[3].trim().replace(/^['"]|['"]$/g, '');
    const rightKey = rightRaw.toLowerCase();

    // Check if comparing day of week (e.g. dow == fri, day == 5)
    const isDowLeft = leftKey === 'dow' || leftKey === 'day' || leftKey === 'weekday';
    const isDowRight = rightKey === 'dow' || rightKey === 'day' || rightKey === 'weekday';

    if (isDowLeft && SCHEDULE_DAY_MAP[rightKey] !== undefined) {
      const curDow = ctx.dow !== undefined ? Number(ctx.dow) : -1;
      const targetDow = SCHEDULE_DAY_MAP[rightKey];
      switch (op) {
        case '==':
        case '=': return curDow === targetDow;
        case '!=': return curDow !== targetDow;
      }
    } else if (isDowRight && SCHEDULE_DAY_MAP[leftKey] !== undefined) {
      const curDow = ctx.dow !== undefined ? Number(ctx.dow) : -1;
      const targetDow = SCHEDULE_DAY_MAP[leftKey];
      switch (op) {
        case '==':
        case '=': return curDow === targetDow;
        case '!=': return curDow !== targetDow;
      }
    }

    const leftVal = ctx.hasOwnProperty(leftKey) ? ctx[leftKey] : (!isNaN(Number(leftRaw)) ? Number(leftRaw) : leftRaw);
    const rightVal = ctx.hasOwnProperty(rightKey) ? ctx[rightKey] : (!isNaN(Number(rightRaw)) ? Number(rightRaw) : rightRaw);

    switch (op) {
      case '>=': return leftVal >= rightVal;
      case '<=': return leftVal <= rightVal;
      case '==':
      case '=': return String(leftVal).toLowerCase() == String(rightVal).toLowerCase();
      case '!=': return String(leftVal).toLowerCase() != String(rightVal).toLowerCase();
      case '>': return leftVal > rightVal;
      case '<': return leftVal < rightVal;
    }
  }

  // 2. Direct day-of-week condition check (e.g. {{#if fri}}, {{#if friday}}, {{#if sat}})
  const singleKey = expr.toLowerCase();
  if (SCHEDULE_DAY_MAP[singleKey] !== undefined) {
    const curDow = ctx.dow !== undefined ? Number(ctx.dow) : -1;
    return curDow === SCHEDULE_DAY_MAP[singleKey];
  }

  // 3. Single truthy check (e.g. {{#if remaining}})
  if (ctx.hasOwnProperty(singleKey)) {
    const val = ctx[singleKey];
    if (typeof val === 'number') return val > 0;
    return Boolean(val);
  }

  return false;
}

/**
 * Processes conditional blocks ({{#if expr}}...{{else}}...{{/if}} and [if expr]...[else]...[/if])
 * @param {string} template 
 * @param {Object} ctx 
 * @returns {string}
 */
function processTemplateConditionals(template, ctx) {
  if (!template) return '';
  let result = template;

  // 1. Process {{#if expr}} ... {{else}} ... {{/if}}
  const mustacheRegex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/gi;
  result = result.replace(mustacheRegex, (match, expr, thenBranch, elseBranch) => {
    const isTrue = evaluateCondition(expr, ctx);
    return isTrue ? (thenBranch || '') : (elseBranch || '');
  });

  // 2. Process [if expr] ... [else] ... [/if]
  const bracketRegex = /\[if\s+([^\]]+)\]([\s\S]*?)(?:\[else\]([\s\S]*?))?\[\/if\]/gi;
  result = result.replace(bracketRegex, (match, expr, thenBranch, elseBranch) => {
    const isTrue = evaluateCondition(expr, ctx);
    return isTrue ? (thenBranch || '') : (elseBranch || '');
  });

  // Clean up excess newlines created by stripped blocks
  result = result.replace(/(\r?\n){3,}/g, '\n\n');
  return result.trim();
}

/**
 * Resolves dynamic template tags and conditionals ({{#if ...}}, #weekdate, #timerange, #max, #registered, #remaining, {all})
 * in text messages for scheduled text tasks.
 * @param {string} templateText 
 * @param {string|null} [groupId=null] 
 * @returns {Promise<Object>} LINE message object ({ type: 'text'|'textV2', ... })
 */
async function resolveScheduleTemplateText(templateText, groupId = null) {
  if (!templateText) {
    return { type: 'text', text: '' };
  }

  let text = String(templateText);

  // 1. Fetch current active week details
  let dateStr = '';
  let timeRange = '17:30-20:00';
  let maxPlayers = 0;
  let registeredFieldPlayers = 0;
  let remaining = 0;

  try {
    const weekRes = await queryWeekID(0);
    if (weekRes && weekRes.length > 0) {
      const week = weekRes[0];
      dateStr = week.date ? (await getFormatDate(week.date, 'short')) : '';
      timeRange = week.time_range || '17:30-20:00';
      maxPlayers = parseInt(week.max, 10) || 0;

      const members = await executeQuery(
        `SELECT mtw.member_id, mtw.team_id, m.team_id as member_team_id 
         FROM member_team_week_tbl mtw
         LEFT JOIN member_tbl m ON mtw.member_id = m.id 
         WHERE mtw.week_id = ?`,
        [week.id]
      );
      registeredFieldPlayers = (members || []).filter(m => Number(m.member_team_id) !== 100 && Number(m.team_id) !== 100).length;
      remaining = Math.max(0, maxPlayers - registeredFieldPlayers);
    }
  } catch (err) {
    logger.error('Error resolving template variables for schedule text:', err.message);
  }

  // 2. Build template context for conditionals and replacement
  const bkkCurrent = getBangkokCurrent();
  const currentDow = bkkCurrent.dow;
  const dayNameShort = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][currentDow] || 'sun';
  const dayNameFull = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][currentDow] || 'sunday';

  const ctx = {
    remaining,
    remains: remaining,
    left: remaining,
    registered: registeredFieldPlayers,
    players: registeredFieldPlayers,
    count: registeredFieldPlayers,
    max: maxPlayers,
    maxplayers: maxPlayers,
    capacity: maxPlayers,
    date: dateStr,
    weekdate: dateStr,
    week_date: dateStr,
    timerange: timeRange,
    time_range: timeRange,
    time: timeRange,
    dow: currentDow,
    day: currentDow,
    weekday: currentDow,
    day_name: dayNameShort,
    dayname: dayNameShort,
    [dayNameShort]: true,
    [dayNameFull]: true
  };

  // 3. Process conditional blocks ({{#if ...}} ... {{/if}})
  text = processTemplateConditionals(text, ctx);

  // 4. Perform variable replacement
  text = text
    .replace(/#(weekdate|week_date|date)/gi, dateStr)
    .replace(/\{(weekdate|week_date|date)\}/gi, dateStr)
    .replace(/#(timerange|time_range|time)/gi, timeRange)
    .replace(/\{(timerange|time_range|time)\}/gi, timeRange)
    .replace(/#(max|maxplayers|capacity)/gi, String(maxPlayers))
    .replace(/\{(max|maxplayers|capacity)\}/gi, String(maxPlayers))
    .replace(/#(registered|players|count)/gi, String(registeredFieldPlayers))
    .replace(/\{(registered|players|count)\}/gi, String(registeredFieldPlayers))
    .replace(/#(remaining|remains|left)/gi, String(remaining))
    .replace(/\{(remaining|remains|left)\}/gi, String(remaining));

  // 5. Format LINE message payload (support {all} or #all for mentionee)
  if (text.includes('#all')) {
    text = text.replace(/#all/gi, '{all}');
  }

  if (text.includes('{all}')) {
    return {
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
  }

  return {
    type: 'text',
    text
  };
}

module.exports = {
  updateHof,
  testConnection,
  executeQuery,
  queryWeekDate,
  queryWeekID,
  getMemberNY,
  getTeamColorWeek,
  getTeamWeek,
  getMemberWeek,
  getMatchWeek,
  recalculateMatchScore,
  recalculateTableWeek,
  finalizeWeekMatchesAndStandings,
  getWeekEndInfo,
  getTableWeek,
  updateMember,
  updateMemberInfo,
  updateMemberRank,
  updateMemberPriority,
  updateMemberAvoidIds,
  setMemberWeekPriority,
  updateMemberDebt,
  updateMemberWeek,
  setWeekCost,
  resetWeekDebt,
  updateMaxNumberWeek,
  removeReserveMembers,
  queryMemberbyLineID,
  queryMemberbyName,
  newMember,
  registerMember,
  unregisterMember,
  resetMemberTeam,
  getTopStat,
  IsMemberWeek,
  newWeek,
  getFormatDate,
  addTeamColorWeek,
  rerollTeamColors,
  getYearlyColorUsageCounts,
  getYearlyColorStatsCached,
  refreshYearlyColorStatsCache,
  selectLeastUsedColors,
  addTeamMemberWeek,
  getMemberWeek2,
  getMemberWeek0,
  registerNY,
  unregisterNY,
  unregisterGuestNY,
  getNYEventInfo,
  ensureNYTable,
  getDebtList,
  getScheduleText,
  getScheduleFromDb,
  formatScheduleLines,
  extendSchedule,
  parseExtendArgs,
  solveExtendedMatchups,
  isMatchPlayed,
  getCurrentMatch,
  saveScheduleToDb,
  ensureMatchStatScheduleColumns,
  getTheme,
  setTheme,
  updateMemberAutoReg,
  getAutoRegCount,
  getAutoRegList,
  getTemplate,
  getMemberDisplayInfo,
  getMemberStats,
  getMvpList,
  getAdminCommands,
  logSlip,
  ensureSlipLogSchema,
  getSlipByQRCode,
  updateSlipLog,
  markSlipVerified,
  deleteSlipLog,
  recordSlipVerifyAttempt,
  getPendingSlipsForVerify,
  ensureAppSettingsTable,
  getSetting,
  setSetting,
  getSettingsByCategory,
  getSlipVerifyConfig,
  setSlipVerifyConfig,
  ensureDonateLogTable,
  adjustMemberDonate,
  getDonateLeaderboard,
  getRecentDonateLogs,
  getNoticedSlips,
  getSlipById,
  setMemberDebt,
  updateWeekTimeRange,
  getWeekLeaderStats,
  loadSavedWeekLeaderStats,
  computeWeekChangeChecksum,
  selectTeamOfTheWeekPlayers,
  calculateWeekRawMvp,
  computePlayerRawScore,
  resolveWeekPlayerPositions,
  calcAndSaveMaxMvpScore,
  ensureMvpWeekTable,
  saveWeekMvpRecords,
  ensureMemberYearStatTable,
  updateYearStatCache,
  ensurePosTables,
  getAllPositions,
  queryTableWeek,
  getMemberPositions,
  setMemberPosition,
  updatePositionPoints,
  setMemberWeekPosition,
  getEffectiveMemberPosition,
  allocateFormationSlots,
  getTeamFormationData,
  getTeamFormation,
  getTotwFormationData,
  randomTeamByPosition,
  saveActiveGroupId,
  getActiveGroupId,
  saveBaseUrl,
  getBaseUrlFromDb,
  getTaskGroupId,
  saveTaskGroupId,
  getScheduledTasks,
  getScheduledTaskByKey,
  addScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  setScheduledTaskLastRun,
  toggleScheduledTask,
  resolveScheduleTemplateText,
  ensureLineGroupTable,
  ensureScheduledTaskTable,
  saveGroupProfile,
  getGroupProfile,
  resolveLineGroupId,
  getGroupTag,
  syncGroupProfile,
  getPendingReplyTasks,
  dispatchPendingReplyTasks,
  matchesScheduleDay,
  getBangkokCurrent,
  parseTeamAndWeekArgs,
  checkTeamWeekAccess,
  pool,
  executeQuery,
  ensureUserTable,
  ensureMemberFeeExemptColumn
};