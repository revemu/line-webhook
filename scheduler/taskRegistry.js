const fs = require('fs');
const path = require('path');

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
      let dayMatches = true;
      if (Array.isArray(targetDays)) {
        dayMatches = targetDays.includes(dow);
      } else if (targetDays !== '*' && targetDays != null) {
        dayMatches = Number(targetDays) === dow;
      }

      if (!dayMatches) continue;

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
