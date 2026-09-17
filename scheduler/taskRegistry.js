const db = require('../query');

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
 * Ensures schedule evaluation matches Thai local time regardless of server OS timezone.
 * @param {Date} [date=new Date()] 
 * @returns {Object} { dow, currentTimeStr, todayDateStr, h, m }
 */
function getBangkokDateTime(date = new Date()) {
  const tz = process.env.TIMEZONE || process.env.TZ || 'Asia/Bangkok';
  const dateStr = date.toLocaleString('en-US', { timeZone: tz });
  const bDate = new Date(dateStr);

  const dow = bDate.getDay();
  const h = String(bDate.getHours()).padStart(2, '0');
  const m = String(bDate.getMinutes()).padStart(2, '0');
  const currentTimeStr = `${h}:${m}`;
  const todayDateStr = `${bDate.getFullYear()}-${String(bDate.getMonth() + 1).padStart(2, '0')}-${String(bDate.getDate()).padStart(2, '0')}`;

  return { dow, currentTimeStr, todayDateStr, h, m };
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
    this.lastExecution = new Map(); // taskId -> 'YYYY-MM-DD'
    this.isLoaded = false;
  }

  /**
   * Loads scheduled tasks from scheduled_task_tbl in database.
   */
  async loadTasks() {
    try {
      console.log('[TaskRegistry] Loading scheduled tasks from database (scheduled_task_tbl)...');
      const rows = await db.getScheduledTasks(false);

      this.tasks.clear();

      if (rows && rows.length > 0) {
        for (const row of rows) {
          const taskId = row.task_key || String(row.id);
          const taskObj = {
            id: taskId,
            dbId: row.id,
            name: row.task_name || taskId,
            type: row.task_type || 'command',
            command: row.command || null,
            text_message: row.text_message || null,
            groupId: row.group_id || null,
            enabled: row.enabled === 1 || row.enabled === true,
            schedule: {
              days: row.schedule_days || '*',
              time: normalizeTime(row.schedule_time || '20:00')
            },
            last_run_date: row.last_run_date || null
          };

          this.tasks.set(taskId, taskObj);
          if (row.last_run_date) {
            this.lastExecution.set(taskId, row.last_run_date);
          }

          console.log(`[TaskRegistry] Registered task: ${taskId} (${taskObj.name}) | Type: ${taskObj.type} | Schedule: ${taskObj.schedule.days} @ ${taskObj.schedule.time} | Enabled: ${taskObj.enabled}`);
        }
      } else {
        console.log('[TaskRegistry] No tasks found in scheduled_task_tbl.');
      }

      this.isLoaded = true;
      console.log(`[TaskRegistry] Total tasks registered: ${this.tasks.size}`);
    } catch (err) {
      console.error('[TaskRegistry] Failed to load tasks from DB:', err.message);
    }
  }

  /**
   * Evaluates registered tasks against current date & time (Bangkok timezone).
   * @param {Date} [now=new Date()]
   * @returns {Array<Object>} List of tasks that should execute now
   */
  getDueTasks(now = new Date()) {
    const dueTasks = [];
    const { dow, currentTimeStr, todayDateStr } = getBangkokDateTime(now);

    for (const [id, task] of this.tasks.entries()) {
      if (task.enabled === false) continue;

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

      // 3. Ensure the task has not already executed today
      const lastRun = this.lastExecution.get(id);
      if (lastRun === todayDateStr) {
        continue;
      }

      dueTasks.push(task);
    }

    return dueTasks;
  }

  /**
   * Marks a task as successfully run for the given date.
   * Updates memory map and persists to scheduled_task_tbl.
   * @param {string} taskId 
   * @param {Date} [date=new Date()] 
   */
  async markTaskExecuted(taskId, date = new Date()) {
    const { todayDateStr } = getBangkokDateTime(date);
    this.lastExecution.set(taskId, todayDateStr);

    const task = this.tasks.get(taskId);
    if (task) {
      task.last_run_date = todayDateStr;
    }

    try {
      await db.setScheduledTaskLastRun(taskId, todayDateStr);
    } catch (err) {
      console.error(`[TaskRegistry] Failed to persist last_run_date for task '${taskId}':`, err.message);
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
