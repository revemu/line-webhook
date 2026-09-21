/**
 * prune_images.js
 * 
 * Utility and module to prune generated image files older than a specified retention period (default: 30 days).
 * Prevents LINE Flex messages from showing broken images while managing server disk space.
 * 
 * Usage via CLI:
 *   node prune_images.js
 *   node prune_images.js --days=30
 *   node prune_images.js --days=14 --dry-run
 *   node prune_images.js --include-avatars
 * 
 * Usage as Module:
 *   const { pruneImages } = require('./prune_images');
 *   const result = pruneImages({ retentionDays: 30 });
 */

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

/**
 * Prunes files in a specific directory matching a filter.
 */
function pruneDirectory({ dirPath, label, fileFilter, maxAgeMs, now, isDryRun }) {
  if (!fs.existsSync(dirPath)) {
    return { scanned: 0, deleted: 0, bytesFreed: 0 };
  }

  let files;
  try {
    files = fs.readdirSync(dirPath);
  } catch (err) {
    logger.error(`❌ [${label}] Failed to read directory:`, err.message);
    return { scanned: 0, deleted: 0, bytesFreed: 0 };
  }

  let scanned = 0;
  let deleted = 0;
  let bytesFreed = 0;

  for (const file of files) {
    if (fileFilter && !fileFilter(file)) continue;

    const fullPath = path.join(dirPath, file);
    try {
      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) continue;

      scanned++;
      const ageMs = now - stats.mtimeMs;
      const ageDays = (ageMs / (24 * 3600 * 1000)).toFixed(1);

      if (ageMs > maxAgeMs) {
        bytesFreed += stats.size;
        deleted++;
        if (isDryRun) {
          if (require.main === module) {
            logger.info(`   [DRY-RUN] Would delete: ${file} (${ageDays}d old, ${(stats.size / 1024).toFixed(1)} KB)`);
          }
        } else {
          fs.unlinkSync(fullPath);
          if (require.main === module) {
            logger.info(`   🗑️ Deleted: ${file} (${ageDays}d old, ${(stats.size / 1024).toFixed(1)} KB)`);
          }
        }
      }
    } catch (err) {
      logger.warn(`   ⚠️ Error checking file ${file}:`, err.message);
    }
  }

  return { scanned, deleted, bytesFreed };
}

/**
 * Prunes generated image files older than retentionDays.
 * @param {Object} [options]
 * @param {number} [options.retentionDays=30]
 * @param {boolean} [options.isDryRun=false]
 * @param {boolean} [options.includeAvatars=false]
 * @param {boolean} [options.includeQr=true]
 * @returns {Object}
 */
function pruneImages(options = {}) {
  let retentionDays = (typeof options.retentionDays === 'number' && options.retentionDays > 0)
    ? options.retentionDays
    : 30;

  if (process.env.IMAGE_RETENTION_DAYS && typeof options.retentionDays !== 'number') {
    const envVal = parseInt(process.env.IMAGE_RETENTION_DAYS, 10);
    if (!isNaN(envVal) && envVal > 0) retentionDays = envVal;
  }

  const isDryRun = Boolean(options.isDryRun);
  const includeAvatars = Boolean(options.includeAvatars);
  const includeQr = options.includeQr !== false;

  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  // 1. Team formation & TOTW images (img/team)
  const teamDir = path.join(__dirname, 'img', 'team');
  const teamStats = pruneDirectory({
    dirPath: teamDir,
    label: 'Team & TOTW Images',
    fileFilter: (name) => name.startsWith('team_') && name.endsWith('.png'),
    maxAgeMs,
    now,
    isDryRun
  });

  // 2. Temporary QR codes (qr/)
  let qrStats = { scanned: 0, deleted: 0, bytesFreed: 0 };
  if (includeQr) {
    const qrDir = path.join(__dirname, 'qr');
    qrStats = pruneDirectory({
      dirPath: qrDir,
      label: 'QR Code Cache',
      fileFilter: (name) => name.endsWith('.png') || name.endsWith('.jpg'),
      maxAgeMs,
      now,
      isDryRun
    });
  }

  // 3. Avatar Disk Cache (img/avatars) - optional
  let avatarStats = { scanned: 0, deleted: 0, bytesFreed: 0 };
  if (includeAvatars) {
    const avatarDir = path.join(__dirname, 'img', 'avatars');
    avatarStats = pruneDirectory({
      dirPath: avatarDir,
      label: 'Avatar Cache',
      fileFilter: (name) => name.endsWith('.jpg') || name.endsWith('.png'),
      maxAgeMs,
      now,
      isDryRun
    });
  }

  const totalScanned = teamStats.scanned + qrStats.scanned + avatarStats.scanned;
  const totalDeleted = teamStats.deleted + qrStats.deleted + avatarStats.deleted;
  const totalFreedBytes = teamStats.bytesFreed + qrStats.bytesFreed + avatarStats.bytesFreed;
  const totalFreedMb = (totalFreedBytes / 1024 / 1024).toFixed(2);

  return {
    retentionDays,
    isDryRun,
    totalScanned,
    totalDeleted,
    totalFreedBytes,
    totalFreedMb,
    details: {
      team: teamStats,
      qr: qrStats,
      avatar: avatarStats
    }
  };
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  let retentionDays = 30;
  let isDryRun = false;
  let includeAvatars = false;
  let includeQr = true;

  for (const arg of args) {
    if (arg.startsWith('--days=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (!isNaN(val) && val > 0) retentionDays = val;
    } else if (arg === '--dry-run') {
      isDryRun = true;
    } else if (arg === '--include-avatars') {
      includeAvatars = true;
    } else if (arg === '--no-qr') {
      includeQr = false;
    }
  }

  logger.info('====================================================');
  logger.info(`🧹 Image Pruning Tool ${isDryRun ? '[DRY RUN - No files deleted]' : ''}`);
  logger.info(`Retention period : ${retentionDays} days`);
  logger.info(`Cut-off date     : ${new Date(Date.now() - retentionDays * 86400000).toISOString()}`);
  logger.info('====================================================\n');

  const result = pruneImages({ retentionDays, isDryRun, includeAvatars, includeQr });

  logger.info(`📊 [Team Images] Scanned: ${result.details.team.scanned} | Deleted: ${result.details.team.deleted} | Freed: ${(result.details.team.bytesFreed / 1024 / 1024).toFixed(2)} MB`);
  logger.info(`📊 [QR Codes]    Scanned: ${result.details.qr.scanned} | Deleted: ${result.details.qr.deleted} | Freed: ${(result.details.qr.bytesFreed / 1024 / 1024).toFixed(2)} MB`);
  if (includeAvatars) {
    logger.info(`📊 [Avatars]     Scanned: ${result.details.avatar.scanned} | Deleted: ${result.details.avatar.deleted} | Freed: ${(result.details.avatar.bytesFreed / 1024 / 1024).toFixed(2)} MB`);
  }

  logger.info('\n====================================================');
  logger.info(`✨ Pruning completed ${isDryRun ? '(DRY RUN)' : ''}`);
  logger.info(`Total files ${isDryRun ? 'eligible' : 'removed'}: ${result.totalDeleted}`);
  logger.info(`Total disk space ${isDryRun ? 'to free' : 'freed'} : ${result.totalFreedMb} MB`);
  logger.info('====================================================');
}

module.exports = {
  pruneImages
};
