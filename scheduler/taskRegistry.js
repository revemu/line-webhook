const crypto = require('crypto');
const db = require('../query');
const logger = require('../utils/logger');

const DAY_MAP = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6
};

/**
 * Resolves current Date and Time in Asia/Bangkok (UTC+7) timezone.
 * Uses Intl.DateTimeFormat formatToParts for 100% reliable timezone conversion.
 * @param {Date} [date=new Date()] 
 * @returns {Object} { dow, currentTimeStr, todayDateStr, currentMinuteKey, h, m, weekdayShort }
 */
function getBangkokDateTime(date = new Date()) {
  const tz = process.env.TIMEZONE || process.env.TZ || 'Asia/Bangkok';

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short'
    });

    const parts = formatter.formatToParts(date);
    const map = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }

    let h = map.hour === '24' ? '00' : String(map.hour).padStart(2, '0');
    let m = String(map.minute).padStart(2, '0');
    let s = String(map.second || '00').padStart(2, '0');
    const currentTimeStr = `${h}:${m}`;
    const todayDateStr = `${map.year}-${map.month}-${map.day}`;
    const currentDateTimeStr = `${todayDateStr} ${h}:${m}:${s}`;
    const currentMinuteKey = `${todayDateStr} ${currentTimeStr}`;
    const weekdayShort = (map.weekday || '').toLowerCase();
    const dow = DAY_MAP[weekdayShort] !== undefined ? DAY_MAP[weekdayShort] : date.getDay();

    return { dow, currentTimeStr, todayDateStr, currentDateTimeStr, currentMinuteKey, h, m, s, weekdayShort };
  } catch (err) {
    // Fallback in case of timezone formatting error
    const d = new Date(date.getTime() + (7 * 3600 * 1000) + (date.getTimezoneOffset() * 60 * 1000));
    const dow = d.getDay();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const currentTimeStr = `${h}:${m}`;
    const todayDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const currentDateTimeStr = `${todayDateStr} ${h}:${m}:${s}`;
    const currentMinuteKey = `${todayDateStr} ${currentTimeStr}`;
    return { dow, currentTimeStr, todayDateStr, currentDateTimeStr, currentMinuteKey, h, m, s, weekdayShort: Object.keys(DAY_MAP)[dow] };
  }
}

/**
 * Normalizes HH:mm time string (e.g. "17:26:00" -> "17:26", "7:5" -> "07:05").
 * @param {string} timeStr 
 * @returns {string}
 */
function normalizeTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const parts = timeStr.trim().split(':');
  if (parts.length >= 2) {
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    return `${h}:${m}`;
  }
  return timeStr.trim();
}

/**
 * Checks if targetDays specification matches the current day of the week.
 * Supports '*', 'weekdays', 'weekends', [1,2,3,4,5], '1-5', '1,2,3,4,5', 'mon-fri', 'fri', 'thu', etc.
 * @param {Array|string|number} targetDays 
 * @param {number} currentDow - 0 (Sun) .. 6 (Sat)
 * @returns {boolean}
 */
function matchesDay(targetDays, currentDow) {
  if (targetDays === '*' || targetDays == null || targetDays === 'all' || targetDays === 'daily' || targetDays === 'everyday') {
    return true;
  }

  // If array e.g. [1, 2, 3, 4, 5] or ['mon', 'fri']
  if (Array.isArray(targetDays)) {
    return targetDays.some(d => {
      if (typeof d === 'number') return d === currentDow;
      const str = String(d).toLowerCase().trim();
      if (DAY_MAP[str] !== undefined) return DAY_MAP[str] === currentDow;
      return parseInt(str, 10) === currentDow;
    });
  }

  // If number e.g. 1
  if (typeof targetDays === 'number') {
    return targetDays === currentDow;
  }

  // If string
  if (typeof targetDays === 'string') {
    const s = targetDays.toLowerCase().trim();
    if (s === '*' || s === 'all' || s === 'daily' || s === 'everyday') return true;
    if (s === 'weekdays' || s === 'mon-fri' || s === '1-5') return currentDow >= 1 && currentDow <= 5;
    if (s === 'weekends' || s === 'sat-sun' || s === '6,0' || s === '0,6') return currentDow === 0 || currentDow === 6;

    // Handle single day name e.g. "fri", "thu"
    if (DAY_MAP[s] !== undefined) {
      return DAY_MAP[s] === currentDow;
    }

    // Handle range e.g. "1-5" or "mon-fri"
    const rangeMatch = s.match(/^([a-z0-9]+)\s*-\s*([a-z0-9]+)$/);
    if (rangeMatch) {
      const start = DAY_MAP[rangeMatch[1]] !== undefined ? DAY_MAP[rangeMatch[1]] : parseInt(rangeMatch[1], 10);
      const end = DAY_MAP[rangeMatch[2]] !== undefined ? DAY_MAP[rangeMatch[2]] : parseInt(rangeMatch[2], 10);
      if (!isNaN(start) && !isNaN(end)) {
        if (start <= end) {
          return currentDow >= start && currentDow <= end;
        } else {
          return currentDow >= start || currentDow <= end;
        }
      }
    }

    // Handle comma-separated list e.g. "1,2,3,4,5" or "mon,tue,wed,thu,fri"
    const parts = s.split(',').map(p => p.trim());
    return parts.some(p => {
      if (DAY_MAP[p] !== undefined) return DAY_MAP[p] === currentDow;
      return parseInt(p, 10) === currentDow;
    });
  }

  return false;
}

class TaskRegistry {
  constructor() {
    this.tasks = new Map();
    this.lastExecution = new Map(); // taskId -> 'YYYY-MM-DD HH:mm'
    this.lastTasksHash = null;
    this.isLoaded = false;
  }

  /**
   * Loads scheduled tasks from scheduled_task_tbl in database.
   * Only loads and registers enabled tasks (enabled = 1).
   * Compares payload hash to avoid reloading and logging when tasks are unchanged.
   * @param {boolean} [force=false]
   * @returns {Promise<boolean>} True if tasks were loaded or changed, false if unchanged.
   */
  async loadTasks(force = false) {
    try {
      const rows = await db.getScheduledTasks(true);
      const tasksHash = crypto.createHash('md5').update(JSON.stringify(rows || [])).digest('hex');

      if (!force && this.isLoaded && this.lastTasksHash === tasksHash) {
        // Tasks in DB are identical, no need to reload or log
        return false;
      }

      const isInitial = !this.isLoaded;
      this.tasks.clear();

      if (rows && rows.length > 0) {
        for (const row of rows) {
          const isEnabled = row.enabled === 1 || row.enabled === true;
          if (!isEnabled) continue;

          const taskId = row.task_key || String(row.id);
          const taskObj = {
            id: taskId,
            dbId: row.id,
            name: row.task_name || taskId,
            type: row.task_type || 'command',
            command: row.command || null,
            text_message: row.text_message || null,
            groupId: row.group_id || null,
            deliveryMode: row.delivery_mode || 'push',
            expireMinutes: row.expire_minutes !== undefined && row.expire_minutes !== null ? parseInt(row.expire_minutes, 10) : 60,
            enabled: true,
            schedule: {
              days: row.schedule_days || '*',
              time: normalizeTime(row.schedule_time || '20:00')
            },
            last_run_date: row.last_run_date || null
          };

          this.tasks.set(taskId, taskObj);
          logger.debug(`[TaskRegistry] Registered task: ${taskId} (${taskObj.name}) | Type: ${taskObj.type} | Schedule: ${taskObj.schedule.days} @ ${taskObj.schedule.time}`);
        }
      }

      this.lastTasksHash = tasksHash;
      this.isLoaded = true;

      if (isInitial) {
        logger.info(`[TaskRegistry] Initialized ${this.tasks.size} active scheduled task(s) from database`);
      } else {
        logger.info(`[TaskRegistry] Scheduled tasks updated from database (${this.tasks.size} active task(s))`);
      }

      return true;
    } catch (err) {
      logger.error('[TaskRegistry] Failed to load tasks from DB:', err.message);
      return false;
    }
  }

  /**
   * Evaluates registered tasks against current date & time (Bangkok timezone).
   * @param {Date} [now=new Date()]
   * @returns {Array<Object>} List of tasks that should execute now
   */
  getDueTasks(now = new Date()) {
    const dueTasks = [];
    const { dow, currentTimeStr, todayDateStr, currentMinuteKey, weekdayShort } = getBangkokDateTime(now);

    for (const [id, task] of this.tasks.entries()) {
      if (task.enabled === false) continue;
      // reply_on_chat tasks are dispatched on-demand when chat messages arrive in the group; skip them in background worker to stay silent
      if (task.deliveryMode === 'reply_on_chat') continue;

      const schedule = task.schedule || {};
      const targetDays = schedule.days;
      const targetTime = normalizeTime(schedule.time);

      // 1. Check day-of-week condition
      if (!matchesDay(targetDays, dow)) {
        continue;
      }

      // 2. Check time condition (HH:mm)
      if (targetTime && targetTime !== currentTimeStr) {
        continue;
      }

      // 3. Ensure the task has not already executed during this exact minute
      const lastRunMinute = this.lastExecution.get(id);
      if (lastRunMinute === currentMinuteKey) {
        continue;
      }

      logger.info(`[TaskRegistry] Task '${id}' matched schedule (${weekdayShort} @ ${currentTimeStr})!`);
      dueTasks.push(task);
    }

    return dueTasks;
  }

  /**
   * Marks that a task's schedule match was logged for the current minute without updating DB last_run_date.
   * @param {string} taskId 
   * @param {Date} [date=new Date()] 
   */
  markMinuteLogged(taskId, date = new Date()) {
    const { currentMinuteKey } = getBangkokDateTime(date);
    this.lastExecution.set(taskId, currentMinuteKey);
  }

  /**
   * Marks a task as successfully run for the given date and minute.
   * Updates memory map and persists full datetime string to scheduled_task_tbl.
   * @param {string} taskId 
   * @param {Date} [date=new Date()] 
   */
  async markTaskExecuted(taskId, date = new Date()) {
    const { currentDateTimeStr, currentMinuteKey } = getBangkokDateTime(date);
    this.lastExecution.set(taskId, currentMinuteKey);

    const task = this.tasks.get(taskId);
    if (task) {
      task.last_run_date = currentDateTimeStr;
    }

    try {
      await db.setScheduledTaskLastRun(taskId, currentDateTimeStr);
    } catch (err) {
      logger.error(`[TaskRegistry] Failed to persist last_run_date for task '${taskId}':`, err.message);
    }
  }

  /**
   * Retrieves a registered task by its ID or key.
   * @param {string} taskId 
   * @returns {Object|null}
   */
  getTaskById(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Returns all registered tasks.
   * @returns {Array<Object>}
   */
  getAllTasks() {
    return Array.from(this.tasks.values());
  }
}

module.exports = new TaskRegistry();
module.exports.getBangkokDateTime = getBangkokDateTime;
