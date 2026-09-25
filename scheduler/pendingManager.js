const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const db = require('../query');

const STATE_FILE_PATH = path.join(__dirname, '..', 'temp', 'pending_tasks.json');

/**
 * In-memory & file-persisted store for scheduled tasks with delivery_mode = 'reply_on_chat'
 * that have reached their scheduled time and are waiting for the next chat message.
 */
class PendingTaskManager {
  constructor() {
    this.pendingTasks = new Map(); // taskId -> PendingTaskObject
    this._loadFromFile();
  }

  /**
   * Loads persisted pending tasks from temp/pending_tasks.json on startup.
   * Discards tasks that have already expired.
   * @private
   */
  _loadFromFile() {
    try {
      if (!fs.existsSync(STATE_FILE_PATH)) return;
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
      if (!raw || !raw.trim()) return;

      const items = JSON.parse(raw);
      if (!Array.isArray(items)) return;

      const now = Date.now();
      let restoredCount = 0;

      for (const item of items) {
        if (item && item.id && item.expiresAt && item.expiresAt > now) {
          this.pendingTasks.set(String(item.id), item);
          restoredCount++;
        }
      }

      if (restoredCount > 0) {
        logger.info(`[PendingManager] Restored ${restoredCount} pending reply_on_chat task(s) from ${STATE_FILE_PATH}`);
      }

      // Save back cleaned (unexpired) list
      this._saveToFile();
    } catch (err) {
      logger.error('[PendingManager] Failed to load pending tasks from file:', err.message);
    }
  }

  /**
   * Persists current pending tasks to temp/pending_tasks.json.
   * @private
   */
  _saveToFile() {
    try {
      const tempDir = path.dirname(STATE_FILE_PATH);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const items = Array.from(this.pendingTasks.values());
      fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(items, null, 2), 'utf8');
    } catch (err) {
      logger.error('[PendingManager] Failed to save pending tasks to file:', err.message);
    }
  }

  /**
   * Checks if a task is currently enqueued.
   * @param {string|number} taskId 
   * @returns {boolean}
   */
  has(taskId) {
    if (!taskId) return false;
    return this.pendingTasks.has(String(taskId));
  }

  /**
   * Enqueues a task when its schedule triggers.
   * @param {Object} task 
   */
  enqueue(task) {
    if (!task || !task.id) return;

    const taskId = String(task.id);
    const expireMinutes = Number(task.expireMinutes) > 0 ? parseInt(task.expireMinutes, 10) : 60;
    const now = Date.now();
    const expiresAt = task.expiresAt && task.expiresAt > now ? task.expiresAt : (now + (expireMinutes * 60 * 1000));

    const pendingItem = {
      id: taskId,
      dbId: task.dbId || task.id,
      name: task.name || taskId,
      type: task.type || task.task_type || 'command',
      command: task.command || null,
      text_message: task.text_message || null,
      groupId: task.groupId || task.group_id || null,
      rawGroupId: task.rawGroupId || task.raw_group_id || task.groupId || null,
      expireMinutes,
      enqueuedAt: now,
      expiresAt
    };

    this.pendingTasks.set(taskId, pendingItem);
    this._saveToFile();

    const groupTag = db.getGroupTag(pendingItem.groupId);
    const expireTime = new Date(expiresAt).toLocaleTimeString('th-TH', { hour12: false, timeZone: 'Asia/Bangkok' });
    logger.info(`[PendingManager] Enqueued task '${taskId}' (${pendingItem.name}) for ${groupTag || 'any group'} [mode: reply_on_chat] (expires at ${expireTime}, window: ${expireMinutes}m)`);
  }

  /**
   * Retrieves and returns all non-expired pending tasks eligible for the given groupId.
   * Automatically purges expired tasks from memory and file.
   * @param {string} groupId 
   * @returns {Promise<Array<Object>>}
   */
  async getPendingForGroup(groupId) {
    if (!groupId) return [];
    const now = Date.now();
    const matched = [];
    let stateChanged = false;

    for (const [taskId, task] of this.pendingTasks.entries()) {
      // 1. Check expiration
      if (now > task.expiresAt) {
        logger.info(`[PendingManager] Pending task '${taskId}' expired without chat activity, cleared from queue.`);
        this.pendingTasks.delete(taskId);
        stateChanged = true;
        continue;
      }

      // 2. Check group matching (if task has no group specified, matches any active group)
      if (!task.groupId && !task.rawGroupId) {
        matched.push(task);
        continue;
      }

      const targetGid = task.groupId ? await db.resolveLineGroupId(task.groupId) : null;
      const rawGid = task.rawGroupId || task.groupId;

      let isGroupMatch = (targetGid === groupId || String(rawGid) === String(groupId));
      if (!isGroupMatch) {
        const groupProfile = await db.getGroupProfile(groupId);
        if (groupProfile) {
          if (String(groupProfile.id) === String(rawGid) || (groupProfile.line_group_id && groupProfile.line_group_id === targetGid)) {
            isGroupMatch = true;
          }
        }
      }

      if (isGroupMatch) {
        matched.push(task);
      }
    }

    if (stateChanged) {
      this._saveToFile();
    }

    return matched;
  }

  /**
   * Removes a task from the pending queue after execution and updates persistence.
   * @param {string|number} taskId 
   */
  remove(taskId) {
    if (!taskId) return;
    this.pendingTasks.delete(String(taskId));
    this._saveToFile();
  }

  /**
   * Clears all pending tasks (e.g. on server reset) and updates persistence.
   */
  clear() {
    this.pendingTasks.clear();
    this._saveToFile();
  }

  /**
   * Returns the count of currently active pending tasks.
   * @returns {number}
   */
  size() {
    return this.pendingTasks.size;
  }
}

const pendingManager = new PendingTaskManager();
module.exports = pendingManager;
