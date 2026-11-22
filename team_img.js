const { renderAsync } = require('@resvg/resvg-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./query');
const logger = require('./utils/logger');
const { getFormatDate, getSlashDate } = require('./utils/date');
const { hasRamImage, cacheAndPersistAsync } = require('./utils/ramImageCache');
const {
  AVATAR_CACHE_DIR: avatarCacheDir,
  getAvatarDiskCachePath,
  resolveWebAvatarUrl: resolveBrowserAvatarUrl,
  fetchImageAsBase64,
  getCachedBase64
} = require('./utils/avatarCache');

const teamImgDir = path.join(__dirname, 'img', 'team');
const fontPathSarabun = path.join(__dirname, 'fonts', 'Sarabun-Regular.ttf');
const fontPathSarabunBold = path.join(__dirname, 'fonts', 'Sarabun-Bold.ttf');
const fontPathKaohom = path.join(__dirname, 'fonts', 'LKKaohom.ttf');
const RENDER_SCALE = 1.5;

// Ensure output directories exist
if (!fs.existsSync(teamImgDir)) {
  fs.mkdirSync(teamImgDir, { recursive: true });
}

// Pre-load custom Goal & Assist icons as Base64 Data URIs (resvg requires data: URIs for <image> tags)
let goalIconDataUri = '';
let assistIconDataUri = '';

try {
  const goalPath = path.join(__dirname, 'assets', 'icon_goal2.png');
  if (fs.existsSync(goalPath)) {
    goalIconDataUri = `data:image/png;base64,${fs.readFileSync(goalPath).toString('base64')}`;
  }
} catch (e) {
  logger.warn('[TeamImg] Could not load icon_goal.png:', e.message);
}

try {
  const assistPath = path.join(__dirname, 'assets', 'icon_assist2.png');
  if (fs.existsSync(assistPath)) {
    assistIconDataUri = `data:image/png;base64,${fs.readFileSync(assistPath).toString('base64')}`;
  }
} catch (e) {
  logger.warn('[TeamImg] Could not load icon_assist.png:', e.message);
}

// Crown SVG paths inlined from assets/crown.svg (512x512 viewBox)
const CROWN_PATHS = `
  <path style="fill:#F5BE18;" d="M255.835,150.83L230.12,289.462l-58.519-130.06l6.923,141.929l-62.805-106.324l37.584,178.194 c12.858,0,71.377-10.221,102.696-10.055c53.738,0.329,101.707,5.11,102.532,10.055l37.584-178.194l-62.805,106.324l6.923-141.929 l-58.684,130.225L255.835,150.83z"/>
  <path style="fill:#FFD630;" d="M255.835,150.83L230.12,289.462l-58.519-130.06l6.923,141.929l-62.805-106.324l37.584,178.194l0,0 c3.626-4.946,46.815-10.055,102.532-10.055L255.835,150.83L255.835,150.83z"/>
  <path style="fill:#F5BE18;" d="M113.742,172.59c9.726,0,17.639,7.912,17.639,17.639s-7.912,17.639-17.639,17.639 s-17.639-7.912-17.639-17.639S104.016,172.59,113.742,172.59z M398.424,171.766c9.726,0,17.639,7.912,17.639,17.639 c0,9.726-7.912,17.639-17.639,17.639s-17.639-7.912-17.639-17.639C380.786,179.678,388.698,171.766,398.424,171.766z M340.894,137.643c9.726,0,17.639,7.912,17.639,17.639c0,9.726-7.912,17.639-17.639,17.639c-9.726,0-17.639-7.912-17.639-17.639 C323.255,145.555,331.168,137.643,340.894,137.643z M256,129.566c9.726,0,17.639,7.912,17.639,17.639 c0,9.726-7.912,17.639-17.639,17.639s-17.639-7.912-17.639-17.639C238.361,137.479,246.275,129.566,256,129.566z M169.952,137.149 c9.726,0,17.639,7.912,17.639,17.639c0,9.726-7.912,17.639-17.639,17.639c-9.726,0-17.639-7.912-17.639-17.639 C152.314,145.061,160.227,137.149,169.952,137.149z"/>
  <path style="fill:#FFD630;" d="M113.742,172.59c9.726,0,17.639,7.912,17.639,17.639s-7.912,17.639-17.639,17.639 s-17.639-7.912-17.639-17.639S104.016,172.59,113.742,172.59z M256,129.401v35.276c-9.726,0-17.639-7.912-17.639-17.639 C238.361,137.313,246.275,129.401,256,129.401z M169.952,136.984c9.726,0,17.639,7.912,17.639,17.639 c0,9.726-7.912,17.639-17.639,17.639c-9.726,0-17.639-7.912-17.639-17.639C152.314,144.897,160.227,136.984,169.952,136.984z"/>
`;


/**
 * Strips raw emojis and special unicode symbols to prevent resvg tofu boxes
 */
function stripEmojis(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{FE0F}]/gu, '')
    .trim();
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

function getTeamHeaderColors(teamColorName) {
  const c = String(teamColorName || '').toLowerCase().replace(/^ทีม(สี)?/, '').replace(/^สี/, '').trim();
  if (c.includes('team of the week') || c.includes('totw') || c.includes('ยอดเยี่ยม') || c.includes('gold')) {
    return { bg: '#1E1B4B', titleColor: '#FDE047', subColor: '#E2E8F0', badgeBg: '#4338CA', badgeText: '#FDE047', dot: '#F59E0B', border: '#4338CA' };
  }
  if (c.includes('white') || c.includes('ขาว')) {
    return { bg: '#F1F5F9', titleColor: '#0F172A', subColor: '#475569', badgeBg: '#CBD5E1', badgeText: '#0F172A', dot: '#94A3B8', border: '#CBD5E1' };
  }
  if (c.includes('yellow') || c.includes('เหลือง')) {
    return { bg: '#EAB308', titleColor: '#000000', subColor: '#1E293B', badgeBg: '#CA8A04', badgeText: '#FFFFFF', dot: '#713F12', border: '#FACC15' };
  }
  if (c.includes('red') || c.includes('แดง')) {
    return { bg: '#B91C1C', titleColor: '#FFFFFF', subColor: '#FECACA', badgeBg: '#7F1D1D', badgeText: '#FEE2E2', dot: '#F87171', border: '#EF4444' };
  }
  if (c.includes('green') || c.includes('เขียว')) {
    return { bg: '#15803D', titleColor: '#FFFFFF', subColor: '#DCFCE7', badgeBg: '#14532D', badgeText: '#BBF7D0', dot: '#4ADE80', border: '#22C55E' };
  }
  if (c.includes('blue') || c.includes('น้ำเงิน')) {
    return { bg: '#1D4ED8', titleColor: '#FFFFFF', subColor: '#DBEAFE', badgeBg: '#1E3A8A', badgeText: '#BFDBFE', dot: '#60A5FA', border: '#3B82F6' };
  }
  if (c.includes('cyan') || c.includes('ฟ้า')) {
    return { bg: '#0284C7', titleColor: '#FFFFFF', subColor: '#E0F2FE', badgeBg: '#075985', badgeText: '#BAE6FD', dot: '#38BDF8', border: '#38BDF8' };
  }
  if (c.includes('black') || c.includes('ดำ')) {
    return { bg: '#18181B', titleColor: '#FFFFFF', subColor: '#A1A1AA', badgeBg: '#27272A', badgeText: '#E4E4E7', dot: '#71717A', border: '#3F3F46' };
  }
  if (c.includes('orange') || c.includes('ส้ม')) {
    return { bg: '#C2410C', titleColor: '#FFFFFF', subColor: '#FFEDD5', badgeBg: '#7C2D12', badgeText: '#FED7AA', dot: '#FB923C', border: '#F97316' };
  }
  if (c.includes('pink') || c.includes('ชมพู')) {
    return { bg: '#BE185D', titleColor: '#FFFFFF', subColor: '#FCE7F3', badgeBg: '#831843', badgeText: '#FBCFE8', dot: '#F472B6', border: '#EC4899' };
  }
  if (c.includes('purple') || c.includes('ม่วง')) {
    return { bg: '#6D28D9', titleColor: '#FFFFFF', subColor: '#EDE9FE', badgeBg: '#4C1D95', badgeText: '#DDD6FE', dot: '#A78BFA', border: '#A855F7' };
  }
  return { bg: '#0B0F19', titleColor: '#FFFFFF', subColor: '#94A3B8', badgeBg: '#1E293B', badgeText: '#38BDF8', dot: '#3B82F6', border: '#334155' };
}

/**
 * Builds the SVG string for a single team's tactical formation.
 */
async function buildTeamFormationSvg(team, dateStr = '', timeRange = '', options = {}) {
  const isTotw = String(team.teamId || '').toLowerCase() === 'totw';
  const embedAssets = options.embedAvatars !== false;
  const svgUid = String(options.svgUid || team.teamId || 't').replace(/[^a-zA-Z0-9_-]/g, '_');
  const resolvedGoalIconHref = embedAssets ? goalIconDataUri : '/webhook/assets/icon_goal2.png';
  const resolvedAssistIconHref = embedAssets ? assistIconDataUri : '/webhook/assets/icon_assist2.png';

  // Format team name: remove 'ทีม' / 'ทีม ' prefix as requested (e.g. 'Red', 'Yellow', 'Green')
  let rawTeamColor = team.teamColor || `Team ${team.teamId}`;
  rawTeamColor = stripEmojis(rawTeamColor).replace(/^ทีม(สี)?\s*/i, '').replace(/^สี/i, '').trim();
  const teamNameFormatted = isTotw ? 'Team of the Week' : (rawTeamColor || 'Team');

  const formattedDateStr = dateStr ? getFormatDate(dateStr, 'short') : '';
  const headerColors = getTeamHeaderColors(team.teamColor);

  const slots = team.slots || {
    CF: [], AM: [], MF: [], DM: [], DW: [], DF: [], GK: [], alternates: []
  };

  const allMembers = team.members || [];

  // Collect ALL player objects from team.members and all formation slots
  const playersToLoad = new Set();
  allMembers.forEach(m => { if (m) playersToLoad.add(m); });

  Object.values(slots).forEach(slotGroup => {
    if (Array.isArray(slotGroup)) {
      slotGroup.forEach(slot => {
        if (slot) {
          if (slot.primary) playersToLoad.add(slot.primary);
          if (slot.alternate) playersToLoad.add(slot.alternate);
          if (slot.id && !slot.primary && !slot.alternate) playersToLoad.add(slot);
        }
      });
    }
  });

  // Pre-fetch all player avatars in parallel when embedding base64 (for resvg PNG generation)
  if (embedAssets) {
    await Promise.all(Array.from(playersToLoad).map(async (m) => {
      const rawPic = m.picture_url || m.pictureUrl;
      if (rawPic && !m.avatarDataUri) {
        m.avatarDataUri = await fetchImageAsBase64(rawPic);
      }
    }));
  }

  // Identify Team / Week MVP (Highest rating player with goals/assists tiebreaker)
  let momPlayer = null;
  let topRating = -1;
  let topGoals = -1;
  let topAssists = -1;

  for (const m of allMembers) {
    if (!m) continue;
    const rRaw = m.weekStats?.rating || m.score || m.raw_score || 0;
    const wRating = (!isNaN(parseFloat(rRaw)) && rRaw !== '-') ? parseFloat(rRaw) : 0;
    const wGoals = Number(m.weekStats?.goals || m.goals || 0) || 0;
    const wAssists = Number(m.weekStats?.assists || m.assists || 0) || 0;

    if (wRating > topRating && wRating > 0) {
      topRating = wRating;
      topGoals = wGoals;
      topAssists = wAssists;
      momPlayer = m;
    } else if (wRating === topRating && wRating > 0) {
      if (wGoals > topGoals || (wGoals === topGoals && wAssists > topAssists)) {
        topGoals = wGoals;
        topAssists = wAssists;
        momPlayer = m;
      }
    }
  }

  // No fallback: if no player has a real match rating > 0, momPlayer stays null
  // and no crown will be shown (match hasn't been played yet)

  const momPlayerId = momPlayer ? (momPlayer.id || momPlayer.member_id) : null;
  const isMomPlayer = (p) => {
    if (!p || !momPlayer) return false;
    const pId = p.id || p.member_id;
    const mId = momPlayer.id || momPlayer.member_id;
    if (pId && mId && String(pId) === String(mId)) return true;
    if (p.name && momPlayer.name && p.name.trim() === momPlayer.name.trim()) return true;
    return false;
  };

  // Determine dimensions based on pitchOnly mode
  const pitchOnly = !!options.pitchOnly;
  const svgWidth = 1080;
  const pitchX = 40;
  const pitchY = pitchOnly ? 25 : 142;
  const pitchWidth = 1000;
  const pitchHeight = 1260;
  const svgHeight = pitchOnly ? (pitchY + pitchHeight + 25) : 1606;

  // Determine row positions on the tactical pitch (1080p layout with expanded spacing)
  const hasCF = slots.CF && slots.CF.length > 0;
  const hasAM = slots.AM && slots.AM.length > 0;
  const hasDM = slots.DM && slots.DM.length > 0;

  const rowLayouts = [];
  if (hasCF && hasAM) {
    rowLayouts.push({ role: 'CF', y: pitchY + 75, slots: slots.CF });
    rowLayouts.push({ role: 'AM', y: pitchY + 265, slots: slots.AM });
  } else if (hasCF) {
    rowLayouts.push({ role: 'CF', y: pitchY + 105, slots: slots.CF });
  } else if (hasAM) {
    rowLayouts.push({ role: 'AM', y: pitchY + 135, slots: slots.AM });
  } else {
    rowLayouts.push({ role: 'CF', y: pitchY + 105, slots: [{ primary: null, alternate: null }] });
  }

  rowLayouts.push({
    role: 'MF',
    y: pitchY + (hasCF && hasAM ? (hasDM ? 450 : 475) : (hasDM ? 385 : 460)),
    slots: slots.MF && slots.MF.length > 0 ? slots.MF : [{ primary: null, alternate: null }]
  });

  if (hasDM) {
    rowLayouts.push({ role: 'DM', y: pitchY + (hasCF && hasAM ? 635 : 595), slots: slots.DM });
  }

  rowLayouts.push({
    role: 'DW',
    y: pitchY + (hasDM ? 785 : 725),
    slots: slots.DW && slots.DW.length > 0 ? slots.DW : [{ primary: null, alternate: null }, { primary: null, alternate: null }],
    isFlank: true
  });

  rowLayouts.push({ role: 'DF', y: pitchY + 945, slots: slots.DF && slots.DF.length > 0 ? slots.DF : [{ primary: null, alternate: null }] });

  rowLayouts.push({ role: 'GK', y: pitchY + 1145, slots: slots.GK && slots.GK.length > 0 ? slots.GK : [{ primary: null, alternate: null }] });

  // Render individual player cards
  let defsSvg = '';
  let pitchPlayersSvg = '';

  const renderSinglePlayer = (player, posCode, isAlternate, isMom, cx, cy) => {
    if (!player) {
      // Empty slot placeholder (enlarged)
      return `
        <g transform="translate(${cx}, ${cy})">
          <circle cx="0" cy="0" r="52" fill="#1E293B" stroke="#FFFFFF44" stroke-width="3" stroke-dasharray="8 4"/>
          <text x="0" y="10" font-size="26" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8" text-anchor="middle">${escapeXml(posCode)}</text>
        </g>
      `;
    }

    const pId = player.id || Math.random().toString(36).substring(2, 7);
    const rawName = (player.name || player.alias || (isAlternate ? 'สำรอง' : 'Player')).replace(/^@/, '');
    const cleanRaw = stripEmojis(rawName)
      .replace(/\s*[\(\[]\s*(alt|alternate|สำรอง|ตัวสำรอง)\s*[\)\]]\s*/gi, '')
      .trim();
    const pName = cleanRaw || (isAlternate ? 'สำรอง' : 'Player');
    const pWStat = player.weekStats || {};
    const pHasWRating = pWStat.rating && pWStat.rating !== '-' && Number(pWStat.rating) > 0;
    const pRatingVal = pHasWRating ? parseFloat(pWStat.rating).toFixed(1) : '-';
    const posColor = posBadgeColor[posCode] || '#64748B';

    const borderColor = isMom ? '#F59E0B' : (isAlternate ? '#38BDF8' : '#FFFFFF');
    const borderWidth = isMom ? '5' : (isAlternate ? '4' : '3.2');
    const avatarR = 52;

    const clipId = `clip-avatar-${svgUid}-${pId}-${isAlternate ? 'alt' : 'prim'}`;
    defsSvg += `<clipPath id="${clipId}"><circle cx="0" cy="0" r="${avatarR}"/></clipPath>\n`;

    const rawPic = player.picture_url || player.pictureUrl;
    const playerPicUrl = rawPic ? rawPic.trim().replace(/^http:\/\//i, 'https://') : null;
    const avatarHref = embedAssets
      ? (player.avatarDataUri || (playerPicUrl ? getCachedBase64(playerPicUrl) : null))
      : resolveBrowserAvatarUrl(rawPic);

    const avatarSvg = avatarHref ? `
      <image href="${escapeXml(avatarHref)}" xlink:href="${escapeXml(avatarHref)}" x="-${avatarR}" y="-${avatarR}" width="${avatarR * 2}" height="${avatarR * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>
    ` : `
      <circle cx="0" cy="0" r="${avatarR}" fill="${isAlternate ? '#0C2A44' : '#1E293B'}"/>
      <text x="0" y="11" font-size="24" font-family="Sarabun, sans-serif" font-weight="bold" fill="${isMom ? '#FDE047' : (isAlternate ? '#38BDF8' : '#FFFFFF')}" text-anchor="middle">${escapeXml(posCode)}</text>
    `;

    const goals = Number(pWStat.goals || 0);
    const assists = Number(pWStat.assists || 0);

    // 1. Overlapping Rating Badge (Top-Right)
    let ratingBadgeSvg = '';
    if (pHasWRating) {
      const numRating = parseFloat(pWStat.rating);
      let badgeBg = '#22C55E';
      if (isMom) badgeBg = '#2563EB'; // FotMob MVP Blue
      else if (numRating >= 3.0) badgeBg = '#22C55E'; // Green
      else if (numRating >= 2.0) badgeBg = '#F59E0B'; // Amber
      else badgeBg = '#EF4444'; // Red

      const pillWidth = isMom ? 82 : 72;
      const pillHeight = 40;
      const pillX = 22;
      const pillY = -70;

      ratingBadgeSvg = `
        <g transform="translate(${pillX}, ${pillY})">
          <rect x="0" y="0" width="${pillWidth}" height="${pillHeight}" rx="15" fill="${badgeBg}" stroke="#FFFFFF" stroke-width="2.5"/>
          <text x="${isMom ? 32 : pillWidth / 2}" y="28" font-size="25" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${pRatingVal}</text>
          ${isMom ? `<g transform="translate(-16, -6) scale(1.5)"><polygon points="53,8 55.5,14 62,14 57,18 59,24 53,20 47,24 49,18 44,14 50.5,14" fill="#FDE047"/></g>` : ''}
        </g>
      `;
    }

    // 2. Overlapping Goal Badge (Bottom-Right)
    const goalBadgeSvg = goals > 0 ? `
      <g transform="translate(42, 32)">
        <circle cx="0" cy="0" r="26.5" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
        ${resolvedGoalIconHref ? `
          <image href="${resolvedGoalIconHref}" xlink:href="${resolvedGoalIconHref}" x="-21" y="-21" width="42" height="42" preserveAspectRatio="xMidYMid meet"/>
        ` : `
          <polygon points="0,-5.5 5.5,-2 3.5,5 -3.5,5 -5.5,-2" fill="#111827"/>
          <line x1="0" y1="-5.5" x2="0" y2="-13.5" stroke="#111827" stroke-width="1.8"/>
          <line x1="5.5" y1="-2" x2="13" y2="-4" stroke="#111827" stroke-width="1.8"/>
          <line x1="3.5" y1="5" x2="9" y2="12" stroke="#111827" stroke-width="1.8"/>
          <line x1="-3.5" y1="5" x2="-9" y2="12" stroke="#111827" stroke-width="1.8"/>
          <line x1="-5.5" y1="-2" x2="-13" y2="-4" stroke="#111827" stroke-width="1.8"/>
        `}
        ${goals > 1 ? `
          <g transform="translate(20, -23)">
            <circle cx="0" cy="0" r="15" fill="#EF4444" stroke="#FFFFFF" stroke-width="2"/>
            <text x="0" y="7.5" font-size="26" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${goals}</text>
          </g>
        ` : ''}
      </g>
    ` : '';

    // 3. Overlapping Assist Badge (Bottom-Left)
    const assistBadgeSvg = assists > 0 ? `
      <g transform="translate(-40, 32)">
        <circle cx="0" cy="0" r="26.5" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
        ${resolvedAssistIconHref ? `
          <image href="${resolvedAssistIconHref}" xlink:href="${resolvedAssistIconHref}" x="-20" y="-18" width="36" height="36" preserveAspectRatio="xMidYMid meet"/>
        ` : `
          <g transform="translate(-11, -8) scale(1.2)">
            <path d="M1,9 C3,7 5,5 9,5 C11,5 13,7 15,7 C17,7 18,9 18,10 C18,11 16,12 13,12 C8,12 3,11 1,9 Z" fill="#38BDF8"/>
            <path d="M3.5,12 L3.5,15 M7.5,12 L7.5,15 M12.5,12 L12.5,15" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M6.5,5 L8.5,8.5 M8.5,5 L10.5,8.5" stroke="#FFFFFF" stroke-width="1.1"/>
          </g>
        `}
        ${assists > 1 ? `
          <g transform="translate(-20, -23)">
            <circle cx="0" cy="0" r="15" fill="#0284C7" stroke="#FFFFFF" stroke-width="2"/>
            <text x="0" y="7.5" font-size="26" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${assists}</text>
          </g>
        ` : ''}
      </g>
    ` : '';

    // 4. Name & Position Label Underneath Avatar (Enlarged)
    // Crown: scale crown.svg paths (512x512 viewBox) to ~54px, centered above avatar
    const crownSvg = isMom
      ? `<g transform="translate(-34, -102) scale(0.135)">${CROWN_PATHS}</g>`
      : '';

    // Calculate visual character width
    const visualLength = pName.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length;
    let nameLines = [pName];
    if (visualLength > 12) {
      if (pName.includes(' ')) {
        const parts = pName.split(/\s+/);
        if (parts.length >= 2) {
          const l1 = parts[0];
          let l2 = parts.slice(1).join(' ');
          const v2 = l2.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length;
          if (v2 > 10) l2 = l2.slice(0, 9) + '..';
          nameLines = [l1, l2];
        }
      } else if (visualLength > 13) {
        let vCount = 0;
        let splitIdx = Math.floor(pName.length / 2);
        for (let i = 0; i < pName.length; i++) {
          if (!/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(pName[i])) {
            vCount++;
            if (vCount >= Math.ceil(visualLength / 2)) {
              splitIdx = i + 1;
              break;
            }
          }
        }
        const l1 = pName.slice(0, splitIdx);
        let l2 = pName.slice(splitIdx);
        const v2 = l2.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length;
        if (v2 > 9) l2 = l2.slice(0, 8) + '..';
        nameLines = [l1, l2];
      }
    }

    const isTwoLines = nameLines.length > 1;
    const labelBoxWidth = 192;
    const labelBoxHeight = isTwoLines ? 54 : 40;
    const badgeW = 44;
    const badgeX = -(labelBoxWidth / 2) + 5;
    const posBadgeY = isTwoLines ? 11 : 6;
    const posBadgeH = isTwoLines ? 32 : 28;
    const posTextY = isTwoLines ? 33 : 27.5;
    const nameCenterX = 23;
    const singleFontSize = visualLength >= 12 ? 19 : (visualLength >= 10 ? 21 : 23);
    const singleTextY = visualLength >= 12 ? 27 : 28.5;
    const textColor = isMom ? '#FDE047' : (isAlternate ? '#38BDF8' : '#FFFFFF');

    const nameTextSvg = isTwoLines ? `
      <text x="${nameCenterX}" y="24" font-size="21" font-family="Sarabun, sans-serif" font-weight="bold" fill="${textColor}" text-anchor="middle">${escapeXml(nameLines[0])}</text>
      <text x="${nameCenterX}" y="45" font-size="21" font-family="Sarabun, sans-serif" font-weight="bold" fill="${textColor}" text-anchor="middle">${escapeXml(nameLines[1])}</text>
    ` : `
      <text x="${nameCenterX}" y="${singleTextY}" font-size="${singleFontSize}" font-family="Sarabun, sans-serif" font-weight="bold" fill="${textColor}" text-anchor="middle">${escapeXml(nameLines[0])}</text>
    `;

    return `
      <g transform="translate(${cx}, ${cy})">
        <!-- Avatar Ring -->
        <circle cx="0" cy="0" r="${avatarR + 1}" fill="none" stroke="${borderColor}" stroke-width="${borderWidth}"/>
        ${avatarSvg}
        ${crownSvg}

        <!-- Overlapping Badges (Top-Right Rating, Bottom-Right Goal, Bottom-Left Assist) -->
        ${ratingBadgeSvg}
        ${goalBadgeSvg}
        ${assistBadgeSvg}

        <!-- Name & Position Pill Underneath Avatar -->
        <g transform="translate(0, ${avatarR + 10})">
          <rect x="-${labelBoxWidth / 2}" y="0" width="${labelBoxWidth}" height="${labelBoxHeight}" rx="10" fill="${isAlternate ? '#071828EE' : (isMom ? '#1A1608F4' : '#000000CC')}" stroke="${isMom ? '#F59E0BCC' : (isAlternate ? '#38BDF888' : '#FFFFFF33')}" stroke-width="1.5"/>
          
          <rect x="${badgeX}" y="${posBadgeY}" width="${badgeW}" height="${posBadgeH}" rx="6" fill="${posColor}"/>
          <text x="${badgeX + badgeW / 2}" y="${posTextY}" font-size="20" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${escapeXml(posCode)}</text>
          
          ${nameTextSvg}
        </g>
      </g>
    `;
  };

  // Iterate over row layouts and place slots
  for (const row of rowLayouts) {
    const slotList = row.slots || [];
    const numSlots = slotList.length;

    if (row.isFlank) {
      // Left and right flank placement (DW Left & Right) - Wide near touchlines
      const leftSlot = slotList[0] || { primary: null, alternate: null };
      const rightSlot = slotList[1] || { primary: null, alternate: null };

      // Left Flank (DW Left)
      const lx = pitchX + 130;
      if (leftSlot.primary && leftSlot.alternate) {
        pitchPlayersSvg += renderSinglePlayer(leftSlot.primary, 'DW', false, isMomPlayer(leftSlot.primary), 115, row.y);
        pitchPlayersSvg += renderSinglePlayer(leftSlot.alternate, 'DW', true, isMomPlayer(leftSlot.alternate), 315, row.y);
      } else {
        pitchPlayersSvg += renderSinglePlayer(leftSlot.primary, 'DW', false, isMomPlayer(leftSlot.primary), lx, row.y);
      }

      // Right Flank (DW Right)
      const rx = pitchX + pitchWidth - 130;
      if (rightSlot.primary && rightSlot.alternate) {
        pitchPlayersSvg += renderSinglePlayer(rightSlot.primary, 'DW', false, isMomPlayer(rightSlot.primary), 765, row.y);
        pitchPlayersSvg += renderSinglePlayer(rightSlot.alternate, 'DW', true, isMomPlayer(rightSlot.alternate), 965, row.y);
      } else {
        pitchPlayersSvg += renderSinglePlayer(rightSlot.primary, 'DW', false, isMomPlayer(rightSlot.primary), rx, row.y);
      }
    } else {
      // Center distributed slots (wide central layout for generous spacing)
      const centerX = pitchX + pitchWidth / 2;
      let xPositions = [];
      if (numSlots === 1) {
        xPositions = [centerX];
      } else if (numSlots === 2) {
        xPositions = [centerX - 230, centerX + 230];
      } else if (numSlots === 3) {
        xPositions = [centerX - 275, centerX, centerX + 275];
      } else if (numSlots === 4) {
        xPositions = [centerX - 330, centerX - 110, centerX + 110, centerX + 330];
      }

      const altOffset = numSlots === 1 ? 105 : 95;
      slotList.forEach((slot, idx) => {
        const cx = xPositions[idx] || centerX;
        if (slot.primary && slot.alternate) {
          pitchPlayersSvg += renderSinglePlayer(slot.primary, row.role, false, isMomPlayer(slot.primary), cx - altOffset, row.y);
          pitchPlayersSvg += renderSinglePlayer(slot.alternate, row.role, true, isMomPlayer(slot.alternate), cx + altOffset, row.y);
        } else {
          pitchPlayersSvg += renderSinglePlayer(slot.primary, row.role, false, isMomPlayer(slot.primary), cx, row.y);
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

  // Bottom MVP Bar SVG (only for full version)
  let mvpBarSvg = '';
  const starBigSvg = `<polygon points="0,-8 2.4,-2.4 8.4,-2.4 3.6,1.3 5,7.2 0,3.6 -5,7.2 -3.6,1.3 -8.4,-2.4 -2.4,-2.4" fill="#FDE047"/>`;

  if (!pitchOnly) {
    if (momPlayer) {
      const rawMomName = (momPlayer.name || momPlayer.alias || 'Player').replace(/^@/, '');
      const momName = stripEmojis(rawMomName) || 'Player';
      const momRatingVal = (momPlayer.weekStats?.rating && momPlayer.weekStats.rating !== '-' && Number(momPlayer.weekStats.rating) > 0)
        ? parseFloat(momPlayer.weekStats.rating).toFixed(1)
        : 'n/a';
      const momGoals = Number(momPlayer.weekStats?.goals || 0);
      const momAssists = Number(momPlayer.weekStats?.assists || 0);

      // Build stats SVG: goal icon + count, assist icon + count (with circular badge box)
      let momStatsSvg = '';
      if (momGoals === 0 && momAssists === 0) {
        momStatsSvg = `<text x="148" y="114" font-size="26" font-family="Sarabun, sans-serif" fill="#CBD5E1">ลงสนามสัปดาห์นี้</text>`;
      } else {
        let sx = 148;
        if (momGoals > 0) {
          momStatsSvg += `
            <g transform="translate(${sx}, 88)">
              <circle cx="17" cy="17" r="17" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
              ${resolvedGoalIconHref ? `
                <image href="${resolvedGoalIconHref}" xlink:href="${resolvedGoalIconHref}" x="3" y="3" width="28" height="28" preserveAspectRatio="xMidYMid meet"/>
              ` : `
                <polygon points="17,10 22.5,14 20.5,21 13.5,21 11.5,14" fill="#111827"/>
              `}
            </g>
          `;
          sx += 44;
          momStatsSvg += `<text x="${sx}" y="115" font-size="28" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF">${momGoals}</text>`;
          sx += momGoals >= 10 ? 44 : 28;
        }
        if (momAssists > 0) {
          if (momGoals > 0) {
            sx += 18;
          }
          momStatsSvg += `
            <g transform="translate(${sx}, 88)">
              <circle cx="17" cy="17" r="17" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
              ${resolvedAssistIconHref ? `
                <image href="${resolvedAssistIconHref}" xlink:href="${resolvedAssistIconHref}" x="4" y="4" width="26" height="26" preserveAspectRatio="xMidYMid meet"/>
              ` : `
                <g transform="translate(5, 5) scale(0.65)">
                  <path d="M1,9 C3,7 5,5 9,5 C11,5 13,7 15,7 C17,7 18,9 18,10 C18,11 16,12 13,12 C8,12 3,11 1,9 Z" fill="#38BDF8"/>
                </g>
              `}
            </g>
          `;
          sx += 44;
          momStatsSvg += `<text x="${sx}" y="115" font-size="28" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF">${momAssists}</text>`;
        }
      }

      const momClipId = `clip-mom-${svgUid}-${momPlayer.id}`;
      defsSvg += `<clipPath id="${momClipId}"><circle cx="80" cy="81" r="44"/></clipPath>\n`;

      const rawMomPic = momPlayer.picture_url || momPlayer.pictureUrl;
      const momPicUrl = rawMomPic ? rawMomPic.trim().replace(/^http:\/\//i, 'https://') : null;
      const momAvatarHref = embedAssets
        ? (momPlayer.avatarDataUri || (momPicUrl ? getCachedBase64(momPicUrl) : null))
        : resolveBrowserAvatarUrl(rawMomPic);
      const momAvatarSvg = momAvatarHref ? `
        <image href="${escapeXml(momAvatarHref)}" xlink:href="${escapeXml(momAvatarHref)}" x="36" y="37" width="88" height="88" preserveAspectRatio="xMidYMid slice" clip-path="url(#${momClipId})"/>
      ` : `
        <circle cx="80" cy="81" r="44" fill="#2A1802"/>
        <polygon points="69,89 74,74 80,82 86,74 91,89" fill="#F59E0B"/>
      `;

      const mvpNameX = isTotw ? 304 : 294;
      mvpBarSvg = `
        <!-- MVP Container -->
        <g transform="translate(40, 1422)">
          <rect x="0" y="0" width="${pitchWidth}" height="162" rx="18" fill="#0F172A" stroke="#F59E0B" stroke-width="2.2"/>
          
          <!-- Avatar Ring -->
          <circle cx="80" cy="81" r="45" fill="none" stroke="#F59E0B" stroke-width="3"/>
          ${momAvatarSvg}

          <!-- Crown SVG (inlined paths, 512x512 viewBox scaled to ~64px) -->
          <g transform="translate(48, -6) scale(0.125)">${CROWN_PATHS}</g>
          <text x="148" y="74" font-size="26" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FCD34D">${isTotw ? 'WEEK MVP' : 'TEAM MVP'}</text>
          <text x="${mvpNameX}" y="74" font-size="30" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF">• ${escapeXml(momName)}</text>
          ${momStatsSvg}

          <!-- Rating Box -->
          <rect x="816" y="39" width="154" height="84" rx="14" fill="#231602" stroke="#F59E0B" stroke-width="2"/>
          <g transform="translate(856, 81) scale(2.1)">${starBigSvg}</g>
          <text x="908" y="92" font-size="32" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FDE047" text-anchor="middle">${escapeXml(momRatingVal)}</text>
        </g>
      `;
    } else {
      const mvpLabelX = isTotw ? 304 : 294;
      mvpBarSvg = `
        <!-- MVP Placeholder Container -->
        <g transform="translate(40, 1422)">
          <rect x="0" y="0" width="${pitchWidth}" height="162" rx="18" fill="#0F172A" stroke="#475569" stroke-width="1.8"/>
          <circle cx="80" cy="81" r="44" fill="#1E293B" stroke="#475569" stroke-width="2"/>
          <text x="80" y="89" font-size="24" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8" text-anchor="middle">MVP</text>

          <text x="148" y="74" font-size="26" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8">${isTotw ? 'WEEK MVP' : 'TEAM MVP'}</text>
          <text x="${mvpLabelX}" y="74" font-size="28" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8">• n/a</text>
          <text x="148" y="114" font-size="25" font-family="Sarabun, sans-serif" fill="#64748B">ยังไม่มีการแข่งขันสัปดาห์นี้</text>

          <rect x="816" y="39" width="154" height="84" rx="14" fill="#1E293B" stroke="#475569" stroke-width="1.8"/>
          <text x="893" y="91" font-size="30" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8" text-anchor="middle">n/a</text>
        </g>
      `;
    }
  }

  // Clean Header Subtitle Text (No emojis that cause tofu boxes)
  const cleanFormationName = stripEmojis(team.formationName || 'ผังการเล่น');
  const headerSubtitle = `${team.totalPlayers || 0} คน • ${cleanFormationName}`;

  const pctBadgeX = 54 + Math.max(58, Math.round(teamNameFormatted.length * 18.5)) + 16;
  const pctBadgeSvg = (!isTotw && team.colorUsagePct !== null && team.colorUsagePct !== undefined) ? `
    <rect x="${pctBadgeX}" y="14" width="84" height="32" rx="8" fill="${headerColors.badgeBg}"/>
    <text x="${pctBadgeX + 42}" y="37" font-size="22" font-family="Sarabun, sans-serif" font-weight="bold" fill="${headerColors.badgeText}" text-anchor="middle">${team.colorUsagePct}%</text>
  ` : '';

  // Assembly SVG Header matching Flex design (solid color, solid dot, % badge, right-aligned date/time)
  const headerBarSvg = pitchOnly ? '' : `
  <!-- Top Header Bar -->
  <g transform="translate(40, 22)">
    <rect x="0" y="0" width="${pitchWidth}" height="102" rx="18" fill="${headerColors.bg}" stroke="${headerColors.border}" stroke-width="2"/>
    
    <!-- Dot, Title & % Badge -->
    <circle cx="32" cy="30" r="9" fill="${headerColors.dot}"/>
    <text x="54" y="40" font-size="32" font-family="Sarabun, sans-serif" font-weight="bold" fill="${headerColors.titleColor}">${escapeXml(teamNameFormatted)}</text>
    ${pctBadgeSvg}

    <!-- Date & Time (Right-Aligned) -->
    <text x="974" y="40" font-size="28" font-family="Sarabun, sans-serif" font-weight="bold" fill="${headerColors.subColor}" text-anchor="end">${escapeXml(formattedDateStr)}</text>
    <text x="974" y="82" font-size="28" font-family="Sarabun, sans-serif" font-weight="bold" fill="${headerColors.subColor}" text-anchor="end">${escapeXml(timeRange)}</text>

    <!-- Subtitle Line -->
    <text x="26" y="82" font-size="28" font-family="Sarabun, sans-serif" font-weight="bold" fill="${headerColors.titleColor}">${escapeXml(headerSubtitle)}</text>
  </g>
  `;

  const svg = `
<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="bg-grad-${svgUid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B0F19"/>
      <stop offset="100%" stop-color="#05070D"/>
    </linearGradient>
    <clipPath id="pitch-clip-${svgUid}">
      <rect x="${pitchX}" y="${pitchY}" width="${pitchWidth}" height="${pitchHeight}" rx="18"/>
    </clipPath>
    ${defsSvg}
  </defs>

  <!-- Background Base -->
  <rect width="${svgWidth}" height="${svgHeight}" fill="url(#bg-grad-${svgUid})"/>

  ${headerBarSvg}

  <!-- Football Pitch (Lawn Stripes & Markings) -->
  <g clip-path="url(#pitch-clip-${svgUid})">
    <!-- Alternating Lawn Stripes -->
    ${pitchStripesSvg}

    <!-- Halfway Line -->
    <line x1="${pitchX}" y1="${pitchY + pitchHeight / 2}" x2="${pitchX + pitchWidth}" y2="${pitchY + pitchHeight / 2}" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2.5"/>

    <!-- Center Circle & Spot -->
    <circle cx="${pitchX + pitchWidth / 2}" cy="${pitchY + pitchHeight / 2}" r="90" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2.5"/>
    <circle cx="${pitchX + pitchWidth / 2}" cy="${pitchY + pitchHeight / 2}" r="5" fill="#FFFFFF" fill-opacity="0.7"/>

    <!-- Top Penalty Area & Goal Area -->
    <rect x="${pitchX + (pitchWidth - 380) / 2}" y="${pitchY}" width="380" height="160" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2.5"/>
    <rect x="${pitchX + (pitchWidth - 190) / 2}" y="${pitchY}" width="190" height="60" fill="none" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="2"/>
    <circle cx="${pitchX + pitchWidth / 2}" cy="${pitchY + 115}" r="4" fill="#FFFFFF" fill-opacity="0.7"/>

    <!-- Bottom Penalty Area & Goal Area -->
    <rect x="${pitchX + (pitchWidth - 380) / 2}" y="${pitchY + pitchHeight - 160}" width="380" height="160" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2.5"/>
    <rect x="${pitchX + (pitchWidth - 190) / 2}" y="${pitchY + pitchHeight - 60}" width="190" height="60" fill="none" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="2"/>
    <circle cx="${pitchX + pitchWidth / 2}" cy="${pitchY + pitchHeight - 115}" r="4" fill="#FFFFFF" fill-opacity="0.7"/>

    <!-- Corner Arcs -->
    <path d="M ${pitchX} ${pitchY + 35} A 35 35 0 0 0 ${pitchX + 35} ${pitchY}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2.5"/>
    <path d="M ${pitchX + pitchWidth - 35} ${pitchY} A 35 35 0 0 0 ${pitchX + pitchWidth} ${pitchY + 35}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2.5"/>
    <path d="M ${pitchX} ${pitchY + pitchHeight - 35} A 35 35 0 0 1 ${pitchX + 35} ${pitchY + pitchHeight}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2.5"/>
    <path d="M ${pitchX + pitchWidth - 35} ${pitchY + pitchHeight} A 35 35 0 0 1 ${pitchX + pitchWidth} ${pitchY + pitchHeight - 35}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2.5"/>

    <!-- Pitch Players Nodes -->
    ${pitchPlayersSvg}
  </g>

  <!-- Pitch Outer Border Frame -->
  <rect x="${pitchX}" y="${pitchY}" width="${pitchWidth}" height="${pitchHeight}" rx="18" fill="none" stroke="#FFFFFF" stroke-opacity="0.7" stroke-width="3"/>

  <!-- MVP Bottom Highlight Bar -->
  ${mvpBarSvg}
</svg>
`;

  return svg;
}

const LAYOUT_VERSION = 'v3'; // Increment if SVG design/layout changes
const inFlightGenerations = new Map();

/**
 * Normalizes player data for deterministic metadata hashing.
 */
function serializePlayerForHash(p) {
  if (!p) return null;
  return {
    id: String(p.id || p.member_id || ''),
    name: String(p.name || p.alias || ''),
    pic: String(p.picture_url || p.pictureUrl || '').trim(),
    rating: String(p.weekStats?.rating ?? p.score ?? p.raw_score ?? ''),
    goals: Number(p.weekStats?.goals ?? p.goals ?? 0),
    assists: Number(p.weekStats?.assists ?? p.assists ?? 0)
  };
}

/**
 * Computes a deterministic MD5 hash of all visual formation inputs.
 * If any player, position, rating, goal, assist, date, or layout setting changes,
 * the hash changes, triggering a fresh image generation.
 */
function computeFormationMetadataHash(team, dateStr = '', timeRange = '', options = {}) {
  const isTotw = String(team.teamId || '').toLowerCase() === 'totw';
  const teamId = String(team.teamId || '');
  const teamColor = String(team.teamColor || '');
  const pitchOnly = !!options.pitchOnly;

  const slots = team.slots || {};
  const slotData = {};
  for (const role of ['CF', 'AM', 'MF', 'DM', 'DW', 'DF', 'GK', 'alternates']) {
    const list = slots[role] || [];
    slotData[role] = list.map(s => {
      if (!s) return null;
      return {
        pos: s.posCode || s.pos_code || role,
        primary: serializePlayerForHash(s.primary || (s.id && !s.alternate ? s : null)),
        alternate: serializePlayerForHash(s.alternate)
      };
    });
  }

  const members = (team.members || []).map(serializePlayerForHash)
    .sort((a, b) => String(a?.id).localeCompare(String(b?.id)));

  const metadata = {
    layoutVersion: LAYOUT_VERSION,
    renderScale: RENDER_SCALE,
    isTotw,
    teamId,
    teamColor,
    colorUsagePct: team.colorUsagePct ?? null,
    dateStr: String(dateStr || ''),
    timeRange: String(timeRange || ''),
    pitchOnly,
    formationName: team.formationName || '',
    slots: slotData,
    members
  };

  return crypto.createHash('md5').update(JSON.stringify(metadata)).digest('hex').substring(0, 16);
}

const { getBaseUrl } = require('./utils/url');

function getPublicImageUrl(filename) {
  let baseUrl = getBaseUrl();
  if (baseUrl.startsWith('http://')) baseUrl = baseUrl.replace('http://', 'https://');
  return `${baseUrl}/webhook/img/team/${filename}`;
}

/**
 * Converts SVG to PNG and saves it into img/team/
 * @param {string} svgString - SVG string
 * @param {number} width - Output width in pixels
 * @param {number} height - Output height in pixels
 * @param {string|null} customFilename - Optional custom filename (e.g. metadata-hashed)
 * @returns {Promise<string>} filename
 */
async function convertSvgToPng(svgString, width = 1080, height = 1606, customFilename = null) {
  const filename = customFilename || `team_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
  const filePath = path.join(teamImgDir, filename);

  const scaledWidth = Math.round(width * RENDER_SCALE);
  const scaledHeight = Math.round(height * RENDER_SCALE);
  const scaledSvg = svgString
    .replace(new RegExp(`width="${width}"`), `width="${scaledWidth}"`)
    .replace(new RegExp(`height="${height}"`), `height="${scaledHeight}"`);

  const resvgOptions = {
    fitTo: { mode: 'width', value: scaledWidth }
  };
  const fontFiles = [];
  if (fs.existsSync(fontPathSarabun)) fontFiles.push(fontPathSarabun);
  if (fs.existsSync(fontPathSarabunBold)) fontFiles.push(fontPathSarabunBold);
  if (fs.existsSync(fontPathKaohom)) fontFiles.push(fontPathKaohom);

  if (fontFiles.length > 0) {
    resvgOptions.font = {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: 'Sarabun',
      sansSerifFamily: 'Sarabun'
    };
  }

  const rendered = await renderAsync(scaledSvg, resvgOptions);
  const buffer = rendered.asPng();
  // Cache in RAM immediately for first LINE fetch, then persist to disk asynchronously
  cacheAndPersistAsync('team', filename, buffer, filePath, 'image/png');
  return filename;
}

/**
 * Generates an exported image for a single team formation with metadata-based disk caching.
 * If an image for the exact same metadata already exists in RAM or on disk, it returns immediately (<1ms).
 * @param {Object} team - FormationsData item
 * @param {string} dateStr - Short date string
 * @param {string} timeRange - Time range string
 * @param {Object} options - Options { pitchOnly: boolean, noCache: boolean, returnMeta: boolean }
 * @returns {Promise<string|Object>} Image public URL or { url, cached, filename } if returnMeta is true
 */
async function generateTeamImage(team, dateStr = '', timeRange = '', options = {}) {
  const pitchOnly = !!options.pitchOnly;
  const hash = computeFormationMetadataHash(team, dateStr, timeRange, options);
  const safeId = String(team.teamId || 'team').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const mode = pitchOnly ? 'pitch' : 'full';
  const filename = `team_${safeId}_${mode}_${hash}.png`;
  const filePath = path.join(teamImgDir, filename);

  // 1. Check RAM cache (pending background disk flush) or disk cache
  if (!options.noCache && hasRamImage('team', filename)) {
    const url = getPublicImageUrl(filename);
    return options.returnMeta ? { url, cached: true, filename } : url;
  }
  if (!options.noCache && fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > 1000) {
        const url = getPublicImageUrl(filename);
        if (options.returnMeta) {
          return { url, cached: true, filename };
        }
        return url;
      }
    } catch (_) {}
  }

  // 2. In-flight request deduplication (prevent concurrent requests for same image from running resvg twice)
  let genPromise = inFlightGenerations.get(filename);
  if (!genPromise) {
    // 3. Cache miss: generate SVG and convert to PNG
    genPromise = (async () => {
      try {
        const svg = await buildTeamFormationSvg(team, dateStr, timeRange, options);
        const width = 1080;
        const height = pitchOnly ? 1310 : 1606;
        await convertSvgToPng(svg, width, height, filename);
        return { url: getPublicImageUrl(filename), filename };
      } finally {
        inFlightGenerations.delete(filename);
      }
    })();
    inFlightGenerations.set(filename, genPromise);
  }

  const result = await genPromise;
  if (options.returnMeta) {
    return { url: result.url, cached: false, filename: result.filename };
  }
  return result.url;
}

/**
 * Checks whether a team formation image already exists in disk cache.
 */
function isTeamImageCached(team, dateStr = '', timeRange = '', options = {}) {
  const pitchOnly = !!options.pitchOnly;
  const hash = computeFormationMetadataHash(team, dateStr, timeRange, options);
  const safeId = String(team.teamId || 'team').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const mode = pitchOnly ? 'pitch' : 'full';
  const filename = `team_${safeId}_${mode}_${hash}.png`;
  const filePath = path.join(teamImgDir, filename);
  if (hasRamImage('team', filename)) return true;
  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      return stats.size > 1000;
    }
  } catch (_) {}
  return false;
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
      const res = await generateTeamImage(team, data.dateStr, data.timeRange, { returnMeta: true });
      const url = res?.url || res;
      if (url) {
        imageUrls.push(url);
        const cacheStr = res?.cached ? '(used cached image)' : '(generated)';
        logger.info(`  [TeamImg] Team ${team.teamId} image: ✅ ${cacheStr}`);
      }
    } catch (err) {
      logger.error(`[TeamImg] Failed to generate image for team ${team.teamId}:`, err.message);
    }
  }

  return imageUrls;
}

module.exports = {
  buildTeamFormationSvg,
  generateTeamImage,
  generateTeamFormationImages,
  computeFormationMetadataHash,
  isTeamImageCached,
  getTeamHeaderColors,
  stripEmojis,
  fetchImageAsBase64
};
