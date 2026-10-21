const { parentPort, workerData } = require('worker_threads');
const db = require('../query');
const lineClient = require('../lineClient');
const cmd = require('../cmd');
const taskRegistry = require('./taskRegistry');
const logger = require('../utils/logger');
const { setBaseUrl } = require('../utils/url');

let currentBaseUrl = (workerData && workerData.baseUrl) || null;
if (currentBaseUrl) {
  setBaseUrl(currentBaseUrl);
}
let isExecuting = false;
let lastDbReloadTime = 0;
const DB_RELOAD_INTERVAL_MS = 5 * 60 * 1000; // Reload tasks from DB every 5 mins

logger.info('[SchedulerWorker] Starting background scheduler worker thread...');

// 1. Initial task discovery
(async () => {
  try {
    await taskRegistry.loadTasks();
    lastDbReloadTime = Date.now();
  } catch (err) {
    logger.error('[SchedulerWorker] Initial task loading error:', err.message);
  }

  try {
    const dbBaseUrl = await db.getBaseUrlFromDb();
    if (dbBaseUrl && dbBaseUrl !== currentBaseUrl) {
      currentBaseUrl = dbBaseUrl;
      setBaseUrl(dbBaseUrl);
      logger.info(`[SchedulerWorker] Loaded base URL from database: ${dbBaseUrl}`);
    }
  } catch (err) {
    logger.error('[SchedulerWorker] Failed to load base URL from DB:', err.message);
  }
})();

/**
 * Evaluates and resolves a scheduled task's message payload under SYSTEM_BOT context.
 * Standardized across all task types (command, text).
 * If the command returns null/empty or the text resolves to empty, returns an empty array [].
 * @param {Object} task 
 * @param {string|null} targetGroupId 
 * @returns {Promise<Array<Object>>} Array of LINE message objects
 */
async function evaluateTaskMessages(task, targetGroupId) {
  const msgs = [];
  const groupTag = targetGroupId ? db.getGroupTag(targetGroupId) : '[System/LogOnly]';

  if (task.type === 'command') {
    const rawCmd = (task.command || '').trim();
    if (!rawCmd) {
      logger.warn(`[SchedulerWorker] Command task '${task.id}' has empty command, skipping evaluation.`);
      return msgs;
    }

    const cleanCmd = rawCmd.startsWith('/') ? rawCmd.substring(1) : rawCmd;
    logger.info(`[SchedulerWorker] Evaluating command: "${cleanCmd}" for ${groupTag} [mode: ${task.deliveryMode || 'push'}]`);

    const botMember = {
      id: 0,
      line_user_id: 'SYSTEM_BOT',
      name: 'System',
      admin: 2,
      debt: 0
    };

    const textMsg = (task.text_message || '').trim();
    if (textMsg) {
      const textMsgObj = await db.resolveScheduleTemplateText(textMsg, targetGroupId);
      if (textMsgObj && (textMsgObj.text || textMsgObj.contents)) {
        msgs.push(textMsgObj);
      }
    }

    const reply = await cmd.process_cmd(cleanCmd, botMember, null, targetGroupId);
    if (reply) {
      if (Array.isArray(reply)) {
        msgs.push(...reply);
      } else {
        msgs.push(reply);
      }
    }
  } else if (task.type === 'text') {
    const textMsg = (task.text_message || '').trim();
    if (!textMsg) {
      logger.warn(`[SchedulerWorker] Text task '${task.id}' has empty text_message, skipping evaluation.`);
      return msgs;
    }

    logger.info(`[SchedulerWorker] Resolving text template for ${groupTag} [mode: ${task.deliveryMode || 'push'}]`);
    const pushMsg = await db.resolveScheduleTemplateText(textMsg, targetGroupId);
    if (pushMsg && (pushMsg.text || pushMsg.contents)) {
      msgs.push(pushMsg);
    }
  } else {
    logger.warn(`[SchedulerWorker] Unknown task type '${task.type}' for task '${task.id}'`);
  }

  return msgs;
}

/**
 * Executes a single task safely with standardized content evaluation,
 * zero redundant queueing for empty outputs, and instant chat reply without re-running.
 * @param {Object} task 
 * @param {string} triggerSource 
 */
async function runTask(task, triggerSource = 'schedule') {
  const isReplyOnChat = task.deliveryMode === 'reply_on_chat';
  const isLogOnly = task.deliveryMode === 'log_only';
  const now = new Date();

  try {
    let targetGroupId = task.groupId || null;

    // If no static groupId is set on task, look up task-specific groupId from DB (template_tpl)
    if (!targetGroupId) {
      targetGroupId = await db.getTaskGroupId(task.id);
    }

    // Fallback to environment variable or DB active_group_id
    if (!targetGroupId) {
      targetGroupId = process.env.LINE_GROUP_ID || (await db.getActiveGroupId());
    }

    if (targetGroupId) {
      targetGroupId = await db.resolveLineGroupId(targetGroupId);
    }

    if (!isLogOnly && !targetGroupId) {
      logger.warn(`[SchedulerWorker] Execution aborted for task '${task.id}': No target groupId available`);
      return;
    }

    logger.info(`[SchedulerWorker] Starting execution of task '${task.id}' (${task.name}) [type: ${task.type}, source: ${triggerSource}, mode: ${task.deliveryMode || 'push'}]`);

    // Standard Content Resolution Phase:
    const msgs = await evaluateTaskMessages(task, targetGroupId);

    // Standard Empty-Content Rule:
    // If a task produces no messages (e.g. no debt, empty condition, no-op),
    // complete it immediately without queueing or pushing.
    if (!msgs || msgs.length === 0) {
      logger.info(`[SchedulerWorker] Task '${task.id}' (${task.name}) evaluated: No messages to deliver (empty output). Completed immediately without action.`);
      await taskRegistry.markTaskExecuted(task.id, now);
      if (parentPort) {
        parentPort.postMessage({
          type: 'TASK_COMPLETED',
          taskId: task.id,
          success: true,
          timestamp: now.toISOString()
        });
      }
      return;
    }

    // Standard Delivery Phase when messages exist:
    if (isReplyOnChat) {
      // Approach 1 (Pre-resolved Messages):
      // Enqueue with pre-generated messages so chat reply delivers immediately with ZERO duplicate command execution!
      logger.info(`[SchedulerWorker] Enqueueing task '${task.id}' (${msgs.length} prepared message(s)) for chat reply...`);
      if (parentPort) {
        parentPort.postMessage({
          type: 'ENQUEUE_PENDING_TASK',
          task: {
            ...task,
            groupId: targetGroupId || task.groupId,
            preparedMessages: msgs,
            expiresAt: task.calculatedExpiresAt || task.expiresAt || undefined
          }
        });
      }
      return;
    }

    let pushResult = null;
    const groupTag = targetGroupId ? db.getGroupTag(targetGroupId) : '[System/LogOnly]';

    if (isLogOnly) {
      const logText = msgs.map(m => m.text || JSON.stringify(m)).join('\n');
      logger.info(`[SchedulerWorker] [LOG_ONLY] Task '${task.id}' output:\n${logText}`);
      pushResult = true;
    } else {
      logger.info(`[SchedulerWorker] Pushing response (${msgs.length} message(s)) to group:${groupTag}...`);
      pushResult = await lineClient.pushMessage(targetGroupId, msgs);
    }

    await taskRegistry.markTaskExecuted(task.id, now);
    logger.info(`[SchedulerWorker] Task '${task.id}' executed successfully. Push result:`, pushResult ? 'SUCCESS' : 'FAILED');

    if (parentPort) {
      parentPort.postMessage({
        type: 'TASK_COMPLETED',
        taskId: task.id,
        success: Boolean(pushResult),
        timestamp: now.toISOString()
      });
    }
  } catch (err) {
    logger.error(`[SchedulerWorker] Error executing task '${task.id}':`, err);
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

    // Auto-refresh tasks from DB every DB_RELOAD_INTERVAL_MS (only updates/logs if DB rows changed)
    if (!taskRegistry.isLoaded || (Date.now() - lastDbReloadTime > DB_RELOAD_INTERVAL_MS)) {
      await taskRegistry.loadTasks();
      lastDbReloadTime = Date.now();
    }

    const dueTasks = taskRegistry.getDueTasks(now);
    if (dueTasks.length > 0) {
      for (const task of dueTasks) {
        await runTask(task, 'schedule');
      }
    }
  } catch (err) {
    logger.error('[SchedulerWorker] Error in tick loop:', err.message);
  } finally {
    isExecuting = false;
  }
}

// 3. Start native timer loop (check every 5 seconds for fast minute matching)
const TICK_INTERVAL_MS = 5 * 1000;
const timerInterval = setInterval(tick, TICK_INTERVAL_MS);

// 4. Handle IPC messages from the main thread
if (parentPort) {
  parentPort.on('message', async (message) => {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'UPDATE_GROUP_ID':
        // No-op (group routing is managed via scheduled_task_tbl)
        break;

      case 'UPDATE_BASE_URL':
        if (message.baseUrl) {
          let cleanUrl = message.baseUrl.trim().replace(/\/+$/, '');
          if (cleanUrl.startsWith('http://') && !cleanUrl.includes('localhost') && !cleanUrl.includes('127.0.0.1')) {
            cleanUrl = cleanUrl.replace(/^http:\/\//i, 'https://');
          }
          if (cleanUrl !== currentBaseUrl) {
            currentBaseUrl = cleanUrl;
            setBaseUrl(cleanUrl);
            logger.info(`[SchedulerWorker] Updated dynamic baseUrl from main thread: ${cleanUrl}`);
          }
        }
        break;

      case 'TRIGGER_TASK':
        if (message.taskId) {
          // Check in active registry or fetch from DB directly if not found (e.g. if disabled)
          let task = taskRegistry.getTaskById(message.taskId);
          if (!task) {
            const dbRow = await db.getScheduledTaskByKey(message.taskId);
            if (dbRow) {
              task = {
                id: dbRow.task_key || String(dbRow.id),
                dbId: dbRow.id,
                name: dbRow.task_name || dbRow.task_key,
                type: dbRow.task_type || 'command',
                command: dbRow.command || null,
                text_message: dbRow.text_message || null,
                groupId: dbRow.group_id || null,
                enabled: true
              };
            }
          }

          if (task) {
            logger.info(`[SchedulerWorker] Manual trigger received for task: ${message.taskId}`);
            await runTask(task, 'manual_ipc');
          } else {
            logger.warn(`[SchedulerWorker] Cannot trigger unknown task: ${message.taskId}`);
          }
        }
        break;

      case 'RELOAD_TASKS':
        logger.info('[SchedulerWorker] Reloading tasks from DB upon main thread request...');
        await taskRegistry.loadTasks(true);
        lastDbReloadTime = Date.now();
        break;

      case 'TASK_EXECUTED':
        if (message.taskId) {
          taskRegistry.markTaskExecutedLocally(message.taskId, message.dateTimeStr);
          logger.info(`[SchedulerWorker] Task '${message.taskId}' marked executed locally at ${message.dateTimeStr || 'now'}`);
        }
        break;

      default:
        logger.debug(`[SchedulerWorker] Unknown message type received: ${message.type}`);
    }
  });
}

// Graceful cleanup
process.on('SIGTERM', () => {
  clearInterval(timerInterval);
  process.exit(0);
});
