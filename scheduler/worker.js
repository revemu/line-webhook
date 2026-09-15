const { parentPort, workerData } = require('worker_threads');
const db = require('../query');
const lineClient = require('../lineClient');
const taskRegistry = require('./taskRegistry');

let activeGroupId = (workerData && workerData.initialGroupId) || null;
let isExecuting = false;

console.log('[SchedulerWorker] Starting background scheduler worker thread...');

// 1. Initial task discovery
taskRegistry.loadTasks();

// 2. Fetch initial active group ID from DB if not provided via workerData
(async () => {
  try {
    if (!activeGroupId) {
      activeGroupId = await db.getActiveGroupId();
    }
    console.log(`[SchedulerWorker] Initial active groupId: ${activeGroupId || 'none (will resolve on demand)'}`);
  } catch (err) {
    console.error('[SchedulerWorker] Failed to resolve initial active groupId:', err.message);
  }
})();

/**
 * Executes a single task safely with logging.
 * @param {Object} task 
 * @param {string} triggerSource 
 */
async function runTask(task, triggerSource = 'schedule') {
  console.log(`[SchedulerWorker] Starting execution of task '${task.id}' [source: ${triggerSource}]`);
  const now = new Date();
  try {
    const targetGroupId = activeGroupId || (await db.getActiveGroupId());
    const result = await task.execute({
      groupId: targetGroupId,
      lineClient,
      db
    });
    taskRegistry.markTaskExecuted(task.id, now);
    console.log(`[SchedulerWorker] Task '${task.id}' completed. Result: ${result}`);

    if (parentPort) {
      parentPort.postMessage({
        type: 'TASK_COMPLETED',
        taskId: task.id,
        success: Boolean(result),
        timestamp: now.toISOString()
      });
    }
  } catch (err) {
    console.error(`[SchedulerWorker] Error executing task '${task.id}':`, err);
    if (parentPort) {
      parentPort.postMessage({
        type: 'TASK_ERROR',
        taskId: task.id,
        error: err.message,
        timestamp: now.toISOString()
      });
    }
  }
}

/**
 * Periodic tick evaluating scheduled tasks.
 */
async function tick() {
  if (isExecuting) return;
  isExecuting = true;

  try {
    const now = new Date();
    const dueTasks = taskRegistry.getDueTasks(now);

    for (const task of dueTasks) {
      await runTask(task, 'schedule');
    }
  } catch (err) {
    console.error('[SchedulerWorker] Error in tick loop:', err.message);
  } finally {
    isExecuting = false;
  }
}

// 3. Start native timer loop (check every 30 seconds for precise minute matching)
const TICK_INTERVAL_MS = 30 * 1000;
const timerInterval = setInterval(tick, TICK_INTERVAL_MS);

// 4. Handle IPC messages from the main thread
if (parentPort) {
  parentPort.on('message', async (message) => {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'UPDATE_GROUP_ID':
        if (message.groupId && message.groupId !== activeGroupId) {
          activeGroupId = message.groupId;
          console.log(`[SchedulerWorker] Updated active groupId from main thread: ${activeGroupId}`);
        }
        break;

      case 'TRIGGER_TASK':
        if (message.taskId) {
          const task = taskRegistry.getTaskById(message.taskId);
          if (task) {
            console.log(`[SchedulerWorker] Manual trigger received for task: ${message.taskId}`);
            await runTask(task, 'manual_ipc');
          } else {
            console.warn(`[SchedulerWorker] Cannot trigger unknown task: ${message.taskId}`);
          }
        }
        break;

      case 'RELOAD_TASKS':
        console.log('[SchedulerWorker] Reloading tasks...');
        taskRegistry.loadTasks();
        break;

      default:
        console.log(`[SchedulerWorker] Unknown message type received: ${message.type}`);
    }
  });
}

// Graceful cleanup
process.on('SIGTERM', () => {
  clearInterval(timerInterval);
  process.exit(0);
});
