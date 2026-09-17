const fs = require('fs');
const path = require('path');

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
 * Checks if targetDays specification matches the current day of the week.
 * Supports '*', 'weekdays', 'weekends', [1,2,3,4,5], '1-5', '1,2,3,4,5', 'mon-fri', etc.
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
  }

  /**
   * Scans and loads all .js task modules from the tasks/ directory.
   */
  loadTasks() {
    const tasksDir = path.join(__dirname, 'tasks');
    if (!fs.existsSync(tasksDir)) {
      console.warn(`[TaskRegistry] Tasks directory not found at: ${tasksDir}`);
      return;
    }

    const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.js'));
    for (const file of files) {
      try {
        const filePath = path.join(tasksDir, file);
        // Clear require cache to support hot reload if ever required
        delete require.cache[require.resolve(filePath)];
        const task = require(filePath);

        if (!task || !task.id || typeof task.execute !== 'function') {
          console.warn(`[TaskRegistry] Invalid task structure in ${file}, skipping.`);
          continue;
        }

        this.tasks.set(task.id, task);
        console.log(`[TaskRegistry] Registered task: ${task.id} (${task.name || 'Unnamed'}) | Schedule: ${JSON.stringify(task.schedule)}`);
      } catch (err) {
        console.error(`[TaskRegistry] Failed to load task file ${file}:`, err.message);
      }
    }
    console.log(`[TaskRegistry] Total tasks registered: ${this.tasks.size}`);
  }

  /**
   * Evaluates registered tasks against the current date & time.
   * @param {Date} [now=new Date()]
   * @returns {Array<Object>} List of tasks that should execute now
   */
  getDueTasks(now = new Date()) {
    const dueTasks = [];
    const dow = now.getDay(); // 0 = Sun .. 6 = Sat
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${h}:${m}`;
    const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    for (const [id, task] of this.tasks.entries()) {
      if (task.enabled === false) continue;

      const schedule = task.schedule || {};
      const targetDays = schedule.days;
      const targetTime = schedule.time;

      // 1. Check day-of-week condition
      if (!matchesDay(targetDays, dow)) continue;

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
   * @param {string} taskId 
   * @param {Date} [date=new Date()] 
   */
  markTaskExecuted(taskId, date = new Date()) {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    this.lastExecution.set(taskId, dateStr);
  }

  /**
   * Retrieves a registered task by its ID.
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
