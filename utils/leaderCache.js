const logger = require('./logger');

let leaderStatsCache = {};

function getLeaderStatsCache(weekId) {
	if (!weekId) return null;
	const entry = leaderStatsCache[String(weekId)];
	return entry && entry.data ? entry.data : null;
}

function setLeaderStatsCache(weekId, data) {
	if (!weekId || !data) return;
	leaderStatsCache[String(weekId)] = {
		data,
		cachedAt: Date.now()
	};
}

function invalidateLeaderStatsCache(weekId = null) {
	if (weekId) {
		delete leaderStatsCache[String(weekId)];
		logger.info(`[Ratings Cache] Invalidated cache for week ${weekId}`);
	} else {
		leaderStatsCache = {};
		logger.info(`[Ratings Cache] Invalidated cache for all weeks`);
	}
}

module.exports = {
	getLeaderStatsCache,
	setLeaderStatsCache,
	invalidateLeaderStatsCache
};
