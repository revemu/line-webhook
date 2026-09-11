const svg2img = require('svg2img');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./query');
const { getFormatDate, getSlashDate } = require('./utils/date');

const teamImgDir = path.join(__dirname, 'img', 'team');
const fontPathSarabun = path.join(__dirname, 'fonts', 'Sarabun-Regular.ttf');
const fontPathKaohom = path.join(__dirname, 'fonts', 'LKKaohom.ttf');

// Ensure output directory exists
if (!fs.existsSync(teamImgDir)) {
  fs.mkdirSync(teamImgDir, { recursive: true });
}

/**
 * Clean up old team images older than 2 hours.
 */
function cleanupOldImages() {
  try {
    if (!fs.existsSync(teamImgDir)) return;
    const files = fs.readdirSync(teamImgDir);
    const now = Date.now();
    for (const file of files) {
      if (file.startsWith('team_') && file.endsWith('.png')) {
        const filePath = path.join(teamImgDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 2 * 3600 * 1000) {
          fs.unlinkSync(filePath);
          console.log(`[TeamImg-Cleanup] Deleted old team image: ${file}`);
        }
      }
    }
  } catch (err) {
    console.error('[TeamImg-Cleanup] Error cleaning up old team images:', err.message);
  }
}

/**
 * Fetches an image URL and converts it into a base64 Data URI.
 */
const avatarCache = new Map();
async function fetchImageAsBase64(url, timeoutMs = 2000) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  if (avatarCache.has(url)) return avatarCache.get(url);

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: timeoutMs
    });
    const contentType = response.headers['content-type'] || 'image/jpeg';
    const base64 = Buffer.from(response.data).toString('base64');
    const dataUri = `data:${contentType};base64,${base64}`;
    avatarCache.set(url, dataUri);
    return dataUri;
  } catch (err) {
    return null;
  }
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const posBadgeColor = {
  'GK': '#EAB308',
  'DF': '#3B82F6',
  'DW': '#06B6D4',
  'DM': '#10B981',
  'MF': '#8B5CF6',
  'AM': '#EC4899',
  'CF': '#EF4444'
};

const posIcons = {
  'GK': '🧤',
  'DF': '🛡️',
  'DW': '🏃',
  'DM': '⚓',
  'MF': '⚙️',
  'AM': '🎯',
  'CF': '⚡'
};

function getTeamHeaderColors(teamColorName) {
  const n = (teamColorName || '').toLowerCase();
  if (n.includes('yellow') || n.includes('เหลือง')) return { bg: '#854D0E', accent: '#FACC15', title: '#FEF08A', dot: '#FACC15' };
  if (n.includes('red') || n.includes('แดง')) return { bg: '#991B1B', accent: '#EF4444', title: '#FEE2E2', dot: '#EF4444' };
  if (n.includes('green') || n.includes('เขียว')) return { bg: '#166534', accent: '#22C55E', title: '#DCFCE7', dot: '#22C55E' };
  if (n.includes('blue') || n.includes('น้ำเงิน') || n.includes('ฟ้า')) return { bg: '#1E40AF', accent: '#3B82F6', title: '#DBEAFE', dot: '#38BDF8' };
  if (n.includes('orange') || n.includes('ส้ม')) return { bg: '#9A3412', accent: '#F97316', title: '#FFEDD5', dot: '#FB923C' };
  if (n.includes('pink') || n.includes('ชมพู')) return { bg: '#9D174D', accent: '#EC4899', title: '#FCE7F3', dot: '#F472B6' };
  if (n.includes('purple') || n.includes('ม่วง')) return { bg: '#6D28D9', accent: '#A855F7', title: '#EDE9FE', dot: '#C084FC' };
  if (n.includes('black') || n.includes('ดำ')) return { bg: '#1E293B', accent: '#94A3B8', title: '#F1F5F9', dot: '#CBD5E1' };
  if (n.includes('white') || n.includes('ขาว')) return { bg: '#334155', accent: '#F8FAFC', title: '#FFFFFF', dot: '#F8FAFC' };
  return { bg: '#1E293B', accent: '#38BDF8', title: '#FFFFFF', dot: '#38BDF8' };
}

/**
 * Builds the SVG string for a single team's tactical formation.
 */
async function buildTeamFormationSvg(team, dateStr = '', timeRange = '') {
  const isTotw = String(team.teamId || '').toLowerCase() === 'totw';
  const teamName = team.teamColor || `ทีม ${team.teamId}`;
  const teamNameFormatted = isTotw
    ? '🌟 Team of the Week 🌟'
    : (teamName.startsWith('ทีม') ? teamName : `ทีม ${teamName}`);

  const formattedDateStr = dateStr ? getFormatDate(dateStr, 'short') : '';
  const headerColors = getTeamHeaderColors(team.teamColor);

  // Pre-fetch all player avatars in parallel
  const allMembers = team.members || [];
  await Promise.all(allMembers.map(async (m) => {
    if (m.picture_url && !m.avatarDataUri) {
      m.avatarDataUri = await fetchImageAsBase64(m.picture_url);
    }
  }));

  // Identify Team MVP
  let momPlayer = null;
  if (!isTotw) {
    const validMoms = allMembers
      .filter(m => m.weekStats && m.weekStats.rating && m.weekStats.rating !== '-' && Number(m.weekStats.rating) > 0)
      .sort((a, b) => parseFloat(b.weekStats.rating) - parseFloat(a.weekStats.rating));
    if (validMoms.length > 0) {
      momPlayer = validMoms[0];
    }
  } else if (allMembers.length > 0) {
    momPlayer = allMembers[0];
  }
  const momPlayerId = momPlayer ? momPlayer.id : null;

  const slots = team.slots || {
    CF: [], AM: [], MF: [], DM: [], DW: [], DF: [], GK: [], alternates: []
  };

  const svgWidth = 800;
  const svgHeight = 1120;
  const pitchX = 40;
  const pitchY = 120;
  const pitchWidth = 720;
  const pitchHeight = 820;

  // Determine row positions on the tactical pitch
  const hasCF = slots.CF && slots.CF.length > 0;
  const hasAM = slots.AM && slots.AM.length > 0;
  const hasDM = slots.DM && slots.DM.length > 0;

  const rowLayouts = [];
  if (hasCF && hasAM) {
    rowLayouts.push({ role: 'CF', y: pitchY + 70, slots: slots.CF });
    rowLayouts.push({ role: 'AM', y: pitchY + 180, slots: slots.AM });
  } else if (hasCF) {
    rowLayouts.push({ role: 'CF', y: pitchY + 110, slots: slots.CF });
  } else if (hasAM) {
    rowLayouts.push({ role: 'AM', y: pitchY + 110, slots: slots.AM });
  } else {
    rowLayouts.push({ role: 'CF', y: pitchY + 110, slots: [{ primary: null, alternate: null }] });
  }

  rowLayouts.push({ role: 'MF', y: pitchY + (hasDM ? 290 : 320), slots: slots.MF && slots.MF.length > 0 ? slots.MF : [{ primary: null, alternate: null }] });

  if (hasDM) {
    rowLayouts.push({ role: 'DM', y: pitchY + 420, slots: slots.DM });
  }

  rowLayouts.push({
    role: 'DW',
    y: pitchY + (hasDM ? 540 : 500),
    slots: slots.DW && slots.DW.length > 0 ? slots.DW : [{ primary: null, alternate: null }, { primary: null, alternate: null }],
    isFlank: true
  });

  rowLayouts.push({ role: 'DF', y: pitchY + 650, slots: slots.DF && slots.DF.length > 0 ? slots.DF : [{ primary: null, alternate: null }] });

  rowLayouts.push({ role: 'GK', y: pitchY + 755, slots: slots.GK && slots.GK.length > 0 ? slots.GK : [{ primary: null, alternate: null }] });

  // Render individual player cards
  let defsSvg = '';
  let pitchPlayersSvg = '';

  const renderSinglePlayer = (player, posCode, isAlternate, isMom, cx, cy) => {
    if (!player) {
      // Empty slot placeholder
      return `
        <g transform="translate(${cx}, ${cy})">
          <circle cx="0" cy="0" r="22" fill="#1E293B" stroke="#FFFFFF44" stroke-width="2" stroke-dasharray="4 2"/>
          <text x="0" y="6" font-size="13" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8" text-anchor="middle">${escapeXml(posCode)}</text>
        </g>
      `;
    }

    const pId = player.id || Math.random().toString(36).substring(2, 7);
    const pName = (player.name || player.alias || (isAlternate ? 'Alt' : 'Player')).replace(/^@/, '');
    const icon = posIcons[posCode] || '';
    const pWStat = player.weekStats || {};
    const pHasWRating = pWStat.rating && pWStat.rating !== '-' && Number(pWStat.rating) > 0;
    const pRatingStr = pHasWRating ? `⭐${parseFloat(pWStat.rating).toFixed(1)}` : '⭐?';
    const badgeBg = isAlternate ? '#0284C7' : (posBadgeColor[posCode] || '#64748B');
    const badgeText = `${icon} ${posCode} ${pRatingStr}`;

    const borderColor = isMom ? '#F59E0B' : (isAlternate ? '#38BDF8' : '#FFFFFF');
    const borderWidth = isMom ? '3.5' : (isAlternate ? '2.5' : '2');
    const avatarR = 24;

    const clipId = `clip-avatar-${pId}-${isAlternate ? 'alt' : 'prim'}`;
    defsSvg += `<clipPath id="${clipId}"><circle cx="0" cy="0" r="${avatarR}"/></clipPath>\n`;

    const avatarSvg = player.avatarDataUri ? `
      <image href="${player.avatarDataUri}" x="-${avatarR}" y="-${avatarR}" width="${avatarR * 2}" height="${avatarR * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>
    ` : `
      <circle cx="0" cy="0" r="${avatarR}" fill="${isAlternate ? '#0C2A44' : '#1E293B'}"/>
      <text x="0" y="6" font-size="14" font-family="Sarabun, sans-serif" font-weight="bold" fill="${isMom ? '#FDE047' : (isAlternate ? '#38BDF8' : '#FFFFFF')}" text-anchor="middle">${isMom ? '👑' : escapeXml(posCode)}</text>
    `;

    const goals = Number(pWStat.goals || 0);
    const assists = Number(pWStat.assists || 0);
    const hasStats = goals > 0 || assists > 0;
    const statsStr = hasStats ? `⚽${goals} 👟${assists}` : '';

    const cardBoxWidth = 114;
    const cardBoxHeight = hasStats ? 46 : 34;

    return `
      <g transform="translate(${cx}, ${cy})">
        <!-- Avatar Ring -->
        <circle cx="0" cy="0" r="${avatarR + 1}" fill="none" stroke="${borderColor}" stroke-width="${borderWidth}"/>
        ${avatarSvg}
        ${isMom ? '<text x="12" y="-16" font-size="18">👑</text>' : ''}

        <!-- Name & Badge Card -->
        <g transform="translate(0, ${avatarR + 4})">
          <rect x="-${cardBoxWidth / 2}" y="0" width="${cardBoxWidth}" height="${cardBoxHeight}" rx="6" fill="${isAlternate ? '#071828EE' : (isMom ? '#1A1608F4' : '#000000CC')}" stroke="${isMom ? '#F59E0BCC' : (isAlternate ? '#38BDF888' : '#FFFFFF33')}" stroke-width="1"/>
          
          <!-- Position & Rating Pill -->
          <rect x="-42" y="3" width="84" height="15" rx="3" fill="${badgeBg}"/>
          <text x="0" y="14" font-size="9.5" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${escapeXml(badgeText)}</text>

          <!-- Player Name -->
          <text x="0" y="28" font-size="11" font-family="Sarabun, sans-serif" font-weight="bold" fill="${isMom ? '#FDE047' : (isAlternate ? '#38BDF8' : '#FFFFFF')}" text-anchor="middle">${escapeXml(pName.length > 12 ? pName.slice(0, 11) + '..' : pName)}</text>

          ${hasStats ? `
          <!-- Stats Line -->
          <text x="0" y="41" font-size="9" font-family="Sarabun, sans-serif" font-weight="bold" fill="${isMom ? '#FDE047' : '#FCD34D'}" text-anchor="middle">${escapeXml(statsStr)}</text>
          ` : ''}
        </g>
      </g>
    `;
  };

  // Iterate over row layouts and place slots
  for (const row of rowLayouts) {
    const slotList = row.slots || [];
    const numSlots = slotList.length;

    if (row.isFlank) {
      // Left and right flank placement
      const leftSlot = slotList[0] || { primary: null, alternate: null };
      const rightSlot = slotList[1] || { primary: null, alternate: null };

      // Left Flank (DW Left)
      const lx = pitchX + 110;
      if (leftSlot.primary && leftSlot.alternate) {
        pitchPlayersSvg += renderSinglePlayer(leftSlot.primary, 'DW', false, momPlayerId === leftSlot.primary?.id, lx - 48, row.y);
        pitchPlayersSvg += renderSinglePlayer(leftSlot.alternate, 'DW', true, momPlayerId === leftSlot.alternate?.id, lx + 48, row.y);
      } else {
        pitchPlayersSvg += renderSinglePlayer(leftSlot.primary, 'DW', false, momPlayerId === leftSlot.primary?.id, lx, row.y);
      }

      // Right Flank (DW Right)
      const rx = pitchX + pitchWidth - 110;
      if (rightSlot.primary && rightSlot.alternate) {
        pitchPlayersSvg += renderSinglePlayer(rightSlot.primary, 'DW', false, momPlayerId === rightSlot.primary?.id, rx - 48, row.y);
        pitchPlayersSvg += renderSinglePlayer(rightSlot.alternate, 'DW', true, momPlayerId === rightSlot.alternate?.id, rx + 48, row.y);
      } else {
        pitchPlayersSvg += renderSinglePlayer(rightSlot.primary, 'DW', false, momPlayerId === rightSlot.primary?.id, rx, row.y);
      }
    } else {
      // Center distributed slots
      const centerX = pitchX + pitchWidth / 2;
      let xPositions = [];
      if (numSlots === 1) {
        xPositions = [centerX];
      } else if (numSlots === 2) {
        xPositions = [centerX - 120, centerX + 120];
      } else if (numSlots === 3) {
        xPositions = [centerX - 180, centerX, centerX + 180];
      }

      slotList.forEach((slot, idx) => {
        const cx = xPositions[idx] || centerX;
        if (slot.primary && slot.alternate) {
          pitchPlayersSvg += renderSinglePlayer(slot.primary, row.role, false, momPlayerId === slot.primary?.id, cx - 52, row.y);
          pitchPlayersSvg += renderSinglePlayer(slot.alternate, row.role, true, momPlayerId === slot.alternate?.id, cx + 52, row.y);
        } else {
          pitchPlayersSvg += renderSinglePlayer(slot.primary, row.role, false, momPlayerId === slot.primary?.id, cx, row.y);
        }
      });
    }
  }

  // Pitch Lawn Stripes
  let pitchStripesSvg = '';
  const stripeHeight = pitchHeight / 10;
  for (let i = 0; i < 10; i++) {
    const stripeColor = i % 2 === 0 ? '#15803D' : '#166534';
    pitchStripesSvg += `<rect x="${pitchX}" y="${pitchY + i * stripeHeight}" width="${pitchWidth}" height="${stripeHeight}" fill="${stripeColor}"/>\n`;
  }

  // Bottom MVP Bar SVG
  let mvpBarSvg = '';
  if (momPlayer) {
    const momName = (momPlayer.name || momPlayer.alias || 'Player').replace(/^@/, '');
    const momRatingVal = (momPlayer.weekStats?.rating && momPlayer.weekStats.rating !== '-' && Number(momPlayer.weekStats.rating) > 0)
      ? parseFloat(momPlayer.weekStats.rating).toFixed(1)
      : 'n/a';
    const momGoals = Number(momPlayer.weekStats?.goals || 0);
    const momAssists = Number(momPlayer.weekStats?.assists || 0);
    const statsParts = [];
    if (momGoals > 0) statsParts.push(`⚽ ${momGoals} ประตู`);
    if (momAssists > 0) statsParts.push(`👟 ${momAssists} แอสซิสต์`);
    const momStatsDesc = statsParts.length > 0 ? statsParts.join('  ') : 'ลงสนามสัปดาห์นี้';

    const momClipId = `clip-mom-${momPlayer.id}`;
    defsSvg += `<clipPath id="${momClipId}"><circle cx="85" cy="1005" r="24"/></clipPath>\n`;

    const momAvatarSvg = momPlayer.avatarDataUri ? `
      <image href="${momPlayer.avatarDataUri}" x="61" y="981" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="url(#${momClipId})"/>
    ` : `
      <circle cx="85" cy="1005" r="24" fill="#2A1802"/>
      <text x="85" y="1011" font-size="18" text-anchor="middle">👑</text>
    `;

    mvpBarSvg = `
      <!-- MVP Container -->
      <g transform="translate(40, 960)">
        <rect x="0" y="0" width="720" height="90" rx="12" fill="#0F172ACC" stroke="#F59E0B" stroke-width="1.8"/>
        
        <!-- Avatar Ring -->
        <circle cx="45" cy="45" r="25" fill="none" stroke="#F59E0B" stroke-width="2.5"/>
        ${momAvatarSvg.replace(/cx="85" cy="1005"/g, 'cx="45" cy="45"').replace(/x="61" y="981"/g, 'x="21" y="21"')}

        <!-- MVP Info -->
        <text x="85" y="32" font-size="13" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FCD34D">${isTotw ? '👑 Week MVP' : '👑 Team MVP'}</text>
        <text x="175" y="32" font-size="15" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF">• ${escapeXml(momName)}</text>
        <text x="85" y="58" font-size="13" font-family="Sarabun, sans-serif" fill="#CBD5E1">${escapeXml(momStatsDesc)}</text>

        <!-- Rating Box -->
        <rect x="600" y="22" width="100" height="46" rx="8" fill="#231602" stroke="#F59E0B" stroke-width="1.5"/>
        <text x="650" y="52" font-size="18" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FDE047" text-anchor="middle">⭐ ${momRatingVal}</text>
      </g>
    `;
  } else {
    mvpBarSvg = `
      <!-- MVP Placeholder Container -->
      <g transform="translate(40, 960)">
        <rect x="0" y="0" width="720" height="90" rx="12" fill="#0F172ACC" stroke="#475569" stroke-width="1.2"/>
        <circle cx="45" cy="45" r="24" fill="#1E293B" stroke="#475569" stroke-width="1.2"/>
        <text x="45" y="52" font-size="18" text-anchor="middle">👑</text>

        <text x="85" y="34" font-size="13" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8">${isTotw ? '👑 Week MVP' : '👑 Team MVP'}</text>
        <text x="175" y="34" font-size="15" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8">• n/a</text>
        <text x="85" y="60" font-size="13" font-family="Sarabun, sans-serif" fill="#64748B">ยังไม่มีการแข่งขันสัปดาห์นี้</text>

        <rect x="600" y="22" width="100" height="46" rx="8" fill="#1E293B" stroke="#475569" stroke-width="1"/>
        <text x="650" y="52" font-size="18" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8" text-anchor="middle">⭐ n/a</text>
      </g>
    `;
  }

  // Header Subtitle Text
  const subItems = [];
  if (formattedDateStr) subItems.push(`📅 ${formattedDateStr}`);
  subItems.push(`📋 ${team.totalPlayers || 0} คน • ${team.formationName || 'ผังการเล่น'}`);
  if (timeRange) subItems.push(`⏰ ${timeRange}`);
  const headerSubtitle = subItems.join('   ');

  // Assembly Full SVG
  const svg = `
<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B0F19"/>
      <stop offset="100%" stop-color="#05070D"/>
    </linearGradient>
    <linearGradient id="header-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${headerColors.bg}"/>
      <stop offset="100%" stop-color="#0F172A"/>
    </linearGradient>
    <clipPath id="pitch-clip">
      <rect x="${pitchX}" y="${pitchY}" width="${pitchWidth}" height="${pitchHeight}" rx="14"/>
    </clipPath>
    ${defsSvg}
  </defs>

  <!-- Background Base -->
  <rect width="${svgWidth}" height="${svgHeight}" fill="url(#bg-grad)"/>

  <!-- Top Header Bar -->
  <g transform="translate(40, 20)">
    <rect x="0" y="0" width="720" height="84" rx="14" fill="url(#header-grad)" stroke="${headerColors.accent}" stroke-width="1.8"/>
    
    <!-- Dot & Title -->
    <circle cx="28" cy="30" r="7" fill="${headerColors.dot}"/>
    <text x="46" y="38" font-size="22" font-family="Sarabun, sans-serif" font-weight="bold" fill="${headerColors.title}">${escapeXml(teamNameFormatted)}</text>
    
    <!-- Subtitle Line -->
    <text x="24" y="66" font-size="13" font-family="Sarabun, sans-serif" font-weight="bold" fill="#CBD5E1">${escapeXml(headerSubtitle)}</text>
  </g>

  <!-- Football Pitch (Lawn Stripes & Markings) -->
  <g clip-path="url(#pitch-clip)">
    <!-- Alternating Lawn Stripes -->
    ${pitchStripesSvg}

    <!-- Halfway Line -->
    <line x1="${pitchX}" y1="${pitchY + pitchHeight / 2}" x2="${pitchX + pitchWidth}" y2="${pitchY + pitchHeight / 2}" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2"/>

    <!-- Center Circle & Spot -->
    <circle cx="${pitchX + pitchWidth / 2}" cy="${pitchY + pitchHeight / 2}" r="70" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2"/>
    <circle cx="${pitchX + pitchWidth / 2}" cy="${pitchY + pitchHeight / 2}" r="4" fill="#FFFFFF" fill-opacity="0.7"/>

    <!-- Top Penalty Area & Goal Area -->
    <rect x="${pitchX + (pitchWidth - 280) / 2}" y="${pitchY}" width="280" height="120" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2"/>
    <rect x="${pitchX + (pitchWidth - 140) / 2}" y="${pitchY}" width="140" height="45" fill="none" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="1.5"/>
    <circle cx="${pitchX + pitchWidth / 2}" cy="${pitchY + 85}" r="3" fill="#FFFFFF" fill-opacity="0.7"/>

    <!-- Bottom Penalty Area & Goal Area -->
    <rect x="${pitchX + (pitchWidth - 280) / 2}" y="${pitchY + pitchHeight - 120}" width="280" height="120" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2"/>
    <rect x="${pitchX + (pitchWidth - 140) / 2}" y="${pitchY + pitchHeight - 45}" width="140" height="45" fill="none" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="1.5"/>
    <circle cx="${pitchX + pitchWidth / 2}" cy="${pitchY + pitchHeight - 85}" r="3" fill="#FFFFFF" fill-opacity="0.7"/>

    <!-- Corner Arcs -->
    <path d="M ${pitchX} ${pitchY + 25} A 25 25 0 0 0 ${pitchX + 25} ${pitchY}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2"/>
    <path d="M ${pitchX + pitchWidth - 25} ${pitchY} A 25 25 0 0 0 ${pitchX + pitchWidth} ${pitchY + 25}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2"/>
    <path d="M ${pitchX} ${pitchY + pitchHeight - 25} A 25 25 0 0 1 ${pitchX + 25} ${pitchY + pitchHeight}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2"/>
    <path d="M ${pitchX + pitchWidth - 25} ${pitchY + pitchHeight} A 25 25 0 0 1 ${pitchX + pitchWidth} ${pitchY + pitchHeight - 25}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2"/>

    <!-- Pitch Players Nodes -->
    ${pitchPlayersSvg}
  </g>

  <!-- Pitch Outer Border Frame -->
  <rect x="${pitchX}" y="${pitchY}" width="${pitchWidth}" height="${pitchHeight}" rx="14" fill="none" stroke="#FFFFFF" stroke-opacity="0.7" stroke-width="2.5"/>

  <!-- MVP Bottom Highlight Bar -->
  ${mvpBarSvg}

  <!-- Footer Watermark -->
  <text x="${svgWidth / 2}" y="${svgHeight - 20}" font-size="11" font-family="Sarabun, sans-serif" fill="#64748B" text-anchor="middle">Generated by Revemu Football Bot • ${new Date().getFullYear()}</text>
</svg>
`;

  return svg;
}

/**
 * Converts SVG to PNG and saves it into img/team/
 * @returns {Promise<string>} filename
 */
async function convertSvgToPng(svgString) {
  cleanupOldImages();

  const filename = `team_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
  const filePath = path.join(teamImgDir, filename);

  const imgOptions = { format: 'png', width: 800, height: 1120 };
  const fontFiles = [];
  if (fs.existsSync(fontPathSarabun)) fontFiles.push(fontPathSarabun);
  if (fs.existsSync(fontPathKaohom)) fontFiles.push(fontPathKaohom);

  if (fontFiles.length > 0) {
    imgOptions.resvg = {
      font: {
        fontFiles: fontFiles,
        loadSystemFonts: true,
        defaultFontFamily: 'Sarabun',
        sansSerifFamily: 'Sarabun'
      }
    };
  }

  return new Promise((resolve, reject) => {
    svg2img(svgString, imgOptions, (error, buffer) => {
      if (error) return reject(error);
      fs.writeFile(filePath, buffer, (writeErr) => {
        if (writeErr) return reject(writeErr);
        resolve(filename);
      });
    });
  });
}

/**
 * Generates an exported image for a single team formation.
 * @param {Object} team - FormationsData item
 * @param {string} dateStr - Short date string
 * @param {string} timeRange - Time range string
 * @returns {Promise<string>} Image public URL
 */
async function generateTeamImage(team, dateStr = '', timeRange = '') {
  const svg = await buildTeamFormationSvg(team, dateStr, timeRange);
  const filename = await convertSvgToPng(svg);

  let baseUrl = global.baseWebhookUrl || "https://api.revemu.org";
  if (baseUrl.startsWith('http://')) baseUrl = baseUrl.replace('http://', 'https://');
  return `${baseUrl}/img/team/${filename}`;
}

/**
 * Generates image(s) for formation(s) by command parameter.
 * @param {string} param - Command parameter (e.g. '1', 'yellow', '12/09/2026', 'all', etc.)
 * @param {string|null} groupId - LINE Group ID
 * @returns {Promise<Array<string>>} Array of generated image URLs
 */
async function generateTeamFormationImages(param = '', groupId = null) {
  const data = await db.getTeamFormationData(param, groupId);
  if (!data || !data.formationsData || data.formationsData.length === 0) {
    return [];
  }

  const imageUrls = [];
  for (const team of data.formationsData) {
    if (imageUrls.length >= 4) break; // Limit to 4 images per reply
    try {
      const url = await generateTeamImage(team, data.dateStr, data.timeRange);
      if (url) imageUrls.push(url);
    } catch (err) {
      console.error(`[TeamImg] Failed to generate image for team ${team.teamId}:`, err.message);
    }
  }

  return imageUrls;
}

module.exports = {
  buildTeamFormationSvg,
  generateTeamImage,
  generateTeamFormationImages,
  cleanupOldImages
};
