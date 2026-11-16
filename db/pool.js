const mysql = require('mysql2/promise');
require('dotenv').config({ quiet: true });
const logger = require('../utils/logger');

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

/** Shared MySQL connection pool used across repositories and routers. */
const pool = mysql.createPool(dbConfig);

/**
 * Executes a prepared SQL statement on the shared connection pool.
 * @param {string} query
 * @param {Array} [params=[]]
 * @returns {Promise<*>}
 */
async function executeQuery(query, params = []) {
  try {
    const [results] = await pool.execute(query, params);
    return results;
  } catch (error) {
    logger.info(error);
    throw error;
  }
}

module.exports = {
  dbConfig,
  pool,
  executeQuery
};
