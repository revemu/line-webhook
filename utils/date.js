/**
 * Thai Date & Localization Utilities
 */

const thaiMonths = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const thaiMonthsShort = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

/**
 * Formats a Date object to YYYY-MM-DD HH:mm:ss string
 * @param {Date|string} curDate 
 * @returns {string}
 */
function formatDate(curDate) {
  if (!curDate) return '';
  const dObj = (curDate instanceof Date) ? curDate : new Date(curDate);
  if (isNaN(dObj.getTime())) {
    return typeof curDate === 'string' ? curDate : '';
  }
  const d = ('0' + dObj.getDate()).slice(-2);
  const m = ('0' + (dObj.getMonth() + 1)).slice(-2);
  const y = dObj.getFullYear();
  const h = ('0' + dObj.getHours()).slice(-2);
  const min = ('0' + dObj.getMinutes()).slice(-2);
  const s = ('0' + dObj.getSeconds()).slice(-2);
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/**
 * Formats a Date object to YYYY-MM-DD
 * @param {Date|string} date 
 * @returns {string}
 */
function getShortDate(date) {
  if (!date) return '';
  const dObj = (date instanceof Date) ? date : new Date(date);
  if (isNaN(dObj.getTime())) return '';
  const y = dObj.getFullYear() + 543;
  const d = ('0' + dObj.getDate()).slice(-2);
  const m = ('0' + (dObj.getMonth() + 1)).slice(-2);
  return `${y}-${m}-${d}`;
}

/**
 * Formats a Date object into Thai date string format
 * @param {Date|string} date 
 * @param {string} format 'short' | 'full'
 * @param {Object} [options]
 * @param {boolean} [options.buddhistEra=false]
 * @param {boolean} [options.includeTime=false]
 * @returns {string}
 */
function getFormatDate(date, format = 'short', options = {}) {
  if (!date) return '';
  const dObj = (date instanceof Date) ? date : new Date(date);
  if (isNaN(dObj.getTime())) return typeof date === 'string' ? date : '';

  const { buddhistEra = false, includeTime = false } = options;
  const d = dObj.getDate();
  let yearNum = buddhistEra ? dObj.getFullYear() + 543 : dObj.getFullYear();
  let y = yearNum.toString();
  let month;

  switch (format) {
    case 'full':
      month = thaiMonths[dObj.getMonth()];
      break;
    case 'short':
    default:
      month = thaiMonthsShort[dObj.getMonth()];
      y = `${y.slice(-2)}`;
      break;
  }

  let result = `${d} ${month} ${y}`;
  if (includeTime) {
    const h = ('0' + dObj.getHours()).slice(-2);
    const min = ('0' + dObj.getMinutes()).slice(-2);
    const s = ('0' + dObj.getSeconds()).slice(-2);
    result += ` ${h}:${min}:${s}`;
  }
  return result;
}

/**
 * Returns the Date object for the next Saturday
 * @returns {Date}
 */
function getNextSaturday() {
  const date = new Date();
  date.setDate(date.getDate() + (6 - date.getDay() + 7) % 7 || 7);
  return date;
}

module.exports = {
  thaiMonths,
  thaiMonthsShort,
  formatDate,
  getShortDate,
  getFormatDate,
  getNextSaturday
};
