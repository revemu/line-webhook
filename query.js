const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ quiet: true });
const flex = require('./flex');
const lineClient = require('./lineClient');
const { getFormatDate, getShortDate, thaiMonthsShort } = require('./utils/date');

let lastGroupId = null;

async function ensureMemberPicture(member, groupId = null) {
  const pic = member ? (member.picture_url || member.pictureUrl) : null;
  const isInvalid = !pic || String(pic).trim() === '' || String(pic).toLowerCase() === 'none' || String(pic).toLowerCase() === 'null';
  if (member && isInvalid && member.line_user_id) {
    if (groupId) {
      lastGroupId = groupId;
    }
    const effectiveGroupId = groupId || lastGroupId;

    try {
      console.log(`[ensureMemberPicture] picture_url is empty for member ${member.name} (${member.id}), fetching from LINE API...`);
      const profile = await lineClient.fetchUserProfile(member.line_user_id, effectiveGroupId);

      if (profile && profile.pictureUrl) {
        console.log(`[ensureMemberPicture] Successfully fetched profile from LINE: pictureUrl=${profile.pictureUrl}`);
        await executeQuery("UPDATE member_tbl SET picture_url = ? WHERE id = ?", [profile.pictureUrl, member.id]);
        member.picture_url = profile.pictureUrl;
        member.pictureUrl = profile.pictureUrl;
      }
    } catch (err) {
      console.error(`[ensureMemberPicture] failed to fetch profile for user ${member.line_user_id}:`, err.message);
    }
  }
}


const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig)

// Test database connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to MySQL database successfully');
    connection.release();
  } catch (error) {
    console.error('❌ Error connecting to MySQL database:', error.message);
  }
}


// Helper function to handle database queries
async function executeQuery(query, params = []) {
  try {
    const [results] = await pool.execute(query, params);
    return results;
  } catch (error) {
    console.log(error);
    throw error;
  }
}

async function getAdminCommands() {
  const results = await executeQuery("SELECT cmd FROM admin_cmd_tbl");
  return results.map(r => r.cmd);
}

function resolveMemberDisplayInfo(member, badges, donateColors, hofCounts, hofBadge, hofAwards = {}) {
  let name_display = (member.id == 116 || member.id == 16) ? member.alias : member.name;
  name_display = (name_display || '').replace('@', '');

  const badgeInfo = badges[String(member.rank || 0)] || null;
  let badgeUrl = badgeInfo ? badgeInfo.url : null;
  const badgeSize = badgeInfo ? (badgeInfo.size || '20px') : '20px';
  if (badgeUrl) {
    if (!badgeUrl.startsWith('http://') && !badgeUrl.startsWith('https://')) {
      const baseUrl = global.baseWebhookUrl || "https://api.revemu.org";
      badgeUrl = badgeUrl.startsWith('/') ? `${baseUrl}${badgeUrl}` : `${baseUrl}/${badgeUrl}`;
    }
    if (badgeUrl.startsWith('http://')) {
      badgeUrl = badgeUrl.replace('http://', 'https://');
    }
  }

  let nameColor = null;
  const memberDonate = member.donate || 0;
  if (memberDonate >= 100) {
    let matched = null;
    for (const dc of donateColors) {
      if (dc.threshold <= memberDonate) {
        matched = dc;
      } else {
        break;
      }
    }
    if (matched) {
      nameColor = matched.color;
    }
  }

  const hofCount = hofCounts[member.id] || 0;
  const memberAwards = hofAwards[member.id] ? Array.from(hofAwards[member.id]) : [];
  const hofBadges = [];

  if (memberAwards.length > 0) {
    const badgesWithId = [];
    for (const awardType of memberAwards) {
      let badge = hofBadge[awardType];
      if (!badge) {
        badge = hofBadge['default'] || Object.values(hofBadge)[0] || { id: 0, url: 'https://bearbit.org/pic/crown.gif', size: '20px' };
      }
      let bUrl = badge.url ? badge.url.trim() : null;
      let bSize = badge.size || '20px';
      let bId = badge.id || 0;
      if (bUrl && bUrl.toLowerCase() !== 'none' && bUrl !== '') {
        if (!bUrl.startsWith('http://') && !bUrl.startsWith('https://')) {
          const baseUrl = global.baseWebhookUrl || "https://api.revemu.org";
          bUrl = bUrl.startsWith('/') ? `${baseUrl}${bUrl}` : `${baseUrl}/${bUrl}`;
        }
        if (bUrl.startsWith('http://')) {
          bUrl = bUrl.replace('http://', 'https://');
        }
        badgesWithId.push({ id: bId, url: bUrl, size: bSize });
      }
    }
    badgesWithId.sort((a, b) => a.id - b.id);
    badgesWithId.forEach(b => hofBadges.push({ url: b.url, size: b.size }));
  } else if (hofCount > 0) {
    let badge = hofBadge['default'] || Object.values(hofBadge)[0] || { url: 'https://bearbit.org/pic/crown.gif', size: '20px' };
    let bUrl = badge.url ? badge.url.trim() : null;
    if (bUrl && bUrl.toLowerCase() !== 'none' && bUrl !== '') {
      if (!bUrl.startsWith('http://') && !bUrl.startsWith('https://')) {
        const baseUrl = global.baseWebhookUrl || "https://api.revemu.org";
        bUrl = bUrl.startsWith('/') ? `${baseUrl}${bUrl}` : `${baseUrl}/${bUrl}`;
      }
      if (bUrl.startsWith('http://')) {
        bUrl = bUrl.replace('http://', 'https://');
      }
      hofBadges.push({ url: bUrl, size: badge.size || '20px' });
    }
  }

  let selectedHofBadge = null;
  if (hofCount > 1 && hofBadge && hofBadge['multi']) {
    selectedHofBadge = hofBadge['multi'];
  } else if (hofCount > 0 && hofBadge && hofBadge['default']) {
    selectedHofBadge = hofBadge['default'];
  } else if (hofCount > 0 && hofBadge) {
    selectedHofBadge = Object.values(hofBadge)[0];
  }

  let hofBadgeUrl = selectedHofBadge ? selectedHofBadge.url : (hofCount > 0 ? 'https://bearbit.org/pic/crown.gif' : null);
  let hofBadgeSize = selectedHofBadge ? (selectedHofBadge.size || '20px') : '20px';
  if (hofBadgeUrl && !hofBadgeUrl.startsWith('http://') && !hofBadgeUrl.startsWith('https://')) {
    const baseUrl = global.baseWebhookUrl || "https://api.revemu.org";
    hofBadgeUrl = hofBadgeUrl.startsWith('/') ? `${baseUrl}${hofBadgeUrl}` : `${baseUrl}/${hofBadgeUrl}`;
  }
  if (hofBadgeUrl && hofBadgeUrl.startsWith('http://')) {
    hofBadgeUrl = hofBadgeUrl.replace('http://', 'https://');
  }

  let rawPic = member.picture_url || member.pictureUrl;
  let pictureUrl = rawPic ? String(rawPic).trim() : null;
  if (pictureUrl) {
    if (pictureUrl.toLowerCase() === 'none' || pictureUrl.toLowerCase() === 'null' || pictureUrl === '') {
      pictureUrl = null;
    } else {
      if (pictureUrl.startsWith('http://')) {
        pictureUrl = pictureUrl.replace('http://', 'https://');
      }
    }
  }

  return {
    id: member.id,
    name: name_display,
    badgeUrl,
    badgeSize,
    nameColor,
    hofCount,
    hofBadgeUrl,
    hofBadgeSize,
    hofBadges,
    pictureUrl
  };
}

async function fetchDisplayAssets() {
  const badges = {};
  try {
    const badgeResults = await executeQuery("SELECT value, url, size FROM template_tpl WHERE name = 'rank_badge'");
    badgeResults.forEach(r => {
      badges[r.value] = { url: r.url, size: r.size };
    });
  } catch (badgeErr) {
    console.error('Error querying rank badges:', badgeErr.message);
  }

  const donateColors = [];
  try {
    const colorResults = await executeQuery("SELECT value, code FROM template_tpl WHERE name = 'donate_color'");
    colorResults.forEach(r => {
      donateColors.push({
        threshold: parseInt(r.value, 10),
        color: r.code
      });
    });
    donateColors.sort((a, b) => a.threshold - b.threshold);
  } catch (colorErr) {
    console.error('Error querying donate colors:', colorErr.message);
  }

  const hofCounts = {};
  const hofAwards = {};
  try {
    const hofResults = await executeQuery("SELECT member_id, type FROM hof_tbl");
    hofResults.forEach(h => {
      hofCounts[h.member_id] = (hofCounts[h.member_id] || 0) + 1;
      if (!hofAwards[h.member_id]) {
        hofAwards[h.member_id] = [];
      }
      hofAwards[h.member_id].push(h.type);
    });
  } catch (hofErr) {
    console.error('Error querying HOF counts:', hofErr.message);
  }

  const hofBadge = {};
  try {
    const hofBadgeTpls = await executeQuery("SELECT id, value, url, size FROM template_tpl WHERE name = 'hof_badge' ORDER BY id ASC");
    hofBadgeTpls.forEach(r => {
      hofBadge[r.value] = { id: r.id, url: r.url, size: r.size || '20px' };
    });
  } catch (hofBadgeErr) {
    console.error('Error querying HOF badge template:', hofBadgeErr.message);
  }

  const teamColors = {};
  try {
    const colorResults = await executeQuery("SELECT value, code FROM template_tpl WHERE name = 'team_color_pools'");
    colorResults.forEach(r => {
      if (r.value && r.code) {
        teamColors[r.value.toLowerCase()] = r.code;
      }
    });
  } catch (colorErr) {
    console.error('Error querying team color templates:', colorErr.message);
  }

  return { badges, donateColors, hofCounts, hofBadge, hofAwards, teamColors };
}

async function updateAlertCall(value = 1) {

  let query;
  query = `update template_tpl set value=${value} where name='call'`;

  const res = await executeQuery(query);
  //console.log(res) ;
  return res;

}

async function updateMember(member_id, value, type = 0) {
  let query;
  if (type == 0) {
    query = "update member_tbl set name=? where id=?";
    return await executeQuery(query, [value, member_id]);
  } else if (type == 1) {
    //query = `update member_team_week_tbl set team_id=${value} where member_id=${member_id} and week_id=${week_id}`
  }
}

async function updateMemberRank(member_id, rank) {
  const query = "update member_tbl set rank=? where id=?";
  return await executeQuery(query, [rank, member_id]);
}

async function resetMemberTeam() {
  const week = await queryWeekID();
  let query = `update member_team_week_tbl set team_id=0 where week_id=${week[0].id}`;

  const res = await executeQuery(query);
  //console.log(res) ;
  return res;

}

async function newMember(lineID, name, pictureUrl = null) {
  const query = "insert into member_tbl (name, debt, donate, team_id, alias, line_user_id, fav_team_id, picture_url) values(?, 0, 0, 0, ?, ?, 0, ?)";
  const res = await executeQuery(query, [name, name.replace('@', ''), lineID, pictureUrl]);
  return res;
}

async function updateMemberInfo(member_id, name, pictureUrl = null) {
  let query = "update member_tbl set name = ?, picture_url = ? where id = ?";
  return await executeQuery(query, [name, pictureUrl, member_id]);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function newTeamColorWeek(color, index, week_id) {
  const query = `insert into team_color_week_tbl values(null, ${index}, ${week_id}, '${color}')`;
  console.log(query);

  const res = await executeQuery(query);
  return res;
}

async function addTeamColorWeek(count = 3, targetWeekId = null) {
  let week_id;
  let max_players = 24;

  if (targetWeekId) {
    week_id = targetWeekId;
    const weekRes = await queryWeekID(targetWeekId);
    if (weekRes && weekRes.length > 0) {
      max_players = weekRes[0].max || 24;
    }
  } else {
    const week = await queryWeekID();
    if (!week || week.length === 0) return;
    week_id = week[0].id;
    max_players = week[0].max || 24;
  }

  const targetCount = max_players > 24 ? 4 : count;

  let query = `select * from team_color_week_tbl where week_id=${week_id}`;
  const res = await executeQuery(query);

  if (!res || res.length < targetCount) {
    const poolRes = await executeQuery("SELECT value FROM template_tpl WHERE name = 'team_color_pools'");
    let colors = poolRes && poolRes.length > 0 ? poolRes.map(r => r.value) : [];

    const existingColors = res ? res.map(r => (r.color || '').toLowerCase()) : [];
    const availableColors = colors.filter(c => !existingColors.includes((c || '').toLowerCase()));

    const shuffledAvailable = shuffleArray([...availableColors]);
    const numToInsert = targetCount - (res ? res.length : 0);
    const existingCount = res ? res.length : 0;

    for (let i = 0; i < numToInsert && i < shuffledAvailable.length; i++) {
      await newTeamColorWeek(shuffledAvailable[i], existingCount + i + 1, week_id);
    }
  } else {
    //console.log("Team color week already exist!");
  }
}

async function addTeamMemberWeek() {

  const week = await queryWeekID();
  let query = `select * from member_team_week_tbl where week_id=${week[0].id}`;
  let team_colors = await getTeamColorWeek(week[0].id);
  const members = await executeQuery(query);
  //console.log(res) ;
  //return res ;
  if (members.length > 0) {
    let num = 0;
    //const test = members.filter(member => member.team_id !=0) ;
    if (members.filter(member => member.team_id != 0).length > 0) {
      console.log("Team already created!");
      return 1;
    } else if (members.filter(member => member.team != 0).length == 0) {
      console.log("No Team assigned!");
      return 2;
    }

    for (let i = 0; i < members.length; i++) {
      //newTeamColorWeek(colors[i], i+1, week[0].id)

      if (members[i].team > 0) {
        num = members[i].team - 1;
        console.log(`${members[i].name} => ${team_colors[num].color}`)
        await updateMemberWeek(members[i].member_id, team_colors[num].id, 1);
      } else {
        console.log(`${members[i].name} no team assigned`)
      }

    }
    return 0;
  }
}


async function ensureWeekTimeColumn() {
  try {
    const checkQuery = "SHOW COLUMNS FROM week_tbl LIKE 'time_range'";
    const res = await executeQuery(checkQuery);
    if (res.length === 0) {
      console.log("[Migration] Adding time_range column to week_tbl...");
      await executeQuery("ALTER TABLE week_tbl ADD COLUMN time_range VARCHAR(50) NOT NULL DEFAULT '17:30-20:00'");
      console.log("✅ time_range column added to week_tbl successfully!");
    }
  } catch (err) {
    console.error("Error ensuring time_range column in week_tbl:", err.message);
  }
}

async function updateWeekTimeRange(timeRangeStr, targetWeekId = 0) {
  await ensureWeekTimeColumn();
  let week_id = targetWeekId;
  if (week_id === 0) {
    const week = await queryWeekID(0);
    if (!week || week.length === 0) return { success: false, message: 'ไม่พบสัปดาห์ปัจจุบัน' };
    week_id = week[0].id;
  }
  const query = "UPDATE week_tbl SET time_range = ? WHERE id = ?";
  await executeQuery(query, [timeRangeStr, week_id]);
  return { success: true, week_id, time_range: timeRangeStr };
}

async function newWeek(week_date, custom_time_range = null) {
  await ensureWeekTimeColumn();
  // Self-healing cleanup for any previous corrupted B.E. dates in week_tbl
  try {
    await executeQuery("UPDATE week_tbl SET date = DATE_SUB(date, INTERVAL 543 YEAR) WHERE YEAR(date) > 2400");
  } catch (e) { }

  const week = await queryWeekID();
  let y = week_date.getFullYear();
  if (y > 2400) y -= 543;
  const date_str = getShortDate(week_date);
  const last_week = getShortDate(new Date(week[0].date));
  let new_week_num = week[0].number;
  let target_week_id = null;
  const time_range = custom_time_range || '17:30-20:00';

  if (last_week != date_str) {
    new_week_num = week[0].number + 1;
    const insertQuery = "INSERT INTO week_tbl (number, date, status, year, max, cost, time_range) VALUES (?, ?, 2, ?, 24, 0, ?)";
    const res = await executeQuery(insertQuery, [new_week_num, date_str, y, time_range]);
    const new_week_id = res.insertId;
    target_week_id = new_week_id;

    // Auto-register members using autoreg_tbl, excluding those with outstanding debt
    try {
      await ensureAutoRegTable();
      const autoRegMembers = await executeQuery(`
        SELECT m.id, m.name, m.debt 
        FROM autoreg_tbl a 
        JOIN member_tbl m ON a.member_id = m.id 
        WHERE a.status = 1 
        ORDER BY a.id ASC, m.id ASC
      `);
      for (const member of autoRegMembers) {
        if (member.debt > 0) {
          console.log(`[Auto-Reg] Skipped ${member.name} (ID: ${member.id}) due to outstanding debt of ${member.debt} baht`);
          continue;
        }
        // Check if member is already registered for this week to avoid duplicates
        const existQuery = "SELECT 1 FROM member_team_week_tbl WHERE week_id = ? AND member_id = ?";
        const existRes = await executeQuery(existQuery, [new_week_id, member.id]);
        if (existRes.length === 0) {
          const insertQuery = "insert into member_team_week_tbl values(null, ?, ?, 0, ?, 0, 0)";
          await executeQuery(insertQuery, [member.id, member.name, new_week_id]);
          console.log(`[Auto-Reg] Registered ${member.name} (ID: ${member.id}) for week ID ${new_week_id}`);
        } else {
          console.log(`[Auto-Reg] Member ${member.name} (ID: ${member.id}) already registered for week ID ${new_week_id}`);
        }
      }
    } catch (regErr) {
      console.error('⚠️ Auto-registration failed:', regErr.message);
    }
  } else {
    console.log(date_str + " already exist!");
    if (custom_time_range && week && week.length > 0) {
      await updateWeekTimeRange(custom_time_range, week[0].id);
    }
    if (week && week.length > 0) {
      target_week_id = week[0].id;
    }
  }
  await addTeamColorWeek(3, target_week_id);
}

async function updateMaxNumberWeek(max_number = 24) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    const query = "update week_tbl set max=? where id=?";
    const res = await executeQuery(query, [max_number, week_id]);

    if (max_number > 24) {
      const currentColors = await getTeamColorWeek(week_id);
      if (currentColors && currentColors.length < 4) {
        const poolRes = await executeQuery("SELECT value FROM template_tpl WHERE name = 'team_color_pools'");
        const candidatePool = poolRes && poolRes.length > 0 ? poolRes.map(r => r.value) : [];

        const usedColors = currentColors.map(c => (c.color || '').toLowerCase());
        const availableColors = candidatePool.filter(c => c && !usedColors.includes(c.toLowerCase()));

        if (availableColors.length > 0) {
          const chosenColor = availableColors[0];
          const nextIndex = currentColors.length + 1;
          await newTeamColorWeek(chosenColor, nextIndex, week_id);
          console.log(`[setmaxweek] Added 4th team color '${chosenColor}' for week ID ${week_id}`);
        }
      }
    }

    return res;
  }
}

async function removeReserveMembers() {
  const week = await queryWeekID();
  if (week.length === 0) {
    return { success: false, message: 'ไม่พบสัปดาห์ปัจจุบัน' };
  }
  const week_id = week[0].id;
  const max_players = week[0].max;

  // Fetch all registered members for the week in order of registration
  const query = "SELECT id, member_id, team_id, member_name FROM member_team_week_tbl WHERE week_id = ? ORDER BY id ASC";
  const registrations = await executeQuery(query, [week_id]);

  let nonGoalieCount = 0;
  const reservesToRemove = [];

  for (const reg of registrations) {
    if (reg.team_id !== 100) {
      nonGoalieCount++;
      if (nonGoalieCount > max_players) {
        reservesToRemove.push(reg);
      }
    }
  }

  if (reservesToRemove.length === 0) {
    return { success: true, count: 0, message: 'ไม่มีรายชื่อสำรองในสัปดาห์นี้' };
  }

  // Delete all reserve registrations
  const idsToDelete = reservesToRemove.map(r => r.id);
  const deleteQuery = `DELETE FROM member_team_week_tbl WHERE id IN (${idsToDelete.join(',')})`;
  await executeQuery(deleteQuery);

  return {
    success: true,
    count: reservesToRemove.length,
    names: reservesToRemove.map(r => r.member_name)
  };
}

async function updateMemberDebt(member_id) {
  let query1 = ""

  query1 = "update member_tbl set debt=0 where id=?";
  const res1 = await executeQuery(query1, [member_id]);

  //console.log(res) ;
  return res1;
}

async function updateMemberWeek(member_id, value, type = 0) {
  const week = await queryWeekID();
  if (week.length > 0) {
    let week_id = week[0].id;
    let query;
    let query1 = "";
    let finalPayVal = value;
    if (type == 0) {
      // Fallback: If member is not registered in active week_id, check if they have an unpaid registration in another active week
      const checkReg = await executeQuery("SELECT week_id FROM member_team_week_tbl WHERE member_id = ? AND week_id = ?", [member_id, week_id]);
      if (checkReg.length === 0) {
        const findUnpaid = await executeQuery("SELECT week_id FROM member_team_week_tbl WHERE member_id = ? AND pay = 0 ORDER BY week_id DESC LIMIT 1", [member_id]);
        if (findUnpaid.length > 0) {
          week_id = findUnpaid[0].week_id;
        }
      }

      query = "update member_team_week_tbl set pay=? where member_id=? and week_id=?";
      query1 = "update member_tbl set debt=? where id=?";
      const res1 = await executeQuery(query1, [0, member_id]);
    } else if (type == 1) {
      query = "update member_team_week_tbl set team_id=? where member_id=? and week_id=?";
    }

    const res = await executeQuery(query, [finalPayVal, member_id, week_id]);
    //console.log(res) ;
    return res;
  }
}

async function setWeekCost(totalCost) {
  const week = await queryWeekID();
  if (week.length === 0) {
    return { success: false, message: 'ไม่พบข้อมูลสัปดาห์ปัจจุบัน' };
  }
  const week_id = week[0].id;

  // Query all members registered for this week
  const membersQuery = `
    SELECT mtw.member_id, mtw.pay, m.team_id 
    FROM member_team_week_tbl mtw
    INNER JOIN member_tbl m ON mtw.member_id = m.id
    WHERE mtw.week_id = ?
  `;
  const members = await executeQuery(membersQuery, [week_id]);
  if (members.length === 0) {
    return { success: false, message: 'ไม่มีสมาชิกที่ลงชื่อในสัปดาห์นี้' };
  }

  const payingMembers = members.filter(m => (m.team_id !== 101 && m.team_id !== 1));
  //const count = members.length;
  const count = (members.length > week[0].max) ? week[0].max : members.length;
  if (count === 0) {
    return { success: false, message: 'ไม่มีสมาชิกที่ต้องชำระเงินในสัปดาห์นี้' };
  }

  const sharedFee = Math.ceil((totalCost + 100) / count) + 35;
  let costfee = sharedFee;
  await executeQuery(
    "UPDATE week_tbl SET cost = ? WHERE id = ?",
    [costfee, week_id]
  );
  for (const m of payingMembers) {
    if (m.team_id === 101 || m.team_id === 1) {
      continue;
    } else if (m.team_id === 100) {
      costfee = 40;
    } else {
      costfee = sharedFee;
    }
    await executeQuery(
      "UPDATE member_tbl SET debt = ? WHERE id = ?",
      [costfee, m.member_id]
    );
  }

  return { success: true, count, sharedFee };
}

async function resetWeekDebt() {
  const week = await queryWeekID();
  if (week.length === 0) {
    return { success: false, message: 'ไม่พบข้อมูลสัปดาห์ปัจจุบัน' };
  }
  const week_id = week[0].id;

  // Query all members registered for this week
  const membersQuery = "SELECT member_id FROM member_team_week_tbl WHERE week_id = ?";
  const members = await executeQuery(membersQuery, [week_id]);
  if (members.length === 0) {
    return { success: false, message: 'ไม่มีสมาชิกที่ลงชื่อในสัปดาห์นี้' };
  }

  const memberIds = members.map(m => m.member_id);
  const placeholders = memberIds.map(() => '?').join(',');

  // Reset debt in member_tbl to 0 for these members
  await executeQuery(
    `UPDATE member_tbl SET debt = 0 WHERE id IN (${placeholders})`,
    memberIds
  );

  // Reset pay to 0 in member_team_week_tbl for this week
  await executeQuery(
    "UPDATE member_team_week_tbl SET pay = 0 WHERE week_id = ?",
    [week_id]
  );

  return { success: true, count: members.length };
}

async function setMemberDebt(member_id, amount) {
  const query = "UPDATE member_tbl SET debt = ? WHERE id = ?";
  const res = await executeQuery(query, [amount, member_id]);
  return res;
}

async function queryWeekDate(week_id = 0) {
  let query = "";
  if (week_id == 0) {
    query = "SELECT id, number, date FROM week_tbl ORDER BY id DESC LIMIT 1";
    return await executeQuery(query);
  } else {
    query = "SELECT id, number, date FROM week_tbl where id=?";
    return await executeQuery(query, [week_id]);
  }
}

async function queryWeekID(week_param = 0) {
  await ensureWeekTimeColumn();

  if (!week_param || week_param === 0 || String(week_param).trim() === '0') {
    const query = "SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl ORDER BY id DESC LIMIT 1";
    return await executeQuery(query);
  }

  const strParam = String(week_param).trim();

  // 1. If numeric (e.g. 5, 12)
  if (/^\d+$/.test(strParam)) {
    const num = Number(strParam);
    const query = "SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl WHERE id = ? OR number = ? ORDER BY id DESC LIMIT 1";
    const res = await executeQuery(query, [num, num]);
    if (res && res.length > 0) return res;
  }

  // 2. Format DD/MM or DD-MM or DD.MM (e.g. 30/08, 30-8, 30.08)
  const slashMatch = strParam.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10);
    let year = slashMatch[3] ? parseInt(slashMatch[3], 10) : null;
    if (year) {
      if (year < 100) year += 2000;
      if (year > 2500) year -= 543;
    }

    let query = "SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl WHERE DAY(date) = ? AND MONTH(date) = ?";
    const params = [day, month];
    if (year) {
      query += " AND YEAR(date) = ?";
      params.push(year);
    }
    query += " ORDER BY id DESC LIMIT 1";

    const res = await executeQuery(query, params);
    if (res && res.length > 0) return res;
  }

  // 3. Format Thai Date (e.g. 30ส.ค., 30 ส.ค., 30สิงหาคม)
  const thaiMonths = {
    'ม.ค.': 1, 'มกรา': 1, 'มกราคม': 1,
    'ก.พ.': 2, 'กุมภา': 2, 'กุมภาพันธ์': 2,
    'มี.ค.': 3, 'มีนา': 3, 'มีนาคม': 3,
    'เม.ย.': 4, 'เมษา': 4, 'เมษายน': 4,
    'พ.ค.': 5, 'พฤษภา': 5, 'พฤษภาคม': 5,
    'มิ.ย.': 6, 'มิถุนา': 6, 'มิถุนายน': 6,
    'ก.ค.': 7, 'กรกฎา': 7, 'กรกฎาคม': 7,
    'ส.ค.': 8, 'สิงหา': 8, 'สิงหาคม': 8,
    'ก.ย.': 9, 'กันยา': 9, 'กันยายน': 9,
    'ต.ค.': 10, 'ตุลา': 10, 'ตุลาคม': 10,
    'พ.ย.': 11, 'พฤศจิกา': 11, 'พฤศจิกายน': 11,
    'ธ.ค.': 12, 'ธันวา': 12, 'ธันวาคม': 12
  };

  const thaiMatch = strParam.match(/^(\d{1,2})\s*([ก-ฮa-zA-Z\.]+)(?:\s*(\d{2,4}))?$/);
  if (thaiMatch) {
    const day = parseInt(thaiMatch[1], 10);
    const monthStr = thaiMatch[2].trim();
    let month = null;
    for (const [key, val] of Object.entries(thaiMonths)) {
      if (monthStr.startsWith(key) || key.startsWith(monthStr)) {
        month = val;
        break;
      }
    }
    if (month) {
      let year = thaiMatch[3] ? parseInt(thaiMatch[3], 10) : null;
      if (year) {
        if (year < 100) year += 2000;
        if (year > 2500) year -= 543;
      }

      let query = "SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl WHERE DAY(date) = ? AND MONTH(date) = ?";
      const params = [day, month];
      if (year) {
        query += " AND YEAR(date) = ?";
        params.push(year);
      }
      query += " ORDER BY id DESC LIMIT 1";

      const res = await executeQuery(query, params);
      if (res && res.length > 0) return res;
    }
  }

  // Fallback to latest week if nothing matched
  const fallbackQuery = "SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date, max, cost, COALESCE(time_range, '17:30-20:00') as time_range FROM week_tbl ORDER BY id DESC LIMIT 1";
  return await executeQuery(fallbackQuery);
}

async function unregisterMember(member_id) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    const query = "SELECT * from member_team_week_tbl where week_id=? and member_id=?";
    const res = await executeQuery(query, [week_id, member_id]);
    if (res.length > 0) {
      const team_id = res[0].team_id;
      const deleteQuery = "delete from member_team_week_tbl where member_id=? and week_id=?";
      await executeQuery(deleteQuery, [member_id, week_id]);
      return { success: true, team_id: team_id };
    } else {
      return { success: false, team_id: null };
    }
  }
  return { success: false, team_id: null };
}

async function IsMemberWeek(member_id) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    const query = `SELECT * from member_team_week_tbl where week_id=${week_id} and member_id=${member_id}`;
    const res = await executeQuery(query);
    //console.log(`${res.length}`)
    if (res.length > 0) {
      //console.log(`${week_id}`)
      return true;
    } else {
      return false;
    }
  }
}

async function registerNY(member_id) {

  const query = `update member_tbl set fav_team_id=1 where id=${member_id}`;

  //console.log(query) ;
  const reg_res = await executeQuery(query);
  //console.log(reg_res) ;
  return true;

}

async function registerMember(member_id, member_name) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    const query = "SELECT * from member_team_week_tbl where week_id=? and member_id=?";
    const res = await executeQuery(query, [week_id, member_id]);
    const check = "SELECT * from member_tbl where id=?";
    const check_res = await executeQuery(check, [member_id]);
    if (check_res.length > 0) {
      const debt = check_res[0].debt;
      //console.log(`ยอดค้าง ${debt}`);
      if (debt > 0) return debt;
    }
    //console.log(`${res.length}`)
    if (res.length > 0) {
      return 1;
    } else {
      const query = "insert into member_team_week_tbl values(null, ?, ?, 0, ?, 0, 0)";
      //console.log(query) ;
      const reg_res = await executeQuery(query, [member_id, member_name, week_id]);
      //console.log(reg_res) ;
      return 0;
    }
  }
  //console.log(res) ;
  return 0;
}

async function queryMemberbyLineID(lineId) {
  const query = "SELECT * FROM member_tbl where line_user_id=?";
  const res = await executeQuery(query, [lineId]);
  return res;
}

async function queryMemberbyName(name) {
  const query = "SELECT * FROM member_tbl where name=?";
  const res = await executeQuery(query, [name]);
  return res;
}

async function queryMatchGoal(match_id, goal_status = 0, groupId = null) {
  let status;
  let icon = "";
  const baseUrl = global.baseWebhookUrl || "https://api.revemu.org";
  if (goal_status == 0) {
    status = " <= 2";
    icon = "⚽";
  } else if (goal_status == 3) {
    status = " = 3";
    icon = "👟";
  }

  query = `SELECT member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id, goal_status_tbl.status, match_goal_tbl.status as statusid, count(*) as goal 
    FROM match_goal_tbl, member_tbl, goal_status_tbl 
    WHERE match_goal_tbl.match_id=${match_id} 
      AND match_goal_tbl.member_id = member_tbl.id 
      AND match_goal_tbl.status ${status} 
      AND match_goal_tbl.status=goal_status_tbl.id 
    GROUP BY member_tbl.id, match_goal_tbl.status, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id`;

  const match_goals = await executeQuery(query);
  if (match_goals.length === 0) {
    return null;
  }

  await Promise.all(match_goals.map(member => ensureMemberPicture(member, groupId)));
  const assets = await fetchDisplayAssets();
  return flex.buildScorerRowFlex(icon, match_goals, goal_status, assets, resolveMemberDisplayInfo);
}

async function getTeamColorWeek(week_id) {
  const query = `SELECT team_color_week_tbl.id, team_color_week_tbl.color, template_tpl.url, template_tpl.code FROM team_color_week_tbl LEFT JOIN template_tpl ON LOWER(team_color_week_tbl.color) = LOWER(template_tpl.value) AND template_tpl.name = 'team_color_pools' WHERE team_color_week_tbl.week_id = ${week_id}`;

  let result = await executeQuery(query);
  if ((!result || result.length === 0) && week_id) {
    console.log(`[Auto-Fix] Missing team_color_week for week_id=${week_id}. Generating team colors automatically...`);
    await addTeamColorWeek(3, week_id);
    result = await executeQuery(query);
  }
  if (result && result.length > 0) {
    return result;
  }
  return [];
}

async function getTemplate(name, value) {
  query = `select * from template_tpl where name='${name}' and value='${value}'`;

  const result = await executeQuery(query);
  if (result.length > 0) {
    return result[0];
  }
}

async function getTeamColor(color) {
  query = `SELECT * FROM template_tpl WHERE name = 'team_color_pools' AND LOWER(value) = LOWER('${color}')`;

  const result = await executeQuery(query);
  if (result && result.length > 0) {
    return result[0];
  }
}

async function queryMatchWeek(week_id) {
  query = `SELECT * FROM match_stat_tbl where week_id = ${week_id} order by match_num`;

  const result = await executeQuery(query);
  if (result.length > 0) {
    return result;
  }
}

async function queryTableWeek(week_id) {

  let query = `SELECT team_color_week_tbl.color, table_week_tbl.* FROM table_week_tbl , team_color_week_tbl where table_week_tbl.week_id = ${week_id} AND table_week_tbl.team_week_id = team_color_week_tbl.id order by table_week_tbl.pts DESC, (table_week_tbl.g - table_week_tbl.a) DESC`;

  const result = await executeQuery(query);
  if (result.length > 0) {
    return result;
  }
}

async function getTableWeek(week_id = 0) {

  res = await queryWeekID(week_id);

  if (res.length > 0) {
    if (week_id == 0) {
      week_id = res[0].id;
    }
    const week_tables = await queryTableWeek(week_id);

    if (week_tables.length > 0) {
      const bubble = JSON.parse(JSON.stringify(flex.tpl_bubble));
      bubble.size = "mega";
      bubble.hero.url = 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg';
      //bubble.hero.url = teamColor.url ;
      bubble.hero.aspectRatio = "12:6"

      const date = new Date(res[0].date);
      const date_str = await getFormatDate(date);
      const team_colors = await getTeamColorWeek(week_id);
      return flex.buildTableWeekFlex(date_str, week_tables, team_colors);
    }
  }
}

async function getWeekLeaderStats(week_id, groupId = null) {
  try {
    const goalsQuery = `
      SELECT 
        mgt.member_id, 
        m.id,
        m.name, 
        m.alias,
        m.rank,
        m.donate,
        m.picture_url,
        m.line_user_id,
        m.pos_id as member_pos_id,
        mtw.team_id,
        mtw.pos_id as week_pos_id,
        SUM(CASE WHEN mgt.status <= 2 THEN 1 ELSE 0 END) as goals,
        SUM(CASE WHEN mgt.status = 3 THEN 1 ELSE 0 END) as assists
      FROM match_goal_tbl mgt
      JOIN match_stat_tbl mst ON mgt.match_id = mst.id
      JOIN member_tbl m ON mgt.member_id = m.id
      LEFT JOIN member_team_week_tbl mtw ON mtw.member_id = m.id AND mtw.week_id = mst.week_id
      WHERE mst.week_id = ?
      GROUP BY mgt.member_id, m.id, m.name, m.alias, m.rank, m.donate, m.picture_url, m.line_user_id, m.pos_id, mtw.team_id, mtw.pos_id
    `;
    const goalRes = await executeQuery(goalsQuery, [week_id]);
    if (!goalRes || goalRes.length === 0) return null;

    await Promise.all(goalRes.map(member => ensureMemberPicture(member, groupId)));
    const assets = await fetchDisplayAssets();

    const tableRows = await queryTableWeek(week_id);
    const teamMvpFactorMap = {};
    const teamInfoMap = {};

    // Calculate actual Goals Against (GA), Clean Sheets, and Wins per team from match_stat_tbl for this week
    const teamGaMap = {};
    const teamCleanSheetsMap = {};
    const teamWinsMap = {};
    const matchScores = await executeQuery(
      "SELECT team_a_id, team_b_id, team_a_goal, team_b_goal FROM match_stat_tbl WHERE week_id = ?",
      [week_id]
    );
    if (matchScores && matchScores.length > 0) {
      matchScores.forEach(m => {
        const gaA = Number(m.team_b_goal) || 0;
        const gaB = Number(m.team_a_goal) || 0;
        const gA = Number(m.team_a_goal) || 0;
        const gB = Number(m.team_b_goal) || 0;

        if (m.team_a_id) {
          teamGaMap[m.team_a_id] = (teamGaMap[m.team_a_id] || 0) + gaA;
          if (gaA === 0) teamCleanSheetsMap[m.team_a_id] = (teamCleanSheetsMap[m.team_a_id] || 0) + 1;
          if (gA > gB) teamWinsMap[m.team_a_id] = (teamWinsMap[m.team_a_id] || 0) + 1;
        }
        if (m.team_b_id) {
          teamGaMap[m.team_b_id] = (teamGaMap[m.team_b_id] || 0) + gaB;
          if (gaB === 0) teamCleanSheetsMap[m.team_b_id] = (teamCleanSheetsMap[m.team_b_id] || 0) + 1;
          if (gB > gA) teamWinsMap[m.team_b_id] = (teamWinsMap[m.team_b_id] || 0) + 1;
        }
      });
    }

    await ensurePosTables();
    const allPositions = await getAllPositions();
    const posMap = {};
    allPositions.forEach(p => { posMap[p.id] = p; });
    const defaultPos = allPositions.find(p => p.code === 'CF') || allPositions[0] || { code: 'CF', icon: '⚡', pts_goal: 4, pts_assist: 3, pts_clean_sheet: 0 };

    console.log(`\n=== [MVP Calculation Log] Week ID: ${week_id} ===`);
    if (tableRows && tableRows.length > 0) {
      tableRows.forEach(row => {
        const teamId = row.team_week_id;
        const w = Number(row.w !== undefined ? row.w : (row.W || 0));
        if (w > 0) teamWinsMap[teamId] = w;
        const d = Number(row.d !== undefined ? row.d : (row.D || 0));
        const l = Number(row.l !== undefined ? row.l : (row.L || 0));
        const totalMatches = w + d + l;
        const pts = Number(row.pts !== undefined ? row.pts : (row.PTS || 0));

        const avgPts = totalMatches > 0 ? (pts / totalMatches) : pts;
        const goalsScored = Number(row.G !== undefined ? row.G : (row.g || 0));
        const goalsConceded = Number(row.A !== undefined ? row.A : (row.a || 0));
        const goalsAgainst = (teamGaMap[teamId] !== undefined && teamGaMap[teamId] > 0) ? teamGaMap[teamId] : goalsConceded;
        const divisor = goalsAgainst > 0 ? goalsAgainst : 1;
        const factor = avgPts / divisor;

        teamMvpFactorMap[teamId] = factor;
        teamInfoMap[teamId] = { color: row.color, w, d, l, matches: totalMatches, pts, avgPts, goalsAgainst, divisor, factor };

        console.log(` [Team ${row.color || teamId} (ID: ${teamId})]`);
        console.log(`   └─ Record: Wins (W): ${w}, Draws (D): ${d}, Losses (L): ${l} => Total Matches Played: ${totalMatches}`);
        console.log(`   └─ Points (Pts): ${pts}`);
        console.log(`   └─ Avg Pts Calculation: Points (${pts}) / Total Matches (${totalMatches > 0 ? totalMatches : 1}) = ${avgPts.toFixed(4)}`);
        console.log(`   └─ Goals Against (A) [from match_stat_tbl]: ${goalsAgainst}`);
        console.log(`   └─ Team Factor Calculation: Avg Pts (${avgPts.toFixed(4)}) / Goals Against (${divisor}) = ${factor.toFixed(4)}`);
        console.log(`   => Team Factor = ${factor.toFixed(4)}`);
      });
    }

    // Pass 1: Compute raw MVP scores with position weights from pos_tbl + match wins * 1.5
    const rawScoresList = goalRes.map(m => {
      if (isTempReserveMember(m.name)) return null;

      const g = Number(m.goals) || 0;
      const a = Number(m.assists) || 0;
      const teamId = Number(m.team_id) || 0;

      const cleanSheets = teamCleanSheetsMap[teamId] || 0;
      const wins = teamWinsMap[teamId] || 0;

      let pos = defaultPos;
      if (m.week_pos_id > 0 && posMap[m.week_pos_id]) {
        pos = posMap[m.week_pos_id];
      } else if (m.member_pos_id > 0 && posMap[m.member_pos_id]) {
        pos = posMap[m.member_pos_id];
      }

      const ptsGoal = parseFloat(pos.pts_goal) || 4.0;
      const ptsAssist = parseFloat(pos.pts_assist) || 3.0;
      const ptsCleanSheet = parseFloat(pos.pts_clean_sheet) || 0.0;

      // Raw MVP score = (Goals * ptsGoal) + (Assists * ptsAssist) + (CleanSheets * ptsCleanSheet) + (Wins * 1.5)
      const rawScore = (g * ptsGoal) + (a * ptsAssist) + (cleanSheets * ptsCleanSheet) + (wins * 1.5);

      return { member: m, g, a, cleanSheets, wins, pos, ptsGoal, ptsAssist, ptsCleanSheet, rawScore };
    }).filter(item => item !== null);

    let maxGoals = 0;
    let maxAssists = 0;
    let maxRawMvpScore = 0;

    rawScoresList.forEach(item => {
      if (item.g > maxGoals) maxGoals = item.g;
      if (item.a > maxAssists) maxAssists = item.a;
      if (item.rawScore > maxRawMvpScore && item.rawScore > 0) maxRawMvpScore = item.rawScore;
    });

    // Determine the year for current week_id
    let weekYear = new Date().getFullYear();
    try {
      const weekRes = await executeQuery("SELECT date FROM week_tbl WHERE id = ?", [week_id]);
      if (weekRes && weekRes.length > 0 && weekRes[0].date) {
        weekYear = new Date(weekRes[0].date).getFullYear();
      }
    } catch (e) {}

    // Retrieve benchmark reference max MVP score for current year from mvp_week_tbl
    await ensureMvpWeekTable();
    let refMaxScore = 0;
    try {
      const maxDbRes = await executeQuery(`
        SELECT MAX(m.raw_score) as max_raw 
        FROM mvp_week_tbl m
        JOIN week_tbl w ON m.week_id = w.id
        WHERE YEAR(w.date) = ?
      `, [weekYear]);
      if (maxDbRes && maxDbRes[0] && maxDbRes[0].max_raw) {
        refMaxScore = parseFloat(maxDbRes[0].max_raw);
      }
    } catch (e) {}

    if (maxRawMvpScore > refMaxScore) {
      refMaxScore = maxRawMvpScore;
    }

    // Fallback if benchmark not set yet for this year: use max raw MVP score of current week
    if (!refMaxScore || isNaN(refMaxScore) || refMaxScore <= 0) {
      refMaxScore = maxRawMvpScore;
    }

    // Pass 2: Normalize to 1-10 rating scale against refMaxScore
    const formattedList = rawScoresList.map(item => {
      const m = item.member;
      const g = item.g;
      const a = item.a;
      const cleanSheets = item.cleanSheets;
      const wins = item.wins;
      const pos = item.pos;
      const ptsGoal = item.ptsGoal;
      const ptsAssist = item.ptsAssist;
      const ptsCleanSheet = item.ptsCleanSheet;
      const rawScore = item.rawScore;
      const normalizedScore = (refMaxScore > 0 && rawScore > 0) ? Math.min(10.0, (rawScore / refMaxScore) * 10) : 0;

      const teamDetails = teamInfoMap[m.team_id];
      const teamName = teamDetails ? teamDetails.color : `ID ${m.team_id}`;

      console.log(` [Player ${m.name}] (Team: ${teamName}) [Position: ${pos.code} ${pos.icon || ''}]`);
      console.log(`   └─ Position Category Points: Goal: ${ptsGoal}, Assist: ${ptsAssist}, Clean Sheet: ${ptsCleanSheet}`);
      console.log(`   └─ Player Stats: Goals (G): ${g}, Assists (A): ${a}, Clean Sheets (CS): ${cleanSheets}, Match Wins (W): ${wins}`);
      console.log(`   └─ Raw MVP Score: (${g} * ${ptsGoal}) + (${a} * ${ptsAssist}) + (${cleanSheets} * ${ptsCleanSheet}) + (${wins} * 1.5) = ${rawScore.toFixed(4)}`);
      console.log(`   └─ 1-10 Rating Normalization: (${rawScore.toFixed(4)} / Benchmark Ref ${refMaxScore.toFixed(4)}) * 10 = ${normalizedScore.toFixed(1)} / 10`);
      console.log(`   => Final MVP Rating = ${normalizedScore.toFixed(1)} / 10`);

      const info = resolveMemberDisplayInfo(m, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
      return {
        ...m,
        goals: g,
        assists: a,
        rawScore,
        score: normalizedScore,
        info
      };
    });

    const topScorers = maxGoals > 0 ? formattedList.filter(item => item.goals === maxGoals) : [];
    const topAssists = maxAssists > 0 ? formattedList.filter(item => item.assists === maxAssists) : [];
    const mvps = maxRawMvpScore > 0 ? formattedList.filter(item => item.rawScore === maxRawMvpScore) : [];
    const maxMvpScore = mvps.length > 0 ? mvps[0].score : 0;

    // Save/update current week MVP winners into mvp_week_tbl
    if (mvps && mvps.length > 0) {
      await saveWeekMvpRecords(week_id, mvps);
    }

    console.log(` [MVP Winner(s)] Max Raw: ${maxRawMvpScore.toFixed(4)} | Benchmark Ref: ${refMaxScore.toFixed(4)} | Leader Rating: ${maxMvpScore.toFixed(1)}/10 | Winner(s): ${mvps.length > 0 ? mvps.map(p => p.name).join(', ') : 'None'}`);
    console.log(`=============================================\n`);

    return { topScorers, topAssists, mvps, maxGoals, maxAssists, maxMvpScore };
  } catch (err) {
    console.error("Error calculating week leader stats:", err.message);
    return null;
  }
}

async function ensurePosTables() {
  try {
    const createPosSql = `
      CREATE TABLE IF NOT EXISTS pos_tbl (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(10) NOT NULL UNIQUE,
        name VARCHAR(50) NOT NULL,
        icon VARCHAR(10) DEFAULT '',
        pts_goal DECIMAL(6,2) DEFAULT 0.00,
        pts_assist DECIMAL(6,2) DEFAULT 0.00,
        pts_clean_sheet DECIMAL(6,2) DEFAULT 0.00
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await executeQuery(createPosSql);

    const createMemberPosSql = `
      CREATE TABLE IF NOT EXISTS member_pos_tbl (
        id INT AUTO_INCREMENT PRIMARY KEY,
        member_id INT NOT NULL,
        pos_id INT NOT NULL,
        is_primary TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_member_pos (member_id, pos_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await executeQuery(createMemberPosSql);

    // Seed default positions with category points if empty
    const countRes = await executeQuery("SELECT COUNT(*) as count FROM pos_tbl");
    if (countRes && countRes[0] && countRes[0].count === 0) {
      await executeQuery(`
        INSERT INTO pos_tbl (code, name, icon, pts_goal, pts_assist, pts_clean_sheet) VALUES
        ('GK', 'Goalkeeper', '🧤', 10.00, 6.00, 5.00),
        ('DF', 'Defender', '🛡️', 6.00, 4.00, 4.00),
        ('MF', 'Midfielder', '⚙️', 5.00, 3.00, 1.00),
        ('CF', 'Center Forward', '⚡', 4.00, 3.00, 0.00)
      `);
      console.log("🌱 [Seed DB] Default positions (GK, DF, MF, CF) with category points inserted into pos_tbl!");
    } else {
      // Set default points if unpopulated
      await executeQuery("UPDATE pos_tbl SET pts_goal = 10.00, pts_assist = 6.00, pts_clean_sheet = 5.00 WHERE UPPER(code) = 'GK' AND pts_goal = 0");
      await executeQuery("UPDATE pos_tbl SET pts_goal = 6.00, pts_assist = 4.00, pts_clean_sheet = 4.00 WHERE UPPER(code) = 'DF' AND pts_goal = 0");
      await executeQuery("UPDATE pos_tbl SET pts_goal = 5.00, pts_assist = 3.00, pts_clean_sheet = 1.00 WHERE UPPER(code) = 'MF' AND pts_goal = 0");
      await executeQuery("UPDATE pos_tbl SET pts_goal = 4.00, pts_assist = 3.00, pts_clean_sheet = 0.00 WHERE UPPER(code) = 'CF' AND pts_goal = 0");
    }
  } catch (err) {
    console.error("Error creating position tables:", err.message);
  }
}

async function setMemberWeekPosition(member_id, week_id, pos_code) {
  await ensurePosTables();
  try {
    let posId = 0;
    if (pos_code) {
      const posRes = await executeQuery("SELECT id FROM pos_tbl WHERE UPPER(code) = UPPER(?)", [pos_code]);
      if (posRes && posRes.length > 0) posId = posRes[0].id;
    }

    await executeQuery(
      "UPDATE member_team_week_tbl SET pos_id = ? WHERE member_id = ? AND week_id = ?",
      [posId, member_id, week_id]
    );

    return { success: true, member_id, week_id, pos_code: pos_code ? pos_code.toUpperCase() : 'DEFAULT', pos_id: posId };
  } catch (err) {
    console.error("Error setting member week position:", err.message);
    return { success: false, error: err.message };
  }
}

async function getEffectiveMemberPosition(member_id, week_id = 0) {
  await ensurePosTables();
  try {
    // 1. Check week-specific position if week_id is provided
    if (week_id > 0) {
      const mtwRes = await executeQuery(
        "SELECT pos_id FROM member_team_week_tbl WHERE member_id = ? AND week_id = ?",
        [member_id, week_id]
      );
      if (mtwRes && mtwRes.length > 0 && mtwRes[0].pos_id > 0) {
        const posRes = await executeQuery(
          "SELECT id, code, name, icon, pts_goal, pts_assist, pts_clean_sheet FROM pos_tbl WHERE id = ?",
          [mtwRes[0].pos_id]
        );
        if (posRes && posRes.length > 0) {
          return { ...posRes[0], is_custom_week: true };
        }
      }
    }

    // 2. Check default position in member_tbl.pos_id
    const mRes = await executeQuery("SELECT pos_id FROM member_tbl WHERE id = ?", [member_id]);
    if (mRes && mRes.length > 0 && mRes[0].pos_id > 0) {
      const posRes = await executeQuery(
        "SELECT id, code, name, icon, pts_goal, pts_assist, pts_clean_sheet FROM pos_tbl WHERE id = ?",
        [mRes[0].pos_id]
      );
      if (posRes && posRes.length > 0) {
        return { ...posRes[0], is_custom_week: false };
      }
    }

    // 3. Fallback to member_pos_tbl primary position
    const defRes = await executeQuery(`
      SELECT p.id, p.code, p.name, p.icon, p.pts_goal, p.pts_assist, p.pts_clean_sheet 
      FROM member_pos_tbl mp
      JOIN pos_tbl p ON mp.pos_id = p.id
      WHERE mp.member_id = ? AND mp.is_primary = 1
      LIMIT 1
    `, [member_id]);
    if (defRes && defRes.length > 0) {
      return { ...defRes[0], is_custom_week: false };
    }

    // 4. Fallback to default position (first position in pos_tbl)
    const fallbackRes = await executeQuery("SELECT id, code, name, icon, pts_goal, pts_assist, pts_clean_sheet FROM pos_tbl ORDER BY id ASC LIMIT 1");
    return fallbackRes && fallbackRes.length > 0 ? { ...fallbackRes[0], is_custom_week: false } : null;
  } catch (err) {
    console.error("Error getting effective position:", err.message);
    return null;
  }
}

async function updatePositionPoints(pos_code, pts_goal = 0, pts_assist = 0, pts_clean_sheet = 0) {
  await ensurePosTables();
  try {
    const sql = `
      UPDATE pos_tbl 
      SET pts_goal = ?, pts_assist = ?, pts_clean_sheet = ? 
      WHERE UPPER(code) = UPPER(?)
    `;
    await executeQuery(sql, [pts_goal, pts_assist, pts_clean_sheet, pos_code]);
    return { success: true, pos_code: pos_code.toUpperCase(), pts_goal, pts_assist, pts_clean_sheet };
  } catch (err) {
    console.error("Error updating position points:", err.message);
    return { success: false, error: err.message };
  }
}

async function getAllPositions() {
  await ensurePosTables();
  try {
    return await executeQuery("SELECT * FROM pos_tbl ORDER BY id ASC");
  } catch (err) {
    console.error("Error fetching positions:", err.message);
    return [];
  }
}

async function getMemberPositions(member_id) {
  await ensurePosTables();
  try {
    const sql = `
      SELECT p.id, p.code, p.name, p.icon, mp.is_primary
      FROM member_pos_tbl mp
      JOIN pos_tbl p ON mp.pos_id = p.id
      WHERE mp.member_id = ?
      ORDER BY mp.is_primary DESC, p.id ASC
    `;
    return await executeQuery(sql, [member_id]);
  } catch (err) {
    console.error("Error fetching member positions:", err.message);
    return [];
  }
}

async function setMemberPosition(member_id, pos_code, is_primary = 1) {
  await ensurePosTables();
  try {
    const posRes = await executeQuery("SELECT id FROM pos_tbl WHERE UPPER(code) = UPPER(?)", [pos_code]);
    if (!posRes || posRes.length === 0) return { success: false, message: `Unknown position code: ${pos_code}` };
    const posId = posRes[0].id;

    if (is_primary) {
      await executeQuery("UPDATE member_pos_tbl SET is_primary = 0 WHERE member_id = ?", [member_id]);
    }

    await executeQuery(`
      INSERT INTO member_pos_tbl (member_id, pos_id, is_primary)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE is_primary = VALUES(is_primary)
    `, [member_id, posId, is_primary ? 1 : 0]);

    return { success: true, member_id, pos_code: pos_code.toUpperCase(), pos_id: posId };
  } catch (err) {
    console.error("Error setting member position:", err.message);
    return { success: false, error: err.message };
  }
}

function isTempReserveMember(name) {
  if (!name) return true;
  const n = String(name).trim().toLowerCase();
  return n.startsWith('@team') || n.startsWith('+team') || /^@?\+?team\d+/i.test(n);
}

async function ensureMvpWeekTable() {
  try {
    const createSql = `
      CREATE TABLE IF NOT EXISTS mvp_week_tbl (
        id INT AUTO_INCREMENT PRIMARY KEY,
        week_id INT NOT NULL,
        member_id INT DEFAULT 0,
        member_name VARCHAR(255) DEFAULT '',
        goals INT DEFAULT 0,
        assists INT DEFAULT 0,
        clean_sheet INT DEFAULT 0,
        raw_score DECIMAL(10,4) DEFAULT 0.0000,
        rating DECIMAL(4,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_week_member (week_id, member_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await executeQuery(createSql);
    // Cleanup temporary reserve slot records (@team1+1, @team1+7, +team1+2, etc.)
    try {
      await executeQuery("DELETE FROM mvp_week_tbl WHERE member_name LIKE '@team%' OR member_name LIKE 'team%' OR member_name LIKE '+team%'");
    } catch (e) {}
  } catch (err) {
    console.error("Error creating mvp_week_tbl table:", err.message);
  }
}

async function saveWeekMvpRecords(week_id, mvpList) {
  await ensureMvpWeekTable();
  if (!mvpList || mvpList.length === 0) return;

  for (const item of mvpList) {
    const memId = item.id || item.member_id || 0;
    const name = item.name || '';
    const g = Number(item.goals) || 0;
    const a = Number(item.assists) || 0;
    const cs = Number(item.cleanSheets !== undefined ? item.cleanSheets : (item.clean_sheet || 0)) || 0;
    const raw = parseFloat(item.rawScore || item.score || 0);
    const rat = parseFloat(item.score || 0);

    await executeQuery(`
      INSERT INTO mvp_week_tbl (week_id, member_id, member_name, goals, assists, clean_sheet, raw_score, rating)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        member_name = VALUES(member_name),
        goals = VALUES(goals),
        assists = VALUES(assists),
        clean_sheet = VALUES(clean_sheet),
        raw_score = VALUES(raw_score),
        rating = VALUES(rating)
    `, [week_id, memId, name, g, a, cs, raw, rat]);
  }
}

async function calculateWeekRawMvp(week_id) {
  const goalsQuery = `
    SELECT 
      mgt.member_id, 
      m.name, 
      m.pos_id as member_pos_id,
      mtw.team_id,
      mtw.pos_id as week_pos_id,
      SUM(CASE WHEN mgt.status <= 2 THEN 1 ELSE 0 END) as goals,
      SUM(CASE WHEN mgt.status = 3 THEN 1 ELSE 0 END) as assists
    FROM match_goal_tbl mgt
    JOIN match_stat_tbl mst ON mgt.match_id = mst.id
    JOIN member_tbl m ON mgt.member_id = m.id
    LEFT JOIN member_team_week_tbl mtw ON mtw.member_id = m.id AND mtw.week_id = mst.week_id
    WHERE mst.week_id = ?
    GROUP BY mgt.member_id, m.name, m.pos_id, mtw.team_id, mtw.pos_id
  `;
  const goalRes = await executeQuery(goalsQuery, [week_id]);
  if (!goalRes || goalRes.length === 0) return [];

  const tableRows = await queryTableWeek(week_id);
  if (!tableRows || tableRows.length === 0) return [];

  const teamGaMap = {};
  const teamCleanSheetsMap = {};
  const teamWinsMap = {};
  const matchScores = await executeQuery(
    "SELECT team_a_id, team_b_id, team_a_goal, team_b_goal FROM match_stat_tbl WHERE week_id = ?",
    [week_id]
  );
  if (matchScores && matchScores.length > 0) {
    matchScores.forEach(m => {
      const gaA = Number(m.team_b_goal) || 0;
      const gaB = Number(m.team_a_goal) || 0;
      const gA = Number(m.team_a_goal) || 0;
      const gB = Number(m.team_b_goal) || 0;

      if (m.team_a_id) {
        teamGaMap[m.team_a_id] = (teamGaMap[m.team_a_id] || 0) + gaA;
        if (gaA === 0) teamCleanSheetsMap[m.team_a_id] = (teamCleanSheetsMap[m.team_a_id] || 0) + 1;
        if (gA > gB) teamWinsMap[m.team_a_id] = (teamWinsMap[m.team_a_id] || 0) + 1;
      }
      if (m.team_b_id) {
        teamGaMap[m.team_b_id] = (teamGaMap[m.team_b_id] || 0) + gaB;
        if (gaB === 0) teamCleanSheetsMap[m.team_b_id] = (teamCleanSheetsMap[m.team_b_id] || 0) + 1;
        if (gB > gA) teamWinsMap[m.team_b_id] = (teamWinsMap[m.team_b_id] || 0) + 1;
      }
    });
  }

  await ensurePosTables();
  const allPositions = await getAllPositions();
  const posMap = {};
  allPositions.forEach(p => { posMap[p.id] = p; });
  const defaultPos = allPositions.find(p => p.code === 'CF') || allPositions[0] || { code: 'CF', icon: '⚡', pts_goal: 4, pts_assist: 3, pts_clean_sheet: 0 };

  const teamMvpFactorMap = {};
  const teamDetailsMap = {};
  tableRows.forEach(row => {
    const teamId = row.team_week_id;
    const w = Number(row.w !== undefined ? row.w : (row.W || 0));
    if (w > 0) teamWinsMap[teamId] = w;
    const d = Number(row.d !== undefined ? row.d : (row.D || 0));
    const l = Number(row.l !== undefined ? row.l : (row.L || 0));
    const totalMatches = w + d + l;
    const pts = Number(row.pts !== undefined ? row.pts : (row.PTS || 0));

    const avgPts = totalMatches > 0 ? (pts / totalMatches) : pts;
    const goalsConceded = Number(row.A !== undefined ? row.A : (row.a || 0));
    const goalsAgainst = (teamGaMap[teamId] !== undefined && teamGaMap[teamId] > 0) ? teamGaMap[teamId] : goalsConceded;
    const divisor = goalsAgainst > 0 ? goalsAgainst : 1;
    const factor = avgPts / divisor;

    teamMvpFactorMap[teamId] = factor;
    teamDetailsMap[teamId] = {
      teamName: row.color || `ID ${teamId}`,
      w,
      d,
      l,
      matches: totalMatches,
      pts,
      avgPts,
      goalsAgainst,
      factor
    };
  });

  return goalRes.map(m => {
    if (isTempReserveMember(m.name)) return null;

    const g = Number(m.goals) || 0;
    const a = Number(m.assists) || 0;
    const teamId = Number(m.team_id) || 0;

    const cleanSheets = teamCleanSheetsMap[teamId] || 0;
    const wins = teamWinsMap[teamId] || 0;

    let pos = defaultPos;
    if (m.week_pos_id > 0 && posMap[m.week_pos_id]) {
      pos = posMap[m.week_pos_id];
    } else if (m.member_pos_id > 0 && posMap[m.member_pos_id]) {
      pos = posMap[m.member_pos_id];
    }

    const ptsGoal = parseFloat(pos.pts_goal) || 4.0;
    const ptsAssist = parseFloat(pos.pts_assist) || 3.0;
    const ptsCleanSheet = parseFloat(pos.pts_clean_sheet) || 0.0;

    // Raw MVP score = (Goals * ptsGoal) + (Assists * ptsAssist) + (CleanSheets * ptsCleanSheet) + (Wins * 1.5)
    const rawScore = (g * ptsGoal) + (a * ptsAssist) + (cleanSheets * ptsCleanSheet) + (wins * 1.5);
    const td = teamDetailsMap[teamId] || { teamName: '?', w: 0, d: 0, l: 0, matches: 1, pts: 0, avgPts: 0, goalsAgainst: 0, factor: 1 };

    return {
      week_id,
      member_id: m.member_id,
      name: m.name,
      goals: g,
      assists: a,
      cleanSheets,
      wins,
      posCode: pos.code,
      posIcon: pos.icon || '',
      ptsGoal,
      ptsAssist,
      ptsCleanSheet,
      rawScore,
      teamName: td.teamName
    };
  }).filter(p => p !== null && p.rawScore > 0);
}

async function calcAndSaveMaxMvpScore(options = {}) {
  try {
    await ensureMvpWeekTable();

    // Handle options object or legacy number limit
    let year = null;
    let reset = false;

    if (typeof options === 'object' && options !== null) {
      year = options.year || null;
      reset = !!options.reset;
    } else if (typeof options === 'number') {
      year = null;
      reset = false;
    }

    if (reset) {
      if (year) {
        await executeQuery(
          "DELETE m FROM mvp_week_tbl m JOIN week_tbl w ON m.week_id = w.id WHERE YEAR(w.date) = ?",
          [year]
        );
        console.log(`[MVP Sync] Force reset mvp_week_tbl records for year ${year}`);
      } else {
        await executeQuery("TRUNCATE TABLE mvp_week_tbl");
        console.log(`[MVP Sync] Force reset all mvp_week_tbl records`);
      }
    }

    let weekSql = "SELECT id, date FROM week_tbl";
    let weekParams = [];
    if (year) {
      weekSql += " WHERE YEAR(date) = ?";
      weekParams.push(year);
    }
    weekSql += " ORDER BY date DESC";

    const weeks = await executeQuery(weekSql, weekParams);
    if (!weeks || weeks.length === 0) {
      return { maxRawScore: 0, topPerformances: [], weeksChecked: 0, newInserted: 0, skipped: 0, year };
    }

    // Query list of week_ids already in mvp_week_tbl to skip existing
    const existingWeeksRes = await executeQuery("SELECT DISTINCT week_id FROM mvp_week_tbl");
    const existingWeekIds = new Set((existingWeeksRes || []).map(r => r.week_id));

    console.log(`\n======================================================`);
    console.log(`🚀 [MVP Sync Started] Total Weeks: ${weeks.length} | Year Filter: ${year || 'ALL'} | Reset Mode: ${reset}`);
    console.log(`======================================================`);

    let skippedCount = 0;
    let newInsertedCount = 0;
    let currIdx = 0;

    for (const w of weeks) {
      currIdx++;
      const dateStr = await getFormatDate(new Date(w.date), 'short');

      if (!reset && existingWeekIds.has(w.id)) {
        skippedCount++;
        console.log(` ⏩ [${currIdx}/${weeks.length}] Week ID ${w.id} (${dateStr}) -> Already synced in mvp_week_tbl (Skipped)`);
        continue;
      }

      console.log(` ⚙️ [${currIdx}/${weeks.length}] Processing Week ID ${w.id} (${dateStr})...`);
      const playerScores = await calculateWeekRawMvp(w.id);
      if (playerScores && playerScores.length > 0) {
        playerScores.sort((a, b) => b.rawScore - a.rawScore);
        const maxRawForWeek = playerScores[0].rawScore;
        const weekWinners = playerScores.filter(p => p.rawScore === maxRawForWeek);
        await saveWeekMvpRecords(w.id, weekWinners);
        newInsertedCount++;
        console.log(`    ✅ Synced ${weekWinners.length} MVP winner(s) for Week ID ${w.id} (Top Raw Score: ${maxRawForWeek.toFixed(4)})`);
      } else {
        console.log(`    ⚠️ No valid team members (team_id > 0) scored in Week ID ${w.id}`);
      }
    }

    // Query max raw score from mvp_week_tbl
    let maxSql = "SELECT MAX(m.raw_score) as max_raw FROM mvp_week_tbl m";
    let maxParams = [];
    if (year) {
      maxSql += " JOIN week_tbl w ON m.week_id = w.id WHERE YEAR(w.date) = ?";
      maxParams.push(year);
    }
    const maxDbRes = await executeQuery(maxSql, maxParams);
    const maxRawScore = (maxDbRes && maxDbRes[0] && maxDbRes[0].max_raw) ? parseFloat(maxDbRes[0].max_raw) : 0;

    if (maxRawScore > 0) {
      const existing = await executeQuery("SELECT id FROM template_tpl WHERE name = 'max_mvp_score'");
      if (existing && existing.length > 0) {
        await executeQuery("UPDATE template_tpl SET value = ? WHERE name = 'max_mvp_score'", [maxRawScore.toFixed(4)]);
      } else {
        await executeQuery("INSERT INTO template_tpl (name, value) VALUES ('max_mvp_score', ?)", [maxRawScore.toFixed(4)]);
      }
    }

    let topSql = `
      SELECT m.*, w.date 
      FROM mvp_week_tbl m
      LEFT JOIN week_tbl w ON m.week_id = w.id
    `;
    let topParams = [];
    if (year) {
      topSql += " WHERE YEAR(w.date) = ?";
      topParams.push(year);
    }
    topSql += " ORDER BY m.raw_score DESC LIMIT 5";

    const topDbPerformances = await executeQuery(topSql, topParams);

    let topPerformances = [];
    if (topDbPerformances && topDbPerformances.length > 0) {
      for (const p of topDbPerformances) {
        const dateStr = p.date ? await getFormatDate(new Date(p.date), 'short') : '';
        topPerformances.push({
          week_id: p.week_id,
          member_id: p.member_id,
          name: p.member_name,
          goals: p.goals,
          assists: p.assists,
          cleanSheets: Number(p.clean_sheet) || 0,
          rawScore: parseFloat(p.raw_score),
          score: parseFloat(p.rating),
          dateStr
        });
      }
    }

    console.log(`\n======================================================`);
    console.log(`🏆 ALL-TIME TOP 5 RAW MVP SCORES (CHECKED ${weeks.length} WEEKS - NEW: ${newInsertedCount}, SKIPPED: ${skippedCount}, YEAR: ${year || 'ALL'})`);
    console.log(`======================================================`);
    topPerformances.forEach((p, i) => {
      const rating = maxRawScore > 0 ? Math.min(10.0, (p.rawScore / maxRawScore) * 10).toFixed(1) : '0.0';
      console.log(`#${i + 1} ${p.name} (${p.dateStr}) [Week ID: ${p.week_id}]`);
      console.log(`   └─ Player Stats: Goals (G): ${p.goals}, Assists (A): ${p.assists}, CleanSheets: ${p.cleanSheets}`);
      console.log(`   └─ Raw MVP Score: ${p.rawScore.toFixed(4)}`);
      console.log(`   => Normalized 1-10 Rating = ${rating} / 10\n`);
    });
    console.log(`📌 Benchmark Max Raw Score Saved to DB (10.00 Ref): ${maxRawScore.toFixed(4)}`);
    console.log(`======================================================\n`);

    return { maxRawScore, topPerformances, weeksChecked: weeks.length, newInserted: newInsertedCount, skipped: skippedCount, year };
  } catch (err) {
    console.error("Error calculating max MVP score across weeks:", err.message);
    return { maxRawScore: 0, topPerformances: [], weeksChecked: 0, newInserted: 0, skipped: 0, year: null, error: err.message };
  }
}

async function getMatchWeek(week_id = 0, groupId = null) {

  const res = await queryWeekID(week_id);
  if (res && res.length > 0) {
    if (week_id == 0) {
      week_id = res[0].id;
    }
    const matches = await queryMatchWeek(week_id);
    if (matches && matches.length > 0) {
      const assets = await fetchDisplayAssets();
      const theme = await getTheme();
      const colors = flex.getThemeColors(theme, assets.teamColors);
      const imgTpl = await getTemplate('matchweek', 'header');
      let headerUrl = imgTpl && imgTpl.url ? imgTpl.url.trim() : null;
      if (headerUrl && headerUrl.toLowerCase() !== 'none' && headerUrl.length > 0) {
        if (!headerUrl.startsWith('http://') && !headerUrl.startsWith('https://')) {
          const baseUrl = global.baseWebhookUrl || "https://api.revemu.org";
          headerUrl = headerUrl.startsWith('/') ? `${baseUrl}${headerUrl}` : `${baseUrl}/${headerUrl}`;
        }
        if (headerUrl.startsWith('http://')) {
          headerUrl = headerUrl.replace('http://', 'https://');
        }
        try {
          headerUrl = encodeURI(headerUrl);
        } catch (e) { }
      } else {
        headerUrl = null;
      }

      const date = new Date(res[0].date);
      const date_str = await getFormatDate(date);
      let team_colors = await getTeamColorWeek(week_id);

      // ── 1. Build Standings Table Bubble (Bubble 1) ──
      const tableRows = await queryTableWeek(week_id);
      const tableBodyContents = [];

      tableBodyContents.push({
        type: 'box',
        layout: 'vertical',
        backgroundColor: colors.bgRound,
        paddingAll: 'md',
        cornerRadius: 'md',
        contents: [
          {
            type: 'text',
            text: '📊 ตารางคะแนน',
            weight: 'bold',
            size: 'lg',
            color: colors.textPrimary,
            align: 'center'
          },
          {
            type: 'text',
            text: `เสาร์ที่ ${date_str || ''}`,
            size: 'sm',
            color: colors.textMuted,
            align: 'center',
            margin: 'xs'
          }
        ]
      });

      if (tableRows && tableRows.length > 0) {
        tableBodyContents.push({
          type: 'box',
          layout: 'horizontal',
          margin: 'md',
          paddingStart: 'xs',
          paddingEnd: 'xs',
          contents: [
            { type: 'text', text: 'ทีม', size: 'xs', weight: 'bold', color: colors.textMuted, flex: 4 },
            { type: 'text', text: 'W', size: 'xs', weight: 'bold', color: colors.textMuted, flex: 1, align: 'center' },
            { type: 'text', text: 'D', size: 'xs', weight: 'bold', color: colors.textMuted, flex: 1, align: 'center' },
            { type: 'text', text: 'L', size: 'xs', weight: 'bold', color: colors.textMuted, flex: 1, align: 'center' },
            { type: 'text', text: 'GD', size: 'xs', weight: 'bold', color: colors.textMuted, flex: 1, align: 'center' },
            { type: 'text', text: 'PTS', size: 'xs', weight: 'bold', color: colors.textMuted, flex: 1, align: 'center' }
          ]
        });

        tableBodyContents.push({ type: 'separator', margin: 'xs', color: colors.separator });

        const medals = ['🥇', '🥈', '🥉', '4️⃣'];
        tableRows.forEach((row, i) => {
          const gd = (row.G || 0) - (row.A || 0);
          const gdStr = gd > 0 ? `+${gd}` : `${gd}`;
          tableBodyContents.push({
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            paddingStart: 'xs',
            paddingEnd: 'xs',
            alignItems: 'center',
            contents: [
              { type: 'text', text: `${medals[i] || (i + 1 + '.')} ${row.color || ''}`, size: 'sm', color: colors.tdc(row.color), flex: 4, weight: i === 0 ? 'bold' : 'regular' },
              { type: 'text', text: `${row.w ?? 0}`, size: 'sm', color: colors.textMutedLight, flex: 1, align: 'center' },
              { type: 'text', text: `${row.d ?? 0}`, size: 'sm', color: colors.textMutedLight, flex: 1, align: 'center' },
              { type: 'text', text: `${row.l ?? 0}`, size: 'sm', color: colors.textMutedLight, flex: 1, align: 'center' },
              { type: 'text', text: gdStr, size: 'sm', color: gd >= 0 ? (colors.name === 'white' ? '#15803d' : '#88ff88') : (colors.name === 'white' ? '#dc2626' : '#ff8888'), flex: 1, align: 'center' },
              { type: 'text', text: `${row.pts ?? 0}`, size: 'sm', color: colors.textPrimary, flex: 1, align: 'center', weight: 'bold' }
            ]
          });
        });
      }

      // ── Weekly Leaders (Top Scorer, Top Assist, MVP with Avatars & HOF) ──
      const leaders = await getWeekLeaderStats(week_id, groupId);
      if (leaders && ((leaders.topScorers && leaders.topScorers.length > 0) || (leaders.topAssists && leaders.topAssists.length > 0) || (leaders.mvps && leaders.mvps.length > 0))) {
        const leaderCards = [];

        const buildLeaderCategoryCard = (icon, titleText, leaderList, valueText) => {
          if (!leaderList || leaderList.length === 0) return null;
          const memberCols = leaderList.map(leaderObj => flex.makeMemberColumn(leaderObj.info, null, colors, false));

          return {
            type: 'box',
            layout: 'vertical',
            backgroundColor: colors.bgMain,
            borderColor: colors.borderCurrent || colors.separator,
            borderWidth: 'normal',
            cornerRadius: 'md',
            paddingAll: 'sm',
            margin: 'xs',
            spacing: 'xs',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                alignItems: 'center',
                contents: [
                  { type: 'text', text: `${icon} ${titleText}`, size: 'xs', weight: 'bold', color: colors.textMuted, flex: 1 },
                  { type: 'text', text: valueText, size: 'xs', weight: 'bold', color: colors.textAccent, align: 'end', flex: 1 }
                ]
              },
              { type: 'separator', margin: 'xs', color: colors.separator },
              ...memberCols.map(col => ({
                type: 'box',
                layout: 'horizontal',
                margin: 'xs',
                alignItems: 'center',
                contents: [col]
              }))
            ]
          };
        };

        if (leaders.topScorers && leaders.topScorers.length > 0) {
          const b = buildLeaderCategoryCard('⚽', 'ดาวซัลโว', leaders.topScorers, `${leaders.maxGoals} ประตู`);
          if (b) leaderCards.push(b);
        }
        if (leaders.topAssists && leaders.topAssists.length > 0) {
          const b = buildLeaderCategoryCard('👟', 'แอสซิสต์สูงสุด', leaders.topAssists, `${leaders.maxAssists} แอสซิสต์`);
          if (b) leaderCards.push(b);
        }
        if (leaders.mvps && leaders.mvps.length > 0) {
          const b = buildLeaderCategoryCard('👑', 'MVP', leaders.mvps, `${leaders.maxMvpScore.toFixed(1)} คะแนน`);
          if (b) leaderCards.push(b);
        }

        if (leaderCards.length > 0) {
          tableBodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
          tableBodyContents.push({
            type: 'box',
            layout: 'vertical',
            backgroundColor: colors.bgRound,
            paddingAll: 'sm',
            cornerRadius: 'md',
            margin: 'sm',
            spacing: 'xs',
            contents: [
              {
                type: 'text',
                text: '🏆 ทำเนียบยอดเยี่ยมประจำสัปดาห์',
                size: 'xs',
                weight: 'bold',
                color: colors.textPrimary,
                align: 'center',
                margin: 'xs'
              },
              ...leaderCards
            ]
          });
        }
      }

      // Compact Match Summary below table in Bubble 1
      if (matches && matches.length > 0) {
        tableBodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
        tableBodyContents.push({
          type: 'text',
          text: '⚽ สรุปผลการแข่งขันประจำสัปดาห์',
          size: 'xs',
          weight: 'bold',
          color: colors.textPrimary,
          margin: 'sm'
        });

        matches.forEach(m => {
          const team_a = team_colors.find(t => t.id === m.team_a_id);
          const team_b = team_colors.find(t => t.id === m.team_b_id);
          tableBodyContents.push({
            type: 'box',
            layout: 'horizontal',
            margin: 'xs',
            alignItems: 'center',
            contents: [
              { type: 'text', text: `[${m.match_num ?? '?'}]`, size: 'xs', color: colors.textMuted, flex: 1 },
              { type: 'text', text: team_a ? team_a.color : '?', size: 'xs', color: team_a ? colors.tdc(team_a.color) : colors.textPrimary, flex: 3, align: 'end' },
              { type: 'text', text: `${m.team_a_goal ?? 0} - ${m.team_b_goal ?? 0}`, size: 'xs', color: colors.textAccent, weight: 'bold', flex: 2, align: 'center' },
              { type: 'text', text: team_b ? team_b.color : '?', size: 'xs', color: team_b ? colors.tdc(team_b.color) : colors.textPrimary, flex: 3, align: 'start' }
            ]
          });
        });
      }

      const tableBubble = {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: colors.bgMain,
          paddingAll: 'sm',
          contents: tableBodyContents
        }
      };

      if (headerUrl && headerUrl.trim() !== '') {
        tableBubble.header = {
          type: 'box',
          layout: 'vertical',
          backgroundColor: colors.bgHeader,
          paddingAll: 'none',
          contents: [
            { type: 'image', url: headerUrl, size: 'full', aspectRatio: '20:7', aspectMode: 'cover' }
          ]
        };
      }

      // ── 2. Build Match Detail Bubbles (Up to 12 matches per bubble) ──
      const matchBubbles = [];
      const chunkSize = 12;

      for (let i = 0; i < matches.length; i += chunkSize) {
        const matchChunk = matches.slice(i, i + chunkSize);
        const startNum = matchChunk[0].match_num ?? (i + 1);
        const endNum = matchChunk[matchChunk.length - 1].match_num ?? (i + matchChunk.length);

        const matchBodyContents = [];

        matchBodyContents.push({
          type: 'box',
          layout: 'vertical',
          backgroundColor: colors.bgRound,
          paddingAll: 'md',
          cornerRadius: 'md',
          contents: [
            {
              type: 'text',
              text: matches.length > chunkSize ? `⚽ รายละเอียดแมตช์ [${startNum} - ${endNum}]` : '⚽ รายละเอียดการแข่งขัน',
              weight: 'bold',
              size: 'lg',
              color: colors.textPrimary,
              align: 'center'
            },
            {
              type: 'text',
              text: `เสาร์ที่ ${date_str || ''}`,
              size: 'sm',
              color: colors.textMuted,
              align: 'center',
              margin: 'xs'
            }
          ]
        });

        for (const match of matchChunk) {
          const team_a = team_colors.filter(t => t.id === match.team_a_id)[0];
          const team_b = team_colors.filter(t => t.id === match.team_b_id)[0];

          const goalBox = await queryMatchGoal(match.id, 0, groupId);
          const assistBox = await queryMatchGoal(match.id, 3, groupId);

          const cardContents = [
            {
              type: 'box',
              layout: 'horizontal',
              alignItems: 'center',
              margin: 'xs',
              contents: [
                { type: 'text', text: `[${match.match_num ?? '?'}]`, size: 'xs', color: colors.textMuted, flex: 1, align: 'start' },
                { type: 'text', text: team_a && team_a.color ? team_a.color : '?', size: 'md', weight: 'bold', color: team_a ? colors.tdc(team_a.color) : colors.textPrimary, flex: 3, align: 'end' },
                { type: 'text', text: `${match.team_a_goal ?? 0} - ${match.team_b_goal ?? 0}`, size: 'md', weight: 'bold', color: colors.textAccent, flex: 2, align: 'center' },
                { type: 'text', text: team_b && team_b.color ? team_b.color : '?', size: 'md', weight: 'bold', color: team_b ? colors.tdc(team_b.color) : colors.textPrimary, flex: 3, align: 'start' }
              ]
            }
          ];

          if (goalBox) cardContents.push(goalBox);
          if (assistBox) cardContents.push(assistBox);

          matchBodyContents.push({
            type: 'box',
            layout: 'vertical',
            backgroundColor: colors.bgRound,
            paddingAll: 'sm',
            cornerRadius: 'md',
            margin: 'sm',
            contents: cardContents
          });
        }

        const chunkBubble = {
          type: 'bubble',
          size: 'mega',
          body: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: colors.bgMain,
            paddingAll: 'sm',
            contents: matchBodyContents
          }
        };

        if (headerUrl && headerUrl.trim() !== '') {
          chunkBubble.header = {
            type: 'box',
            layout: 'vertical',
            backgroundColor: colors.bgHeader,
            paddingAll: 'none',
            contents: [
              { type: 'image', url: headerUrl, size: 'full', aspectRatio: '20:7', aspectMode: 'cover' }
            ]
          };
        }

        matchBubbles.push(chunkBubble);
      }

      return {
        type: 'carousel',
        contents: [
          tableBubble,
          ...matchBubbles
        ]
      };

      return bubble;
    }


  }
}


// Maps team color name → a readable display color on dark backgrounds
function teamDisplayColor(colorName, code) {
  const n = (colorName || '').toLowerCase();
  if (n === 'black') return '#999999';
  if (n === 'white') return '#ffffff';
  if (n === 'red') return '#ff5566';
  if (n === 'green') return '#44cc66';
  if (!code || code.length < 7) return '#ffffff';
  const r = parseInt(code.slice(1, 3), 16);
  const g = parseInt(code.slice(3, 5), 16);
  const b = parseInt(code.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.40 ? '#ffffff' : code;
}

async function getTeamWeek(week_id = 0, groupId = null) {

  let query = "";
  let res;

  res = await queryWeekID(week_id);

  if (res.length > 0) {
    if (week_id == 0) {
      week_id = res[0].id;
    }

    const team_colors = await getTeamColorWeek(week_id);
    const date = new Date(res[0].date);
    const date_str = await getFormatDate(date);

    if (team_colors.length > 0) {
      const theme = await getTheme();
      const assets = await fetchDisplayAssets();
      const teamMembersMap = {};

      for (const team of team_colors) {
        team.teamColor = await getTeamColor(team.color);
        query = `select member_team_week_tbl.*, member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id from member_team_week_tbl left join member_tbl on member_team_week_tbl.member_id = member_tbl.id where member_team_week_tbl.week_id=${week_id} and member_team_week_tbl.team_id=${team.id}`;
        //console.log(query);
        const team_members = await executeQuery(query);
        if (team_members.length > 0) {
          await Promise.all(team_members.map(member => ensureMemberPicture(member, groupId)));
        }
        teamMembersMap[team.id] = team_members;
      }

      return flex.buildTeamWeekFlex(team_colors, teamMembersMap, theme, assets, resolveMemberDisplayInfo);
    }

  }

}

async function getDonateBadge(donate = 0) {
  if (donate < 100) {
    return "";
  } else if (donate > 599) {
    return "👑";
  } else if (donate > 499) {
    return "👑";
  } else if (donate > 299) {
    return "⭐";
  } else if (donate > 199) {
    return "✨";
  } else if (donate > 99) {
    return "🎗️";
  }

}

async function getMemberNY() {
  let header = "";
  let body = "";
  let query = "";

  query = `SELECT * from member_tbl where fav_team_id = 1`;
  header = "ประกาศจัดงานเลี้ยงปีใหม่นะครับ \nวันเสาร์ที่ 20 ธันวาคม เวลา 19.00-24.00 น. หลังจากเตะบอล 17.00-19.00 น. นะครับ\nสถานที่: มูนเทอร์เรซ ห้อง M5 นะครับ \nขอเรียนเชิญทุกท่านที่มาร่วมงานลงชื่อด้วยนะครับ\n\n";


  const result = await executeQuery(query);
  if (result.length > 0) {

    let i = 0;
    for (const member of result) {

      let donate = await getDonateBadge(member.donate);
      //console.log((i+1) + ". " + donate + member.name) ;
      body += (i + 1) + ". " + donate + member.name + "\n";
      i++;
    }
    let str = header + `+${i} พิมพ์ x1 เพื่อลงชื่อครับ\n` + body;
    //header = `+${i} พิมพ์ x1 เพื่อลงชื่อครับ` ;
    //str = `${header} ${str}` ;
    //console.log(str) ;
    return str;
  } else {
    return header;
  }

}

async function getAutoRegCount(groupId = null) {
  try {
    await ensureAutoRegTable();
    let query = `
      SELECT COUNT(DISTINCT m.id) as count 
      FROM member_tbl m 
      LEFT JOIN autoreg_tbl a ON m.id = a.member_id 
      WHERE (m.auto_reg = 1 OR a.status = 1)
    `;
    const params = [];
    if (groupId) {
      query += " AND (a.group_id IS NULL OR a.group_id = '' OR a.group_id = ?)";
      params.push(groupId);
    }
    const autoRegRes = await executeQuery(query, params);
    return autoRegRes.length > 0 ? autoRegRes[0].count : 0;
  } catch (err) {
    console.error("Error getting autoRegCount:", err.message);
    return 0;
  }
}

async function fetchLineProfile(lineUserId, groupId = null) {
  return await lineClient.fetchUserProfile(lineUserId, groupId);
}

async function updateMemberPictureUrl(memberId, pictureUrl) {
  const query = "update member_tbl set picture_url = ? where id = ?";
  return await executeQuery(query, [pictureUrl, memberId]);
}

async function getMemberWeek0(type = 0, isFlex = true, groupId = null, highlightMemberId = null) {
  let header = "";
  let body = "";
  let sub = {};
  let query = "";
  let start = "";
  const res = await queryWeekID();

  if (res.length > 0) {
    const week_id = res[0].id;
    await addTeamColorWeek(3, week_id);
    const max_players = res[0].max;
    const date = new Date(res[0].date);
    const time_range = res[0].time_range || '17:30-20:00';

    query = `SELECT member_tbl.name, member_tbl.alias, member_tbl.rank, member_team_week_tbl.team_id, member_team_week_tbl.team, member_team_week_tbl.pay, member_tbl.fav_team_id, member_tbl.id, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id, fav_team_tbl.url FROM member_team_week_tbl INNER JOIN member_tbl ON member_tbl.id = member_team_week_tbl.member_id LEFT JOIN fav_team_tbl ON member_tbl.fav_team_id=fav_team_tbl.id where member_team_week_tbl.week_id = ${week_id}`;
    if (type == 0) {
      header = "คนที่ยังไมได้จ่ายค่าสนาม";
      query += " and pay=0";
    } else if (type == 1) {
      header = "ลงชื่อเตะบอล";
      start = "+";
    }

    const result = await executeQuery(query);
    if (result.length > 0) {
      if (isFlex) {
        const players = [];
        const reserves = [];
        const goalies = [];
        const dateStr = await getFormatDate(date, 'short');
        const titleText = type === 0 ? "สมาชิกที่ยังไม่จ่ายค่าสนาม" : "ลงชื่อ";

        const assets = await fetchDisplayAssets();

        await Promise.all(result.map(member => ensureMemberPicture(member, groupId)));

        for (const member of result) {
          const info = resolveMemberDisplayInfo(member, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
          const name_display = info.name;
          const badgeUrl = info.badgeUrl;
          const badgeSize = info.badgeSize;
          const nameColor = info.nameColor;
          const hofCount = info.hofCount;
          const hofBadgeUrl = info.hofBadgeUrl;
          const hofBadgeSize = info.hofBadgeSize;
          const donate = '';
          const isCurrent = highlightMemberId ? (
            String(member.id) === String(highlightMemberId) ||
            String(member.member_id) === String(highlightMemberId) ||
            String(member.line_user_id) === String(highlightMemberId)
          ) : false;

          if (type == 1) {
            if (member.team_id == 100) {
              goalies.push({ name: name_display, donate, badgeUrl, badgeSize, nameColor, hofCount, hofBadgeUrl, hofBadgeSize, hofBadges: info.hofBadges, pictureUrl: info.pictureUrl, isCurrent });
            } else {
              if (players.length < max_players) {
                players.push({ name: name_display, donate, badgeUrl, badgeSize, nameColor, hofCount, hofBadgeUrl, hofBadgeSize, hofBadges: info.hofBadges, pictureUrl: info.pictureUrl, isCurrent });
              } else {
                reserves.push({ name: name_display, donate, badgeUrl, badgeSize, nameColor, hofCount, hofBadgeUrl, hofBadgeSize, hofBadges: info.hofBadges, pictureUrl: info.pictureUrl, isCurrent });
              }
            }
          } else {
            players.push({ name: name_display, donate, badgeUrl, badgeSize, nameColor, hofCount, hofBadgeUrl, hofBadgeSize, hofBadges: info.hofBadges, pictureUrl: info.pictureUrl, isCurrent });
          }
        }

        const imgTpl = await getTemplate('register', 'header');
        const imageUrl = imgTpl ? imgTpl.url : null;

        const theme = await getTheme();
        const autoRegCount = await getAutoRegCount(groupId);

        const flexJson = flex.buildMemberWeekFlex(titleText, dateStr, max_players, players, reserves, goalies, imageUrl, theme, autoRegCount, time_range);
        let altHeader = `+${players.length}`;
        if (reserves.length > 0) altHeader += `(${reserves.length})`;
        if (goalies.length > 0) altHeader += `(${goalies.length})`;
        const altText = `${altHeader} ${titleText} เสาร์ที่ ${dateStr} @ ${time_range} น.`;
        return [flexJson, sub, altText];
      }

      header = `${header} เสาร์ที่ ${await getFormatDate(date, 'short')}\n\n`;
      let i = 0;
      let player = 0;
      let reserve = 0;
      let reserve_str = "\n=== รายชื่อสำรอง ===\n";
      let goal = 0;
      let goal_str = "\n=== รายชื่อโกล์ ===\n";
      for (const member of result) {
        //let donate = await getDonateBadge(member.donate);
        let donate = '';
        let name_display = (member.id == 116 || member.id == 16) ? member.alias : member.name;
        name_display = (name_display || '').replace('@', '');

        if (type == 1) {
          if (member.team_id == 100) {
            goal++;
            goal_str += (goal) + ". " + donate + name_display + "\n";
          } else {
            if (player < max_players) {
              player++;
              body += (player) + ". " + donate + name_display + "\n";
            } else {
              reserve++;
              reserve_str += (reserve) + ". " + donate + name_display + "\n";
            }
          }
        } else {
          body += (i + 1) + ". " + donate + name_display + "\n";
          player++;
        }
        i++;
      }
      let str = header + body;
      header = `+${player}`;
      if (reserve > 0) str += reserve_str;
      if (goal > 0) str += goal_str;
      if (reserve > 0) header += `(${reserve})`;
      if (goal > 0) header += `(${goal})`;

      str = `${header} ${str}`;

      return [str, sub, null];
    } else {
      if (type == 0) {
        header = `จ่ายครบหมดแล้ว เสาร์ที่ ${await getFormatDate(date)}`;
      } else if (type == 1) {
        header = `ลงชื่อเตะบอล เสาร์ที่ ${await getFormatDate(date)} ได้`;
      }
      return [header, sub, null];
    }
  } else {
    header = "ยังไม่มีข้อมูลสำหรับสัปดาห์นี้";
    return [header, sub, null];
  }
}

async function getMemberWeek(type = 0) {
  let header = "";
  let body = "";
  let query = "";
  let start = ""
  const res = await queryWeekID();

  if (res.length > 0) {
    const week_id = res[0].id;
    query = `SELECT member_tbl.name, member_tbl.alias, member_team_week_tbl.team_id, member_team_week_tbl.team, member_team_week_tbl.pay, member_tbl.fav_team_id, member_tbl.id, member_tbl.donate, member_tbl.fav_team_id, fav_team_tbl.url FROM member_team_week_tbl INNER JOIN member_tbl ON member_tbl.id = member_team_week_tbl.member_id LEFT JOIN fav_team_tbl ON member_tbl.fav_team_id=fav_team_tbl.id where member_team_week_tbl.week_id = ${week_id}`;
    if (type == 0) {
      header = "คนที่ยังไมได้จ่ายค่าสนาม";
      query += " and pay=0";
    } else if (type == 1) {
      header = "ลงชื่อเตะบอล";
      start = "+"
    }

    /*const check = `SELECT * from member_tbl where debt > 0`;
    const check_res = await executeQuery(check);
    let debt_str = "\n=== สมาชิกที่มียอดค้าง ===\n"
    let debt_count = 0;
    if (check_res.length > 0) {
      for (const member of check_res) {
        debt_count++;
        debt_str += `${debt_count}. ${member.name} - ${member.debt}บาท\n`;
      }
    }*/

    const result = await executeQuery(query);
    if (result.length > 0) {
      const date = new Date(res[0].date);

      header = `${header} เสาร์ที่ ${await getFormatDate(date, 'short')}\n\n`;
      let i = 0;
      let player = 0;
      let reserve = 0;
      let reserve_str = "\n=== รายชื่อสำรอง ===\n";
      let goal = 0;
      let goal_str = "\n=== รายชื่อโกล์ ===\n";
      let index = 0;
      for (const member of result) {
        //let donate = await getDonateBadge(member.donate);
        let donate = '';

        if (type == 1) {
          if (member.team_id == 100) {
            goal++;
            goal_str += (goal) + ". " + donate + member.name + "\n";
          } else {

            //index = player ;
            if (player < 24) {
              player++;
              body += (player) + ". " + donate + member.name + "\n";
            } else {
              reserve++;
              reserve_str += (reserve) + ". " + donate + member.name + "\n";
            }
          }
        } else {
          body += (i + 1) + ". " + donate + member.name + "\n";
          player++;
        }
        i++;
      }
      //console.log(`player: ${player} reserve: ${reserve} goal: ${goal}`);
      let str = header + body;
      header = `+${player}`;
      if (reserve > 0) str += reserve_str;
      if (goal > 0) str += goal_str;
      if (reserve > 0) header += `(${reserve})`;
      if (goal > 0) header += `(${goal})`;
      if (debt_count > 0) str += debt_str;

      str = `${header} ${str}`;

      return str;
    }
  } else {
    if (type == 0) {
      header = `จ่ายครบหมดแล้ว เสาร์ที่ ${await getFormatDate(date)}`;
    } else if (type == 1) {
      header = `ลงชื่อเตะบอล เสาร์ที่ ${await getFormatDate(date)} ได้`;
    }
    return header;
  }

}

async function getMemberWeek2(type = 0, useMention = true) {
  let header = "";
  let body = "";
  let sub = {};
  let user_json = "";
  let query = "";
  let start = ""
  let merber_count = 0;
  const res = await queryWeekID();

  if (res.length > 0) {
    const week_id = res[0].id;
    const date = new Date(res[0].date);
    query = `SELECT member_tbl.name, member_tbl.line_user_id, member_tbl.alias, member_team_week_tbl.team_id, member_team_week_tbl.team, member_team_week_tbl.pay, member_tbl.debt, member_tbl.id, member_tbl.donate, member_tbl.fav_team_id, fav_team_tbl.url FROM member_team_week_tbl INNER JOIN member_tbl ON member_tbl.id = member_team_week_tbl.member_id LEFT JOIN fav_team_tbl ON member_tbl.fav_team_id=fav_team_tbl.id where member_team_week_tbl.week_id = ${week_id}`;
    if (type == 0) {
      header = "คนที่ยังไมได้จ่ายค่าสนาม";
      query += " and pay=0 and member_tbl.team_id <> 1";
    } else if (type == 1) {
      header = "ลงชื่อเตะบอล";
      start = "+"
    }

    const result = await executeQuery(query);
    if (result.length > 0) {


      header = `${header} เสาร์ที่ ${await getFormatDate(date, 'short')}\n\n`;
      let i = 0;
      let player = 0;
      let reserve = 0;
      let reserve_str = "\n=== รายชื่อสำรอง ===\n";
      let goal = 0;
      let goal_str = "\n=== รายชื่อโกล์ ===\n";
      let index = 0;
      merber_count = result.length;
      for (const member of result) {
        //let donate = await getDonateBadge(member.donate);
        let donate = '';
        let member_name = member.name;
        if (type == 1) {
          if (member.debt == 1000) {
            goal++;
            goal_str += (goal) + ". " + donate + member_name + "\n";
          } else {

            //index = player ;
            if (player < 24) {
              player++;
              body += (player) + ". " + donate + member_name + "\n";
            } else {
              reserve++;
              reserve_str += (reserve) + ". " + donate + member_name + "\n";
            }
          }
        } else {
          //console.log(`user count: ${i+1}:${result.length}`)
          if (result.length < 21 && useMention) {
            let line_id = member.line_user_id;
            //line_id = "Ud734c89ea67da2ed0a16d8dfa6538ecc"
            let name = member_name;
            if (line_id != null && line_id != "") {
              name = `user${index + 1}`;
              body += `${i + 1}. ${donate}{${name}} \n`;
              if (index > 0) user_json += ',';
              sub[name] = {
                "type": "mention",
                "mentionee":
                {
                  "type": "user",
                  "userId": line_id
                }
              };
              index++;
            } else {
              body += (i + 1) + ". " + donate + member_name + "\n";
            }


          } else {
            body += (i + 1) + ". " + donate + member_name + "\n";
          }
          player++;
        }
        i++;
        //if (i > 1) break ;
      }
      //user_json = "{" + user_json + "}" ;
      //console.log(user_json.replace(/\s/g, "")) ;
      //sub = JSON.parse(user_json.replace(/\s/g, "")) 
      //console.log(`player: ${player} reserve: ${reserve} goal: ${goal}`) ;
      let str = header + body;
      header = `\n+${player}`;
      if (reserve > 0) str += reserve_str;
      if (goal > 0) str += goal_str;
      if (reserve > 0) header += `(${reserve})`;
      if (goal > 0) header += `(${goal})`;

      str = `${header} ${str}`;
      //console.log(sub) ;
      return [str, sub, merber_count];
    } else {
      if (type == 0) {
        header = `จ่ายครบหมดแล้ว เสาร์ที่ ${await getFormatDate(date)}`;
      } else if (type == 1) {
        header = `ลงชื่อเตะบอล เสาร์ที่ ${await getFormatDate(date)} ได้`;
      }
      //return header ;
      //console.log(`header: ${header} sub: ${sub} merber_count: ${merber_count}`) ;
      return [header, sub, merber_count];
    }
  }

}

// ── Shared query builders (used by both getTopStat and updateHof) ──

function buildGoalQuery(statusCondition, year, limit = null) {
  let sql = `SELECT member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id,
    goal_status_tbl.status, match_goal_tbl.status as statusid, COUNT(*) as goal
    FROM match_goal_tbl
    JOIN member_tbl ON match_goal_tbl.member_id = member_tbl.id
    JOIN goal_status_tbl ON match_goal_tbl.status = goal_status_tbl.id
    JOIN match_stat_tbl ON match_goal_tbl.match_id = match_stat_tbl.id
    JOIN week_tbl ON match_stat_tbl.week_id = week_tbl.id
    WHERE match_goal_tbl.status ${statusCondition}
      AND YEAR(week_tbl.date) = ${year}
      AND member_tbl.id <> 121 AND member_tbl.id <> 169
      AND member_tbl.team_id <> 101
    GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id
    ORDER BY goal DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  return sql;
}

function buildAvgPtsQuery(year, limit = null) {
  let sql = `SELECT 
    member_tbl.id,
    member_tbl.name, 
    member_tbl.alias, 
    member_tbl.rank,
    member_tbl.donate,
    member_tbl.picture_url,
    member_tbl.line_user_id,
    SUM(table_week_tbl.pts) 
        / SUM(table_week_tbl.w + table_week_tbl.d + table_week_tbl.l) AS pts,
    SUM(table_week_tbl.w + table_week_tbl.d + table_week_tbl.l) AS m
    FROM member_team_week_tbl
    JOIN table_week_tbl ON member_team_week_tbl.team_id = table_week_tbl.team_week_id
    JOIN member_tbl     ON member_team_week_tbl.member_id = member_tbl.id
    JOIN week_tbl       ON table_week_tbl.week_id = week_tbl.id
    WHERE week_tbl.year = ${year}
      AND member_tbl.id <> 121 AND member_tbl.id <> 169
      AND member_tbl.team_id <> 101
    GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id
    HAVING COUNT(table_week_tbl.id) > (
        SELECT COUNT(*) * 0.6
        FROM week_tbl
        WHERE week_tbl.year = ${year}
    )
    ORDER BY pts DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  return sql;
}

function buildBottomQuery(year, limit = null) {
  let sql = `
    SELECT 
      member_tbl.id,
      member_tbl.name, 
      member_tbl.alias, 
      member_tbl.rank,
      member_tbl.donate,
      member_tbl.picture_url,
      member_tbl.line_user_id,
      COUNT(*) as goal
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.week_id = tw.week_id AND mtw.team_id = tw.team_week_id
    JOIN member_tbl ON mtw.member_id = member_tbl.id
    JOIN week_tbl w ON mtw.week_id = w.id
    WHERE w.year = ${year}
      AND member_tbl.id <> 121 AND member_tbl.id <> 169 AND member_tbl.team_id <> 101
      AND tw.team_week_id = (
        SELECT t2.team_week_id
        FROM table_week_tbl t2
        WHERE t2.week_id = tw.week_id
        ORDER BY t2.pts ASC, (t2.g - t2.a) ASC
        LIMIT 1
      )
    GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id
    ORDER BY goal DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  return sql;
}

function buildLuckyColorQuery(year) {
  return `
    SELECT 
      t_col.color,
      SUM(tw.w) as wins,
      SUM(tw.w + tw.d + tw.l) as matches
    FROM table_week_tbl tw
    JOIN team_color_week_tbl t_col ON tw.team_week_id = t_col.id
    JOIN week_tbl w ON tw.week_id = w.id
    WHERE w.year = ${year}
    GROUP BY t_col.color
    ORDER BY (SUM(tw.w) / SUM(tw.w + tw.d + tw.l)) DESC, SUM(tw.w + tw.d + tw.l) DESC
  `;
}

async function getTopStat(limit = 10, type = 0, groupId = null) {
  let header = "";
  let icon = "";
  let query = "";
  let status = "";
  const res = await getTemplate('top', type);
  let url = res ? res.url : '';
  if (url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      const getBaseUrl = () => {
        let u = global.baseWebhookUrl || 'https://api.revemu.org';
        if (u.startsWith('http://')) {
          u = u.replace('http://', 'https://');
        }
        return u;
      };
      const baseUrl = getBaseUrl();
      url = url.startsWith('/') ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
    }
    if (url.startsWith('http://')) {
      url = url.replace('http://', 'https://');
    }
  }

  const currentYear = new Date().getFullYear();

  if (type == 0) {
    status = "< 2";
    header = `Top ${limit} Scorer`;
    icon = "⚽";
    query = buildGoalQuery(status, currentYear, limit);
  } else if (type == 1) {
    status = "= 3";
    header = `Top ${limit} Assist`;
    icon = "👟";
    query = buildGoalQuery(status, currentYear, limit);
  } else if (type == 2) {
    status = "= 2";
    header = `สปายฝั่งตรงข้าม`;
    icon = "🥅";
    query = buildGoalQuery(status, currentYear, limit);
  } else if (type == 4) {
    header = `Top ${limit} Avg Pts`;
    icon = "📊";
    query = buildAvgPtsQuery(currentYear, limit);
  } else if (type == 5) {
    header = `ซึมเศร้าสะสม`;
    icon = "📉";
    query = buildBottomQuery(currentYear, limit);
  } else if (type == 6) {
    header = `Lucky Colors`;
    icon = "🎨";
    query = buildLuckyColorQuery(currentYear);
  }

  const result = await executeQuery(query);
  if (result.length > 0) {
    if (type != 6) {
      await Promise.all(result.slice(0, 3).map(member => ensureMemberPicture(member, groupId)));
    }
    const assets = await fetchDisplayAssets();
    const theme = await getTheme();
    return flex.buildTopStatFlex(result, type, header, icon, url, theme, assets, resolveMemberDisplayInfo);
  }
}

async function checkDebtCall() {
  const debt_call = `SELECT value from template_tpl where name = 'call'`;
  const debt_call_res = await executeQuery(debt_call);
  if (debt_call_res.length > 0) {
    if (debt_call_res[0].value == 0) {
      proceed = true;
    }
  }
  return proceed;
}

async function getDebtList(type = 0) {
  let debt_str = "=== สมาชิกที่มียอดค้าง ===\n\n";
  let debt_count = 0;
  let sub = {};
  let proceed = false;

  if (type == 0) {
    const debt_call = `SELECT value from template_tpl where name = 'call'`;
    const debt_call_res = await executeQuery(debt_call);
    if (debt_call_res.length > 0) {
      if (debt_call_res[0].value == 0) {
        proceed = true;
      }
    }
  } else {
    proceed = true;
  }

  if (proceed) {
    const check = `SELECT * from member_tbl where debt > 0`;
    const check_res = await executeQuery(check);

    if (check_res.length > 0) {
      for (const member of check_res) {
        debt_count++;
        let name = member.name;
        let line_id = member.line_user_id;
        if (line_id != null && line_id != "") {
          name = `user${debt_count}`;
          debt_str += `${debt_count}. {${name}} - ${member.debt} บาท\n`;
          sub[name] = {
            "type": "mention",
            "mentionee":
            {
              "type": "user",
              "userId": line_id
            }
          };
        } else {
          debt_str += `${debt_count}. ${name} - ${member.debt} บาท\n`;
        }
      }
      if (type == 0) {
        await updateAlertCall(1);
      }
    }

  }
  debt_str += "** ข้อความแจ้งเตือนวันละครั้ง **\n";
  debt_str += "สมาชิกจะยังลงชื่อไม่ได้ในสัปดาห์นี้ และจะไม่ถูกเพิ่มจากการลงทะเบียนอัตโนมัติ ถ้ามีการเปิดสัปดาห์ใหม่";
  return [debt_str, sub, debt_count, proceed];

}


async function getScheduleText(startTimeStr = '17:00', matchMin = 8, breakMin = 2, totalHours = 3, endTimeStr = null) {
  // Fetch current week team colors
  const week = await queryWeekID();
  if (!week || week.length === 0) return 'ยังไม่มีข้อมูลสัปดาห์นี้';

  const week_id = week[0].id;
  const team_colors = await getTeamColorWeek(week_id);

  if (!team_colors || team_colors.length < 2) {
    return 'ยังไม่มีข้อมูลทีมในสัปดาห์นี้ (ใช้คำสั่ง randomteam ก่อน)';
  }

  // Shuffle a copy of the team colors to randomize starting team assignments and increase schedule variety
  const shuffledColors = shuffleArray([...team_colors.slice(0, 4)]);

  // Build team list (up to 4)
  const teams = shuffledColors.map(t => t.color);
  const numTeams = teams.length;

  // Number of unique pairs in one round-robin cycle
  const cycleLen = (numTeams * (numTeams - 1)) / 2; // = 6 for 4 teams

  // Parse start time and slot sizes (support both '17:30' and '17.30')
  const [startH, startM] = startTimeStr.replace('.', ':').split(':').map(Number);
  const startTotal = startH * 60 + (startM || 0);

  let calculatedTotalHours = totalHours;
  if (endTimeStr) {
    const [endH, endM] = endTimeStr.replace('.', ':').split(':').map(Number);
    let endTotal = endH * 60 + (endM || 0);
    if (endTotal < startTotal) {
      endTotal += 1440; // wrap around midnight
    }
    calculatedTotalHours = (endTotal - startTotal) / 60;
  }

  const slotMin = matchMin + breakMin;
  const maxMatches = Math.floor((calculatedTotalHours * 60) / slotMin);

  // Build pool using a rotating-anchor approach (matching the reference schedule).
  //
  // Each successive round picks the NEXT team as the "anchor".
  // Within a round's cycle the anchor plays FIRST in every sub-round,
  // followed by the other two teams' match:
  //
  //   Round 1 anchor=T0:  (T0,T1),(T2,T3) | (T0,T2),(T1,T3) | (T0,T3),(T1,T2)
  //   Round 2 anchor=T1:  (T1,T0),(T2,T3) | (T1,T2),(T0,T3) | (T1,T3),(T0,T2)
  //   Round 3 anchor=T2:  (T2,T0),(T1,T3) | (T2,T1),(T0,T3) | (T2,T3),(T0,T1)
  //
  // This guarantees each round starts with a completely different team
  // and the boundary between rounds never causes a team to rest 3+ in a row.
  const pool = [];
  let poolRound = 0;
  while (pool.length < maxMatches) {
    const anchor = poolRound % numTeams;
    const others = Array.from({ length: numTeams }, (_, i) => (anchor + 2 + i) % numTeams)
      .filter(t => t !== anchor);

    for (let j = 0; j < others.length && pool.length < maxMatches; j++) {
      const opp = others[j];                        // anchor's opponent this sub-round
      const pair = others.filter((_, k) => k !== j); // the other two teams

      pool.push([anchor, opp]);                       // anchor's match first
      if (pool.length < maxMatches) {
        pool.push([pair[0], pair[1]]);                // then the other pair
      }
    }
    poolRound++;
  }

  // -----------------------------------------------------------
  // Backtracking scheduler: enforce hard constraints, guarantee round-robin unique matchups,
  // ensure distinct starting matches for each round, and perfectly balance 2-match streaks.
  // -----------------------------------------------------------
  const allPairs = [];
  for (let i = 0; i < numTeams; i++) {
    for (let j = i + 1; j < numTeams; j++) {
      allPairs.push([i, j]);
    }
  }
  // Shuffle the candidate matchup pairs to randomise search order and schedule variety
  shuffleArray(allPairs);

  let bestSchedule = null;
  let bestMaxStreak = Infinity;
  let bestStreakDiff = Infinity;
  let steps = 0;
  const maxSteps = 200000;

  const schedule = [];
  const totalRoundsCount = Math.ceil(maxMatches / cycleLen);
  const roundUsedPairs = Array.from({ length: totalRoundsCount }, () => new Set());
  const roundStarts = new Array(totalRoundsCount).fill(-1);

  const consecPlay = new Array(numTeams).fill(0);
  const lastPlay = new Array(numTeams).fill(-2);
  const consecRest = new Array(numTeams).fill(0);
  const lastRest = new Array(numTeams).fill(-2);

  function backtrack(slot) {
    steps++;
    if (steps > maxSteps) return false;

    if (slot === maxMatches) {
      // Calculate streaks for the candidate schedule
      const streaks = new Array(numTeams).fill(0);
      const tempPlay = new Array(numTeams).fill(0);
      const tempLast = new Array(numTeams).fill(-2);
      for (let s = 0; s < maxMatches; s++) {
        const [a, b] = schedule[s];
        for (let t = 0; t < numTeams; t++) {
          if (t === a || t === b) {
            if (tempLast[t] === s - 1) {
              tempPlay[t]++;
              if (tempPlay[t] === 2) streaks[t]++;
            } else {
              tempPlay[t] = 1;
            }
            tempLast[t] = s;
          }
        }
      }

      const maxStr = Math.max(...streaks);
      const minStr = Math.min(...streaks);
      const diff = maxStr - minStr;

      if (maxStr < bestMaxStreak || (maxStr === bestMaxStreak && diff < bestStreakDiff)) {
        bestMaxStreak = maxStr;
        bestStreakDiff = diff;
        bestSchedule = [...schedule];
      }

      // If we find a perfectly balanced solution (all teams play exactly the same number of streaks), stop early
      if (maxStr <= 2 && diff === 0) {
        return true;
      }
      return false;
    }

    const roundIdx = Math.floor(slot / cycleLen);
    const isRoundStart = (slot % cycleLen === 0);

    for (let pIdx = 0; pIdx < allPairs.length; pIdx++) {
      if (roundUsedPairs[roundIdx].has(pIdx)) continue;

      const [a, b] = allPairs[pIdx];
      // Ensure distinct starting matchups for each round
      if (isRoundStart) {
        let duplicateStart = false;
        for (let r = 0; r < roundIdx; r++) {
          if (roundStarts[r] === pIdx) {
            duplicateStart = true;
            break;
          }
        }
        if (duplicateStart) continue;
      }

      // Hard play constraint: no team plays 3 in a row
      const aC = lastPlay[a] === slot - 1 ? consecPlay[a] : 0;
      const bC = lastPlay[b] === slot - 1 ? consecPlay[b] : 0;
      if (aC >= 2 || bC >= 2) continue;

      // Hard constraint: no consecutive matches can have the exact same pairing
      if (slot > 0) {
        const [prevA, prevB] = schedule[slot - 1];
        if ((a === prevA && b === prevB) || (a === prevB && b === prevA)) {
          continue;
        }
      }

      // Special constraint: match 1 and match 2 of each round must not share any team (no 2-streak between match 1 & 2)
      if (numTeams >= 4 && slot % cycleLen === 1) {
        const [prevA, prevB] = schedule[slot - 1];
        if (a === prevA || a === prevB || b === prevA || b === prevB) continue;
      }

      // Special constraint: opening match of Round 2 must not share any team with Round 1 opening match
      if (numTeams >= 4 && slot === cycleLen) {
        const [prevStartA, prevStartB] = schedule[0];
        if (a === prevStartA || a === prevStartB || b === prevStartA || b === prevStartB) continue;
      }

      // Hard rest constraint: no team rests 3 in a row
      let restOk = true;
      for (let t = 0; t < numTeams; t++) {
        if (t === a || t === b) continue;
        const tR = lastRest[t] === slot - 1 ? consecRest[t] : 0;
        if (tR >= 2) { restOk = false; break; }
      }
      if (!restOk) continue;

      // Save state
      const prevPlay = [...consecPlay];
      const prevLastPlay = [...lastPlay];
      const prevRest = [...consecRest];
      const prevLastRest = [...lastRest];

      // Update state
      for (let t = 0; t < numTeams; t++) {
        if (t === a || t === b) {
          consecPlay[t] = lastPlay[t] === slot - 1 ? consecPlay[t] + 1 : 1;
          lastPlay[t] = slot;
          consecRest[t] = 0;
        } else {
          consecRest[t] = lastRest[t] === slot - 1 ? consecRest[t] + 1 : 1;
          lastRest[t] = slot;
          consecPlay[t] = 0;
        }
      }

      schedule.push([a, b]);
      roundUsedPairs[roundIdx].add(pIdx);
      if (isRoundStart) roundStarts[roundIdx] = pIdx;

      if (backtrack(slot + 1)) return true;

      // Backtrack
      schedule.pop();
      roundUsedPairs[roundIdx].delete(pIdx);
      if (isRoundStart) roundStarts[roundIdx] = -1;
      for (let t = 0; t < numTeams; t++) {
        consecPlay[t] = prevPlay[t];
        lastPlay[t] = prevLastPlay[t];
        consecRest[t] = prevRest[t];
        lastRest[t] = prevLastRest[t];
      }
    }
    return false;
  }

  let matchups = [];
  if (numTeams === 3) {
    const cycle = [
      [0, 1],
      [1, 2],
      [2, 0]
    ];
    for (let i = 0; i < maxMatches; i++) {
      matchups.push([...cycle[i % 3]]);
    }
  } else {
    backtrack(0);

    if (bestSchedule) {
      matchups = bestSchedule;
    } else {
      // Fallback: original rotating anchor generator
      console.warn('[schedule] Backtracking solver found no solution, using fallback rotating anchor pool.');
      const pool = [];
      let poolRound = 0;
      while (pool.length < maxMatches) {
        const anchor = poolRound % numTeams;
        const others = Array.from({ length: numTeams }, (_, i) => (anchor + 2 + i) % numTeams)
          .filter(t => t !== anchor);

        for (let j = 0; j < others.length && pool.length < maxMatches; j++) {
          const opp = others[j];
          const pair = others.filter((_, k) => k !== j);

          pool.push([anchor, opp]);
          if (pool.length < maxMatches) {
            pool.push([pair[0], pair[1]]);
          }
        }
        poolRound++;
      }
      matchups = pool;
    }
  }

  // Post-process matchups to ensure consecutive playing teams remain on the same side (Left or Right)
  for (let i = 1; i < matchups.length; i++) {
    const [prevA, prevB] = matchups[i - 1];
    const [currA, currB] = matchups[i];

    if (currB === prevA || currA === prevB) {
      matchups[i] = [currB, currA];
    }
  }

  const totalRounds = Math.ceil(maxMatches / cycleLen);

  const toTime = (mins) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // Format output
  const thaiMonthsShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const dateObj = new Date(week[0].date || Date.now());
  const dateStr = `${dateObj.getDate()} ${thaiMonthsShort[dateObj.getMonth()]} ${String(dateObj.getFullYear()).slice(-2)}`;

  const lines = [];
  lines.push(`⚽ ตารางแข่งขัน เสาร์ที่ ${dateStr}`);
  lines.push(`🕐 เริ่ม ${startTimeStr} น. | ${matchMin} นาที/แมตช์`);
  const displayHours = Number(calculatedTotalHours.toFixed(2));
  lines.push(`👥 ${numTeams} ทีม | ${matchups.length} แมตช์ (${totalRounds} รอบ) | ${displayHours} ชม.`);
  lines.push(`⚠️ เล่น/พักติดต่อกันได้สูงสุด 2 แมตช์เท่านั้น`);
  lines.push('─'.repeat(30));

  let actualSlotMin = slotMin;
  if (endTimeStr && matchups.length > 0) {
    const totalMinutes = calculatedTotalHours * 60;
    actualSlotMin = totalMinutes / matchups.length;
  }

  matchups.forEach((m, i) => {
    // New round header every cycleLen matches
    if (i % cycleLen === 0) {
      lines.push(`▶ รอบที่ ${Math.floor(i / cycleLen) + 1}`);
    }

    const slotStart = Math.round(startTotal + i * actualSlotMin);
    const resting = teams.filter((_, idx) => idx !== m[0] && idx !== m[1]).join(', ');
    lines.push(`[${i + 1}] ${toTime(slotStart)}-${toTime(slotStart + matchMin)}  ${teams[m[0]]} vs ${teams[m[1]]}  (พัก: ${resting})`);
  });

  lines.push('─'.repeat(30));
  const displayEndTime = endTimeStr ? endTimeStr.replace('.', ':') : toTime(Math.round(startTotal + matchups.length * actualSlotMin));
  lines.push(`สิ้นสุด ${displayEndTime} น.`);

  // ── Build schedule JSON ──
  const scheduleMatches = matchups.map((m, i) => {
    const slotStart = Math.round(startTotal + i * actualSlotMin);
    return {
      matchNo: i + 1,
      round: Math.floor(i / cycleLen) + 1,
      startTime: toTime(slotStart),
      endTime: toTime(slotStart + matchMin),
      teamA: teams[m[0]],
      teamAId: shuffledColors[m[0]].id,
      teamB: teams[m[1]],
      teamBId: shuffledColors[m[1]].id,
      resting: teams.filter((_, idx) => idx !== m[0] && idx !== m[1])
    };
  });

  // ── Sync with match_stat_tbl to find current & next match ──
  let currentMatchNo = 1;
  let nextMatchNo = 2;
  let dbMatches = [];
  try {
    const rows = await queryMatchWeek(week_id);
    if (rows && rows.length > 0) {
      dbMatches = rows;
      // Highest match_num recorded in DB = the match currently in progress (or last played)
      const maxDbMatchNum = Math.max(...dbMatches.map(r => r.match_num));
      currentMatchNo = maxDbMatchNum;
      nextMatchNo = Math.min(maxDbMatchNum + 1, scheduleMatches.length);
    }
    // else: no records → start from match 1 / next is match 2
  } catch (err) {
    console.error('[schedule] failed to query match_stat_tbl:', err.message);
  }

  const currentMatch = scheduleMatches.find(m => m.matchNo === currentMatchNo) || scheduleMatches[0];
  const nextMatch = scheduleMatches.find(m => m.matchNo === nextMatchNo) || null;

  let imageUrl = null;
  try {
    const imgTpl = await getTemplate('schedule', 'header');
    imageUrl = imgTpl ? imgTpl.url : null;
  } catch (err) {
    console.error('[schedule] failed to query template image:', err.message);
  }

  const scheduleJson = {
    generatedAt: new Date().toISOString(),
    weekId: week_id,
    date: dateStr,
    startTime: startTimeStr,
    matchMinutes: matchMin,
    breakMinutes: breakMin,
    totalHours: Number(calculatedTotalHours.toFixed(2)),
    teams: teams,
    totalMatches: scheduleMatches.length,
    totalRounds: totalRounds,
    endTime: endTimeStr ? endTimeStr.replace('.', ':') : toTime(startTotal + scheduleMatches.length * slotMin),
    currentMatch,
    nextMatch,
    imageUrl,
    dbMatches,
    matches: scheduleMatches
  };

  try {
    const jsonPath = path.join(__dirname, 'schedule.json');
    fs.writeFileSync(jsonPath, JSON.stringify(scheduleJson, null, 2), 'utf8');
    console.log(`[schedule] saved → current: match ${currentMatchNo}, next: match ${nextMatchNo}`);
  } catch (err) {
    console.error('[schedule] failed to save JSON:', err.message);
  }

  return [lines.join('\n'), scheduleJson];
}

async function getMatchScorersAndAssists(matchId, assets, groupId) {
  const scorerQ = `SELECT member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id, match_goal_tbl.status as statusid, count(*) as goal
    FROM match_goal_tbl
    JOIN member_tbl ON match_goal_tbl.member_id = member_tbl.id
    WHERE match_goal_tbl.match_id = ${matchId} AND match_goal_tbl.status <= 2
    GROUP BY member_tbl.id, match_goal_tbl.status, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id`;

  const assistQ = `SELECT member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id, count(*) as assist
    FROM match_goal_tbl
    JOIN member_tbl ON match_goal_tbl.member_id = member_tbl.id
    WHERE match_goal_tbl.match_id = ${matchId} AND match_goal_tbl.status = 3
    GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias, member_tbl.rank, member_tbl.donate, member_tbl.picture_url, member_tbl.line_user_id`;

  const [scorerRows, assistRows] = await Promise.all([
    executeQuery(scorerQ),
    executeQuery(assistQ)
  ]);

  await Promise.all([
    ...scorerRows.map(r => ensureMemberPicture(r, groupId)),
    ...assistRows.map(r => ensureMemberPicture(r, groupId))
  ]);

  const scorers = scorerRows.map(r => {
    const info = resolveMemberDisplayInfo(r, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
    return {
      name: info.name,
      goal: r.goal,
      ownGoal: r.statusid === 2,
      badgeUrl: info.badgeUrl,
      badgeSize: info.badgeSize,
      nameColor: info.nameColor,
      hofCount: info.hofCount,
      hofBadgeUrl: info.hofBadgeUrl,
      hofBadgeSize: info.hofBadgeSize,
      hofBadges: info.hofBadges,
      pictureUrl: info.pictureUrl
    };
  });

  const assists = assistRows.map(r => {
    const info = resolveMemberDisplayInfo(r, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
    return {
      name: info.name,
      assist: r.assist,
      badgeUrl: info.badgeUrl,
      badgeSize: info.badgeSize,
      nameColor: info.nameColor,
      hofCount: info.hofCount,
      hofBadgeUrl: info.hofBadgeUrl,
      hofBadgeSize: info.hofBadgeSize,
      hofBadges: info.hofBadges,
      pictureUrl: info.pictureUrl
    };
  });

  return { scorers, assists };
}

// ── Live current/next match lookup ──
// Reads the schedule list from schedule.json but re-queries match_stat_tbl
// for the latest match_num so it is always up to date.
async function getCurrentMatch(groupId = null) {
  const jsonPath = path.join(__dirname, 'schedule.json');
  if (!require('fs').existsSync(jsonPath)) return null;

  const sched = JSON.parse(require('fs').readFileSync(jsonPath, 'utf8'));
  const schedMatches = sched.matches;
  if (!schedMatches || schedMatches.length === 0) return null;

  let currentMatchNo = 1;
  let nextMatchNo = Math.min(2, schedMatches.length);
  let currentDbRow = null;

  let dbMatches = [];
  const week = await queryWeekID();
  if (week && week.length > 0) {
    dbMatches = await queryMatchWeek(week[0].id);
    if (dbMatches && dbMatches.length > 0) {
      const maxDbMatchNum = Math.max(...dbMatches.map(r => r.match_num));
      currentMatchNo = maxDbMatchNum;
      nextMatchNo = Math.min(maxDbMatchNum + 1, schedMatches.length);
      currentDbRow = dbMatches.find(r => r.match_num === maxDbMatchNum);
    }
  }

  const currentMatch = schedMatches.find(m => m.matchNo === currentMatchNo) || schedMatches[0];
  const nextMatch = schedMatches.find(m => m.matchNo === nextMatchNo && nextMatchNo !== currentMatchNo) || null;
  const nextMatch2No = Math.min(currentMatchNo + 2, schedMatches.length);
  const nextMatch2 = (nextMatch2No !== currentMatchNo && nextMatch2No !== nextMatchNo)
    ? (schedMatches.find(m => m.matchNo === nextMatch2No) || null)
    : null;

  // ── Live score & recent match details (last 3 played matches) ──
  let score = null;
  let scorers = [];
  let assists = [];
  const recentMatchDetails = {};

  const assets = await fetchDisplayAssets();

  if (currentDbRow) {
    score = {
      teamA: currentDbRow.team_a_goal ?? 0,
      teamB: currentDbRow.team_b_goal ?? 0
    };
  }

  if (dbMatches && dbMatches.length > 0) {
    // Sort descending by match_num to pick the latest 3 played matches
    const sortedDbMatches = [...dbMatches].sort((a, b) => b.match_num - a.match_num);
    const recentDbMatches = sortedDbMatches.slice(0, 3);

    for (const matchRow of recentDbMatches) {
      const details = await getMatchScorersAndAssists(matchRow.id, assets, groupId);
      recentMatchDetails[matchRow.match_num] = details;
      if (currentDbRow && matchRow.id === currentDbRow.id) {
        scorers = details.scorers;
        assists = details.assists;
      }
    }
  }

  // ── Week table (team, GD, pts) ──
  let table = [];
  if (week && week.length > 0) {
    const tableRows = await queryTableWeek(week[0].id);
    if (tableRows && tableRows.length > 0) {
      table = tableRows.map(r => ({
        team: r.color,
        w: r.w,
        d: r.d,
        l: r.l,
        gd: (r.G - r.A),
        pts: r.pts
      }));
    }
  }

  const imgTpl = await getTemplate('live', 'header');
  const imageUrl = imgTpl ? imgTpl.url : null;

  return { sched, currentMatch, nextMatch, nextMatch2, score, scorers, assists, table, dbMatches, recentMatchDetails, weekId: sched.weekId, date: sched.date, imageUrl, teamColors: assets.teamColors };
}

async function getTheme() {
  try {
    const query = "SELECT value FROM template_tpl WHERE name = 'theme'";
    const result = await executeQuery(query);
    if (result && result.length > 0) {
      return result[0].value;
    }
  } catch (err) {
    console.error('Failed to get theme, defaulting to black:', err.message);
  }
  return 'black';
}

async function setTheme(themeName) {
  const theme = themeName.toLowerCase() === 'white' ? 'white' : 'black';
  const checkQuery = "SELECT id FROM template_tpl WHERE name = 'theme'";
  const rows = await executeQuery(checkQuery);
  if (rows.length > 0) {
    const updateQuery = "UPDATE template_tpl SET value = ? WHERE name = 'theme'";
    return await executeQuery(updateQuery, [theme]);
  } else {
    const insertQuery = "INSERT INTO template_tpl (id, name, value) VALUES (null, 'theme', ?)";
    return await executeQuery(insertQuery, [theme]);
  }
}

async function syncHofRecords(type, year, newMemberIds) {
  // 1. Fetch existing records for this type and year
  const existing = await executeQuery(
    "SELECT id, member_id FROM hof_tbl WHERE type = ? AND year = ? ORDER BY id ASC",
    [type, year]
  );

  const numExisting = existing.length;
  const numNew = newMemberIds.length;

  // 2. Update existing records with the new member IDs
  const minCount = Math.min(numExisting, numNew);
  for (let i = 0; i < minCount; i++) {
    if (existing[i].member_id !== newMemberIds[i]) {
      await executeQuery(
        "UPDATE hof_tbl SET member_id = ? WHERE id = ?",
        [newMemberIds[i], existing[i].id]
      );
    }
  }

  // 3. If there are more new member IDs than existing records, INSERT the remaining
  if (numNew > numExisting) {
    for (let i = numExisting; i < numNew; i++) {
      await executeQuery(
        "INSERT INTO hof_tbl (member_id, type, year) VALUES (?, ?, ?)",
        [newMemberIds[i], type, year]
      );
    }
  }

  // 4. If there are fewer new member IDs than existing records, DELETE the extra records
  if (numExisting > numNew) {
    const idsToDelete = existing.slice(numNew).map(r => r.id);
    await executeQuery(
      `DELETE FROM hof_tbl WHERE id IN (${idsToDelete.join(',')})`
    );
  }
}

async function updateHof() {
  try {
    const currentYear = new Date().getFullYear();

    // Reuse the same shared query builders as getTopStat (no LIMIT to get all)
    const scorers = await executeQuery(buildGoalQuery('< 2', currentYear));
    const assists = await executeQuery(buildGoalQuery('= 3', currentYear));
    const ownGoals = await executeQuery(buildGoalQuery('= 2', currentYear));
    const players = await executeQuery(buildAvgPtsQuery(currentYear));
    const bottomList = await executeQuery(buildBottomQuery(currentYear));

    // Find max counts and filter — shared queries return 'goal' column for counts, 'id' for member
    let topScorers = [];
    if (scorers && scorers.length > 0) {
      const maxGoals = Math.max(...scorers.map(s => s.goal));
      if (maxGoals > 0) {
        topScorers = scorers.filter(s => s.goal === maxGoals).map(s => s.id);
      }
    }

    let topAssists = [];
    if (assists && assists.length > 0) {
      const maxAssists = Math.max(...assists.map(a => a.goal));
      if (maxAssists > 0) {
        topAssists = assists.filter(a => a.goal === maxAssists).map(a => a.id);
      }
    }

    let topOwnGoals = [];
    if (ownGoals && ownGoals.length > 0) {
      const maxOwnGoals = Math.max(...ownGoals.map(o => o.goal));
      if (maxOwnGoals > 0) {
        topOwnGoals = ownGoals.filter(o => o.goal === maxOwnGoals).map(o => o.id);
      }
    }

    let topPlayers = [];
    if (players && players.length > 0) {
      const validPlayers = players.map(p => ({
        id: p.id,
        pts: parseFloat(p.pts)
      })).filter(p => !isNaN(p.pts));

      if (validPlayers.length > 0) {
        const maxPts = Math.max(...validPlayers.map(p => p.pts));
        topPlayers = validPlayers.filter(p => p.pts === maxPts).map(p => p.id);
      }
    }

    let topBottom = [];
    if (bottomList && bottomList.length > 0) {
      const maxBottom = Math.max(...bottomList.map(b => b.goal));
      if (maxBottom > 0) {
        topBottom = bottomList.filter(b => b.goal === maxBottom).map(b => b.id);
      }
    }

    // Sync HOF records instead of deleting and recreating
    await syncHofRecords('scorer', currentYear, topScorers);
    await syncHofRecords('assist', currentYear, topAssists);
    await syncHofRecords('own_goal', currentYear, topOwnGoals);
    await syncHofRecords('avg_pts', currentYear, topPlayers);
    await syncHofRecords('bottom', currentYear, topBottom);

    console.log(`[HOF] Updated HOF for year ${currentYear}. Top Scorers: ${topScorers.join(', ')}, Top Assists: ${topAssists.join(', ')}, Top Own Goals: ${topOwnGoals.join(', ')}, Top Players (Avg Pts): ${topPlayers.join(', ')}, Top Bottom: ${topBottom.join(', ')}`);
  } catch (err) {
    console.error('Error updating HOF records:', err.message);
  }
}

async function ensureAutoRegTable() {
  try {
    const createSql = `
      CREATE TABLE IF NOT EXISTS autoreg_tbl (
        id INT AUTO_INCREMENT PRIMARY KEY,
        member_id INT NOT NULL,
        group_id VARCHAR(100) NOT NULL DEFAULT '',
        priority_order INT DEFAULT 0,
        status TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_member_group (member_id, group_id),
        KEY idx_status_priority (status, priority_order, created_at)
      )
    `;
    await executeQuery(createSql);

    // Normalize any legacy NULL group_id to empty string
    await executeQuery("UPDATE autoreg_tbl SET group_id = '' WHERE group_id IS NULL");

    // Migrate existing member_tbl auto_reg = 1 entries ONLY if not already present in autoreg_tbl
    const migrateSql = `
      INSERT INTO autoreg_tbl (member_id, group_id, priority_order, status)
      SELECT m.id, '', 0, 1 
      FROM member_tbl m 
      WHERE m.auto_reg = 1 
        AND NOT EXISTS (
          SELECT 1 FROM autoreg_tbl a WHERE a.member_id = m.id
        )
    `;
    await executeQuery(migrateSql);
  } catch (err) {
    console.error("Error ensuring autoreg_tbl table:", err.message);
  }
}

async function updateMemberAutoReg(member_id, auto_reg, groupId = null) {
  await ensureAutoRegTable();
  const targetGroup = groupId || '';
  if (Number(auto_reg) === 1) {
    const insertQuery = `
      INSERT INTO autoreg_tbl (member_id, group_id, status)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE status = 1, updated_at = CURRENT_TIMESTAMP
    `;
    await executeQuery(insertQuery, [member_id, targetGroup]);
    await executeQuery("UPDATE member_tbl SET auto_reg = 1 WHERE id = ?", [member_id]);
  } else {
    const deleteQuery = "DELETE FROM autoreg_tbl WHERE member_id = ?";
    await executeQuery(deleteQuery, [member_id]);
    await executeQuery("UPDATE member_tbl SET auto_reg = 0 WHERE id = ?", [member_id]);
  }
}

async function getAutoRegList(groupId = null) {
  await ensureAutoRegTable();
  let query = `
    SELECT m.*, 
           COALESCE(a.id, 0) as autoreg_id, 
           COALESCE(a.priority_order, 0) as priority_order, 
           COALESCE(a.status, 1) as autoreg_status, 
           COALESCE(a.created_at, CURRENT_TIMESTAMP) as autoreg_created_at
    FROM member_tbl m
    LEFT JOIN autoreg_tbl a ON m.id = a.member_id
    WHERE (m.auto_reg = 1 OR a.status = 1)
  `;
  const params = [];
  if (groupId) {
    query += " AND (a.group_id IS NULL OR a.group_id = '' OR a.group_id = ?)";
    params.push(groupId);
  }
  query += " ORDER BY CASE WHEN a.id IS NULL OR a.id = 0 THEN 99999999 ELSE a.id END ASC, m.id ASC";

  const result = await executeQuery(query, params);
  if (result.length > 0) {
    await Promise.all(result.map(member => ensureMemberPicture(member, groupId)));
    const assets = await fetchDisplayAssets();
    return result.map(member => {
      const displayInfo = resolveMemberDisplayInfo(member, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
      displayInfo.autoreg_created_at = member.autoreg_created_at;
      displayInfo.priority_order = member.priority_order;
      return displayInfo;
    });
  }
  return [];
}

async function getMemberDisplayInfo(memberId, groupId = null) {
  const query = "SELECT * FROM member_tbl WHERE id = ?";
  const result = await executeQuery(query, [memberId]);
  if (result.length > 0) {
    await ensureMemberPicture(result[0], groupId);
    const assets = await fetchDisplayAssets();
    return resolveMemberDisplayInfo(result[0], assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards);
  }
  return null;
}

async function getMemberStats(memberId, groupId = null) {
  const memberInfo = await getMemberDisplayInfo(memberId, groupId);
  if (!memberInfo) return null;

  // Query goals, assists, own goals
  const goalQuery = `
    SELECT 
      SUM(CASE WHEN mgt.status < 2 AND w.year = YEAR(CURRENT_DATE()) THEN 1 ELSE 0 END) as goals_year,
      SUM(CASE WHEN mgt.status < 2 THEN 1 ELSE 0 END) as goals_alltime,
      SUM(CASE WHEN mgt.status = 3 AND w.year = YEAR(CURRENT_DATE()) THEN 1 ELSE 0 END) as assists_year,
      SUM(CASE WHEN mgt.status = 3 THEN 1 ELSE 0 END) as assists_alltime,
      SUM(CASE WHEN mgt.status = 2 AND w.year = YEAR(CURRENT_DATE()) THEN 1 ELSE 0 END) as owngoals_year,
      SUM(CASE WHEN mgt.status = 2 THEN 1 ELSE 0 END) as owngoals_alltime
    FROM match_goal_tbl mgt
    JOIN match_stat_tbl mst ON mgt.match_id = mst.id
    JOIN week_tbl w ON mst.week_id = w.id
    WHERE mgt.member_id = ?
  `;

  // Query pts, matches, weeks, wins
  const ptQuery = `
    SELECT 
      SUM(CASE WHEN w.year = YEAR(CURRENT_DATE()) THEN tw.pts ELSE 0 END) as pts_year,
      SUM(CASE WHEN w.year = YEAR(CURRENT_DATE()) THEN (tw.w + tw.d + tw.l) ELSE 0 END) as matches_year,
      COUNT(DISTINCT CASE WHEN w.year = YEAR(CURRENT_DATE()) THEN w.id ELSE NULL END) as weeks_year,
      SUM(CASE WHEN w.year = YEAR(CURRENT_DATE()) THEN tw.w ELSE 0 END) as wins_year,
      SUM(tw.pts) as pts_alltime,
      SUM(tw.w + tw.d + tw.l) as matches_alltime,
      COUNT(DISTINCT w.id) as weeks_alltime,
      SUM(tw.w) as wins_alltime
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.team_id = tw.team_week_id
    JOIN week_tbl w ON tw.week_id = w.id
    WHERE mtw.member_id = ?
  `;

  const dateQuery = `
    SELECT MIN(w.date) as first_match_date
    FROM member_team_week_tbl mtw
    JOIN week_tbl w ON mtw.week_id = w.id
    WHERE mtw.member_id = ?
  `;

  const bottomQuery = `
    SELECT 
      SUM(CASE WHEN w.year = YEAR(CURRENT_DATE()) THEN 1 ELSE 0 END) as bottom_year,
      COUNT(*) as bottom_alltime
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.week_id = tw.week_id AND mtw.team_id = tw.team_week_id
    JOIN week_tbl w ON mtw.week_id = w.id
    WHERE mtw.member_id = ? AND tw.team_week_id = (
      SELECT t2.team_week_id
      FROM table_week_tbl t2
      WHERE t2.week_id = tw.week_id
      ORDER BY t2.pts ASC, (t2.g - t2.a) ASC
      LIMIT 1
    )
  `;

  const champQuery = `
    SELECT 
      SUM(CASE WHEN w.year = YEAR(CURRENT_DATE()) THEN 1 ELSE 0 END) as champ_year,
      COUNT(*) as champ_alltime
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.week_id = tw.week_id AND mtw.team_id = tw.team_week_id
    JOIN week_tbl w ON mtw.week_id = w.id
    WHERE mtw.member_id = ? AND tw.team_week_id = (
      SELECT t2.team_week_id
      FROM table_week_tbl t2
      WHERE t2.week_id = tw.week_id
      ORDER BY t2.pts DESC, (t2.g - t2.a) DESC
      LIMIT 1
    )
  `;

  const colorQuery = `
    SELECT 
      t_col.color,
      SUM(tw.w) as wins,
      SUM(tw.w + tw.d + tw.l) as matches
    FROM member_team_week_tbl mtw
    JOIN table_week_tbl tw ON mtw.team_id = tw.team_week_id
    JOIN team_color_week_tbl t_col ON tw.team_week_id = t_col.id
    WHERE mtw.member_id = ?
    GROUP BY t_col.color
  `;

  const [goalResult, ptResult, dateResult, bottomResult, champResult, colorResult] = await Promise.all([
    executeQuery(goalQuery, [memberId]),
    executeQuery(ptQuery, [memberId]),
    executeQuery(dateQuery, [memberId]),
    executeQuery(bottomQuery, [memberId]),
    executeQuery(champQuery, [memberId]),
    executeQuery(colorQuery, [memberId])
  ]);

  const goals = goalResult[0] || {};
  const pts = ptResult[0] || {};
  const firstMatchDate = dateResult[0] ? dateResult[0].first_match_date : null;
  const bottom = bottomResult[0] || {};
  const champ = champResult[0] || {};

  const bottomYear = Number(bottom.bottom_year || 0);
  const bottomAllTime = Number(bottom.bottom_alltime || 0);
  const champYear = Number(champ.champ_year || 0);
  const champAllTime = Number(champ.champ_alltime || 0);
  const weeksYear = Number(pts.weeks_year || 0);
  const weeksAlltime = Number(pts.weeks_alltime || 0);

  const winsYear = Number(pts.wins_year || 0);
  const winsAlltime = Number(pts.wins_alltime || 0);
  const matchesYear = Number(pts.matches_year || 0);
  const matchesAlltime = Number(pts.matches_alltime || 0);

  const colorStats = (colorResult || []).map(row => {
    const color = row.color;
    const wins = Number(row.wins || 0);
    const matches = Number(row.matches || 0);
    const winRate = matches > 0 ? Number(((wins / matches) * 100).toFixed(1)) : 0;
    return {
      color,
      wins,
      matches,
      winRate
    };
  });

  colorStats.sort((a, b) => {
    if (b.winRate !== a.winRate) {
      return b.winRate - a.winRate;
    }
    return b.matches - a.matches;
  });

  const luckyColor = colorStats.length > 0 && colorStats[0].winRate > 0 ? colorStats[0].color : null;

  return {
    member: memberInfo,
    firstMatchDate,
    stats: {
      goals: {
        year: Number(goals.goals_year || 0),
        alltime: Number(goals.goals_alltime || 0)
      },
      assists: {
        year: Number(goals.assists_year || 0),
        alltime: Number(goals.assists_alltime || 0)
      },
      owngoals: {
        year: Number(goals.owngoals_year || 0),
        alltime: Number(goals.owngoals_alltime || 0)
      },
      matches: {
        year: matchesYear,
        alltime: matchesAlltime
      },
      weeks: {
        year: weeksYear,
        alltime: weeksAlltime
      },
      avgpts: {
        year: matchesYear > 0 ? Number((pts.pts_year / matchesYear).toFixed(2)) : 0,
        alltime: matchesAlltime > 0 ? Number((pts.pts_alltime / matchesAlltime).toFixed(2)) : 0
      },
      bottom: {
        year: bottomYear,
        yearPct: weeksYear > 0 ? Number((bottomYear / weeksYear * 100).toFixed(1)) : 0,
        alltime: bottomAllTime,
        alltimePct: weeksAlltime > 0 ? Number((bottomAllTime / weeksAlltime * 100).toFixed(1)) : 0
      },
      champ: {
        year: champYear,
        yearPct: weeksYear > 0 ? Number((champYear / weeksYear * 100).toFixed(1)) : 0,
        alltime: champAllTime,
        alltimePct: weeksAlltime > 0 ? Number((champAllTime / weeksAlltime * 100).toFixed(1)) : 0
      },
      win: {
        yearPct: matchesYear > 0 ? Number((winsYear / matchesYear * 100).toFixed(1)) : 0,
        alltimePct: matchesAlltime > 0 ? Number((winsAlltime / matchesAlltime * 100).toFixed(1)) : 0
      }
    },
    colorStats,
    luckyColor
  };
}

async function logSlip(senderId, senderName, imagePath, status, qrcode = null, responseJson = null) {
  try {
    const createSql = `CREATE TABLE IF NOT EXISTS slip_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sender_id VARCHAR(255),
      sender_name VARCHAR(255),
      image_path VARCHAR(255),
      status VARCHAR(50),
      qrcode TEXT,
      response_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;
    await executeQuery(createSql, []);

    const checkColSql = `SELECT count(*) as count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'slip_log' AND column_name = 'qrcode'`;
    const colExists = await executeQuery(checkColSql, []);
    if (colExists && colExists.length > 0 && colExists[0].count === 0) {
      await executeQuery("ALTER TABLE slip_log ADD COLUMN qrcode TEXT", []);
      await executeQuery("ALTER TABLE slip_log ADD COLUMN response_json TEXT", []);
    }

    const sql = `INSERT INTO slip_log (sender_id, sender_name, image_path, status, qrcode, response_json) VALUES (?, ?, ?, ?, ?, ?)`;
    const jsonStr = responseJson ? JSON.stringify(responseJson) : null;
    await executeQuery(sql, [senderId, senderName, imagePath, status, qrcode, jsonStr]);
  } catch (err) {
    console.error("Error logging slip:", err);
  }
}

async function getSlipByQRCode(qrcode) {
  try {
    const sql = `SELECT id, response_json FROM slip_log WHERE qrcode = ? LIMIT 1`;
    const rows = await executeQuery(sql, [qrcode]);
    if (rows && rows.length > 0) {
      return {
        id: rows[0].id,
        data: rows[0].response_json ? JSON.parse(rows[0].response_json) : null
      };
    }
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') {
      console.error("Error getting slip by qrcode:", err);
    }
  }
  return null;
}

async function updateSlipLog(id, status, responseJson = null) {
  try {
    const jsonStr = responseJson ? JSON.stringify(responseJson) : null;
    const sql = `UPDATE slip_log SET status = ?, response_json = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?`;
    await executeQuery(sql, [status, jsonStr, id]);
  } catch (err) {
    console.error("Error updating slip log:", err);
  }
}

async function getNoticedSlips(senderId = null) {
  try {
    let sql = `SELECT id, sender_name, image_path, status, qrcode, created_at FROM slip_log WHERE status = 'noticed'`;
    const params = [];
    if (senderId) {
      sql += ` AND sender_id = ?`;
      params.push(senderId);
    }
    sql += ` ORDER BY created_at DESC LIMIT 10`;
    return await executeQuery(sql, params);
  } catch (err) {
    console.error("Error getting noticed slips:", err);
    return [];
  }
}

async function getSlipById(id) {
  try {
    const sql = `SELECT id, sender_id, sender_name, image_path, status, qrcode, response_json, created_at FROM slip_log WHERE id = ?`;
    const rows = await executeQuery(sql, [id]);
    if (rows && rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    console.error("Error getting slip by id:", err);
  }
  return null;
}

module.exports = {
  updateHof,
  testConnection,
  executeQuery,
  queryWeekDate,
  queryWeekID,
  getMemberNY,
  getTeamColorWeek,
  getTeamWeek,
  getMemberWeek,
  getMatchWeek,
  getTableWeek,
  updateMember,
  updateMemberInfo,
  updateMemberRank,
  updateMemberDebt,
  updateMemberWeek,
  setWeekCost,
  resetWeekDebt,
  updateMaxNumberWeek,
  removeReserveMembers,
  queryMemberbyLineID,
  queryMemberbyName,
  newMember,
  registerMember,
  unregisterMember,
  resetMemberTeam,
  getTopStat,
  IsMemberWeek,
  newWeek,
  getFormatDate,
  addTeamColorWeek,
  addTeamMemberWeek,
  getMemberWeek2,
  getMemberWeek0,
  registerNY,
  getDebtList,
  getScheduleText,
  getCurrentMatch,
  getTheme,
  setTheme,
  updateMemberAutoReg,
  getAutoRegCount,
  getAutoRegList,
  getTemplate,
  getMemberDisplayInfo,
  getMemberStats,
  getAdminCommands,
  logSlip,
  getSlipByQRCode,
  updateSlipLog,
  getNoticedSlips,
  getSlipById,
  setMemberDebt,
  updateWeekTimeRange,
  calcAndSaveMaxMvpScore,
  ensureMvpWeekTable,
  saveWeekMvpRecords,
  ensurePosTables,
  getAllPositions,
  getMemberPositions,
  setMemberPosition,
  updatePositionPoints,
  setMemberWeekPosition,
  getEffectiveMemberPosition
};