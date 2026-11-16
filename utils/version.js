// utils/version.js
// Dynamic Asset and Application Auto-Versioning & Cache Busting System
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let cachedChangelogMtime = 0;
let cachedAppVersion = '0.6.5';
let cachedGitRevision = null;
let lastGitCheckTime = 0;

// In-memory HTML cache for instantaneous response delivery while detecting live modifications
const htmlCache = new Map();

/**
 * Get short Git commit hash if repository is present
 */
function getGitRevision() {
    const now = Date.now();
    if (cachedGitRevision !== null && (now - lastGitCheckTime < 10000)) {
        return cachedGitRevision;
    }
    lastGitCheckTime = now;
    try {
        const out = execSync('git rev-parse --short HEAD', {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 1000
        });
        cachedGitRevision = out.trim() || null;
    } catch {
        cachedGitRevision = null;
    }
    return cachedGitRevision;
}

/**
 * Automatically get base application version from CHANGELOG.md (or package.json)
 * Updates immediately whenever CHANGELOG.md is edited.
 */
function getAppVersion() {
    try {
        const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
        if (fs.existsSync(changelogPath)) {
            const stat = fs.statSync(changelogPath);
            if (stat.mtimeMs !== cachedChangelogMtime) {
                cachedChangelogMtime = stat.mtimeMs;
                const content = fs.readFileSync(changelogPath, 'utf8');
                const match = content.match(/##\s*\[(\d+\.\d+\.\d+)\]/);
                if (match && match[1]) {
                    cachedAppVersion = match[1];
                }
            }
            return cachedAppVersion;
        }
    } catch (e) {
        // Fallback below
    }

    try {
        const pkgPath = path.join(__dirname, '..', 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.version) return pkg.version;
        }
    } catch {
        // Fallback below
    }

    return cachedAppVersion;
}

/**
 * Get file modification time in epoch seconds
 */
function getFileMtime(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            return Math.floor(stat.mtimeMs / 1000);
        }
    } catch {
        // Ignore
    }
    return 0;
}

/**
 * Calculate dynamic asset version token based on base app version and global frontend file modification timestamps
 */
function getAssetVersion(targetFilePath = null) {
    const baseVersion = getAppVersion();
    const publicDir = path.join(__dirname, '..', 'public');
    const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

    let maxMtime = getFileMtime(changelogPath);
    if (targetFilePath) {
        const targetMtime = getFileMtime(targetFilePath);
        if (targetMtime > maxMtime) maxMtime = targetMtime;
    }

    try {
        if (fs.existsSync(publicDir)) {
            const files = fs.readdirSync(publicDir);
            for (const file of files) {
                if (file.startsWith('.')) continue;
                const fullPath = path.join(publicDir, file);
                const mtime = getFileMtime(fullPath);
                if (mtime > maxMtime) {
                    maxMtime = mtime;
                }
            }
        }
    } catch {
        // Fallback
    }

    if (maxMtime > 0) {
        return `${baseVersion}.${maxMtime}`;
    }
    return baseVersion;
}

/**
 * Render HTML file with auto-injected dynamic version query strings and client metadata
 */
function renderVersionedHtml(filePath, req = null) {
    const fileStat = fs.statSync(filePath);
    const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
    const changelogStat = fs.existsSync(changelogPath) ? fs.statSync(changelogPath) : { mtimeMs: 0 };

    // Determine current prefix (/web or /webhook)
    const urlPath = req && req.originalUrl ? req.originalUrl : '';
    const isWebPrefix = urlPath.startsWith('/web/') || urlPath === '/web';
    const prefix = isWebPrefix ? '/web' : '/webhook';
    const cacheKey = `${filePath}:${prefix}`;

    const baseVersion = getAppVersion();
    const assetVersion = getAssetVersion(filePath);
    const maxMtimeSec = parseInt(assetVersion.split('.').pop(), 10) || Math.floor(fileStat.mtimeMs / 1000);

    const cached = htmlCache.get(cacheKey);
    if (
        cached &&
        cached.assetVersion === assetVersion &&
        cached.fileMtimeMs === fileStat.mtimeMs &&
        cached.changelogMtimeMs === changelogStat.mtimeMs
    ) {
        return cached.html;
    }

    const gitRev = getGitRevision();

    let rawHtml = fs.readFileSync(filePath, 'utf8');

    // 1. Replace style.css link with auto-busting assetVersion
    const cssReplacement = `href="${prefix}/style.css?v=${assetVersion}"`;
    rawHtml = rawHtml.replace(/href=["'][^"']*style\.css(?:\?v=[^"']*)?["']/g, cssReplacement);

    // 2. Prepare dynamic version config script
    const versionScript = `
	<!-- Auto Injected Dynamic Version Metadata -->
	<script id="__APP_VERSION_CONFIG__">
		window.__APP_VERSION__ = ${JSON.stringify(baseVersion)};
		window.__ASSET_VERSION__ = ${JSON.stringify(assetVersion)};
		window.__GIT_REV__ = ${JSON.stringify(gitRev)};
		window.__LAST_MODIFIED__ = ${maxMtimeSec};
	</script>`;

    // 3. Inject script before </head> or <body>
    if (rawHtml.includes('</head>')) {
        rawHtml = rawHtml.replace('</head>', `${versionScript}\n</head>`);
    } else if (rawHtml.includes('<body')) {
        rawHtml = rawHtml.replace('<body', `${versionScript}\n<body`);
    } else {
        rawHtml = `${versionScript}\n${rawHtml}`;
    }

    htmlCache.set(cacheKey, {
        assetVersion: assetVersion,
        fileMtimeMs: fileStat.mtimeMs,
        changelogMtimeMs: changelogStat.mtimeMs,
        html: rawHtml
    });

    return rawHtml;
}

/**
 * Express middleware helper to send versioned HTML with anti-caching headers
 */
function sendVersionedHtml(req, res, filePath) {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Content-Type', 'text/html; charset=utf-8');

        const html = renderVersionedHtml(filePath, req);
        res.send(html);
    } catch (error) {
        // Safe fallback to res.sendFile if rendering encounters an error
        res.sendFile(filePath);
    }
}

module.exports = {
    getAppVersion,
    getGitRevision,
    getAssetVersion,
    renderVersionedHtml,
    sendVersionedHtml
};
