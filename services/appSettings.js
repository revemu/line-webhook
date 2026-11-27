const { executeQuery } = require('../db/pool');
const logger = require('../utils/logger');

const DEFAULT_SLIP_VERIFY_CONFIG = {
  slip_verify_enabled: { value: '1', description: 'Enable background EasySlip verification for noticed slips (1=on, 0=off)' },
  slip_verify_poll_seconds: { value: '60', description: 'Polling interval in seconds for checking due noticed slips (min 15)' },
  slip_verify_max_attempts: { value: '8', description: 'Maximum EasySlip verification retry attempts per slip' },
  slip_verify_max_age_hours: { value: '168', description: 'Maximum slip age in hours to keep retrying verification (168 = 1 week)' },
  slip_verify_batch_limit: { value: '10', description: 'Maximum number of slips checked per scheduler sweep' },
  slip_verify_notify_success: { value: '0', description: 'Push LINE notification when delayed slip verifies cleanly (1=on, 0=off)' },
  slip_verify_retry_delays: { value: '120,300,600,900,1800,3600,7200,14400', description: 'Comma-separated retry backoff delays in seconds per attempt' }
};

let appSettingsTableEnsured = false;

/**
 * Ensures app_settings_tbl exists for storing operational settings separately from template_tpl.
 */
async function ensureAppSettingsTable() {
  if (appSettingsTableEnsured) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS app_settings_tbl (
      id SERIAL PRIMARY KEY,
      setting_key VARCHAR(100) NOT NULL UNIQUE,
      setting_value TEXT NULL,
      category VARCHAR(50) NOT NULL DEFAULT 'general',
      description VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await executeQuery(sql, []);
  appSettingsTableEnsured = true;
}

/**
 * Reads a single setting value from app_settings_tbl.
 * @param {string} key
 * @param {string|null} [defaultValue=null]
 * @returns {Promise<string|null>}
 */
async function getSetting(key, defaultValue = null) {
  try {
    await ensureAppSettingsTable();
    const rows = await executeQuery(
      "SELECT setting_value FROM app_settings_tbl WHERE setting_key = ? LIMIT 1",
      [key]
    );
    if (rows && rows.length > 0 && rows[0].setting_value !== null && rows[0].setting_value !== undefined) {
      return String(rows[0].setting_value);
    }
  } catch (err) {
    logger.error(`Error reading setting '${key}' from app_settings_tbl:`, err.message);
  }
  return defaultValue;
}

/**
 * Inserts or updates a setting in app_settings_tbl.
 * @param {string} key
 * @param {string|number|boolean} value
 * @param {Object} [options={}]
 * @param {string} [options.category='general']
 * @param {string|null} [options.description=null]
 */
async function setSetting(key, value, { category = 'general', description = null } = {}) {
  await ensureAppSettingsTable();
  const strVal = (value === null || value === undefined) ? null : String(value);
  await executeQuery(
    `INSERT INTO app_settings_tbl (setting_key, setting_value, category, description)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (setting_key) DO UPDATE SET
       setting_value = EXCLUDED.setting_value,
       category = COALESCE(NULLIF(EXCLUDED.category, 'general'), app_settings_tbl.category),
       description = COALESCE(EXCLUDED.description, app_settings_tbl.description),
       updated_at = CURRENT_TIMESTAMP`,
    [key, strVal, category, description]
  );
}

/**
 * Fetches all settings in a category as a key-value map.
 * @param {string} category
 * @returns {Promise<Object>}
 */
async function getSettingsByCategory(category) {
  const result = {};
  try {
    await ensureAppSettingsTable();
    const rows = await executeQuery(
      "SELECT setting_key, setting_value FROM app_settings_tbl WHERE category = ?",
      [category]
    );
    for (const r of rows || []) {
      if (r.setting_key) {
        result[r.setting_key] = r.setting_value;
      }
    }
  } catch (err) {
    logger.error(`Error reading settings category '${category}' from app_settings_tbl:`, err.message);
  }
  return result;
}

/**
 * Parses comma-separated retry delay seconds string into a non-empty array of positive integers.
 * @param {string} raw
 * @returns {number[]}
 */
function parseRetryDelaysSeconds(raw) {
  const parsed = String(raw || '')
    .split(',')
    .map(v => parseInt(v.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? parsed : [120, 300, 600, 900, 1800, 3600, 7200, 14400];
}

/**
 * Loads slip verification scheduler settings from app_settings_tbl, seeding defaults if missing.
 * Also migrates any legacy slip_verify_* rows out of template_tpl if present.
 * @returns {Promise<Object>}
 */
async function getSlipVerifyConfig() {
  const map = {};
  for (const [k, meta] of Object.entries(DEFAULT_SLIP_VERIFY_CONFIG)) {
    map[k] = meta.value;
  }

  try {
    await ensureAppSettingsTable();
    const keys = Object.keys(DEFAULT_SLIP_VERIFY_CONFIG);
    const placeholders = keys.map(() => '?').join(', ');
    const rows = await executeQuery(
      `SELECT setting_key, setting_value FROM app_settings_tbl WHERE setting_key IN (${placeholders})`,
      keys
    );

    const found = new Set();
    for (const r of rows || []) {
      if (r.setting_key && r.setting_value !== undefined && r.setting_value !== null && String(r.setting_value).trim() !== '') {
        map[r.setting_key] = String(r.setting_value).trim();
        found.add(r.setting_key);
      }
    }

    if (found.size < keys.length) {
      // Check if any slip_verify_* values were previously placed in template_tpl and migrate them cleanly
      const legacyMap = {};
      try {
        const legacyRows = await executeQuery(
          `SELECT name, value FROM template_tpl WHERE name IN (${placeholders})`,
          keys
        );
        for (const lr of legacyRows || []) {
          if (lr.name && lr.value !== null && lr.value !== undefined && String(lr.value).trim() !== '') {
            legacyMap[lr.name] = String(lr.value).trim();
          }
        }
        if (legacyRows && legacyRows.length > 0) {
          await executeQuery(`DELETE FROM template_tpl WHERE name IN (${placeholders})`, keys);
        }
      } catch (legacyErr) {
        logger.debug('Skipped legacy template_tpl slip_verify migration:', legacyErr.message);
      }

      for (const key of keys) {
        if (!found.has(key)) {
          const valToSeed = legacyMap[key] || DEFAULT_SLIP_VERIFY_CONFIG[key].value;
          map[key] = valToSeed;
          try {
            await executeQuery(
              `INSERT INTO app_settings_tbl (setting_key, setting_value, category, description)
               VALUES (?, ?, 'slip_verify', ?)
               ON CONFLICT (setting_key) DO NOTHING`,
              [key, valToSeed, DEFAULT_SLIP_VERIFY_CONFIG[key].description]
            );
          } catch (insertErr) {
            logger.debug(`Could not seed app_settings_tbl setting '${key}':`, insertErr.message);
          }
        }
      }
    }
  } catch (err) {
    logger.error("Error loading slip verify config from app_settings_tbl:", err.message);
  }

  return {
    enabled: map.slip_verify_enabled !== '0' && map.slip_verify_enabled.toLowerCase() !== 'false',
    pollSeconds: Math.max(15, parseInt(map.slip_verify_poll_seconds, 10) || 60),
    maxAttempts: Math.max(1, parseInt(map.slip_verify_max_attempts, 10) || 8),
    maxAgeHours: Math.max(1, parseInt(map.slip_verify_max_age_hours, 10) || 168),
    batchLimit: Math.max(1, Math.min(100, parseInt(map.slip_verify_batch_limit, 10) || 10)),
    notifySuccess: map.slip_verify_notify_success !== '0' && map.slip_verify_notify_success.toLowerCase() !== 'false',
    retryDelaysSeconds: parseRetryDelaysSeconds(map.slip_verify_retry_delays)
  };
}

/**
 * Updates a slip verification setting in app_settings_tbl.
 * @param {string} name
 * @param {string|number|boolean} value
 */
async function setSlipVerifyConfig(name, value) {
  const key = String(name || '').trim();
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SLIP_VERIFY_CONFIG, key)) {
    throw new Error(`Unknown slip verify config key: ${key}`);
  }
  await setSetting(key, value, {
    category: 'slip_verify',
    description: DEFAULT_SLIP_VERIFY_CONFIG[key].description
  });
}

module.exports = {
  DEFAULT_SLIP_VERIFY_CONFIG,
  ensureAppSettingsTable,
  getSetting,
  setSetting,
  getSettingsByCategory,
  parseRetryDelaysSeconds,
  getSlipVerifyConfig,
  setSlipVerifyConfig
};
