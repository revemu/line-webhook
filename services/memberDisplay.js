const { executeQuery } = require('../db/pool');
const { getFullUrl } = require('../utils/url');
const logger = require('../utils/logger');

/**
 * Resolves display metadata (name, rank badge, donate name color, HOF awards, avatar URL) for a member row.
 * @param {Object} member
 * @param {Object} badges
 * @param {Array<Object>} donateColors
 * @param {Object} hofCounts
 * @param {Object} hofBadge
 * @param {Object} [hofAwards={}]
 * @returns {Object}
 */
function resolveMemberDisplayInfo(member, badges, donateColors, hofCounts, hofBadge, hofAwards = {}, adminBadges = null) {
  let name_display = (member.id == 116 || member.id == 16) ? member.alias : member.name;
  name_display = (name_display || '').replace('@', '');

  const resolvedAdminBadges = adminBadges || (badges && badges.__adminBadges) || {};
  const adminLevel = Number(member.admin || 0);
  let badgeInfo = null;
  if (adminLevel > 0) {
    badgeInfo = resolvedAdminBadges[String(adminLevel)]
      || resolvedAdminBadges['default']
      || resolvedAdminBadges['1']
      || { url: adminLevel === 2 ? '/img/admin2.png' : '/img/admin.png', size: '20px' };
  } else {
    badgeInfo = (badges && badges[String(member.rank || 0)]) || null;
  }

  let badgeUrl = badgeInfo ? badgeInfo.url : null;
  const badgeSize = badgeInfo ? (badgeInfo.size || '20px') : '20px';
  if (badgeUrl) {
    badgeUrl = getFullUrl(badgeUrl);
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
    const seenUrls = new Set();
    for (const awardType of memberAwards) {
      let badge = hofBadge[awardType];
      if (!badge && (awardType === 'best_mvp' || awardType === 'mvp' || awardType === 'most_mvp' || awardType === 'mvp_count' || awardType === 'top_mvp')) {
        badge = hofBadge['best_mvp'] || hofBadge['most_mvp'] || hofBadge['mvp_count'] || hofBadge['mvp'] || hofBadge['top_mvp'];
      }
      if (!badge && (awardType === 'most_pts' || awardType === 'avg_pts')) {
        badge = hofBadge['most_pts'] || hofBadge['avg_pts'];
      }
      if (!badge) {
        badge = hofBadge['default'] || Object.values(hofBadge)[0] || { id: 0, url: 'https://bearbit.org/pic/crown.gif', size: '20px' };
      }
      let bUrl = badge.url ? badge.url.trim() : null;
      const bSize = badge.size || '20px';
      const bId = badge.id || 0;
      if (bUrl && bUrl.toLowerCase() !== 'none' && bUrl !== '') {
        bUrl = getFullUrl(bUrl);
        if (!seenUrls.has(bUrl)) {
          seenUrls.add(bUrl);
          badgesWithId.push({ id: bId, url: bUrl, size: bSize });
        }
      }
    }
    badgesWithId.sort((a, b) => a.id - b.id);
    badgesWithId.forEach(b => hofBadges.push({ url: b.url, size: b.size }));
  } else if (hofCount > 0) {
    const badge = hofBadge['default'] || Object.values(hofBadge)[0] || { url: 'https://bearbit.org/pic/crown.gif', size: '20px' };
    let bUrl = badge.url ? badge.url.trim() : null;
    if (bUrl && bUrl.toLowerCase() !== 'none' && bUrl !== '') {
      bUrl = getFullUrl(bUrl);
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
  const hofBadgeSize = selectedHofBadge ? (selectedHofBadge.size || '20px') : '20px';
  if (hofBadgeUrl) {
    hofBadgeUrl = getFullUrl(hofBadgeUrl);
  }

  const rawPic = member.picture_url || member.pictureUrl;
  let pictureUrl = rawPic ? String(rawPic).trim() : null;
  if (pictureUrl) {
    if (pictureUrl.toLowerCase() === 'none' || pictureUrl.toLowerCase() === 'null' || pictureUrl === '') {
      pictureUrl = null;
    } else if (pictureUrl.startsWith('http://')) {
      pictureUrl = pictureUrl.replace('http://', 'https://');
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

/**
 * Fetches badge, donate color, HOF, and team color visual assets from template_tpl and hof_tbl.
 * @param {number} [targetYear=new Date().getFullYear()]
 * @returns {Promise<Object>}
 */
async function fetchDisplayAssets(targetYear = new Date().getFullYear()) {
  const badges = {};
  try {
    const badgeResults = await executeQuery("SELECT value, url, size FROM template_tpl WHERE name = 'rank_badge'");
    badgeResults.forEach(r => {
      badges[r.value] = { url: getFullUrl(r.url), size: r.size };
    });
  } catch (badgeErr) {
    logger.error('Error querying rank badges:', badgeErr.message);
  }

  const adminBadges = {};
  try {
    const adminBadgeResults = await executeQuery("SELECT value, url, size FROM template_tpl WHERE name = 'admin_badge'");
    adminBadgeResults.forEach(r => {
      const valKey = String(r.value ?? '').trim() || 'default';
      adminBadges[valKey] = { url: getFullUrl(r.url), size: r.size || '20px' };
    });
  } catch (adminBadgeErr) {
    logger.error('Error querying admin badges:', adminBadgeErr.message);
  }
  Object.defineProperty(badges, '__adminBadges', { value: adminBadges, enumerable: false });

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
    logger.error('Error querying donate colors:', colorErr.message);
  }

  const hofCounts = {};
  const hofAwards = {};
  try {
    const currentYear = targetYear || new Date().getFullYear();
    const hofResults = await executeQuery("SELECT member_id, type, year FROM hof_tbl");
    (hofResults || []).forEach(h => {
      const typeLower = String(h.type || '').toLowerCase().trim();
      const isBestMvp = typeLower === 'best_mvp' || typeLower === 'mvp' || typeLower === 'top_mvp';
      const recordYear = Number(h.year) || 0;

      // Best MVP HOF badge is displayed for only the current year
      if (isBestMvp && recordYear > 0 && recordYear !== currentYear) {
        return;
      }

      hofCounts[h.member_id] = (hofCounts[h.member_id] || 0) + 1;
      if (!hofAwards[h.member_id]) {
        hofAwards[h.member_id] = [];
      }
      hofAwards[h.member_id].push(h.type);
    });
  } catch (hofErr) {
    logger.error('Error querying HOF counts:', hofErr.message);
  }

  const hofBadge = {};
  try {
    const hofBadgeTpls = await executeQuery("SELECT id, value, url, size FROM template_tpl WHERE name = 'hof_badge' ORDER BY id ASC");
    hofBadgeTpls.forEach(r => {
      hofBadge[r.value] = { id: r.id, url: getFullUrl(r.url), size: r.size || '20px' };
    });
  } catch (hofBadgeErr) {
    logger.error('Error querying HOF badge template:', hofBadgeErr.message);
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
    logger.error('Error querying team color templates:', colorErr.message);
  }

  return { badges, adminBadges, donateColors, hofCounts, hofBadge, hofAwards, teamColors };
}

module.exports = {
  resolveMemberDisplayInfo,
  fetchDisplayAssets
};
