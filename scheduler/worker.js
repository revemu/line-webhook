const { parentPort, workerData } = require('worker_threads');
const db = require('../query');
const lineClient = require('../lineClient');
const cmd = require('../cmd');
const taskRegistry = require('./taskRegistry');

let activeGroupId = (workerData && workerData.initialGroupId) || null;
let isExecuting = false;
let lastDbReloadTime = 0;
const DB_RELOAD_INTERVAL_MS = 5 * 60 * 1000; // Reload tasks from DB every 5 mins

console.log('[SchedulerWorker] Starting background scheduler worker thread...');

// 1. Initial task discovery & active group resolution
(async () => {
  try {
    await taskRegistry.loadTasks();
    lastDbReloadTime = Date.now();
  } catch (err) {
    console.error('[SchedulerWorker] Initial task loading error:', err.message);
  }

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
 * Executes a single task safely with logging and push notification.
 * Supports task types: 'command' and 'text'.
 * @param {Object} task 
 * @param {string} triggerSource 
 */
async function runTask(task, triggerSource = 'schedule') {
  console.log(`[SchedulerWorker] Starting execution of task '${task.id}' (${task.name}) [type: ${task.type}, source: ${triggerSource}]`);
  const now = new Date();
  try {
    let targetGroupId = task.groupId || null;

    // If no static groupId is set on task, look up task-specific groupId from DB (template_tpl)
    if (!targetGroupId) {
      targetGroupId = await db.getTaskGroupId(task.id);
    }

    // Fallback to activeGroupId or general DB active_group_id
    if (!targetGroupId) {
      targetGroupId = activeGroupId || (await db.getActiveGroupId());
    }

    if (!targetGroupId) {
      console.warn(`[SchedulerWorker] Execution aborted for task '${task.id}': No target groupId available`);
      return;
    }

    let pushResult = null;

    if (task.type === 'command') {
      const rawCmd = (task.command || '').trim();
      if (!rawCmd) {
        console.warn(`[SchedulerWorker] Command task '${task.id}' has empty command, skipping.`);
        return;
      }

      const cleanCmd = rawCmd.startsWith('/') ? rawCmd.substring(1) : rawCmd;
      console.log(`[SchedulerWorker] Running command: "${cleanCmd}" for group: ${targetGroupId}`);

      const botMember = {
        id: 0,
        line_user_id: 'SYSTEM_BOT',
        name: 'System',
        admin: 1,
        debt: 0
      };

      const reply = await cmd.process_cmd(cleanCmd, botMember, null, targetGroupId);
      if (reply) {
        const msgs = Array.isArray(reply) ? reply : [reply];
        console.log(`[SchedulerWorker] Pushing command response (${msgs.length} message(s)) to group ${targetGroupId}...`);
        pushResult = await lineClient.pushMessage(targetGroupId, msgs);
      } else {
        console.log(`[SchedulerWorker] Command '${cleanCmd}' completed without reply message.`);
        pushResult = true;
      }
    } else if (task.type === 'text') {
      const textMsg = (task.text_message || '').trim();
      if (!textMsg) {
        console.warn(`[SchedulerWorker] Text task '${task.id}' has empty text_message, skipping.`);
        return;
      }

      console.log(`[SchedulerWorker] Resolving and sending text task for group: ${targetGroupId}`);
      const pushMsg = await db.resolveScheduleTemplateText(textMsg, targetGroupId);
      pushResult = await lineClient.pushMessage(targetGroupId, [pushMsg]);
    } else {
      console.warn(`[SchedulerWorker] Unknown task type '${task.type}' for task '${task.id}'`);
      return;
    }

    await taskRegistry.markTaskExecuted(task.id, now);
    console.log(`[SchedulerWorker] Task '${task.id}' executed successfully. Push result:`, pushResult ? 'SUCCESS' : 'FAILED');

    if (parentPort) {
      parentPort.postMessage({
        type: 'TASK_COMPLETED',
        taskId: task.id,
        success: Boolean(pushResult),
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

    // Auto-refresh tasks from DB every DB_RELOAD_INTERVAL_MS
    if (!taskRegistry.isLoaded || (Date.now() - lastDbReloadTime > DB_RELOAD_INTERVAL_MS)) {
      await taskRegistry.loadTasks();
      lastDbReloadTime = Date.now();
    }

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
          // Check in registry or fetch from DB directly if not found
          let task = taskRegistry.getTaskById(message.taskId);
          if (!task) {
            await taskRegistry.loadTasks();
            task = taskRegistry.getTaskById(message.taskId);
          }

          if (task) {
            console.log(`[SchedulerWorker] Manual trigger received for task: ${message.taskId}`);
            await runTask(task, 'manual_ipc');
          } else {
            console.warn(`[SchedulerWorker] Cannot trigger unknown task: ${message.taskId}`);
          }
        }
        break;

      case 'RELOAD_TASKS':
        console.log('[SchedulerWorker] Reloading tasks from DB upon main thread request...');
        await taskRegistry.loadTasks();
        lastDbReloadTime = Date.now();
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
