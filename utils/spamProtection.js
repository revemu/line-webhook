/**
 * Command Spam Protection
 * Prevents processing duplicate commands sent in rapid succession by the same user.
 * Allows only the 1st command to process while in-flight or within the cooldown window.
 */

class CommandSpamProtector {
    /**
     * @param {number} [cooldownMs=3500] Cooldown window in milliseconds after command finishes
     */
    constructor(cooldownMs = 3500) {
        this.cooldownMs = cooldownMs;
        // Key: `${chatId}:${userId}:${normalizedCmd}` -> { inFlight: boolean, lastStarted: number, lastFinished: number }
        this.records = new Map();

        // Periodically prune old records to prevent memory leak
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }

    /**
     * Normalize command string: lowercase, trimmed, collapse multiple whitespaces
     */
    normalizeCommand(cmdStr) {
        if (!cmdStr || typeof cmdStr !== 'string') return '';
        return cmdStr.trim().toLowerCase().replace(/\s+/g, ' ');
    }

    /**
     * Build unique cache key scoped by chat, user, and normalized command
     */
    getKey(userId, groupId, cmdStr) {
        const chat = groupId || 'direct';
        const user = userId || 'unknown';
        const normCmd = this.normalizeCommand(cmdStr);
        return `${chat}:${user}:${normCmd}`;
    }

    /**
     * Attempt to acquire execution lock for a command.
     * @param {string} userId - User's LINE user ID or member ID
     * @param {string|null} groupId - Group ID (or null for 1-on-1)
     * @param {string} cmdStr - Command string
     * @returns {{ allowed: boolean, shouldWarn: boolean, reason?: string }} Result object
     */
    acquire(userId, groupId, cmdStr) {
        const key = this.getKey(userId, groupId, cmdStr);
        const now = Date.now();
        const record = this.records.get(key);

        if (record) {
            // If the exact same command is currently executing
            if (record.inFlight) {
                const shouldWarn = !record.lastWarned || (now - record.lastWarned > 2000);
                if (shouldWarn) record.lastWarned = now;
                return { allowed: false, shouldWarn, reason: 'in_flight' };
            }
            // If the exact same command completed within the cooldown window
            if (record.lastFinished > 0 && (now - record.lastFinished < this.cooldownMs)) {
                const shouldWarn = !record.lastWarned || (now - record.lastWarned > 2000);
                if (shouldWarn) record.lastWarned = now;
                return { allowed: false, shouldWarn, reason: 'cooldown' };
            }
        }

        // Mark as in-flight
        this.records.set(key, {
            inFlight: true,
            lastStarted: now,
            lastFinished: 0,
            lastWarned: 0
        });
        return { allowed: true, shouldWarn: false };
    }

    /**
     * Release in-flight lock after command execution completes (success or failure).
     * @param {string} userId - User's LINE user ID or member ID
     * @param {string|null} groupId - Group ID (or null for 1-on-1)
     * @param {string} cmdStr - Command string
     */
    release(userId, groupId, cmdStr) {
        const key = this.getKey(userId, groupId, cmdStr);
        const record = this.records.get(key);
        if (record) {
            record.inFlight = false;
            record.lastFinished = Date.now();
        }
    }

    /**
     * Remove records whose cooldown has long expired
     */
    cleanup() {
        const now = Date.now();
        const maxAge = Math.max(this.cooldownMs * 2, 30000);
        for (const [key, record] of this.records.entries()) {
            if (!record.inFlight && record.lastFinished > 0 && (now - record.lastFinished > maxAge)) {
                this.records.delete(key);
            }
        }
    }

    /**
     * Clear all records (useful for testing)
     */
    reset() {
        this.records.clear();
    }
}

const defaultCooldown = parseInt(process.env.CMD_SPAM_COOLDOWN_MS, 10) || 3500;
const defaultSpamProtector = new CommandSpamProtector(defaultCooldown);

module.exports = {
    CommandSpamProtector,
    spamProtector: defaultSpamProtector
};
