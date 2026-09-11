const svg2img = require('svg2img');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const db = require('./query');
const { getFormatDate, getSlashDate } = require('./utils/date');

const teamImgDir = path.join(__dirname, 'img', 'team');
const avatarCacheDir = path.join(__dirname, 'img', 'avatars');
const fontPathSarabun = path.join(__dirname, 'fonts', 'Sarabun-Regular.ttf');
const fontPathKaohom = path.join(__dirname, 'fonts', 'LKKaohom.ttf');

// Ensure output directories exist
if (!fs.existsSync(teamImgDir)) {
  fs.mkdirSync(teamImgDir, { recursive: true });
}
if (!fs.existsSync(avatarCacheDir)) {
  fs.mkdirSync(avatarCacheDir, { recursive: true });
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
  console.warn('[TeamImg] Could not load icon_goal.png:', e.message);
}

try {
  const assistPath = path.join(__dirname, 'assets', 'icon_assist2.png');
  if (fs.existsSync(assistPath)) {
    assistIconDataUri = `data:image/png;base64,${fs.readFileSync(assistPath).toString('base64')}`;
  }
} catch (e) {
  console.warn('[TeamImg] Could not load icon_assist.png:', e.message);
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
 * Helper to get local disk cache path for a profile picture URL.
 */
function getAvatarDiskCachePath(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  return path.join(avatarCacheDir, `${hash}.jpg`);
}

/**
 * Fetches an image URL and converts it into a base64 Data URI with local disk caching.
 * resvg (used by svg2img) only supports data: URIs in <image> tags — not file:// URIs.
 */
const avatarCache = new Map(); // url -> base64 data URI
async function fetchImageAsBase64(url, timeoutMs = 6000) {
  if (!url || typeof url !== 'string' || !url.trim().startsWith('http')) return null;
  let secureUrl = url.trim();
  if (secureUrl.startsWith('http://')) {
    secureUrl = secureUrl.replace(/^http:\/\//i, 'https://');
  }

  // 1. In-memory cache
  if (avatarCache.has(secureUrl)) {
    return avatarCache.get(secureUrl);
  }

  // 2. Local disk cache — read bytes and encode to base64 (no network needed)
  const diskPath = getAvatarDiskCachePath(secureUrl);
  try {
    if (fs.existsSync(diskPath)) {
      const buffer = fs.readFileSync(diskPath);
      if (buffer && buffer.length > 50) {
        const dataUri = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        avatarCache.set(secureUrl, dataUri);
        return dataUri;
      } else {
        try { fs.unlinkSync(diskPath); } catch (e) { }
      }
    }
  } catch (diskErr) {
    console.warn(`[AvatarCache] Disk read error (${diskPath}):`, diskErr.message);
  }

  // 3. Remote download — save to disk cache, then return base64 data URI
  try {
    const response = await axios.get(secureUrl, {
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    if (response.data && response.data.length > 50) {
      const contentType = response.headers['content-type'] || 'image/jpeg';
      const buffer = Buffer.from(response.data);

      // Save to disk cache for future reuse
      try {
        fs.writeFileSync(diskPath, buffer);
      } catch (writeErr) {
        console.warn(`[AvatarCache] Disk write error (${diskPath}):`, writeErr.message);
      }

      const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;
      avatarCache.set(secureUrl, dataUri);
      return dataUri;
    }
  } catch (err) {
    console.warn(`[AvatarCache] Failed to download avatar (${secureUrl}):`, err.message);
  }
  return null;
}

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
  const n = (teamColorName || '').toLowerCase();
  if (n.includes('yellow') || n.includes('เหลือง')) return { bg: '#854D0E', accent: '#FACC15', title: '#FEF08A', dot: '#FACC15' };
  if (n.includes('red') || n.includes('แดง')) return { bg: '#991B1B', accent: '#EF4444', title: '#FEE2E2', dot: '#EF4444' };
  if (n.includes('green') || n.includes('เขียว')) return { bg: '#166534', accent: '#22C55E', title: '#DCFCE7', dot: '#22C55E' };
  if (n.includes('blue') || n.includes('น้ำเงิน') || n.includes('ฟ้า')) return { bg: '#1E40AF', accent: '#3B82F6', title: '#DBEAFE', dot: '#38BDF8' };
  if (n.includes('orange') || n.includes('ส้ม')) return { bg: '#9A3412', accent: '#F97316', title: '#FFEDD5', dot: '#FB923C' };
  if (n.includes('pink') || n.includes('ชมพู')) return { bg: '#9D174D', accent: '#EC4899', title: '#FCE7F3', dot: '#F472B6' };
  if (n.includes('purple') || n.includes('ม่วง')) return { bg: '#6D28D9', accent: '#A855F7', title: '#EDE9FE', dot: '#C084FC' };
  if (n.includes('black') || n.includes('ดำ')) return { bg: '#1E293B', accent: '#94A3B8', title: '#F1F5F9', dot: '#000000ff' };
  if (n.includes('white') || n.includes('ขาว')) return { bg: '#ffffffff', accent: '#000000ff', title: '#000000ff', dot: '#ffffffff' };
  return { bg: '#1E293B', accent: '#38BDF8', title: '#FFFFFF', dot: '#38BDF8' };
}

/**
 * Builds the SVG string for a single team's tactical formation.
 */
async function buildTeamFormationSvg(team, dateStr = '', timeRange = '', options = {}) {
  const isTotw = String(team.teamId || '').toLowerCase() === 'totw';

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

  // Pre-fetch all player avatars in parallel
  // fetchImageAsBase64 now returns file:// URI when cached on disk (no base64 overhead)
  await Promise.all(Array.from(playersToLoad).map(async (m) => {
    const rawPic = m.picture_url || m.pictureUrl;
    if (rawPic && !m.avatarDataUri) {
      m.avatarDataUri = await fetchImageAsBase64(rawPic);
    }
  }));

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
  const pitchY = pitchOnly ? 25 : 130;
  const pitchWidth = 1000;
  const pitchHeight = 1260;
  const svgHeight = pitchOnly ? (pitchY + pitchHeight + 25) : 1630;

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

    const clipId = `clip-avatar-${pId}-${isAlternate ? 'alt' : 'prim'}`;
    defsSvg += `<clipPath id="${clipId}"><circle cx="0" cy="0" r="${avatarR}"/></clipPath>\n`;

    const rawPic = player.picture_url || player.pictureUrl;
    const playerPicUrl = rawPic ? rawPic.trim().replace(/^http:\/\//i, 'https://') : null;
    const dataUri = player.avatarDataUri || (playerPicUrl ? avatarCache.get(playerPicUrl) : null);

    const avatarSvg = dataUri ? `
      <image href="${dataUri}" xlink:href="${dataUri}" x="-${avatarR}" y="-${avatarR}" width="${avatarR * 2}" height="${avatarR * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>
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
      const pillX = 18;
      const pillY = -70;

      ratingBadgeSvg = `
        <g transform="translate(${pillX}, ${pillY})">
          <rect x="0" y="0" width="${pillWidth}" height="${pillHeight}" rx="15" fill="${badgeBg}" stroke="#FFFFFF" stroke-width="2.5"/>
          <text x="${isMom ? 32 : pillWidth / 2}" y="28" font-size="25" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${pRatingVal}</text>
          ${isMom ? `<g transform="translate(-14, -6) scale(1.5)"><polygon points="53,8 55.5,14 62,14 57,18 59,24 53,20 47,24 49,18 44,14 50.5,14" fill="#FDE047"/></g>` : ''}
        </g>
      `;
    }

    // 2. Overlapping Goal Badge (Bottom-Right)
    const goalBadgeSvg = goals > 0 ? `
      <g transform="translate(42, 32)">
        <circle cx="0" cy="0" r="26.5" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
        ${goalIconDataUri ? `
          <image href="${goalIconDataUri}" xlink:href="${goalIconDataUri}" x="-21" y="-17" width="42" height="42" preserveAspectRatio="xMidYMid meet"/>
        ` : `
          <polygon points="0,-5.5 5.5,-2 3.5,5 -3.5,5 -5.5,-2" fill="#111827"/>
          <line x1="0" y1="-5.5" x2="0" y2="-13.5" stroke="#111827" stroke-width="1.8"/>
          <line x1="5.5" y1="-2" x2="13" y2="-4" stroke="#111827" stroke-width="1.8"/>
          <line x1="3.5" y1="5" x2="9" y2="12" stroke="#111827" stroke-width="1.8"/>
          <line x1="-3.5" y1="5" x2="-9" y2="12" stroke="#111827" stroke-width="1.8"/>
          <line x1="-5.5" y1="-2" x2="-13" y2="-4" stroke="#111827" stroke-width="1.8"/>
        `}
        ${goals > 1 ? `
          <g transform="translate(18, -20)">
            <circle cx="0" cy="0" r="20" fill="#EF4444" stroke="#FFFFFF" stroke-width="2"/>
            <text x="0" y="5.5" font-size="26" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${goals}</text>
          </g>
        ` : ''}
      </g>
    ` : '';

    // 3. Overlapping Assist Badge (Bottom-Left)
    const assistBadgeSvg = assists > 0 ? `
      <g transform="translate(-40, 32)">
        <circle cx="0" cy="0" r="26.5" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
        ${assistIconDataUri ? `
          <image href="${assistIconDataUri}" xlink:href="${assistIconDataUri}" x="-20" y="-18" width="36" height="36" preserveAspectRatio="xMidYMid meet"/>
        ` : `
          <g transform="translate(-11, -8) scale(1.2)">
            <path d="M1,9 C3,7 5,5 9,5 C11,5 13,7 15,7 C17,7 18,9 18,10 C18,11 16,12 13,12 C8,12 3,11 1,9 Z" fill="#38BDF8"/>
            <path d="M3.5,12 L3.5,15 M7.5,12 L7.5,15 M12.5,12 L12.5,15" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M6.5,5 L8.5,8.5 M8.5,5 L10.5,8.5" stroke="#FFFFFF" stroke-width="1.1"/>
          </g>
        `}
        ${assists > 1 ? `
          <g transform="translate(-14, -20)">
            <circle cx="0" cy="0" r="20" fill="#0284C7" stroke="#FFFFFF" stroke-width="2"/>
            <text x="0" y="5.5" font-size="26" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${assists}</text>
          </g>
        ` : ''}
      </g>
    ` : '';

    // 4. Name & Position Label Underneath Avatar (Enlarged)
    const crownSvg = isMom ? `
      <g transform="translate(-14, -66)">
        <polygon points="0,14 7,0 14,9 21,0 28,14" fill="#F59E0B" stroke="#78350F" stroke-width="1.2"/>
        <rect x="0" y="14" width="28" height="4" fill="#D97706"/>
      </g>
    ` : '';

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
    const labelBoxWidth = 190;
    const labelBoxHeight = isTwoLines ? 54 : 38;
    const posBadgeY = isTwoLines ? 11 : 5;
    const posBadgeH = isTwoLines ? 32 : 28;
    const posTextY = isTwoLines ? 33 : 28;
    const textColor = isMom ? '#FDE047' : (isAlternate ? '#38BDF8' : '#FFFFFF');

    const nameTextSvg = isTwoLines ? `
      <text x="18" y="25.5" font-size="25" font-family="Sarabun, sans-serif" font-weight="bold" fill="${textColor}" text-anchor="middle">${escapeXml(nameLines[0])}</text>
      <text x="18" y="45.5" font-size="25" font-family="Sarabun, sans-serif" font-weight="bold" fill="${textColor}" text-anchor="middle">${escapeXml(nameLines[1])}</text>
    ` : `
      <text x="18" y="28.5" font-size="25" font-family="Sarabun, sans-serif" font-weight="bold" fill="${textColor}" text-anchor="middle">${escapeXml(nameLines[0])}</text>
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
          <rect x="-${labelBoxWidth / 2}" y="0" width="${labelBoxWidth}" height="${labelBoxHeight}" rx="10" fill="${isAlternate ? '#071828EE' : (isMom ? '#1A1608F4' : '#000000CC')}" stroke="${isMom ? '#F59E0BCC' : (isAlternate ? '#38BDF888' : '#FFFFFF26')}" stroke-width="1.4"/>
          
          <rect x="-${labelBoxWidth / 2 - 5}" y="${posBadgeY}" width="40" height="${posBadgeH}" rx="6" fill="${posColor}"/>
          <text x="-${labelBoxWidth / 2 - 24}" y="${posTextY}" font-size="25" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${escapeXml(posCode)}</text>
          
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
        pitchPlayersSvg += renderSinglePlayer(leftSlot.primary, 'DW', false, isMomPlayer(leftSlot.primary), 125, row.y);
        pitchPlayersSvg += renderSinglePlayer(leftSlot.alternate, 'DW', true, isMomPlayer(leftSlot.alternate), 305, row.y);
      } else {
        pitchPlayersSvg += renderSinglePlayer(leftSlot.primary, 'DW', false, isMomPlayer(leftSlot.primary), lx, row.y);
      }

      // Right Flank (DW Right)
      const rx = pitchX + pitchWidth - 130;
      if (rightSlot.primary && rightSlot.alternate) {
        pitchPlayersSvg += renderSinglePlayer(rightSlot.primary, 'DW', false, isMomPlayer(rightSlot.primary), 775, row.y);
        pitchPlayersSvg += renderSinglePlayer(rightSlot.alternate, 'DW', true, isMomPlayer(rightSlot.alternate), 955, row.y);
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
      const statsParts = [];
      if (momGoals > 0) statsParts.push(`${momGoals} ประตู`);
      if (momAssists > 0) statsParts.push(`${momAssists} แอสซิสต์`);
      const momStatsDesc = statsParts.length > 0 ? statsParts.join('   •   ') : 'ลงสนามสัปดาห์นี้';

      const momClipId = `clip-mom-${momPlayer.id}`;
      defsSvg += `<clipPath id="${momClipId}"><circle cx="85" cy="95" r="48"/></clipPath>\n`;

      const rawMomPic = momPlayer.picture_url || momPlayer.pictureUrl;
      const momPicUrl = rawMomPic ? rawMomPic.trim().replace(/^http:\/\//i, 'https://') : null;
      const momDataUri = momPlayer.avatarDataUri || (momPicUrl ? avatarCache.get(momPicUrl) : null);
      const momAvatarSvg = momDataUri ? `
        <image href="${momDataUri}" xlink:href="${momDataUri}" x="37" y="47" width="96" height="96" preserveAspectRatio="xMidYMid slice" clip-path="url(#${momClipId})"/>
      ` : `
        <circle cx="85" cy="95" r="48" fill="#2A1802"/>
        <polygon points="74,103 79,88 85,96 91,88 96,103" fill="#F59E0B"/>
      `;

      mvpBarSvg = `
        <!-- MVP Container -->
        <g transform="translate(40, 1390)">
          <rect x="0" y="0" width="${pitchWidth}" height="190" rx="18" fill="#0F172ACC" stroke="#F59E0B" stroke-width="2.2"/>
          
          <!-- Avatar Ring -->
          <circle cx="85" cy="95" r="50" fill="none" stroke="#F59E0B" stroke-width="3.5"/>
          ${momAvatarSvg}

          <!-- Crown Vector -->
          <g transform="translate(63, 18) scale(2.5)">
            <polygon points="0,12 4,2 9,8 14,2 18,12" fill="#F59E0B" stroke="#78350F" stroke-width="1"/>
          </g>
          <text x="155" y="89" font-size="30" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FCD34D">${isTotw ? 'WEEK MVP' : 'TEAM MVP'}</text>
          <text x="300" y="89" font-size="30" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FFFFFF">• ${escapeXml(momName)}</text>
          <text x="155" y="116" font-size="30" font-family="Sarabun, sans-serif" fill="#CBD5E1">${escapeXml(momStatsDesc)}</text>

          <!-- Rating Box -->
          <rect x="810" y="48" width="150" height="90" rx="14" fill="#231602" stroke="#F59E0B" stroke-width="2"/>
          <g transform="translate(850, 93) scale(2.5)">${starBigSvg}</g>
          <text x="900" y="103" font-size="32" font-family="Sarabun, sans-serif" font-weight="bold" fill="#FDE047" text-anchor="middle">${escapeXml(momRatingVal)}</text>
        </g>
      `;
    } else {
      mvpBarSvg = `
        <!-- MVP Placeholder Container -->
        <g transform="translate(40, 1390)">
          <rect x="0" y="0" width="${pitchWidth}" height="190" rx="18" fill="#0F172ACC" stroke="#475569" stroke-width="1.5"/>
          <circle cx="85" cy="95" r="48" fill="#1E293B" stroke="#475569" stroke-width="1.5"/>
          <polygon points="74,103 79,88 85,96 91,88 96,103" fill="#64748B"/>

          <text x="155" y="89" font-size="30" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8">${isTotw ? 'WEEK MVP' : 'TEAM MVP'}</text>
          <text x="300" y="89" font-size="30" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8">• n/a</text>
          <text x="155" y="130" font-size="30" font-family="Sarabun, sans-serif" fill="#64748B">ยังไม่มีการแข่งขันสัปดาห์นี้</text>

          <rect x="810" y="48" width="150" height="90" rx="14" fill="#1E293B" stroke="#475569" stroke-width="1.5"/>
          <text x="885" y="103" font-size="32" font-family="Sarabun, sans-serif" font-weight="bold" fill="#94A3B8" text-anchor="middle">n/a</text>
        </g>
      `;
    }
  }

  // Clean Header Subtitle Text (No emojis that cause tofu boxes)
  const cleanFormationName = stripEmojis(team.formationName || 'ผังการเล่น');
  const subItems = [];
  //if (formattedDateStr) subItems.push(formattedDateStr);
  let WeekDate = '';
  if (formattedDateStr) WeekDate = formattedDateStr;
  subItems.push(`${team.totalPlayers || 0} คน • ${cleanFormationName}`);

  //if (timeRange) subItems.push(timeRange);
  const headerSubtitle = subItems.join('   •   ');

  // Assembly SVG
  const headerBarSvg = pitchOnly ? '' : `
  <!-- Top Header Bar -->
  <g transform="translate(40, 24)">
    <rect x="0" y="0" width="${pitchWidth}" height="90" rx="16" fill="url(#header-grad)" stroke="${headerColors.accent}" stroke-width="2"/>
    
    <!-- Dot & Title -->
    <circle cx="34" cy="32" r="8" stroke="${headerColors.title}" stroke-width="2" fill="${headerColors.dot}"/>
    <text x="54" y="42" font-size="32" font-family="Sarabun, sans-serif" font-weight="bold" fill="${headerColors.title}">${escapeXml(teamNameFormatted)}</text>

    <!-- Date & Time -->
    <text x="830" y="42" font-size="28" font-family="Sarabun, sans-serif" font-weight="bold" fill="#CBD5E1">${escapeXml(WeekDate)}</text>
    <text x="830" y="80" font-size="28" font-family="Sarabun, sans-serif" font-weight="bold" fill="#CBD5E1">${escapeXml(timeRange)}</text>

    
    <!-- Subtitle Line -->
    <text x="32" y="80" font-size="28" font-family="Sarabun, sans-serif" font-weight="bold" fill="${headerColors.title}">${escapeXml(headerSubtitle)}</text>
  </g>
  `;

  const watermarkSvg = pitchOnly ? '' : `
  <!-- Footer Watermark -->
  <text x="${svgWidth / 2}" y="${svgHeight - 20}" font-size="13" font-family="Sarabun, sans-serif" fill="#64748B" text-anchor="middle">Generated by Agent VII Bot • ${new Date().getFullYear()}</text>
  `;

  const svg = `
<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
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
      <rect x="${pitchX}" y="${pitchY}" width="${pitchWidth}" height="${pitchHeight}" rx="18"/>
    </clipPath>
    ${defsSvg}
  </defs>

  <!-- Background Base -->
  <rect width="${svgWidth}" height="${svgHeight}" fill="url(#bg-grad)"/>

  ${headerBarSvg}

  <!-- Football Pitch (Lawn Stripes & Markings) -->
  <g clip-path="url(#pitch-clip)">
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

  ${watermarkSvg}
</svg>
`;

  return svg;
}

/**
 * Converts SVG to PNG and saves it into img/team/
 * @param {string} svgString - SVG string
 * @param {number} width - Output width in pixels
 * @param {number} height - Output height in pixels
 * @returns {Promise<string>} filename
 */
async function convertSvgToPng(svgString, width = 1080, height = 1560) {
  cleanupOldImages();

  const filename = `team_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
  const filePath = path.join(teamImgDir, filename);

  const imgOptions = { format: 'png', width, height };
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
 * @param {Object} options - Options { pitchOnly: boolean }
 * @returns {Promise<string>} Image public URL
 */
async function generateTeamImage(team, dateStr = '', timeRange = '', options = {}) {
  const pitchOnly = !!options.pitchOnly;
  const svg = await buildTeamFormationSvg(team, dateStr, timeRange, options);
  const width = 1080;
  const height = pitchOnly ? 1310 : 1630;
  const filename = await convertSvgToPng(svg, width, height);

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
  cleanupOldImages,
  stripEmojis,
  fetchImageAsBase64
};
