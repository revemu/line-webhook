/**
 * prune_images.js
 * 
 * Standalone utility to prune generated image files older than a specified retention period (default: 30 days).
 * Prevents LINE Flex messages from showing broken images while managing server disk space.
 * 
 * Usage:
 *   node prune_images.js
 *   node prune_images.js --days=30
 *   node prune_images.js --days=14 --dry-run
 *   node prune_images.js --include-avatars
 */

const fs = require('fs');
const path = require('path');

// Parse CLI arguments
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

// Allow env var override
if (process.env.IMAGE_RETENTION_DAYS) {
  const envVal = parseInt(process.env.IMAGE_RETENTION_DAYS, 10);
  if (!isNaN(envVal) && envVal > 0) retentionDays = envVal;
}

const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
const now = Date.now();

console.log('====================================================');
console.log(`🧹 Image Pruning Tool ${isDryRun ? '[DRY RUN - No files deleted]' : ''}`);
console.log(`Retention period : ${retentionDays} days (${maxAgeMs / 1000 / 3600 / 24} days)`);
console.log(`Cut-off date     : ${new Date(now - maxAgeMs).toISOString()}`);
console.log('====================================================\n');

/**
 * Prunes files in a specific directory matching a filter.
 */
function pruneDirectory({ dirPath, label, fileFilter }) {
  if (!fs.existsSync(dirPath)) {
    console.log(`📁 [${label}] Directory does not exist: ${dirPath}`);
    return { scanned: 0, deleted: 0, bytesFreed: 0 };
  }

  let files;
  try {
    files = fs.readdirSync(dirPath);
  } catch (err) {
    console.error(`❌ [${label}] Failed to read directory:`, err.message);
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
          console.log(`   [DRY-RUN] Would delete: ${file} (${ageDays}d old, ${(stats.size / 1024).toFixed(1)} KB)`);
        } else {
          fs.unlinkSync(fullPath);
          console.log(`   🗑️ Deleted: ${file} (${ageDays}d old, ${(stats.size / 1024).toFixed(1)} KB)`);
        }
      }
    } catch (err) {
      console.warn(`   ⚠️ Error checking file ${file}:`, err.message);
    }
  }

  const mbFreed = (bytesFreed / 1024 / 1024).toFixed(2);
  console.log(`📊 [${label}] Scanned: ${scanned} | ${isDryRun ? 'Would prune' : 'Pruned'}: ${deleted} | Freed: ${mbFreed} MB\n`);
  return { scanned, deleted, bytesFreed };
}

// 1. Team formation & TOTW images (img/team)
const teamDir = path.join(__dirname, 'img', 'team');
const teamStats = pruneDirectory({
  dirPath: teamDir,
  label: 'Team & TOTW Images',
  fileFilter: (name) => name.startsWith('team_') && name.endsWith('.png')
});

// 2. Temporary QR codes (qr/ or img/qr)
let qrStats = { scanned: 0, deleted: 0, bytesFreed: 0 };
if (includeQr) {
  const qrDir = path.join(__dirname, 'qr');
  qrStats = pruneDirectory({
    dirPath: qrDir,
    label: 'QR Code Cache',
    fileFilter: (name) => name.endsWith('.png') || name.endsWith('.jpg')
  });
}

// 3. Avatar Disk Cache (img/avatars) - optional
let avatarStats = { scanned: 0, deleted: 0, bytesFreed: 0 };
if (includeAvatars) {
  const avatarDir = path.join(__dirname, 'img', 'avatars');
  avatarStats = pruneDirectory({
    dirPath: avatarDir,
    label: 'Avatar Cache',
    fileFilter: (name) => name.endsWith('.jpg') || name.endsWith('.png')
  });
}

const totalDeleted = teamStats.deleted + qrStats.deleted + avatarStats.deleted;
const totalFreedMb = ((teamStats.bytesFreed + qrStats.bytesFreed + avatarStats.bytesFreed) / 1024 / 1024).toFixed(2);

console.log('====================================================');
console.log(`✨ Pruning completed ${isDryRun ? '(DRY RUN)' : ''}`);
console.log(`Total files ${isDryRun ? 'eligible' : 'removed'}: ${totalDeleted}`);
console.log(`Total disk space ${isDryRun ? 'to free' : 'freed'} : ${totalFreedMb} MB`);
console.log('====================================================');
