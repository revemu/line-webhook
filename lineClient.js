const fs = require('fs');
const path = require('path');
const { Client } = require('@line/bot-sdk');
const logger = require('./utils/logger');
require('dotenv').config({ quiet: true });

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.CUR_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

let clientInstance = null;

/**
 * Returns the singleton LINE SDK Client instance.
 * @returns {Client}
 */
function getLineClient() {
  if (!clientInstance) {
    clientInstance = new Client(config);
  }
  return clientInstance;
}

/**
 * Fetches member profile from LINE API with group profile fallback.
 * @param {string} userId - LINE User ID
 * @param {string|null} [groupId=null] - LINE Group ID
 * @returns {Promise<Object|null>}
 */
async function fetchUserProfile(userId, groupId = null) {
  const client = getLineClient();
  if (!userId) return null;

  if (groupId) {
    try {
      return await client.getGroupMemberProfile(groupId, userId);
    } catch (groupErr) {
      logger.warn(`[lineClient] getGroupMemberProfile failed for ${userId} in group ${groupId}: ${groupErr.message}. Trying direct profile...`);
    }
  }

  try {
    return await client.getProfile(userId);
  } catch (err) {
    logger.error(`[lineClient] getProfile failed for ${userId}:`, err.message);
    return null;
  }
}

/**
 * Replies to a LINE event using SDK client with formatted error handling.
 * @param {string} replyToken 
 * @param {Object|Array} messages 
 * @returns {Promise<Object>}
 */
async function replyMessage(replyToken, messages) {
  const client = getLineClient();
  try {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    fs.writeFileSync(path.join(tempDir, 'latest_flex.json'), JSON.stringify(messages, null, 2), 'utf8');
    fs.writeFileSync(path.join(tempDir, 'latest_cmd_flex.json'), JSON.stringify(messages, null, 2), 'utf8');
  } catch (fsErr) {
    logger.error('Error saving latest flex json in replyMessage:', fsErr.message);
  }

  try {
    const msgCount = Array.isArray(messages) ? messages.length : 1;
    const msgTypes = Array.isArray(messages) ? messages.map(m => m.type).join(', ') : messages.type;
    logger.debug(`[lineClient] Replying with ${msgCount} message(s) [types: ${msgTypes}] to token ${replyToken ? replyToken.substring(0, 10) + '...' : 'none'}`);
    const result = await client.replyMessage(replyToken, messages);
    logger.debug(`[lineClient] replyMessage succeeded`);
    return result;
  } catch (error) {
    let details = null;
    if (error.response && error.response.data) {
      details = error.response.data;
    } else if (error.originalError && error.originalError.response && error.originalError.response.data) {
      details = error.originalError.response.data;
    } else if (error.data) {
      details = error.data;
    }
    if (details) {
      logger.error('LINE API Error Details:', JSON.stringify(details, null, 2));
    } else {
      logger.error('LINE API Error Details:', JSON.stringify({ message: error.message || String(error) }, null, 2));
    }
    return null;
  }
}

/**
 * Pushes messages to a LINE user, group, or room.
 * @param {string} to - LINE User ID, Group ID, or Room ID
 * @param {Object|Array} messages 
 * @returns {Promise<Object>}
 */
async function pushMessage(to, messages) {
  const client = getLineClient();
  if (!to) {
    logger.warn('[lineClient] pushMessage aborted: recipient ID (to) is empty or null');
    return null;
  }

  try {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    fs.writeFileSync(path.join(tempDir, 'latest_push_flex.json'), JSON.stringify(messages, null, 2), 'utf8');
  } catch (fsErr) {
    logger.error('Error saving latest push json in pushMessage:', fsErr.message);
  }

  try {
    const msgCount = Array.isArray(messages) ? messages.length : 1;
    const msgTypes = Array.isArray(messages) ? messages.map(m => m.type).join(', ') : messages.type;
    logger.debug(`[lineClient] Pushing ${msgCount} message(s) [types: ${msgTypes}] to ${to ? to.substring(0, 10) + '...' : 'none'}`);
    const result = await client.pushMessage(to, messages);
    logger.debug(`[lineClient] pushMessage succeeded`);
    return result;
  } catch (error) {
    let details = null;
    if (error.response && error.response.data) {
      details = error.response.data;
    } else if (error.originalError && error.originalError.response && error.originalError.response.data) {
      details = error.originalError.response.data;
    } else if (error.data) {
      details = error.data;
    }
    if (details) {
      logger.error('LINE API Error Details (pushMessage):', JSON.stringify(details, null, 2));
    } else {
      logger.error('LINE API Error Details (pushMessage):', JSON.stringify({ message: error.message || String(error) }, null, 2));
    }
    return null;
  }
}

/**
 * Fetches group summary (name, pictureUrl) from LINE API.
 * @param {string} groupId - LINE Group ID
 * @returns {Promise<{groupId: string, groupName: string, pictureUrl?: string}|null>}
 */
async function fetchGroupSummary(groupId) {
  const client = getLineClient();
  if (!groupId) return null;
  try {
    return await client.getGroupSummary(groupId);
  } catch (err) {
    logger.debug(`[lineClient] getGroupSummary failed for ${groupId}:`, err.message);
    return null;
  }
}

/**
 * Fetches total member count in a LINE group.
 * @param {string} groupId - LINE Group ID
 * @returns {Promise<number|null>}
 */
async function fetchGroupMembersCount(groupId) {
  const client = getLineClient();
  if (!groupId) return null;
  try {
    const res = await client.getGroupMembersCount(groupId);
    return res && typeof res.count === 'number' ? res.count : null;
  } catch (err) {
    logger.debug(`[lineClient] getGroupMembersCount failed for ${groupId}:`, err.message);
    return null;
  }
}

/**
 * Fetches combined group profile (summary + member count) from LINE API.
 * @param {string} groupId - LINE Group ID
 * @returns {Promise<{groupId: string, groupName: string|null, memberCount: number|null, pictureUrl: string|null}|null>}
 */
async function fetchGroupProfile(groupId) {
  if (!groupId) return null;
  try {
    const [summary, count] = await Promise.all([
      fetchGroupSummary(groupId),
      fetchGroupMembersCount(groupId)
    ]);
    if (!summary && count === null) return null;
    return {
      groupId,
      groupName: summary ? summary.groupName : null,
      memberCount: count !== null ? count : null,
      pictureUrl: summary ? summary.pictureUrl || null : null
    };
  } catch (err) {
    logger.error(`[lineClient] fetchGroupProfile error for ${groupId}:`, err.message);
    return null;
  }
}

module.exports = {
  config,
  getLineClient,
  fetchUserProfile,
  fetchGroupSummary,
  fetchGroupMembersCount,
  fetchGroupProfile,
  replyMessage,
  pushMessage
};

