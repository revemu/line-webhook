const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { renderAsync } = require('@resvg/resvg-js');
const logger = require('./logger');

const AVATAR_CACHE_DIR = path.join(__dirname, '..', 'img', 'avatars');
const AVATAR_THUMB_DIR = path.join(AVATAR_CACHE_DIR, 'thumb');

const THUMB_SIZE = 96;
const MIN_IMAGE_BYTES = 50;
const FAILED_TTL_MS = 5 * 60 * 1000;
const MAX_URL_ENTRIES = 2000;
const MAX_BASE64_ENTRIES = 500;

if (!fs.existsSync(AVATAR_CACHE_DIR)) {
	fs.mkdirSync(AVATAR_CACHE_DIR, { recursive: true });
}
if (!fs.existsSync(AVATAR_THUMB_DIR)) {
	fs.mkdirSync(AVATAR_THUMB_DIR, { recursive: true });
}

const urlByHash = new Map();
const base64DataUriCache = new Map();
const inflightFullDownloads = new Map();
const inflightThumbs = new Map();
const failedCache = new Map();

function setBounded(map, key, val, maxSize) {
	if (map.has(key)) map.delete(key);
	map.set(key, val);
	while (map.size > maxSize) {
		const oldest = map.keys().next().value;
		map.delete(oldest);
	}
}

function normalizeAvatarUrl(url) {
	if (!url || typeof url !== 'string') return null;
	const trimmed = url.trim().replace(/^http:\/\//i, 'https://');
	if (!trimmed.startsWith('https://')) return null;
	return trimmed;
}

function getAvatarHash(secureUrl) {
	return crypto.createHash('md5').update(secureUrl).digest('hex');
}

function getAvatarDiskCachePath(url) {
	const secureUrl = normalizeAvatarUrl(url) || String(url || '');
	return path.join(AVATAR_CACHE_DIR, `${getAvatarHash(secureUrl)}.jpg`);
}

function getThumbDiskPathByHash(hash, ext = 'png') {
	return path.join(AVATAR_THUMB_DIR, `${hash}.${ext}`);
}

function getFullDiskPathByHash(hash) {
	return path.join(AVATAR_CACHE_DIR, `${hash}.jpg`);
}

function detectImageMime(buffer, fallback = 'image/jpeg') {
	if (!buffer || buffer.length < 4) return fallback;
	if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
		return 'image/png';
	}
	if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
		return 'image/jpeg';
	}
	if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
		return 'image/gif';
	}
	if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
		return 'image/webp';
	}
	return fallback;
}

function fileExistsWithMinBytes(filePath) {
	try {
		return fs.existsSync(filePath) && fs.statSync(filePath).size > MIN_IMAGE_BYTES;
	} catch (_) {
		return false;
	}
}

function writeFileAtomicSync(destPath, buffer) {
	const tmpPath = `${destPath}.tmp.${process.pid}.${Date.now()}`;
	fs.writeFileSync(tmpPath, buffer);
	fs.renameSync(tmpPath, destPath);
}

function registerAvatarUrl(rawUrl) {
	const secureUrl = normalizeAvatarUrl(rawUrl);
	if (!secureUrl) return null;
	const hash = getAvatarHash(secureUrl);
	setBounded(urlByHash, hash, secureUrl, MAX_URL_ENTRIES);
	return { secureUrl, hash };
}

function getRegisteredUrl(hash) {
	return urlByHash.get(hash) || null;
}

/**
 * Resolve avatar URL for browser UI:
 * - Already local/data URLs pass through unchanged.
 * - Remote LINE URLs become lightweight self-hosted 96x96 thumbnail paths:
 *   - `/webhook/img/avatars/thumb/<hash>.jpg` if already cached on disk (static 30d immutable)
 *   - `/webhook/avatar/<hash>.jpg` for lazy one-time download + resize + cache
 */
function resolveWebAvatarUrl(rawUrl) {
	if (!rawUrl || typeof rawUrl !== 'string') return '';
	const trimmed = rawUrl.trim();
	if (!trimmed) return '';
	if (trimmed.startsWith('/webhook/') || trimmed.startsWith('data:')) {
		return trimmed;
	}
	const info = registerAvatarUrl(trimmed);
	if (!info) return '';
	if (fileExistsWithMinBytes(getThumbDiskPathByHash(info.hash, 'png'))) {
		return `/webhook/img/avatars/thumb/${info.hash}.png`;
	}
	if (fileExistsWithMinBytes(getThumbDiskPathByHash(info.hash, 'jpg'))) {
		return `/webhook/img/avatars/thumb/${info.hash}.jpg`;
	}
	return `/webhook/avatar/${info.hash}.png`;
}

/**
 * Resolve avatar URLs on player rows without mutating original objects in shared caches.
 */
function mapPlayerAvatars(rows) {
	if (!Array.isArray(rows)) return [];
	return rows.map((row) => {
		if (!row || typeof row !== 'object') return row;
		const resolved = resolveWebAvatarUrl(row.picture_url || row.pictureUrl || '');
		return {
			...row,
			picture_url: resolved
		};
	});
}

async function ensureFullAvatarBuffer(secureUrl, timeoutMs = 6000) {
	const hash = getAvatarHash(secureUrl);
	const fullPath = getFullDiskPathByHash(hash);

	if (fileExistsWithMinBytes(fullPath)) {
		try {
			const diskBuf = fs.readFileSync(fullPath);
			if (diskBuf && diskBuf.length > MIN_IMAGE_BYTES) {
				return { buffer: diskBuf, hash };
			}
		} catch (e) {
			logger.warn(`[AvatarCache] Disk read error (${fullPath}):`, e.message);
		}
	}

	if (inflightFullDownloads.has(hash)) {
		return inflightFullDownloads.get(hash);
	}

	const task = (async () => {
		try {
			const response = await axios.get(secureUrl, {
				responseType: 'arraybuffer',
				timeout: timeoutMs,
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
					'Accept': 'image/jpeg,image/png,image/*;q=0.8'
				}
			});
			if (response.data && response.data.length > MIN_IMAGE_BYTES) {
				const buffer = Buffer.from(response.data);
				try {
					writeFileAtomicSync(fullPath, buffer);
				} catch (writeErr) {
					logger.warn(`[AvatarCache] Disk write error (${fullPath}):`, writeErr.message);
				}
				return { buffer, hash, contentType: response.headers['content-type'] || 'image/jpeg' };
			}
		} catch (err) {
			logger.warn(`[AvatarCache] Failed to download avatar (${secureUrl}):`, err.message);
		}
		return null;
	})().finally(() => {
		inflightFullDownloads.delete(hash);
	});

	inflightFullDownloads.set(hash, task);
	return task;
}

async function createThumbnailBuffer(fullBuffer) {
	try {
		if (!fullBuffer || fullBuffer.length <= MIN_IMAGE_BYTES) return null;
		const mime = detectImageMime(fullBuffer, 'image/jpeg');
		const dataUri = `data:${mime};base64,${fullBuffer.toString('base64')}`;
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_SIZE}" height="${THUMB_SIZE}" viewBox="0 0 ${THUMB_SIZE} ${THUMB_SIZE}"><image href="${dataUri}" x="0" y="0" width="${THUMB_SIZE}" height="${THUMB_SIZE}" preserveAspectRatio="xMidYMid slice"/></svg>`;
		const rendered = await renderAsync(svg, { font: { loadSystemFonts: false } });
		return Buffer.from(rendered.asPng());
	} catch (err) {
		logger.warn(`[AvatarCache] resvg thumbnail resize skipped: ${err.message}`);
		return null;
	}
}

/**
 * Serves or builds a 96x96 cover-cropped PNG thumbnail for the given 32-char MD5 avatar hash.
 * Uses existing PNG/legacy JPEG thumb cache first, then full-size disk cache or DB-verified URL.
 */
async function getOrCreateThumbBuffer(hash, lookupUrlByHash) {
	if (!/^[a-f0-9]{32}$/i.test(hash)) return null;
	const cleanHash = hash.toLowerCase();

	const failUntil = failedCache.get(cleanHash);
	if (failUntil && Date.now() < failUntil) return null;

	const pngThumbPath = getThumbDiskPathByHash(cleanHash, 'png');
	if (fileExistsWithMinBytes(pngThumbPath)) {
		try {
			return fs.readFileSync(pngThumbPath);
		} catch (_) { }
	}
	const legacyJpgThumbPath = getThumbDiskPathByHash(cleanHash, 'jpg');
	if (fileExistsWithMinBytes(legacyJpgThumbPath)) {
		try {
			return fs.readFileSync(legacyJpgThumbPath);
		} catch (_) { }
	}

	if (inflightThumbs.has(cleanHash)) {
		return inflightThumbs.get(cleanHash);
	}

	const task = (async () => {
		try {
			let fullBuffer = null;
			const fullPath = getFullDiskPathByHash(cleanHash);
			if (fileExistsWithMinBytes(fullPath)) {
				fullBuffer = fs.readFileSync(fullPath);
			} else {
				let secureUrl = urlByHash.get(cleanHash) || null;
				if (!secureUrl && typeof lookupUrlByHash === 'function') {
					const rawFromDb = await lookupUrlByHash(cleanHash);
					secureUrl = normalizeAvatarUrl(rawFromDb);
					if (secureUrl) {
						setBounded(urlByHash, cleanHash, secureUrl, MAX_URL_ENTRIES);
					}
				}
				if (!secureUrl) {
					failedCache.set(cleanHash, Date.now() + FAILED_TTL_MS);
					return null;
				}
				const downloaded = await ensureFullAvatarBuffer(secureUrl);
				if (!downloaded || !downloaded.buffer) {
					failedCache.set(cleanHash, Date.now() + FAILED_TTL_MS);
					return null;
				}
				fullBuffer = downloaded.buffer;
			}

			const thumbBuffer = await createThumbnailBuffer(fullBuffer);
			const isPngThumb = Boolean(thumbBuffer && thumbBuffer.length > MIN_IMAGE_BYTES);
			const outBuffer = isPngThumb ? thumbBuffer : fullBuffer;
			const targetThumbPath = isPngThumb ? pngThumbPath : legacyJpgThumbPath;
			if (outBuffer && outBuffer.length > MIN_IMAGE_BYTES) {
				try {
					writeFileAtomicSync(targetThumbPath, outBuffer);
				} catch (writeErr) {
					logger.warn(`[AvatarCache] Thumb write error (${targetThumbPath}):`, writeErr.message);
				}
				failedCache.delete(cleanHash);
				return outBuffer;
			}
			failedCache.set(cleanHash, Date.now() + FAILED_TTL_MS);
			return null;
		} catch (err) {
			logger.warn(`[AvatarCache] Thumbnail pipeline error (${cleanHash}):`, err.message);
			failedCache.set(cleanHash, Date.now() + FAILED_TTL_MS);
			return null;
		}
	})().finally(() => {
		inflightThumbs.delete(cleanHash);
	});

	inflightThumbs.set(cleanHash, task);
	return task;
}

/**
 * Fetches an image URL and converts it into a Base64 Data URI with local disk caching (used by team_img.js).
 */
async function fetchImageAsBase64(url, timeoutMs = 6000) {
	const secureUrl = normalizeAvatarUrl(url);
	if (!secureUrl) return null;

	if (base64DataUriCache.has(secureUrl)) {
		return base64DataUriCache.get(secureUrl);
	}

	const result = await ensureFullAvatarBuffer(secureUrl, timeoutMs);
	if (!result || !result.buffer) return null;

	const contentType = result.contentType || 'image/jpeg';
	const dataUri = `data:${contentType};base64,${result.buffer.toString('base64')}`;
	setBounded(base64DataUriCache, secureUrl, dataUri, MAX_BASE64_ENTRIES);
	return dataUri;
}

function getCachedBase64(url) {
	const secureUrl = normalizeAvatarUrl(url);
	return secureUrl ? base64DataUriCache.get(secureUrl) || null : null;
}

module.exports = {
	AVATAR_CACHE_DIR,
	AVATAR_THUMB_DIR,
	THUMB_SIZE,
	detectImageMime,
	normalizeAvatarUrl,
	getAvatarHash,
	getAvatarDiskCachePath,
	getThumbDiskPathByHash,
	registerAvatarUrl,
	getRegisteredUrl,
	resolveWebAvatarUrl,
	mapPlayerAvatars,
	getOrCreateThumbBuffer,
	fetchImageAsBase64,
	getCachedBase64
};
