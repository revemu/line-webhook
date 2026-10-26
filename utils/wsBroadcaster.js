const WebSocket = require('ws');
const logger = require('./logger');

let wss = null;
let heartbeatInterval = null;

/**
 * Initialize WebSocket Server attached to HTTP server.
 * Handles connections on /ws/live, /webhook/ws, /web/ws
 * @param {import('http').Server} server 
 */
function initWebSocket(server) {
  if (wss) return wss;

  wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const urlObj = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const pathname = urlObj.pathname;

      if (pathname === '/ws/live' || pathname === '/webhook/ws' || pathname === '/web/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          const weekParam = urlObj.searchParams.get('week_id') || urlObj.searchParams.get('week') || urlObj.searchParams.get('weeknum');
          if (weekParam) {
            ws.weekId = String(weekParam);
          }
          wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    } catch (err) {
      logger.warn('[WebSocket Upgrade Error]:', err.message);
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    logger.debug(`[WebSocket] Client connected (Subscribed week: ${ws.weekId || 'all'}, Total clients: ${wss.clients.size})`);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'subscribe') {
          ws.weekId = data.week_id ? String(data.week_id) : null;
          logger.debug(`[WebSocket] Client subscribed to week: ${ws.weekId || 'all'}`);
        } else if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (e) { }
    });

    ws.on('close', () => {
      logger.debug(`[WebSocket] Client disconnected (Remaining clients: ${wss.clients.size})`);
    });

    ws.on('error', (err) => {
      logger.warn('[WebSocket Error]:', err.message);
    });

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'CONNECTED',
      message: 'Connected to live match feed',
      timestamp: Date.now()
    }));
  });

  // Heartbeat ping every 30s to detect broken connections
  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(() => {
      if (!wss) return;
      wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  logger.info('📡 [WebSocket] Live Scoreboard WebSocket Server initialized (/webhook/ws)');
  return wss;
}

/**
 * Broadcast match events to connected clients.
 * If weekId is provided, broadcasts to clients viewing that week or all weeks.
 * @param {string|number} weekId 
 * @param {Object} eventData 
 * @returns {number} Number of clients sent to
 */
function broadcastMatchEvent(weekId, eventData = {}) {
  if (!wss || wss.clients.size === 0) return 0;

  const payload = JSON.stringify({
    ...eventData,
    week_id: weekId ? String(weekId) : null,
    timestamp: Date.now()
  });

  let recipientCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      if (!client.weekId || !weekId || String(client.weekId) === String(weekId)) {
        client.send(payload);
        recipientCount++;
      }
    }
  });

  logger.info(`📡 [WebSocket Broadcast] Sent ${eventData.type || 'EVENT'} for week ${weekId || 'all'} to ${recipientCount} client(s): ${eventData.message || ''}`);
  return recipientCount;
}

function getConnectedClientCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = {
  initWebSocket,
  broadcastMatchEvent,
  getConnectedClientCount
};
