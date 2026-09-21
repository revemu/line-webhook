const logger = require('../utils/logger');
const db = require('../query');

/**
 * In-memory store for scheduled tasks with delivery_mode = 'reply_on_chat'
 * that have reached their scheduled time and are waiting for the next chat message.
 */
class PendingTaskManager {
  constructor() {
    this.pendingTasks = new Map(); // taskId -> PendingTaskObject
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
    const expiresAt = now + (expireMinutes * 60 * 1000);

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

    const groupTag = db.getGroupTag(pendingItem.groupId);
    const expireTime = new Date(expiresAt).toLocaleTimeString('th-TH', { hour12: false, timeZone: 'Asia/Bangkok' });
    logger.info(`[PendingManager] Enqueued task '${taskId}' (${pendingItem.name}) for ${groupTag || 'any group'} (expires at ${expireTime}, window: ${expireMinutes}m)`);
  }

  /**
   * Retrieves and returns all non-expired pending tasks eligible for the given groupId.
   * Automatically purges expired tasks from memory.
   * @param {string} groupId 
   * @returns {Promise<Array<Object>>}
   */
  async getPendingForGroup(groupId) {
    if (!groupId) return [];
    const now = Date.now();
    const matched = [];

    for (const [taskId, task] of this.pendingTasks.entries()) {
      // 1. Check expiration
      if (now > task.expiresAt) {
        logger.info(`[PendingManager] Pending task '${taskId}' expired without chat activity, cleared from queue.`);
        this.pendingTasks.delete(taskId);
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

    return matched;
  }

  /**
   * Removes a task from the pending queue after execution.
   * @param {string|number} taskId 
   */
  remove(taskId) {
    if (!taskId) return;
    this.pendingTasks.delete(String(taskId));
  }

  /**
   * Clears all pending tasks (e.g. on server reset).
   */
  clear() {
    this.pendingTasks.clear();
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
