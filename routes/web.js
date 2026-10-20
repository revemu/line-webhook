// routes/web.js
// Soccer Bot API & Web Dashboard Router (Merged from soccerbotapi)
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const db = require('../query');
const logger = require('../utils/logger');

const router = express.Router();
const upload = multer();

// Web Authentication Configuration
const SESSION_SECRET = process.env.SESSION_SECRET || 'soccerbot_secret_key_2026_xyz';
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'admin1234').trim();
const ROOT_USER = (process.env.ROOT_USER || 'root').trim();
const ROOT_PASSWORD = (process.env.ROOT_PASSWORD || 'root1234').trim();

// Database Pool reference
const pool = db.pool;

// Helper function to execute queries
async function doQuery(sql) {
    try {
        const [rows] = await pool.query(sql);
        return rows;
    } catch (error) {
        logger.error(`Query failed: ${error.message}\nSQL: ${sql}`);
        throw error;
    }
}

// Helper function to execute updates
async function doUpdate(sql) {
    try {
        const [result] = await pool.query(sql);
        return result;
    } catch (error) {
        logger.error(`Update failed: ${error.message}\nSQL: ${sql}`);
        throw error;
    }
}

// Middlewares for Web Routes (Scoped to router so /webhook is not affected)
router.use(cors({ origin: true, credentials: true }));
router.use(cookieParser());
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

// ==================== AUTHENTICATION & SECURITY ====================

// Token generation & verification
function createToken(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', SESSION_SECRET)
        .update(`${header}.${body}`)
        .digest('base64url');
    return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSig = crypto
        .createHmac('sha256', SESSION_SECRET)
        .update(`${header}.${body}`)
        .digest('base64url');
    if (signature !== expectedSig) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (payload.exp && Date.now() > payload.exp) return null;
        return payload;
    } catch {
        return null;
    }
}

// Database user functions
async function getUserByUsername(username) {
    try {
        const [rows] = await pool.query(
            'SELECT id, username, password, role, name FROM user_tbl WHERE LOWER(username) = LOWER(?) LIMIT 1',
            [username]
        );
        if (rows && rows.length > 0) {
            return rows[0];
        }
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            logger.warn('user_tbl not found in database. Using .env credentials fallback.');
        } else {
            logger.error(`Error querying user_tbl: ${error.message}`);
        }
    }
    return null;
}

async function verifyPassword(inputPassword, storedPassword) {
    if (!inputPassword || !storedPassword) return false;
    if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2y$')) {
        return await bcrypt.compare(inputPassword, storedPassword);
    }
    return inputPassword === storedPassword;
}

// Authentication extraction middleware
function authMiddleware(req, res, next) {
    const cookieToken = req.cookies?.soccer_auth;
    const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const token = cookieToken || headerToken;

    if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
            req.user = decoded;
        }
    }
    next();
}

router.use(authMiddleware);

// Middleware to require authentication (admin or root)
function requireAuth(req, res, next) {
    if (!req.user) {
        if (req.accepts('html') && !req.xhr && !req.headers['x-requested-with']) {
            const prefix = req.originalUrl.startsWith('/webhook') ? '/webhook' : '/web';
            return res.redirect(`${prefix}/login?redirect=${encodeURIComponent(req.originalUrl)}`);
        }
        return res.status(401).json({ success: false, error: 'Authentication required. Please login.' });
    }
    next();
}

// Middleware to require root role (Position Manager and position updates)
function requireRoot(req, res, next) {
    if (!req.user) {
        if (req.accepts('html') && !req.xhr && !req.headers['x-requested-with']) {
            const prefix = req.originalUrl.startsWith('/webhook') ? '/webhook' : '/web';
            return res.redirect(`${prefix}/login?redirect=${encodeURIComponent(req.originalUrl)}`);
        }
        return res.status(401).json({ success: false, error: 'Authentication required. Please login.' });
    }
    if (req.user.role !== 'root') {
        if (req.accepts('html') && !req.xhr && !req.headers['x-requested-with']) {
            const prefix = req.originalUrl.startsWith('/webhook') ? '/webhook' : '/web';
            return res.redirect(`${prefix}/match`);
        }
        return res.status(403).json({ success: false, error: 'Access denied: Root role required.' });
    }
    next();
}

// ==================== AUTH & ROUTING ====================

// Root & Web convenience redirects
router.get(['/', '/webhook', '/webhook/', '/web', '/update.shtml'], (req, res) => res.redirect('/webhook/match'));
router.get(['/match', '/webhook/match.shtml', '/web/match.shtml'], (req, res) => res.redirect('/webhook/match'));
router.get(['/view', '/view.shtml', '/webhook/view.shtml', '/web/view.shtml'], (req, res) => res.redirect('/webhook/view'));
router.get(['/position', '/webhook/position.shtml', '/web/position.shtml'], (req, res) => res.redirect('/webhook/position'));

// Login page
router.get(['/webhook/login', '/web/login'], (req, res) => {
    const prefix = req.originalUrl.startsWith('/webhook') ? '/webhook' : '/web';
    if (req.user) {
        const redirect = req.query.redirect;
        if (redirect && (redirect.startsWith('/webhook/') || redirect.startsWith('/web/'))) {
            if (redirect.includes('position') && req.user.role !== 'root') {
                return res.redirect(`${prefix}/match`);
            }
            return res.redirect(redirect);
        }
        return res.redirect(req.user.role === 'root' ? `${prefix}/position` : `${prefix}/match`);
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'login.shtml'));
});

// Login endpoint (POST) - Supports MySQL user_tbl with bcrypt + .env fallback
router.post(['/webhook/login', '/web/login'], upload.none(), async (req, res) => {
    try {
        const { username, password, redirect } = { ...req.query, ...req.body };

        const u = (username || '').trim();
        const p = (password || '').trim();

        if (!u || !p) {
            return res.status(400).json({
                success: false,
                error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'
            });
        }

        let authenticatedUser = null;

        // 1. Attempt database authentication from user_tbl
        const dbUser = await getUserByUsername(u);
        if (dbUser) {
            const isMatch = await verifyPassword(p, dbUser.password);
            if (isMatch) {
                authenticatedUser = {
                    id: dbUser.id,
                    username: dbUser.username,
                    role: dbUser.role,
                    name: dbUser.name
                };

                // Self-healing: if stored password is not bcrypt, auto-hash it
                if (!dbUser.password.startsWith('$2a$') && !dbUser.password.startsWith('$2b$')) {
                    const upgradedHash = await bcrypt.hash(p, 10);
                    await pool.query('UPDATE user_tbl SET password = ? WHERE id = ?', [upgradedHash, dbUser.id]);
                    logger.info(`Auto-upgraded password hash for user ${dbUser.username}`);
                }
            }
        } else {
            // 2. Fallback to .env configuration if user_tbl not created yet
            if (u.toLowerCase() === ROOT_USER.toLowerCase() && p === ROOT_PASSWORD) {
                authenticatedUser = { id: 0, username: ROOT_USER, role: 'root', name: 'Root' };
            } else if (u.toLowerCase() === ADMIN_USER.toLowerCase() && p === ADMIN_PASSWORD) {
                authenticatedUser = { id: 0, username: ADMIN_USER, role: 'admin', name: 'Admin' };
            }
        }

        if (!authenticatedUser) {
            logger.warn(`Failed login attempt for username: ${username}`);
            return res.status(401).json({
                success: false,
                error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (Invalid username or password)'
            });
        }

        // 7-day token
        const token = createToken({
            id: authenticatedUser.id,
            username: authenticatedUser.username,
            role: authenticatedUser.role,
            name: authenticatedUser.name,
            exp: Date.now() + 7 * 24 * 60 * 60 * 1000
        });

        res.cookie('soccer_auth', token, {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/'
        });

        logger.info(`User ${authenticatedUser.username} (${authenticatedUser.role}) logged in successfully`);

        const prefix = req.originalUrl.startsWith('/webhook') ? '/webhook' : '/web';
        let targetRedirect = `${prefix}/match`;
        if (redirect && (redirect.startsWith('/webhook/') || redirect.startsWith('/web/'))) {
            if (redirect.includes('position') && authenticatedUser.role !== 'root') {
                targetRedirect = `${prefix}/match`;
            } else {
                targetRedirect = redirect;
            }
        } else if (authenticatedUser.role === 'root') {
            targetRedirect = `${prefix}/position`;
        }

        return res.json({
            success: true,
            user: authenticatedUser,
            redirect: targetRedirect
        });
    } catch (error) {
        logger.error(`Error in login: ${error.message}`);
        return res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ' });
    }
});

// Change Password endpoint (POST) - Uses bcrypt hash
router.post(['/webhook/change_password', '/web/change_password'], requireAuth, upload.none(), async (req, res) => {
    try {
        const { current_password, new_password, confirm_password } = { ...req.query, ...req.body };

        const curPwd = (current_password || '').trim();
        const newPwd = (new_password || '').trim();
        const confPwd = (confirm_password || '').trim();

        if (!curPwd || !newPwd || !confPwd) {
            return res.status(400).json({
                success: false,
                error: 'กรุณากรอกข้อมูลให้ครบถ้วนทุกช่อง'
            });
        }

        if (newPwd.length < 4) {
            return res.status(400).json({
                success: false,
                error: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร'
            });
        }

        if (newPwd !== confPwd) {
            return res.status(400).json({
                success: false,
                error: 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน'
            });
        }

        // Look up user in MySQL
        const userInDb = await getUserByUsername(req.user.username);
        if (!userInDb) {
            return res.status(400).json({
                success: false,
                error: 'ไม่พบตาราง user_tbl ในระบบ กรุณารัน schema_user.sql ในฐานข้อมูลก่อนเปลี่ยนรหัสผ่าน'
            });
        }

        // Verify current password
        const isMatch = await verifyPassword(curPwd, userInDb.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง'
            });
        }

        // Hash new password using bcrypt
        const hashedPassword = await bcrypt.hash(newPwd, 10);

        // Update in database
        await pool.query(
            'UPDATE user_tbl SET password = ?, updated_at = NOW() WHERE id = ?',
            [hashedPassword, userInDb.id]
        );

        logger.info(`Password successfully changed for user: ${userInDb.username}`);

        return res.json({
            success: true,
            message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว'
        });
    } catch (error) {
        logger.error(`Error in change_password: ${error.message}`);
        return res.status(500).json({
            success: false,
            error: 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน: ' + error.message
        });
    }
});

// Logout endpoint
router.all(['/webhook/logout', '/web/logout'], (req, res) => {
    const user = req.user ? `${req.user.username} (${req.user.role})` : 'unknown';
    logger.info(`User ${user} logged out`);
    res.clearCookie('soccer_auth', { path: '/' });
    const prefix = req.originalUrl.startsWith('/webhook') ? '/webhook' : '/web';
    if (req.accepts('html') && !req.xhr && !req.headers['x-requested-with']) {
        return res.redirect(`${prefix}/login`);
    }
    return res.json({ success: true, message: 'Logged out successfully' });
});

// Current user status endpoint
router.get(['/webhook/auth/me', '/web/auth/me'], (req, res) => {
    if (req.user) {
        return res.json({
            authenticated: true,
            user: {
                id: req.user.id,
                username: req.user.username,
                role: req.user.role,
                name: req.user.name
            }
        });
    }
    return res.json({ authenticated: false, user: null });
});

// ==================== GET INFO ROUTES ====================

router.get(['/webhook/match', '/web/match'], requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'update.shtml'));
});

// Match Viewer (Read-Only: shows current & past matches, accessible to everyone, uses shared base code update.shtml)
router.get(['/webhook/view', '/web/view'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'update.shtml'));
});

router.get(['/webhook/view.shtml', '/web/view.shtml'], (req, res) => {
    res.redirect('/webhook/view');
});

// Alias for Match Viewer
router.get(['/webhook/matches', '/web/matches'], (req, res) => {
    res.redirect('/webhook/view');
});

// Public endpoint for Match Viewer data (Read-only, no auth required)
router.get(['/webhook/match_view_data', '/web/match_view_data'], async (req, res) => {
    try {
        const { weeknum } = req.query;
        const result = await getLastMatchWeek(weeknum || 0, req.user);
        res.json(result);
    } catch (error) {
        logger.error(`Error in match_view_data: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Position Manager requires root user
router.get(['/webhook/position', '/web/position'], requireRoot, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'position.shtml'));
});

router.get(['/webhook/style.css', '/web/style.css'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'style.css'));
});

// Get last match week
router.get(['/webhook/get_info', '/web/get_info'], requireAuth, async (req, res) => {
    try {
        const { cmd, weeknum, matchid } = req.query;

        switch (cmd) {
            case 'get_last_matchweek':
                const result = await getLastMatchWeek(weeknum || 0, req.user);
                res.json(result);
                break;

            case 'get_team_members':
                if (!matchid) {
                    return res.status(400).json({ error: 'matchid is required' });
                }
                const isLocked = await isMatchRosterLocked(matchid, req.user);
                if (isLocked) {
                    return res.json([]);
                }
                const members = await queryTeamMembers(matchid);
                logger.info(`get_team_members: ${JSON.stringify(members)}`);
                res.json(members);
                break;

            case 'get_positions':
                const positions = await queryAllPositions();
                res.json(positions);
                break;

            case 'get_position_page_data':
                if (req.user.role !== 'root') {
                    return res.status(403).json({ success: false, error: 'Access denied: Root role required' });
                }
                const pageData = await queryPositionPageData(weeknum || 0);
                res.json(pageData);
                break;

            default:
                const defaultResult = await getLastMatchWeek(5, req.user);
                res.json(defaultResult);
        }
    } catch (error) {
        logger.error(`Error in get_info: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Update member position - Only root can update
router.post(['/webhook/update_position', '/web/update_position'], requireRoot, upload.none(), async (req, res) => {
    try {
        const data = { ...req.query, ...req.body };
        logger.info(`update_position Request: ${JSON.stringify(data)}`);

        const id = data.id || data.member_team_week_id;
        const pos_id = data.pos_id !== undefined ? parseInt(data.pos_id, 10) : null;
        const team_id = data.team_id !== undefined ? parseInt(data.team_id, 10) : null;

        if (!id) {
            return res.status(400).json({ error: 'id (member_team_week_tbl id) is required' });
        }

        const validPosId = (pos_id === null || isNaN(pos_id) || pos_id < 0) ? 0 : pos_id;
        let sql;
        if (team_id !== null && !isNaN(team_id) && team_id >= 0) {
            sql = `UPDATE member_team_week_tbl SET pos_id = ${validPosId}, team_id = ${team_id} WHERE id = ${parseInt(id, 10)}`;
        } else {
            sql = `UPDATE member_team_week_tbl SET pos_id = ${validPosId} WHERE id = ${parseInt(id, 10)}`;
        }
        await doUpdate(sql);

        logger.info(`Updated member_team_week_tbl id ${id} to pos_id ${validPosId}${team_id !== null ? ', team_id ' + team_id : ''} by ${req.user.username}`);
        res.json({ success: true, message: 'Position updated successfully', id: parseInt(id, 10), pos_id: validPosId });
    } catch (error) {
        logger.error(`Error in update_position: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Batch update member positions & teams - Only root can update
router.post(['/webhook/batch_update_positions', '/web/batch_update_positions'], requireRoot, upload.none(), async (req, res) => {
    try {
        let updates = req.body.updates;
        if (typeof updates === 'string') {
            try { updates = JSON.parse(updates); } catch (e) { updates = []; }
        }
        if (!Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({ error: 'updates array is required' });
        }

        let updatedCount = 0;
        for (const item of updates) {
            const id = parseInt(item.id, 10);
            const pos_id = (item.pos_id === null || isNaN(item.pos_id) || item.pos_id < 0) ? 0 : parseInt(item.pos_id, 10);
            const team_id = (item.team_id !== undefined && item.team_id !== null && !isNaN(item.team_id)) ? parseInt(item.team_id, 10) : null;
            if (id > 0) {
                let sql;
                if (team_id !== null && team_id >= 0) {
                    sql = `UPDATE member_team_week_tbl SET pos_id = ${pos_id}, team_id = ${team_id} WHERE id = ${id}`;
                } else {
                    sql = `UPDATE member_team_week_tbl SET pos_id = ${pos_id} WHERE id = ${id}`;
                }
                await doUpdate(sql);
                updatedCount++;
            }
        }

        logger.info(`Batch updated ${updatedCount} player positions/teams by ${req.user.username}`);
        res.json({ success: true, message: `Successfully updated ${updatedCount} items`, count: updatedCount });
    } catch (error) {
        logger.error(`Error in batch_update_positions: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ADD MATCH ROUTES ====================

// Add match or goal - with multer middleware to handle multipart/form-data
router.post(['/webhook/add_match', '/web/add_match'], requireAuth, upload.none(), async (req, res) => {
    try {
        const data = { ...req.query, ...req.body };
        let msg = "";

        logger.info(`add_match Request: ${JSON.stringify(data)}`);

        // Finish match (End match)
        if (data.matchid !== undefined && (data.cmd === 'finish_match' || data.cmd === 'end_match')) {
            logger.info(`finish match_id ${data.matchid}`);
            await updateMatchScore(data.matchid);
            await doUpdate(`UPDATE match_stat_tbl SET status = 'finished' WHERE id = ${data.matchid}`);

            // Automatically start the next scheduled match
            const [curMatch] = await doQuery(`SELECT match_num, week_id FROM match_stat_tbl WHERE id = ${data.matchid}`);
            if (curMatch) {
                const nextMatches = await doQuery(`SELECT id FROM match_stat_tbl WHERE week_id = ${curMatch.week_id} AND match_num > ${curMatch.match_num} AND status = 'scheduled' ORDER BY match_num ASC LIMIT 1`);
                if (nextMatches.length > 0) {
                    await doUpdate(`UPDATE match_stat_tbl SET status = 'in_progress' WHERE id = ${nextMatches[0].id}`);
                    logger.info(`Automatically started next match_id ${nextMatches[0].id}`);
                }
            }

            if (data.weekid !== undefined) {
                await updateTableWeek(data.weekid);
            }
            return res.json({ success: true, message: 'Match finished successfully', matchid: data.matchid, status: 'finished' });
        }

        // Start match (In Progress / LIVE)
        if (data.matchid !== undefined && data.cmd === 'start_match') {
            logger.info(`start match_id ${data.matchid}`);
            await doUpdate(`UPDATE match_stat_tbl SET status = 'in_progress' WHERE id = ${data.matchid}`);
            return res.json({ success: true, message: 'Match started successfully', matchid: data.matchid, status: 'in_progress' });
        }

        // Reopen match (Back to in_progress)
        if (data.matchid !== undefined && data.cmd === 'reopen_match') {
            logger.info(`reopen match_id ${data.matchid}`);
            await doUpdate(`UPDATE match_stat_tbl SET status = 'in_progress' WHERE id = ${data.matchid}`);
            // Revert any subsequent in_progress matches back to scheduled
            const [curMatch] = await doQuery(`SELECT match_num, week_id FROM match_stat_tbl WHERE id = ${data.matchid}`);
            if (curMatch) {
                await doUpdate(`UPDATE match_stat_tbl SET status = 'scheduled' WHERE week_id = ${curMatch.week_id} AND match_num > ${curMatch.match_num}`);
            }
            if (data.weekid !== undefined) {
                await updateTableWeek(data.weekid);
            }
            return res.json({ success: true, message: 'Match reopened successfully', matchid: data.matchid, status: 'in_progress' });
        }

        // Add new match
        if (data.weekid !== undefined && data.matchnum !== undefined && data.teamaid !== undefined && data.teambid !== undefined) {
            logger.info(`add week ${data.weekid} match ${data.matchnum} team ${data.teamaid} vs team ${data.teambid}`);
            await addMatchWeek(data.matchnum, data.teamaid, data.teambid, data.weekid);
            msg = 'Match added successfully';
        }

        // Add goal
        if (data.memberid !== undefined && data.matchid !== undefined && data.teamid !== undefined) {
            logger.info(`add goal match_id ${data.matchid} from member id ${data.memberid} team id ${data.teamid}`);
            const statusid = data.statusid !== undefined ? data.statusid : 0;
            await addMatchGoal(data.matchid, data.teamid, data.memberid, statusid);
            await updateMatchScore(data.matchid);
            // If match was scheduled, transition to in_progress upon first goal
            await doUpdate(`UPDATE match_stat_tbl SET status = 'in_progress' WHERE id = ${data.matchid} AND status = 'scheduled'`);
            msg = 'Goal added successfully';
            if (data.weekid !== undefined) {
                await updateTableWeek(data.weekid);
            }
            return res.json({ success: true, message: 'Goal added successfully' });
        }

        // Remove goal
        if (data.goalid !== undefined) {
            const result = await doQuery(`SELECT * FROM match_goal_tbl WHERE id = ${data.goalid}`);
            if (result.length > 0) {
                const matchId = result[0].match_id;
                await removeMatchGoal(data.goalid);
                await updateMatchScore(matchId);
                logger.info(`remove goal_id ${data.goalid} in match_id ${matchId}`);
                msg = 'Goal removed successfully';
                if (data.weekid !== undefined) {
                    await updateTableWeek(data.weekid);
                }
                return res.json({ success: true, message: 'Goal removed successfully' });
            } else {
                return res.status(404).json({ error: 'Goal not found' });
            }
        }

        // Remove match (Safety constraint: Only allow deleting from back to front)
        if (data.matchid !== undefined && (data.cmd === 'remove_match' || data.cmd === 'delete_match' || data.cmd === 'remove')) {
            const matchId = parseInt(data.matchid, 10);
            if (isNaN(matchId) || matchId <= 0) {
                return res.status(400).json({ error: 'รหัสแมตช์ (matchid) ไม่ถูกต้อง' });
            }

            const [targetMatch] = await doQuery(`SELECT id, match_num, week_id, status FROM match_stat_tbl WHERE id = ${matchId}`);
            if (!targetMatch) {
                return res.status(404).json({ error: 'ไม่พบข้อมูลแมตช์ที่ต้องการลบ (อาจถูกลบไปแล้ว)' });
            }

            const weekId = targetMatch.week_id;

            // Safety check: Can ONLY delete the last match (highest match_num)
            const [maxRow] = await doQuery(`SELECT MAX(match_num) as max_match_num FROM match_stat_tbl WHERE week_id = ${weekId}`);
            const maxMatchNum = maxRow ? maxRow.max_match_num : targetMatch.match_num;

            if (targetMatch.match_num < maxMatchNum) {
                return res.status(400).json({
                    error: `ไม่อนุญาตให้ลบ Match ${targetMatch.match_num}: กฎความปลอดภัยกำหนดให้ลบได้เฉพาะแมตช์สุดท้าย (Match ${maxMatchNum}) เท่านั้น (ต้องลบจากหลังมาหน้า)`
                });
            }

            // 1. Delete all goals & assists in this match
            await doUpdate(`DELETE FROM match_goal_tbl WHERE match_id = ${matchId}`);

            // 2. Delete the match record
            await doUpdate(`DELETE FROM match_stat_tbl WHERE id = ${matchId}`);
            logger.info(`Match ${targetMatch.match_num} (id: ${matchId}) deleted successfully from week ${weekId} by ${req.user ? req.user.username : 'admin'}`);

            // 3. Recalculate standings table for this week
            await updateTableWeek(weekId);

            return res.json({
                success: true,
                message: `ลบ Match ${targetMatch.match_num} เรียบร้อยแล้ว`,
                deleted_match_num: targetMatch.match_num,
                weekid: weekId
            });
        }

        // If weekid is sent but no other conditions matched, still update table
        if (data.weekid !== undefined) {
            logger.info(`Updating table for week ${data.weekid}`);
            await updateTableWeek(data.weekid);
            return res.json({ success: true, message: msg });
        }

        res.status(400).json({ error: 'Invalid request parameters', received: data });
    } catch (error) {
        logger.error(`Error in add_match: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// ==================== QUERY FUNCTIONS ====================

async function queryTeamMembers(matchid) {
    const sql = `
    SELECT member_tbl.id, member_tbl.name, member_tbl.alias, 
           member_team_week_tbl.team_id, team_color_week_tbl.color
    FROM member_team_week_tbl, member_tbl, match_stat_tbl, team_color_week_tbl
    WHERE (match_stat_tbl.team_a_id = member_team_week_tbl.team_id 
           OR match_stat_tbl.team_b_id = member_team_week_tbl.team_id)
      AND member_tbl.id = member_team_week_tbl.member_id
      AND member_team_week_tbl.team_id = team_color_week_tbl.id
      AND match_stat_tbl.id = ${matchid}
    ORDER BY team_id`;

    return await doQuery(sql);
}

async function queryRegisteredMembers(weekid) {
    const sql = `
    SELECT mtw.id as member_team_week_id, mtw.member_id, 
           COALESCE(m.id, mtw.member_id) as id,
           COALESCE(m.name, mtw.name) as name,
           COALESCE(m.alias, mtw.name) as alias, 
           mtw.team_id, tcw.color,
           mtw.pos_id, m.picture_url,
           p.code as pos_code, p.name as pos_name, p.icon as pos_icon
    FROM member_team_week_tbl mtw
    LEFT JOIN member_tbl m ON mtw.member_id = m.id
    LEFT JOIN team_color_week_tbl tcw ON mtw.team_id = tcw.id
    LEFT JOIN pos_tbl p ON mtw.pos_id = p.id
    WHERE mtw.week_id = ${weekid}
    ORDER BY mtw.team_id, mtw.id`;

    return await doQuery(sql);
}

async function queryMatchScorer(matchID) {
    const sql = `
    SELECT member_tbl.alias as name, match_goal_tbl.id AS goal_id, 
           match_goal_tbl.status as goal_status,
           match_goal_tbl.member_id,
           match_goal_tbl.team_week_id as team_id
    FROM match_goal_tbl, member_tbl
    WHERE match_goal_tbl.match_id = ${matchID}
      AND match_goal_tbl.member_id = member_tbl.id`;

    return await doQuery(sql);
}

async function queryWeekTable(weekid) {
    const sql = `
    SELECT team_color_week_tbl.color, table_week_tbl.* 
    FROM table_week_tbl, team_color_week_tbl
    WHERE table_week_tbl.week_id = ${weekid}
      AND table_week_tbl.team_week_id = team_color_week_tbl.id 
    ORDER BY table_week_tbl.pts DESC`;

    return await doQuery(sql);
}

async function queryWeekId(weeknum = 0) {
    let sql;
    const num = parseInt(weeknum, 10);
    if (!num || isNaN(num) || num <= 0) {
        sql = "SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date, DATE_FORMAT(date, '%Y-%m-%d') as raw_date, time_range FROM week_tbl ORDER BY id DESC LIMIT 1";
    } else {
        sql = `SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date, DATE_FORMAT(date, '%Y-%m-%d') as raw_date, time_range FROM week_tbl WHERE number = ${num} OR id = ${num} ORDER BY id DESC LIMIT 1`;
    }

    const result = await doQuery(sql);

    if (result.length > 0) {
        return {
            success: true,
            id: result[0].id,
            date: result[0].date,
            raw_date: result[0].raw_date,
            time_range: result[0].time_range || '17:30-20:00',
            number: result[0].number,
            sql: sql
        };
    }

    return { success: false };
}

async function queryAllTeamColors(weekid) {
    const sql = `SELECT id, color FROM team_color_week_tbl WHERE week_id = ${weekid}`;
    return await doQuery(sql);
}

async function queryAllMatchWeek(weekid, limit = 2) {
    const sql = `SELECT * FROM match_stat_tbl WHERE week_id = ${weekid} ORDER BY match_num DESC LIMIT ${limit}`;
    return await doQuery(sql);
}

async function queryAllTeamWeekId(weekID) {
    const sql = `SELECT id FROM team_color_week_tbl WHERE week_id = ${weekID}`;
    const result = await doQuery(sql);

    const output = { success: true };
    result.forEach(row => {
        output[row.id] = {
            team_id: row.id,
            w: 0,
            d: 0,
            l: 0,
            G: 0,
            A: 0,
            pts: 0
        };
    });

    return output;
}

async function queryAllPositions() {
    const sql = `SELECT * FROM pos_tbl ORDER BY id`;
    return await doQuery(sql);
}

async function queryRecentWeeks(limit = 20) {
    const sql = `SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date FROM week_tbl ORDER BY id DESC LIMIT ${limit}`;
    return await doQuery(sql);
}

async function queryPositionPageData(weeknum = 0) {
    const weekInfo = await queryWeekId(weeknum);
    if (!weekInfo.success) {
        return { error: `No week found for weeknum ${weeknum}` };
    }

    const weekid = weekInfo.id;
    const positions = await queryAllPositions();
    const weeks = await queryRecentWeeks();
    const teamColors = await queryAllTeamColors(weekid);

    const membersSql = `
    SELECT mtw.id, mtw.member_id, mtw.name, mtw.team_id, mtw.week_id, 
           mtw.team, mtw.pay, mtw.pos_id, mtw.rating, mtw.priority,
           COALESCE(m.alias, mtw.name) as alias,
           COALESCE(m.name, mtw.name) as member_name,
           m.picture_url,
           p.code as pos_code, p.name as pos_name, p.icon as pos_icon,
           p.pts_goal, p.pts_assist,
           tcw.color as team_color
    FROM member_team_week_tbl mtw
    LEFT JOIN member_tbl m ON mtw.member_id = m.id
    LEFT JOIN pos_tbl p ON mtw.pos_id = p.id
    LEFT JOIN team_color_week_tbl tcw ON mtw.team_id = tcw.id
    WHERE mtw.week_id = ${weekid}
    ORDER BY mtw.team_id, mtw.id`;

    const members = await doQuery(membersSql);

    return {
        success: true,
        week: weekInfo,
        weeks: weeks,
        positions: positions,
        team_colors: teamColors,
        members: members
    };
}

// ==================== MAIN FUNCTIONS & ROSTER PROTECTION ====================

/**
 * Check if current time in Bangkok is before 20:00 on Friday of the match week.
 * @param {string} dateStr Format 'YYYY-MM-DD'
 * @returns {boolean}
 */
function isBeforeFriday2000(dateStr) {
    if (!dateStr) return false;
    const parts = String(dateStr).split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
        return false;
    }
    const [y, m, d] = parts;
    const matchDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const matchDow = matchDate.getUTCDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
    // Difference in days to reach the Friday of this match week
    const diffToFriday = (matchDow - 5 + 7) % 7;
    const fridayDate = new Date(matchDate.getTime() - diffToFriday * 24 * 60 * 60 * 1000);
    const fy = fridayDate.getUTCFullYear();
    const fm = String(fridayDate.getUTCMonth() + 1).padStart(2, '0');
    const fd = String(fridayDate.getUTCDate()).padStart(2, '0');
    // Cutoff is Friday 20:00:00 in Bangkok (UTC+7)
    const cutoffTime = new Date(`${fy}-${fm}-${fd}T20:00:00+07:00`).getTime();
    return Date.now() < cutoffTime;
}

/**
 * Check if team rosters should be locked (hidden) for a given week.
 * Only locked if target week is the current/latest week AND before Friday 20:00 AND user is not root.
 * @param {number|string} weekid
 * @param {object|null} currentUser
 * @returns {Promise<boolean>}
 */
async function isWeekRosterLocked(weekid, currentUser = null) {
    if (currentUser && currentUser.role === 'root') {
        return false;
    }
    const [latestWeek] = await doQuery("SELECT id, DATE_FORMAT(date, '%Y-%m-%d') as raw_date FROM week_tbl ORDER BY id DESC LIMIT 1");
    if (!latestWeek) return false;

    const targetWeekId = parseInt(weekid, 10);
    if (targetWeekId !== latestWeek.id) {
        return false;
    }

    return isBeforeFriday2000(latestWeek.raw_date);
}

/**
 * Check if a match belongs to a week whose team roster is locked.
 * @param {number|string} matchid
 * @param {object|null} currentUser
 * @returns {Promise<boolean>}
 */
async function isMatchRosterLocked(matchid, currentUser = null) {
    if (currentUser && currentUser.role === 'root') {
        return false;
    }
    const mid = parseInt(matchid, 10);
    if (!mid || isNaN(mid)) return false;
    const [match] = await doQuery(`SELECT week_id FROM match_stat_tbl WHERE id = ${mid}`);
    if (!match) return false;
    return await isWeekRosterLocked(match.week_id, currentUser);
}

async function getLastMatchWeek(weeknum = 0, currentUser = null) {
    const weekInfo = await queryWeekId(weeknum);

    if (!weekInfo.success) {
        return { error: `No Match for Week ${weeknum}` };
    }

    const { id: weekid, date: weekdate, number: weeknumber } = weekInfo;
    const data = {};

    // Check if team rosters should be locked for the current week before Friday 20:00
    const isLocked = await isWeekRosterLocked(weekid, currentUser);
    data.is_roster_locked = isLocked;
    if (isLocked) {
        data.roster_lock_message = 'รายชื่อทีมสำหรับสัปดาห์นี้จะเปิดแสดงหลังเวลา 20:00 น. ของวันศุกร์';
    }

    // Get all members
    const members = await queryRegisteredMembers(weekid);
    if (isLocked) {
        // Strip team assignment and color to prevent knowing randomized teams early
        data.allmembers = (members || []).map(m => ({
            ...m,
            team_id: 0,
            color: null
        }));
    } else {
        data.allmembers = members || [];
    }

    // Get team colors
    const teamColors = await queryAllTeamColors(weekid);
    const teamStat = {};
    const teamJson = {};

    teamColors.forEach(team => {
        teamStat[team.id] = { cnt: 0, id: team.id };
        teamJson[team.id] = { teamid: team.id, name: team.color };
    });

    // Initialize next match
    const nextMatch = {
        week_id: weekid,
        match_num: 1,
        team_a_id: teamColors[0]?.id,
        team_b_id: teamColors[1]?.id
    };

    // Get recent matches
    const recentMatches = await queryAllMatchWeek(weekid);

    if (recentMatches.length > 0) {
        const lastMatch = recentMatches[0];
        nextMatch.match_num = lastMatch.match_num + 1;

        recentMatches.forEach(match => {
            if (teamStat[match.team_a_id]) teamStat[match.team_a_id].cnt++;
            if (teamStat[match.team_b_id]) teamStat[match.team_b_id].cnt++;

            if (teamStat[match.team_a_id] && teamStat[match.team_a_id].cnt > 1) {
                if (teamStat[match.team_b_id]) nextMatch.team_a_id = teamStat[match.team_b_id].id;
                nextMatch.team_b_id = lastMatch.team_b_id;
            } else if (teamStat[match.team_b_id] && teamStat[match.team_b_id].cnt > 1) {
                if (teamStat[match.team_a_id]) nextMatch.team_b_id = teamStat[match.team_a_id].id;
                nextMatch.team_a_id = lastMatch.team_a_id;
            }
        });
    }

    // Check if the week play time has ended
    let isWeekTimeEnded = false;
    try {
        const timeRange = weekInfo.time_range || '17:30-20:00';
        const endTimeStr = timeRange.split('-')[1]?.trim() || '20:00';
        const [endH, endM] = endTimeStr.split(':').map(Number);

        const endDateTime = new Date(`${weekInfo.date} ${endH || 20}:${endM || 0}:00 GMT+0700`);
        if (!isNaN(endDateTime.getTime())) {
            isWeekTimeEnded = Date.now() > endDateTime.getTime();
        }
    } catch (e) {
        logger.warn(`Could not calculate isWeekTimeEnded: ${e.message}`);
    }

    // Get all matches with details (ordered ascending by match_num)
    const allMatches = await doQuery(`SELECT * FROM match_stat_tbl WHERE week_id = ${weekid} ORDER BY match_num ASC`);
    const allMatchData = {};

    // Determine current active match:
    let activeMatch = allMatches.find(m => m.status === 'in_progress');

    // If no in-progress match, find the first scheduled / unfinished match for display
    if (!activeMatch && !isWeekTimeEnded) {
        activeMatch = allMatches.find(m => m.status === 'scheduled');
    }

    // Fallback: if all matches are finished or legacy data
    if (!activeMatch && allMatches.length > 0) {
        activeMatch = allMatches[allMatches.length - 1];
    }

    for (const match of allMatches) {
        let isLive = false;
        let isFinished = false;
        let isScheduled = false;

        if (match.status === 'in_progress') {
            isLive = true;
        } else if (match.status === 'finished') {
            isFinished = true;
        } else if (match.status === 'scheduled') {
            isScheduled = true;
        } else {
            // Legacy rows without status column
            if (activeMatch && match.id === activeMatch.id && !isWeekTimeEnded) {
                isLive = true;
            } else {
                isFinished = true;
            }
        }

        const isLocked = !isWeekTimeEnded && !isFinished && activeMatch && (match.match_num > activeMatch.match_num);

        allMatchData[match.match_num] = {
            ...match,
            team_a_goal: match.team_a_goal ?? 0,
            team_b_goal: match.team_b_goal ?? 0,
            raw_team_a_goal: match.team_a_goal,
            raw_team_b_goal: match.team_b_goal,
            status: isFinished ? 1 : (isLive ? 0 : 2), // 0 = in_progress, 1 = FT, 2 = SCHEDULED
            match_status: isFinished ? 'FT' : (isLive ? '' : 'SCHEDULED'),
            db_status: match.status || (isFinished ? 'finished' : (isLive ? 'in_progress' : 'scheduled')),
            is_live: isLive,
            is_finished: isFinished,
            is_scheduled: isScheduled,
            is_locked: isLocked,
            team_a_color: teamJson[match.team_a_id]?.name,
            team_b_color: teamJson[match.team_b_id]?.name,
            goal: await queryMatchScorer(match.id)
        };
    }

    data.is_week_ended = isWeekTimeEnded;
    data.all_match = allMatchData;

    if (isLocked) {
        data.current_match_num = 1;
        data.members = [];
    } else if (activeMatch) {
        data.current_match_num = activeMatch.match_num;
        data.current_match_id = activeMatch.id;
        data.members = await queryTeamMembers(activeMatch.id);
    } else if (allMatches.length > 0) {
        data.current_match_num = allMatches[0].match_num;
        data.current_match_id = allMatches[0].id;
        data.members = await queryTeamMembers(allMatches[0].id);
    } else {
        data.current_match_num = 1;
        data.members = members || [];
    }

    // Get week table
    const weekTable = await queryWeekTable(weekid);
    data.tableweek = weekTable || [];

    data.week = weekInfo;
    data.weeks = await queryRecentWeeks(20);
    data.next_match = nextMatch;
    data.team_week = teamJson;

    return data;
}

async function updateMatchScore(matchid) {
    const sqlTeamA = `
    SELECT match_goal_tbl.team_week_id, COUNT(*) as goal
    FROM match_goal_tbl, match_stat_tbl 
    WHERE match_stat_tbl.id = match_goal_tbl.match_id
      AND match_goal_tbl.match_id = ${matchid}
      AND match_goal_tbl.team_week_id = match_stat_tbl.team_a_id 
      AND match_goal_tbl.status <> 3
    GROUP BY team_week_id`;

    const teamAResult = await doQuery(sqlTeamA);
    const teamAGoal = teamAResult.length > 0 ? teamAResult[0].goal : 0;

    const sqlTeamB = `
    SELECT match_goal_tbl.team_week_id, COUNT(*) as goal
    FROM match_goal_tbl, match_stat_tbl 
    WHERE match_stat_tbl.id = match_goal_tbl.match_id
      AND match_goal_tbl.match_id = ${matchid}
      AND match_goal_tbl.team_week_id = match_stat_tbl.team_b_id 
      AND match_goal_tbl.status <> 3
    GROUP BY team_week_id`;

    const teamBResult = await doQuery(sqlTeamB);
    const teamBGoal = teamBResult.length > 0 ? teamBResult[0].goal : 0;

    const updateSql = `UPDATE match_stat_tbl SET team_a_goal = ${teamAGoal}, team_b_goal = ${teamBGoal} WHERE id = ${matchid}`;
    await doUpdate(updateSql);

    logger.info(`Updated match ${matchid} score: ${teamAGoal} - ${teamBGoal}`);
}

async function addMatchWeek(matchNum, teamAid, teamBid, weekid) {
    const sql = `INSERT INTO match_stat_tbl (week_id, match_num, team_a_id, team_a_goal, team_b_id, team_b_goal, status) VALUES (${weekid}, ${matchNum}, ${teamAid}, 0, ${teamBid}, 0, 'in_progress')`;
    await doUpdate(sql);
}

async function addMatchGoal(matchId, teamId, memberId, statusId = 0) {
    const sql = `INSERT INTO match_goal_tbl VALUES(default, ${matchId}, ${memberId}, ${teamId}, ${statusId})`;
    await doUpdate(sql);
}

async function removeMatchGoal(goalId) {
    const sql = `DELETE FROM match_goal_tbl WHERE id = ${goalId}`;
    await doUpdate(sql);
}

async function checkTeamTableExist(teamID, weekID) {
    const sql = `SELECT id FROM table_week_tbl WHERE team_week_id = ${teamID} AND week_id = ${weekID}`;
    const result = await doQuery(sql);
    return result.length > 0;
}

async function addTableWeek(teamID, weekID, record) {
    const { w, d, l, G, A, pts } = record;
    const exists = await checkTeamTableExist(teamID, weekID);

    let sql;
    if (exists) {
        sql = `UPDATE table_week_tbl SET w = ${w}, d = ${d}, l = ${l}, G = ${G}, A = ${A}, pts = ${pts} WHERE team_week_id = ${teamID} AND week_id = ${weekID}`;
    } else {
        sql = `INSERT INTO table_week_tbl VALUES(default, ${teamID}, ${weekID}, ${w}, ${d}, ${l}, ${G}, ${A}, ${pts})`;
    }

    await doUpdate(sql);
    return { success: true, message: `Success Add Team ID ${teamID} to Table Week ${weekID}` };
}

async function updateTableWeek(weekid) {
    const teamWeek = await queryAllTeamWeekId(weekid);

    const sql = `SELECT * FROM match_stat_tbl WHERE week_id = ${weekid}`;
    const allMatches = await doQuery(sql);

    const matches = allMatches.filter(m => {
        if (m.status !== undefined && m.status !== null) {
            return m.status === 'finished';
        }
        return m.team_a_goal !== null && m.team_a_goal !== undefined;
    });

    matches.forEach(match => {
        const teamAID = match.team_a_id;
        const teamBID = match.team_b_id;
        const teamAGoal = Number(match.team_a_goal) || 0;
        const teamBGoal = Number(match.team_b_goal) || 0;

        if (teamWeek[teamAID]) {
            teamWeek[teamAID].G += teamAGoal;
            teamWeek[teamAID].A += teamBGoal;
        }
        if (teamWeek[teamBID]) {
            teamWeek[teamBID].G += teamBGoal;
            teamWeek[teamBID].A += teamAGoal;
        }

        if (teamAGoal === teamBGoal) {
            if (teamWeek[teamAID]) teamWeek[teamAID].d++;
            if (teamWeek[teamBID]) teamWeek[teamBID].d++;
        } else if (teamAGoal > teamBGoal) {
            if (teamWeek[teamAID]) teamWeek[teamAID].w++;
            if (teamWeek[teamBID]) teamWeek[teamBID].l++;
        } else {
            if (teamWeek[teamAID]) teamWeek[teamAID].l++;
            if (teamWeek[teamBID]) teamWeek[teamBID].w++;
        }
    });

    for (const teamId in teamWeek) {
        const team = teamWeek[teamId];
        if (team && team.team_id) {
            team.pts = (team.w * 3) + team.d;
            await addTableWeek(team.team_id, weekid, team);
        }
    }

    logger.info(`Updated table for week ${weekid}`);
    return { success: true };
}

// Attach functions to router for external access
router.getLastMatchWeek = getLastMatchWeek;
router.updateMatchScore = updateMatchScore;
router.updateTableWeek = updateTableWeek;
router.queryPositionPageData = queryPositionPageData;
router.queryWeekId = queryWeekId;
router.queryTeamMembers = queryTeamMembers;
router.queryRegisteredMembers = queryRegisteredMembers;
router.queryAllPositions = queryAllPositions;
router.addMatchWeek = addMatchWeek;
router.addMatchGoal = addMatchGoal;
router.removeMatchGoal = removeMatchGoal;
router.isBeforeFriday2000 = isBeforeFriday2000;
router.isWeekRosterLocked = isWeekRosterLocked;
router.isMatchRosterLocked = isMatchRosterLocked;

module.exports = router;
