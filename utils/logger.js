require('dotenv').config({ quiet: true });

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4
};

let customLogLevel = null;

/**
 * Determine the current active log level.
 * Priority: Runtime custom level -> LOG_LEVEL env -> DEBUG_LOG / DEBUG env -> default ('info')
 * @returns {string}
 */
function getActiveLevel() {
  if (customLogLevel !== null) {
    return customLogLevel;
  }

  if (process.env.LOG_LEVEL && LOG_LEVELS[process.env.LOG_LEVEL.toLowerCase()] !== undefined) {
    return process.env.LOG_LEVEL.toLowerCase();
  }

  const debugEnv = (process.env.DEBUG_LOG || process.env.DEBUG || '').toLowerCase().trim();
  if (debugEnv === 'true' || debugEnv === '1' || debugEnv === '*' || debugEnv === 'yes') {
    return 'debug';
  }

  return 'info';
}

/**
 * Checks if a specific log level is currently enabled.
 * @param {string} level 
 * @returns {boolean}
 */
function isLevelEnabled(level) {
  const currentLevel = getActiveLevel();
  const targetVal = LOG_LEVELS[level] ?? 1;
  const currentVal = LOG_LEVELS[currentLevel] ?? 1;
  return targetVal >= currentVal;
}

const logger = {
  /**
   * Log verbose debug messages (enabled when DEBUG_LOG=true or LOG_LEVEL=debug)
   */
  debug: (...args) => {
    if (isLevelEnabled('debug')) {
      console.log('[DEBUG]', ...args);
    }
  },

  /**
   * Log standard informational messages
   */
  info: (...args) => {
    if (isLevelEnabled('info')) {
      console.log(...args);
    }
  },

  /**
   * Alias for standard log
   */
  log: (...args) => {
    if (isLevelEnabled('info')) {
      console.log(...args);
    }
  },

  /**
   * Log warnings
   */
  warn: (...args) => {
    if (isLevelEnabled('warn')) {
      console.warn(...args);
    }
  },

  /**
   * Log errors
   */
  error: (...args) => {
    if (isLevelEnabled('error')) {
      console.error(...args);
    }
  },

  /**
   * Check if debug logging is currently enabled
   * @returns {boolean}
   */
  isDebugEnabled: () => isLevelEnabled('debug'),

  /**
   * Dynamically override log level at runtime ('debug' | 'info' | 'warn' | 'error' | 'none' | null to reset)
   * @param {string|null} level 
   */
  setLevel: (level) => {
    if (level === null) {
      customLogLevel = null;
    } else if (typeof level === 'string' && LOG_LEVELS[level.toLowerCase()] !== undefined) {
      customLogLevel = level.toLowerCase();
    }
  },

  /**
   * Helper to enable debug logging programmatically
   */
  enableDebug: () => {
    customLogLevel = 'debug';
  },

  /**
   * Helper to disable debug logging programmatically
   */
  disableDebug: () => {
    customLogLevel = 'info';
  },

  LOG_LEVELS
};

module.exports = logger;
