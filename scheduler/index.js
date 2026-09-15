const { Worker } = require('worker_threads');
const path = require('path');
const db = require('../query');

let worker = null;
let currentGroupId = null;
let isShuttingDown = false;

/**
 * Initializes and supervises the scheduler worker thread.
 */
function initScheduler() {
  if (worker) {
    console.log('[SchedulerSupervisor] Worker thread is already active.');
    return;
  }

  const workerPath = path.join(__dirname, 'worker.js');
  console.log(`[SchedulerSupervisor] Spawning scheduler worker thread from ${workerPath}...`);

  worker = new Worker(workerPath, {
    workerData: {
      initialGroupId: currentGroupId
    }
  });

  worker.on('message', (msg) => {
    if (msg.type === 'TASK_COMPLETED') {
      console.log(`[SchedulerSupervisor] Worker notification: Task '${msg.taskId}' completed (success: ${msg.success}) at ${msg.timestamp}`);
    } else if (msg.type === 'TASK_ERROR') {
      console.error(`[SchedulerSupervisor] Worker notification: Task '${msg.taskId}' failed with error: ${msg.error}`);
    }
  });

  worker.on('error', (err) => {
    console.error('[SchedulerSupervisor] Worker thread encountered an error:', err);
  });

  worker.on('exit', (code) => {
    console.warn(`[SchedulerSupervisor] Worker thread exited with code ${code}`);
    worker = null;
    if (!isShuttingDown && code !== 0) {
      console.log('[SchedulerSupervisor] Respawning worker thread in 5 seconds...');
      setTimeout(initScheduler, 5000);
    }
  });

  console.log('[SchedulerSupervisor] Scheduler worker thread spawned successfully.');
}

/**
 * Notifies the scheduler of an active LINE group ID.
 * Also persists the group ID in MySQL via db.saveActiveGroupId.
 * @param {string} groupId 
 */
function notifyActiveGroup(groupId) {
  if (!groupId || typeof groupId !== 'string') return;
  currentGroupId = groupId;

  // Persist to DB asynchronously
  db.saveActiveGroupId(groupId).catch(err => {
    console.error('[SchedulerSupervisor] Failed to persist active groupId to DB:', err.message);
  });

  // Notify worker thread via IPC
  if (worker) {
    worker.postMessage({
      type: 'UPDATE_GROUP_ID',
      groupId
    });
  }
}

/**
 * Triggers a registered task immediately for testing or admin commands.
 * @param {string} taskId 
 */
function triggerTask(taskId) {
  if (worker) {
    worker.postMessage({
      type: 'TRIGGER_TASK',
      taskId
    });
    console.log(`[SchedulerSupervisor] Sent trigger request for task '${taskId}' to worker.`);
  } else {
    console.warn(`[SchedulerSupervisor] Cannot trigger task '${taskId}': worker thread is not running.`);
  }
}

/**
 * Commands the worker thread to reload its task registry.
 */
function reloadTasks() {
  if (worker) {
    worker.postMessage({ type: 'RELOAD_TASKS' });
  }
}

// Cleanup on process shutdown
process.on('SIGINT', () => { isShuttingDown = true; });
process.on('SIGTERM', () => { isShuttingDown = true; });

module.exports = {
  initScheduler,
  notifyActiveGroup,
  triggerTask,
  reloadTasks
};
