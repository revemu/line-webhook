const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const POST_PERSIST_GRACE_MS = 30 * 1000;
const MAX_CACHE_ENTRIES = 60;

// Maps `${category}/${filename}` -> { buffer, contentType, expiresAt }
const memoryStore = new Map();

function makeKey(category, filename) {
  return `${category}/${filename}`;
}

function pruneExpiredAndOverflow() {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
  while (memoryStore.size > MAX_CACHE_ENTRIES) {
    const oldestKey = memoryStore.keys().next().value;
    if (!oldestKey) break;
    memoryStore.delete(oldestKey);
  }
}

/**
 * Checks whether an image buffer is currently cached in RAM (before/during disk flush).
 * @param {string} category - e.g. 'team' or 'qr'
 * @param {string} filename
 * @returns {boolean}
 */
function hasRamImage(category, filename) {
  const key = makeKey(category, filename);
  const entry = memoryStore.get(key);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return false;
  }
  return true;
}

/**
 * Retrieves an image buffer from RAM cache if present and unexpired.
 * @param {string} category
 * @param {string} filename
 * @returns {{ buffer: Buffer, contentType: string }|null}
 */
function getRamImage(category, filename) {
  const key = makeKey(category, filename);
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry;
}

/**
 * Stores a freshly rendered image buffer in RAM immediately so first HTTP requests
 * serve directly from memory, then persists atomically to disk in the background.
 * @param {string} category
 * @param {string} filename
 * @param {Buffer} buffer
 * @param {string} targetFilePath
 * @param {string} [contentType='image/png']
 * @returns {Promise<void>} Background write promise (callers need not await for response)
 */
function cacheAndPersistAsync(category, filename, buffer, targetFilePath, contentType = 'image/png') {
  const key = makeKey(category, filename);
  memoryStore.set(key, {
    buffer,
    contentType,
    expiresAt: Date.now() + DEFAULT_TTL_MS
  });
  pruneExpiredAndOverflow();

  const dir = path.dirname(targetFilePath);
  const tmpPath = `${targetFilePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;

  return (async () => {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(tmpPath, buffer);
      await fs.promises.rename(tmpPath, targetFilePath);
      const entry = memoryStore.get(key);
      if (entry) {
        // Keep in RAM briefly for immediate burst retries, then release memory cleanly
        entry.expiresAt = Math.min(entry.expiresAt, Date.now() + POST_PERSIST_GRACE_MS);
      }
    } catch (err) {
      logger.error(`[RamImageCache] Failed background disk persist for ${targetFilePath}:`, err.message);
      try { await fs.promises.unlink(tmpPath); } catch (_) { }
    }
  })();
}

/**
 * Express middleware that serves freshly generated images straight from RAM on the first hit
 * while background disk persistence completes, falling through to express.static afterward.
 * @param {string} category
 */
function serveRamImageMiddleware(category) {
  return (req, res, next) => {
    const reqPath = (req.path || '').replace(/^\/+/, '');
    if (!reqPath || reqPath.includes('/') || reqPath.includes('..')) {
      return next();
    }
    const entry = getRamImage(category, reqPath);
    if (!entry) {
      return next();
    }
    res.setHeader('Content-Type', entry.contentType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Image-Source', 'ram-cache');
    return res.send(entry.buffer);
  };
}

/**
 * Resolves the fastest ephemeral temp directory for short-lived scan artifacts (uses /dev/shm on Linux).
 */
function resolveEphemeralTempDir(fallbackDir) {
  if (process.platform === 'linux') {
    try {
      if (fs.existsSync('/dev/shm')) {
        return path.join('/dev/shm', 'line-webhook-temp');
      }
    } catch (_) { }
  }
  return fallbackDir;
}

module.exports = {
  hasRamImage,
  getRamImage,
  cacheAndPersistAsync,
  serveRamImageMiddleware,
  resolveEphemeralTempDir,
  _memoryStore: memoryStore
};
