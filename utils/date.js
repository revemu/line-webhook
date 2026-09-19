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
 * Safely parses input into a Date object.
 * If input string has a Buddhist year (e.g. >= 2400), it converts it to Christian year for standard JS Date.
 * @param {Date|string|number} date 
 * @returns {Date|null}
 */
function parseDateInput(date) {
  if (!date) return null;
  if (date instanceof Date) return isNaN(date.getTime()) ? null : date;

  if (typeof date === 'string') {
    const str = date.trim();
    // 1. Match date string starting with a 4-digit year e.g. "2569-08-18" or "2569/08/18"
    const match = str.match(/^(\d{4})[-/](.*)$/);
    if (match) {
      let year = parseInt(match[1], 10);
      if (year >= 2400) {
        year -= 543;
        const normalized = `${year}-${match[2]}`;
        const dObj = new Date(normalized);
        if (!isNaN(dObj.getTime())) return dObj;
      }
    }

    // 2. Match Thai date format e.g. "12 ก.ย. 69", "12 ก.ย. 2569", "12 กันยายน 2026"
    const thaiMatch = str.match(/^(\d{1,2})\s*([ก-๙\.]+)(?:\s*(\d{2,4}))?$/);
    if (thaiMatch) {
      const day = parseInt(thaiMatch[1], 10);
      const mStr = thaiMatch[2].trim();
      let mIdx = thaiMonthsShort.indexOf(mStr);
      if (mIdx === -1) {
        mIdx = thaiMonthsShort.findIndex(m => m.replace(/\./g, '') === mStr.replace(/\./g, ''));
      }
      if (mIdx === -1) {
        mIdx = thaiMonths.indexOf(mStr);
      }
      if (mIdx !== -1) {
        let year = thaiMatch[3] ? parseInt(thaiMatch[3], 10) : new Date().getFullYear();
        if (year < 100) {
          if (year >= 43) {
            year = 2500 + year - 543;
          } else {
            year = 2000 + year;
          }
        } else if (year >= 2400) {
          year -= 543;
        }
        const dObj = new Date(year, mIdx, day);
        if (!isNaN(dObj.getTime())) return dObj;
      }
    }

    // 3. Match DD/MM/YY or DD/MM/YYYY format e.g. "12/09/26", "12/09/2026"
    const slashMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?$/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1], 10);
      const month = parseInt(slashMatch[2], 10) - 1;
      let year = slashMatch[3] ? parseInt(slashMatch[3], 10) : new Date().getFullYear();
      if (year < 100) year += 2000;
      if (year >= 2400) year -= 543;
      const dObj = new Date(year, month, day);
      if (!isNaN(dObj.getTime())) return dObj;
    }

    const dObj = new Date(str);
    return isNaN(dObj.getTime()) ? null : dObj;
  }

  const dObj = new Date(date);
  return isNaN(dObj.getTime()) ? null : dObj;
}

/**
 * Formats a Date object to YYYY-MM-DD HH:mm:ss string
 * @param {Date|string} curDate 
 * @returns {string}
 */
function formatDate(curDate) {
  if (!curDate) return '';
  const dObj = parseDateInput(curDate);
  if (!dObj) {
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
 * Formats a Date object to YYYY-MM-DD (Buddhist Era YYYY)
 * @param {Date|string} date 
 * @returns {string}
 */
function getShortDate(date) {
  if (!date) return '';
  const dObj = parseDateInput(date);
  if (!dObj) return '';
  const fullYear = dObj.getFullYear();
  const y = fullYear >= 2400 ? fullYear - 543 : fullYear;
  const d = ('0' + dObj.getDate()).slice(-2);
  const m = ('0' + (dObj.getMonth() + 1)).slice(-2);
  return `${y}-${m}-${d}`;
}

/**
 * Formats a Date object to DD/MM/YY (Christian Era 2-digit YY e.g. 11/08/26)
 * @param {Date|string} date 
 * @returns {string}
 */
function getSlashDate(date) {
  if (!date) return '';
  const dObj = parseDateInput(date);
  if (!dObj) return '';
  const d = ('0' + dObj.getDate()).slice(-2);
  const m = ('0' + (dObj.getMonth() + 1)).slice(-2);
  const fullYear = dObj.getFullYear();
  const y = fullYear >= 2400 ? fullYear - 543 : fullYear;
  const yy = String(y).slice(-2);
  return `${d}/${m}/${yy}`;
}

/**
 * Formats a Date object into Thai date string format
 * @param {Date|string} date 
 * @param {string} format 'short' | 'full'
 * @param {Object} [options]
 * @param {boolean} [options.buddhistEra=true]
 * @param {boolean} [options.includeTime=false]
 * @returns {string}
 */
function getFormatDate(date, format = 'short', options = {}) {
  if (!date) return '';
  const dObj = parseDateInput(date);
  if (!dObj) return typeof date === 'string' ? date : '';

  const { buddhistEra = true, includeTime = false } = options;
  const d = dObj.getDate();
  const fullYear = dObj.getFullYear();

  let yearNum;
  if (buddhistEra) {
    // Convert to Buddhist Era if year is in Christian Era (< 2400)
    yearNum = fullYear < 2400 ? fullYear + 543 : fullYear;
  } else {
    // Convert to Christian Era if year is in Buddhist Era (>= 2400)
    yearNum = fullYear >= 2400 ? fullYear - 543 : fullYear;
  }

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
  parseDateInput,
  formatDate,
  getShortDate,
  getSlashDate,
  getFormatDate,
  getNextSaturday
};
