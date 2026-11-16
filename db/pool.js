const { Pool, types } = require('pg');
require('dotenv').config({ quiet: true });
const logger = require('../utils/logger');

// Parse PostgreSQL int8 (COUNT, SUM of ints, etc.) and numeric as JS numbers instead of strings
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());

const dbConfig = hasDatabaseUrl
  ? {
      connectionString: String(process.env.DATABASE_URL).trim(),
      max: parseInt(process.env.PGPOOL_MAX || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    }
  : {
      host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10),
      user: process.env.PGUSER || process.env.DB_USER,
      password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
      database: process.env.PGDATABASE || process.env.DB_NAME || 'soccerbot',
      max: parseInt(process.env.PGPOOL_MAX || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    };

const pgPool = new Pool(dbConfig);

pgPool.on('error', (err) => {
  logger.error('[DB Pool] Unexpected PostgreSQL client error:', err.message);
});

/**
 * Converts unquoted MySQL `?` positional placeholders into PostgreSQL `$1, $2, ...` placeholders.
 * Safely ignores `?` inside single-quoted literals, double-quoted identifiers, and SQL comments.
 * @param {string} sql
 * @returns {string}
 */
function convertPlaceholders(sql) {
  if (!sql || typeof sql !== 'string' || !sql.includes('?')) {
    return sql;
  }

  let out = '';
  let paramIndex = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i++;
      } else if (ch === '\\' && next) {
        out += next;
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"' && next === '"') {
        out += next;
        i++;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }

    if (ch === '-' && next === '-') {
      out += ch + next;
      i++;
      inLineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      out += ch + next;
      i++;
      inBlockComment = true;
      continue;
    }
    if (ch === "'") {
      out += ch;
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inDouble = true;
      continue;
    }
    if (ch === '?') {
      paramIndex++;
      out += `$${paramIndex}`;
      continue;
    }
    out += ch;
  }

  return out;
}

/**
 * Formats a `pg` QueryResult into a mysql2-friendly shape:
 * - SELECT / WITH / SHOW -> array of rows
 * - INSERT / UPDATE / DELETE / DDL -> { insertId, affectedRows, rowCount, rows }
 */
function formatPgResult(sql, res) {
  const cmd = (res.command || '').toUpperCase();
  const isRowQuery = cmd === 'SELECT' || cmd === 'WITH' || cmd === 'SHOW' || /^\s*(SELECT|WITH|SHOW)\b/i.test(sql);
  if (isRowQuery) {
    return res.rows || [];
  }
  const rows = res.rows || [];
  const firstId = (rows[0] && rows[0].id !== undefined) ? rows[0].id : null;
  const affectedRows = Number(res.rowCount || 0);
  return {
    insertId: firstId,
    affectedRows,
    rowCount: affectedRows,
    rows
  };
}

/**
 * Runs a query on a client or pool and returns `[formattedResult, fields]` (mysql2 tuple convention).
 */
async function runPgTuple(executor, sql, params) {
  const pgSql = convertPlaceholders(sql);
  const res = params !== undefined ? await executor.query(pgSql, params) : await executor.query(pgSql);
  return [formatPgResult(pgSql, res), res.fields || []];
}

/**
 * Pool facade preserving `.query()`, `.execute()`, `.getConnection()`, and `.end()` on top of PostgreSQL `pg.Pool`.
 */
const pool = {
  rawPool: pgPool,
  query: (sql, params) => runPgTuple(pgPool, sql, params),
  execute: (sql, params) => runPgTuple(pgPool, sql, params),
  end: () => pgPool.end(),
  getConnection: async () => {
    const client = await pgPool.connect();
    let released = false;
    return {
      query: (sql, params) => runPgTuple(client, sql, params),
      execute: (sql, params) => runPgTuple(client, sql, params),
      beginTransaction: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => {
        if (!released) {
          released = true;
          client.release();
        }
      }
    };
  }
};

/**
 * Executes a parameterized SQL statement on the shared PostgreSQL connection pool.
 * @param {string} query
 * @param {Array} [params=[]]
 * @returns {Promise<*>}
 */
async function executeQuery(query, params = []) {
  try {
    const pgSql = convertPlaceholders(query);
    const res = await pgPool.query(pgSql, params);
    return formatPgResult(pgSql, res);
  } catch (error) {
    logger.info(error);
    throw error;
  }
}

module.exports = {
  dbConfig,
  pool,
  pgPool,
  convertPlaceholders,
  executeQuery
};
