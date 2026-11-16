require('dotenv').config({ quiet: true });

/**
 * Returns the effective base URL for public assets/webhooks.
 * Prioritizes runtime global.baseWebhookUrl (from Nginx/Express host header)
 * followed by environment variables BASE_WEBHOOK_URL / BASE_URL.
 * @returns {string}
 */
function getBaseUrl() {
  let url = global.baseWebhookUrl || process.env.BASE_WEBHOOK_URL || process.env.BASE_URL || '';
  if (url && typeof url === 'string') {
    url = url.trim().replace(/\/+$/, '');
    if (url.startsWith('http://')) {
      url = url.replace(/^http:\/\//i, 'https://');
    }
  }
  return url;
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
  let cleanPath = p.startsWith('/') ? p : `/${p}`;
  if (cleanPath.startsWith('/img/')) {
    cleanPath = `/webhook${cleanPath}`;
  }
  return `${baseUrl}${cleanPath}`;
}

/**
 * Resolves the live match viewer URL, preferring an explicit override or LIVE_WEB_URL,
 * otherwise building dynamically from getBaseUrl() + '/webhook/view', and ensuring openExternalBrowser=1.
 * @param {string|null} [overrideUrl=null]
 * @returns {string}
 */
function getLiveWebUrl(overrideUrl = null) {
  const baseUrl = getBaseUrl();
  const dynamicDefault = baseUrl ? `${baseUrl}/webhook/view` : 'https://hydromet.rid.go.th/webhook/view';
  const raw = (overrideUrl && String(overrideUrl).trim())
    || (process.env.LIVE_WEB_URL && process.env.LIVE_WEB_URL.trim())
    || dynamicDefault;
  if (raw.includes('openExternalBrowser=1')) return raw;
  return raw.includes('?') ? `${raw}&openExternalBrowser=1` : `${raw}?openExternalBrowser=1`;
}

module.exports = {
  getBaseUrl,
  setBaseUrl,
  getFullUrl,
  getLiveWebUrl
};
