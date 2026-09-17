require('dotenv').config({ quiet: true });

/**
 * Returns the effective base URL for public assets/webhooks.
 * Prioritizes runtime global.baseWebhookUrl (from Nginx/Express host header)
 * followed by environment variables BASE_WEBHOOK_URL / BASE_URL.
 * @returns {string}
 */
function getBaseUrl() {
  let url = global.baseWebhookUrl || process.env.BASE_WEBHOOK_URL || process.env.BASE_URL || 'https://api.revemu.org';
  if (url && typeof url === 'string') {
    url = url.trim().replace(/\/+$/, '');
    if (url.startsWith('http://')) {
      url = url.replace(/^http:\/\//i, 'https://');
    }
  }
  return url || 'https://api.revemu.org';
}

/**
 * Sets runtime base webhook URL.
 * @param {string} url 
 */
function setBaseUrl(url) {
  if (!url || typeof url !== 'string') return;
  let clean = url.trim().replace(/\/+$/, '');
  if (clean.startsWith('http://')) {
    clean = clean.replace(/^http:\/\//i, 'https://');
  }
  global.baseWebhookUrl = clean;
}

/**
 * Resolves a full absolute URL for a relative asset path.
 * @param {string} relativePath 
 * @returns {string|null}
 */
function getFullUrl(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return null;
  let p = relativePath.trim();
  if (p === '' || p.toLowerCase() === 'none' || p.toLowerCase() === 'null') return null;
  if (p.startsWith('http://') || p.startsWith('https://')) {
    return p.replace(/^http:\/\//i, 'https://');
  }
  const baseUrl = getBaseUrl();
  const cleanPath = p.startsWith('/') ? p : `/${p}`;
  return `${baseUrl}${cleanPath}`;
}

module.exports = {
  getBaseUrl,
  setBaseUrl,
  getFullUrl
};
