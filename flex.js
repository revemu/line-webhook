const report_template = {
  "type": "bubble",
  hero: {
    type: 'image',
    url: '{{img_url}}',
    size: 'full',
    aspectRatio: '20:13',
    aspectMode: 'cover'
  },
  "body": {
    "type": "box",
    "layout": "vertical",
    "contents": [
      {
        "type": "text",
        "text": "{{header}}",
        "weight": "bold",
        "size": "xl"
      }
    ]
  }
};

/*const tpl_top = 
`{
'type': 'bubble',
'hero': 
{
'type': 'image',
'url': '{{img_url}}',
'size': 'full',
'aspectRatio': '20:13',
'aspectMode': 'cover'
},
'body': {
'type': 'box',
'layout': 'vertical',
'contents': 
{{content}}

}
}`;*/
const tpl_carousel =
{
  type: "carousel",
}

const tpl_bubble =
{
  type: 'bubble',
  hero:
  {
    type: 'image',
    url: '',
    size: 'full',
    aspectRatio: '20:13',
    aspectMode: 'cover'
  },
  body: {
    type: 'box',
    layout: 'vertical'
  }
}

function replacePlaceholders(template, data) {
  let jsonString = typeof template === 'string' ? template : JSON.stringify(template);
  Object.keys(data).forEach(key => {
    jsonString = jsonString.replace(new RegExp(`{{${key}}}`, 'g'), data[key]);
  });
  return JSON.parse(jsonString);
}

function replaceFlex(template, data) {
  return replacePlaceholders(typeof template === 'string' ? template.replaceAll("'", '"') : template, data);
}

// Team name → readable color on dark background
const tdc = (name, teamColorMap = null) => {
  if (!name) return '#ffffff';
  const n = name.toLowerCase();
  if (teamColorMap && teamColorMap[n]) return teamColorMap[n];
  if (teamColorMap) {
    for (const [key, val] of Object.entries(teamColorMap)) {
      if (n.includes(key.toLowerCase())) return val;
    }
  }
  if (n.includes('yellow') || n.includes('เหลือง')) return '#facc15';
  if (n.includes('green') || n.includes('เขียว')) return '#44cc66';
  if (n.includes('red') || n.includes('แดง')) return '#ff5566';
  if (n.includes('blue') || n.includes('น้ำเงิน') || n.includes('ฟ้า')) return '#3b82f6';
  if (n.includes('orange') || n.includes('ส้ม')) return '#f97316';
  if (n.includes('pink') || n.includes('ชมพู')) return '#ec4899';
  if (n.includes('purple') || n.includes('ม่วง')) return '#a855f7';
  if (n.includes('black') || n.includes('ดำ')) return '#999999';
  if (n.includes('white') || n.includes('ขาว')) return '#ffffff';
  return '#ffffff';
};

const getThemeColors = (themeName, teamColorMap = {}) => {
  const isWhite = (themeName || '').toLowerCase() === 'white';

  const getDynamicColor = (name) => {
    if (!name) return isWhite ? '#0f172a' : '#ffffff';
    const n = name.toLowerCase();
    // 1. Check dynamic DB template color map first
    if (teamColorMap && teamColorMap[n]) {
      return teamColorMap[n];
    }
    if (teamColorMap) {
      for (const [key, val] of Object.entries(teamColorMap)) {
        if (n.includes(key.toLowerCase())) return val;
      }
    }
    // 2. Fallbacks for well-known color names (English & Thai)
    if (n.includes('yellow') || n.includes('เหลือง')) return isWhite ? '#ca8a04' : '#facc15';
    if (n.includes('green') || n.includes('เขียว')) return isWhite ? '#15803d' : '#44cc66';
    if (n.includes('red') || n.includes('แดง')) return isWhite ? '#dc2626' : '#ff5566';
    if (n.includes('blue') || n.includes('น้ำเงิน') || n.includes('ฟ้า')) return isWhite ? '#1d4ed8' : '#3b82f6';
    if (n.includes('orange') || n.includes('ส้ม')) return isWhite ? '#c2410c' : '#f97316';
    if (n.includes('pink') || n.includes('ชมพู')) return isWhite ? '#db2777' : '#ec4899';
    if (n.includes('purple') || n.includes('ม่วง')) return isWhite ? '#7e22ce' : '#a855f7';
    if (n.includes('black') || n.includes('ดำ')) return isWhite ? '#0f172a' : '#999999';
    if (n.includes('white') || n.includes('ขาว')) return isWhite ? '#64748b' : '#ffffff';
    return isWhite ? '#0f172a' : '#ffffff';
  };

  if (isWhite) {
    return {
      name: 'white',
      bgMain: '#ffffff',
      bgHeader: '#f1f5f9',
      bgRound: '#f8fafc',
      bgCurrent: '#fef2f2',
      bgNext: '#f1f5f9',
      bgNext2: '#f8fafc',
      bgDetail: '#f1f5f9',
      borderCurrent: '#ef4444',
      separator: '#e2e8f0',
      textPrimary: '#0f172a',
      textMuted: '#64748b',
      textMutedDark: '#475569',
      textMutedLight: '#334155',
      textAccent: '#dc2626',
      memberNameSpecial: '#0284c7',
      tdc: (name) => getDynamicColor(name)
    };
  } else {
    // Default 'black' (dark) theme colors
    return {
      name: 'black',
      bgMain: '#0d0d1a',
      bgHeader: '#1a1a2e',
      bgRound: '#16213e',
      bgCurrent: '#1f1c3a',
      bgNext: '#16213e',
      bgNext2: '#12192c',
      bgDetail: '#16122d',
      borderCurrent: '#e94560',
      separator: '#2a2a4a',
      textPrimary: '#ffffff',
      textMuted: '#a0a8c0',
      textMutedDark: '#555577',
      textMutedLight: '#aaaacc',
      textAccent: '#e94560',
      memberNameSpecial: '#ffffff',
      tdc: (name) => getDynamicColor(name)
    };
  }
};

const getBaseUrl = () => {
  let url = global.baseWebhookUrl || 'https://api.revemu.org';
  if (url.startsWith('http://')) {
    url = url.replace('http://', 'https://');
  }
  return url;
};

/**
 * Universal helper to create a round profile avatar box in LINE Flex Message
 * @param {string} pictureUrl - URL of member profile image
 * @param {string} [size='20px'] - Box size (e.g. '20px', '24px', '32px')
 * @returns {Object|null} LINE Flex box component with round corner radius
 */
function createMemberAvatarBox(pictureUrl, size = '20px') {
  if (!pictureUrl) return null;
  return {
    type: 'box',
    layout: 'vertical',
    width: size,
    height: size,
    cornerRadius: '100px',
    flex: 0,
    contents: [
      {
        type: 'image',
        url: pictureUrl,
        size: 'full',
        aspectRatio: '1:1',
        aspectMode: 'cover'
      }
    ]
  };
}

/**
 * Build a Flex bubble for /schedule
 * @param {object} sched - schedule object from getScheduleText (parsed JSON fields)
 * @param {Array}  matchups - array of {matchNo, round, startTime, endTime, teamA, teamB, resting[]}
 */
function buildScheduleFlex(sched, theme) {
  const { date, startTime, matchMinutes, totalHours, teams, totalMatches, totalRounds, endTime, matches } = sched;
  const colors = getThemeColors(theme);

  // Group matches by round
  const rounds = {};
  for (const m of matches) {
    if (!rounds[m.round]) rounds[m.round] = [];
    rounds[m.round].push(m);
  }

  const bodyContents = [];

  // ── Header block ──
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    backgroundColor: colors.bgHeader,
    paddingAll: 'md',
    cornerRadius: 'md',
    contents: [
      {
        type: 'text',
        text: '⚽ ตารางแข่งขัน',
        weight: 'bold',
        size: 'md',
        color: colors.textPrimary,
        align: 'start'
      },
      {
        type: 'text',
        text: `🕐 เสาร์ที่ ${date} ${startTime}–${endTime}`,
        size: 'sm',
        color: colors.textMuted,
        align: 'end',
        margin: 'xs'
      }
    ]
  });

  // ── Info row ──
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'sm',
    contents: [
      { type: 'text', text: `⏱️ ${matchMinutes} นาที/แมตช์`, size: 'sm', color: colors.textMutedDark, flex: 1 },
      { type: 'text', text: `${totalRounds} รอบ`, size: 'sm', color: colors.textMutedDark, flex: 1, align: 'center' },
      { type: 'text', text: `${totalMatches} แมตช์`, size: 'sm', color: colors.textMutedDark, flex: 1, align: 'end' }
    ]
  });

  bodyContents.push({ type: 'separator', margin: 'sm', color: colors.separator });

  // ── Column header ──
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'sm',
    paddingStart: 'sm',
    paddingEnd: 'sm',
    alignItems: 'center',
    contents: [
      { type: 'text', text: '#', size: 'xxs', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
      { type: 'text', text: 'เวลา', size: 'xxs', weight: 'bold', color: colors.textMutedDark, flex: 2, align: 'center' },
      { type: 'text', text: 'ทีม', size: 'xxs', weight: 'bold', color: colors.textMutedDark, flex: 6, align: 'center' }
    ]
  });

  // ── Rounds ──
  for (const [roundNum, roundMatches] of Object.entries(rounds)) {
    // Round label
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'sm',
      backgroundColor: colors.bgRound,
      paddingStart: 'sm',
      paddingEnd: 'sm',
      paddingTop: 'xs',
      paddingBottom: 'xs',
      cornerRadius: 'sm',
      contents: [
        { type: 'text', text: `▶ รอบที่ ${roundNum}`, size: 'xs', weight: 'bold', color: colors.textAccent }
      ]
    });

    for (const m of roundMatches) {
      // Check if match was played
      const dbMatch = sched.dbMatches && sched.dbMatches.find(dm => dm.match_num === m.matchNo);
      let vsText = 'vs';
      if (dbMatch) {
        let scoreA = dbMatch.team_a_goal;
        let scoreB = dbMatch.team_b_goal;
        if (dbMatch.team_a_id === m.teamBId) {
          scoreA = dbMatch.team_b_goal;
          scoreB = dbMatch.team_a_goal;
        }
        vsText = `${scoreA} - ${scoreB}`;
      }

      bodyContents.push({
        type: 'box',
        layout: 'horizontal',
        paddingStart: 'sm',
        paddingEnd: 'sm',
        paddingTop: 'xs',
        paddingBottom: 'xs',
        margin: 'xs',
        alignItems: 'center',
        contents: [
          { type: 'text', text: `${m.matchNo}`, size: 'sm', color: colors.textMuted, flex: 1, align: 'center' },
          { type: 'text', text: `${m.startTime}`, size: 'sm', color: colors.textMutedLight, flex: 2, align: 'center' },
          {
            type: 'box',
            layout: 'horizontal',
            flex: 6,
            alignItems: 'center',
            contents: [
              { type: 'text', text: m.teamA || '?', size: 'sm', color: colors.tdc(m.teamA), weight: 'bold', align: 'end', flex: 2 },
              { type: 'text', text: vsText, size: 'sm', color: colors.textMuted, align: 'center', flex: 1, weight: dbMatch ? 'bold' : 'regular' },
              { type: 'text', text: m.teamB || '?', size: 'sm', color: colors.tdc(m.teamB), weight: 'bold', align: 'start', flex: 2 }
            ]
          }
        ]
      });
    }
  }

  bodyContents.push({ type: 'separator', margin: 'sm', color: colors.separator });
  bodyContents.push({
    type: 'text',
    text: `สิ้นสุด ${endTime} น.  |  ${totalRounds} รอบ  |  ${totalHours} ชม.`,
    size: 'sm',
    color: colors.textMuted,
    align: 'center',
    margin: 'sm'
  });

  const bubble = {
    type: 'bubble',
    size: 'giga',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      paddingAll: 'md',
      contents: bodyContents
    }
  };

  const headerUrl = sched.imageUrl || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg';
  if (headerUrl && headerUrl.toLowerCase() !== 'none') {
    bubble.header = {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgHeader,
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: headerUrl,
          size: 'full',
          aspectRatio: '10:3',
          aspectMode: 'cover'
        }
      ]
    };
  }

  return bubble;
}

/**
 * Build a Flex bubble for /now
 * @param {object} matchInfo - result from getCurrentMatch()
 */
function buildNowFlex(matchInfo, theme) {
  const { currentMatch: cur, nextMatch: nxt, nextMatch2: nxt2, score, scorers, assists, table } = matchInfo;
  const colors = getThemeColors(theme, matchInfo ? matchInfo.teamColors : null);

  const makeHeaderContents = (iconType, iconText, titleText, matchNo, startTime, useLightColor, iconWidth, iconHeight) => {
    const textColor = useLightColor ? colors.textMuted : colors.textMutedDark;
    const isImg = iconType === 'image';
    const defaultDim = isImg ? '48px' : '24px';
    const w = iconWidth || defaultDim;
    const h = iconHeight || defaultDim;
    const iconBox = {
      type: 'box',
      layout: 'vertical',
      width: w,
      height: h,
      flex: 0,
      justifyContent: 'center',
      alignItems: 'center',
      contents: isImg ? [
        {
          type: 'image',
          url: iconText,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'cover',
          animated: true
        }
      ] : [
        {
          type: 'text',
          text: iconText,
          size: 'xs',
          color: textColor,
          align: 'center',
          gravity: 'center'
        }
      ]
    };

    return [
      iconBox,
      {
        type: 'text',
        text: `${titleText} [${matchNo}]`,
        size: 'xs',
        weight: 'bold',
        color: useLightColor ? colors.textAccent : colors.textMutedLight,
        margin: 'none',
        flex: 1
      },
      {
        type: 'text',
        text: startTime || '',
        size: 'xs',
        color: textColor,
        align: 'end'
      }
    ];
  };

  const bodyContents = [];

  // ── Top Header block (matching /live theme) ──
  const schedDate = matchInfo.sched ? matchInfo.sched.date : '';
  const schedStart = matchInfo.sched ? matchInfo.sched.startTime : '';
  const schedEnd = matchInfo.sched ? matchInfo.sched.endTime : '';
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    backgroundColor: colors.bgHeader,
    paddingAll: 'sm',
    cornerRadius: 'md',
    contents: [
      {
        type: 'text',
        text: '⚽ Now Match',
        weight: 'bold',
        size: 'sm',
        color: colors.textPrimary,
        align: 'start'
      },
      {
        type: 'text',
        text: schedDate ? `🕐 ${schedDate} ${schedStart}–${schedEnd}` : '🕐 แมตช์ปัจจุบัน',
        size: 'xs',
        color: colors.textMuted,
        align: 'end',
        margin: 'xs'
      }
    ]
  });

  bodyContents.push({ type: 'separator', margin: 'xs', color: colors.separator });

  // ── Current Match ──
  bodyContents.push({
    type: 'box',
    layout: 'vertical',
    backgroundColor: colors.bgCurrent,
    paddingAll: 'sm',
    cornerRadius: 'sm',
    borderColor: colors.borderCurrent,
    margin: 'xs',
    contents: [
      // Header: label  [matchNo]  time — all same size
      {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        contents: makeHeaderContents('image', `${getBaseUrl()}/img/green_pulse_true.png`, 'แมตช์ปัจจุบัน', cur.matchNo, cur.startTime, true)
      },
      // Score row: TeamA  score  TeamB
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        alignItems: 'center',
        contents: [
          { type: 'text', text: cur.teamA || '?', size: 'md', weight: 'bold', color: colors.tdc(cur.teamA), flex: 2, align: 'end' },
          {
            type: 'text',
            text: score ? `${score.teamA || '?'} - ${score.teamB || '?'}` : 'vs',
            size: 'md',
            weight: 'bold',
            color: colors.textAccent,
            flex: 1,
            align: 'center'
          },
          { type: 'text', text: cur.teamB || '?', size: 'md', weight: 'bold', color: colors.tdc(cur.teamB), flex: 2, align: 'start' }
        ]
      }
    ]
  });

  // ── Scorers ──
  if (scorers && scorers.length > 0) {
    const itemContents = [
      { type: 'text', text: '⚽', size: 'xs', flex: 0, color: colors.textMuted, gravity: 'center' }
    ];

    let isFirst = true;
    for (const s of scorers) {
      if (!isFirst) {
        itemContents.push({
          type: 'text',
          text: '•',
          size: 'xs',
          color: colors.textMutedDark,
          flex: 0,
          margin: 'md',
          gravity: 'center'
        });
      }
      isFirst = false;
      const og = s.ownGoal ? '🥅' : '';
      const nameText = s.goal > 1 ? `${s.name}(${s.goal})${og}` : `${s.name}${og}`;

      const scorerContents = [];
      if (s.pictureUrl) {
        const avatarBox = createMemberAvatarBox(s.pictureUrl, '20px');
        if (avatarBox) scorerContents.push(avatarBox);
      }

      const badgeSize = s.badgeSize || '16px';
      if (s.badgeUrl) {
        scorerContents.push({
          type: 'box',
          layout: 'vertical',
          width: badgeSize,
          height: badgeSize,
          flex: 0,
          contents: [
            {
              type: 'image',
              url: s.badgeUrl,
              size: 'full',
              aspectRatio: '1:1',
              aspectMode: 'cover',
              animated: true
            }
          ],
          margin: 'xs'
        });
      }

      if (s.hofBadges && s.hofBadges.length > 0) {
        for (const hb of s.hofBadges) {
          const hbSize = hb.badgeSize || '16px';
          scorerContents.push({
            type: 'box',
            layout: 'vertical',
            width: hbSize,
            height: hbSize,
            flex: 0,
            contents: [
              {
                type: 'image',
                url: hb.badgeUrl,
                size: 'full',
                aspectRatio: '1:1',
                aspectMode: 'cover',
                animated: true
              }
            ],
            margin: 'xs'
          });
        }
      }

      scorerContents.push({
        type: 'text',
        text: nameText,
        size: 'xs',
        color: colors.textPrimary,
        margin: 'xs',
        gravity: 'center'
      });

      itemContents.push({
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        contents: scorerContents,
        margin: 'xs',
        flex: 0
      });
    }

    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'xs',
      alignItems: 'center',
      contents: itemContents
    });
  }

  // ── Assists ──
  if (assists && assists.length > 0) {
    const itemContents = [
      { type: 'text', text: '👟', size: 'xs', flex: 0, color: colors.textMuted, gravity: 'center' }
    ];

    let isFirst = true;
    for (const a of assists) {
      if (!isFirst) {
        itemContents.push({
          type: 'text',
          text: '•',
          size: 'xs',
          color: colors.textMutedDark,
          flex: 0,
          margin: 'md',
          gravity: 'center'
        });
      }
      isFirst = false;
      const nameText = a.assist > 1 ? `${a.name}(${a.assist})` : `${a.name}`;

      const assistContents = [];
      if (a.pictureUrl) {
        const avatarBox = createMemberAvatarBox(a.pictureUrl, '20px');
        if (avatarBox) assistContents.push(avatarBox);
      }

      const badgeSize = a.badgeSize || '16px';
      if (a.badgeUrl) {
        assistContents.push({
          type: 'box',
          layout: 'vertical',
          width: badgeSize,
          height: badgeSize,
          flex: 0,
          contents: [
            {
              type: 'image',
              url: a.badgeUrl,
              size: 'full',
              aspectRatio: '1:1',
              aspectMode: 'cover',
              animated: true
            }
          ],
          margin: 'xs'
        });
      }

      if (a.hofBadges && a.hofBadges.length > 0) {
        for (const hb of a.hofBadges) {
          const hbSize = hb.badgeSize || '16px';
          assistContents.push({
            type: 'box',
            layout: 'vertical',
            width: hbSize,
            height: hbSize,
            flex: 0,
            contents: [
              {
                type: 'image',
                url: hb.badgeUrl,
                size: 'full',
                aspectRatio: '1:1',
                aspectMode: 'cover',
                animated: true
              }
            ],
            margin: 'xs'
          });
        }
      }

      assistContents.push({
        type: 'text',
        text: nameText,
        size: 'xs',
        color: colors.textMutedLight,
        margin: 'xs',
        gravity: 'center'
      });

      itemContents.push({
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        contents: assistContents,
        margin: 'xs',
        flex: 0
      });
    }

    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'xs',
      alignItems: 'center',
      contents: itemContents
    });
  }

  // ── Next Match ──
  if (nxt) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'xs',
      backgroundColor: colors.bgNext || colors.bgRound,
      paddingAll: 'sm',
      cornerRadius: 'sm',
      contents: [
        // Header: label  [matchNo]  time — all same size
        {
          type: 'box',
          layout: 'horizontal',
          alignItems: 'center',
          contents: makeHeaderContents('text', '⏭', 'แมตช์ถัดไป', nxt.matchNo, nxt.startTime, true)
        },
        // Teams row: TeamA  vs  TeamB
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'xs',
          alignItems: 'center',
          contents: [
            { type: 'text', text: nxt.teamA || '?', size: 'md', weight: 'bold', color: colors.tdc(nxt.teamA), flex: 2, align: 'end' },
            { type: 'text', text: 'vs', size: 'md', color: colors.textMuted, flex: 1, align: 'center' },
            { type: 'text', text: nxt.teamB || '?', size: 'md', weight: 'bold', color: colors.tdc(nxt.teamB), flex: 2, align: 'start' }
          ]
        }
      ]
    });

    // ── Second next match ──
    if (nxt2) {
      bodyContents.push({
        type: 'box',
        layout: 'vertical',
        margin: 'xs',
        backgroundColor: colors.bgNext2 || colors.bgRound,
        paddingAll: 'sm',
        cornerRadius: 'sm',
        contents: [
          // Header: label  [matchNo]  time — all same size
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: makeHeaderContents('text', '⏭⏭', 'หลังจากนั้น', nxt2.matchNo, nxt2.startTime, false)
          },
          // Teams row: TeamA  vs  TeamB
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'xs',
            alignItems: 'center',
            contents: [
              { type: 'text', text: nxt2.teamA || '?', size: 'md', weight: 'bold', color: colors.tdc(nxt2.teamA), flex: 2, align: 'end' },
              { type: 'text', text: 'vs', size: 'md', color: colors.textMutedDark, flex: 1, align: 'center' },
              { type: 'text', text: nxt2.teamB || '?', size: 'md', weight: 'bold', color: colors.tdc(nxt2.teamB), flex: 2, align: 'start' }
            ]
          }
        ]
      });
    }
  } else {
    bodyContents.push({ type: 'text', text: '🏁 นี่คือแมตช์สุดท้ายแล้วครับ', size: 'sm', color: colors.textAccent, margin: 'sm', align: 'center' });
  }

  // ── Standings table ──
  if (table && table.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
    bodyContents.push({ type: 'text', text: '📊 ตารางคะแนน', size: 'sm', weight: 'bold', color: colors.textPrimary, margin: 'md' });

    // Header row
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'xs',
      contents: [
        { type: 'text', text: 'ทีม', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 4 },
        { type: 'text', text: 'W', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center', margin: 'lg' },
        { type: 'text', text: 'D', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
        { type: 'text', text: 'L', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
        { type: 'text', text: 'GD', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
        { type: 'text', text: 'PTS', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' }
      ]
    });

    const medals = ['🥇', '🥈', '🥉', '4️⃣'];
    table.forEach((row, i) => {
      const gdStr = row.gd > 0 ? `+${row.gd}` : `${row.gd}`;
      bodyContents.push({
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        contents: [
          { type: 'text', text: `${medals[i] || (i + 1 + '.')} ${row.team}`, size: 'sm', color: colors.tdc(row.team), flex: 4, weight: i === 0 ? 'bold' : 'regular' },
          { type: 'text', text: `${row.w}`, size: 'sm', color: colors.textMutedLight, flex: 1, align: 'center', margin: 'lg' },
          { type: 'text', text: `${row.d}`, size: 'sm', color: colors.textMutedLight, flex: 1, align: 'center' },
          { type: 'text', text: `${row.l}`, size: 'sm', color: colors.textMutedLight, flex: 1, align: 'center' },
          { type: 'text', text: gdStr, size: 'sm', color: row.gd >= 0 ? (colors.name === 'white' ? '#15803d' : '#88ff88') : (colors.name === 'white' ? '#dc2626' : '#ff8888'), flex: 1, align: 'center' },
          { type: 'text', text: `${row.pts}`, size: 'sm', color: colors.textPrimary, flex: 1, align: 'center', weight: 'bold' }
        ]
      });
    });
  }

  const bubble = {
    type: 'bubble',
    size: 'giga',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      paddingAll: 'md',
      contents: bodyContents
    }
  };

  const headerUrl = matchInfo.imageUrl || (matchInfo.sched && matchInfo.sched.imageUrl) || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg';
  if (headerUrl && headerUrl.toLowerCase() !== 'none') {
    bubble.header = {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgHeader,
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: headerUrl,
          size: 'full',
          aspectRatio: '20:7',
          aspectMode: 'cover'
        }
      ]
    };
  }

  return bubble;
}

/**
 * Build a Flex bubble for /now2 (live full schedule with current match highlighted)
 * @param {object} matchInfo - result from getCurrentMatch() containing sched, dbMatches, currentMatch, scorers, assists, table
 */
function buildLiveFlex(matchInfo, theme) {
  const { sched, currentMatch, scorers, assists, table, dbMatches, recentMatchDetails, imageUrl } = matchInfo;
  const { date, startTime, matchMinutes, totalHours, teams, totalMatches, totalRounds, endTime, matches } = sched;
  const colors = getThemeColors(theme, matchInfo ? matchInfo.teamColors : null);

  // Filter to show 5 matches max: 2 previous matches, 1 current match, 2 next matches
  const curMatchNo = currentMatch ? currentMatch.matchNo : 1;
  const minMatchNo = Math.max(1, curMatchNo - 2);
  const maxMatchNo = curMatchNo + 2;
  const displayMatches = matches.filter(m => m.matchNo >= minMatchNo && m.matchNo <= maxMatchNo);

  // Group display matches by round
  const rounds = {};
  for (const m of displayMatches) {
    if (!rounds[m.round]) rounds[m.round] = [];
    rounds[m.round].push(m);
  }

  const bodyContents = [];

  // ── Header block ──
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    backgroundColor: colors.bgHeader,
    paddingAll: 'sm',
    cornerRadius: 'md',
    contents: [
      {
        type: 'text',
        text: '⚽ Live! Match',
        weight: 'bold',
        size: 'sm',
        color: colors.textPrimary,
        align: 'start'
      },
      {
        type: 'text',
        text: `🕐 ${date} ${startTime}–${endTime}`,
        size: 'xs',
        color: colors.textMuted,
        align: 'end',
        margin: 'xs'
      }
    ]
  });

  bodyContents.push({ type: 'separator', margin: 'xs', color: colors.separator });

  // ── Column header ──
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'xs',
    paddingStart: 'xs',
    paddingEnd: 'xs',
    alignItems: 'center',
    contents: [
      { type: 'text', text: '#', size: 'xs', weight: 'bold', color: colors.textMutedDark, flex: 2, align: 'center' },
      { type: 'text', text: 'เวลา', size: 'xs', weight: 'bold', color: colors.textMutedDark, flex: 2, align: 'center' },
      { type: 'text', text: 'ทีม', size: 'xs', weight: 'bold', color: colors.textMutedDark, flex: 5, align: 'center' }
    ]
  });

  function renderMatchRow(m) {
    const isCurrent = currentMatch && m.matchNo === currentMatch.matchNo;

    // Check if match was played
    const dbMatch = dbMatches && dbMatches.find(dm => dm.match_num === m.matchNo);
    let vsText = 'vs';
    if (dbMatch) {
      let scoreA = dbMatch.team_a_goal;
      let scoreB = dbMatch.team_b_goal;
      if (dbMatch.team_a_id === m.teamBId) {
        scoreA = dbMatch.team_b_goal;
        scoreB = dbMatch.team_a_goal;
      }
      vsText = `${scoreA} - ${scoreB}`;
    }

    const matchNumContents = [];
    if (isCurrent) {
      matchNumContents.push({
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        justifyContent: 'center',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            width: '48px',
            height: '48px',
            flex: 0,
            justifyContent: 'center',
            alignItems: 'center',
            contents: [
              {
                type: 'image',
                url: `${getBaseUrl()}/img/green_pulse_true.png`,
                size: 'full',
                aspectRatio: '1:1',
                aspectMode: 'cover',
                animated: true
              }
            ]
          },
          {
            type: 'text',
            text: `${m.matchNo}`,
            size: 'sm',
            color: colors.textAccent,
            weight: 'bold',
            margin: 'none',
            offsetStart: '-6px'
          }
        ]
      });
    } else {
      matchNumContents.push({
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        justifyContent: 'center',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            width: '48px',
            height: '48px',
            flex: 0,
            contents: [
              {
                type: 'text',
                text: ' ',
                size: 'xxs'
              }
            ]
          },
          {
            type: 'text',
            text: `${m.matchNo}`,
            size: 'sm',
            color: colors.textMuted,
            weight: 'regular',
            margin: 'none',
            offsetStart: '-6px'
          }
        ]
      });
    }

    const matchBoxContents = [
      {
        type: 'box',
        layout: 'horizontal',
        flex: 2,
        justifyContent: 'center',
        alignItems: 'center',
        contents: matchNumContents
      },
      { type: 'text', text: `${m.startTime}`, size: 'sm', color: isCurrent ? colors.textPrimary : colors.textMutedLight, flex: 2, align: 'center', weight: isCurrent ? 'bold' : 'regular' },
      {
        type: 'box',
        layout: 'horizontal',
        flex: 5,
        alignItems: 'center',
        contents: [
          { type: 'text', text: m.teamA || '?', size: 'sm', color: colors.tdc(m.teamA), weight: 'bold', align: 'end', flex: 2 },
          { type: 'text', text: vsText, size: 'sm', color: isCurrent ? colors.textAccent : colors.textMuted, align: 'center', flex: 1, weight: dbMatch || isCurrent ? 'bold' : 'regular' },
          { type: 'text', text: m.teamB || '?', size: 'sm', color: colors.tdc(m.teamB), weight: 'bold', align: 'start', flex: 2 }
        ]
      }
    ];

    const matchContainer = {
      type: 'box',
      layout: 'horizontal',
      paddingStart: 'xs',
      paddingEnd: 'xs',
      paddingTop: 'xs',
      paddingBottom: 'xs',
      margin: 'xs',
      alignItems: 'center',
      cornerRadius: 'sm',
      contents: matchBoxContents
    };

    if (isCurrent) {
      matchContainer.backgroundColor = colors.bgCurrent;
      matchContainer.borderColor = colors.borderCurrent;
    }

    bodyContents.push(matchContainer);

    // Display scorers & assists for played matches
    const mDetails = (recentMatchDetails && recentMatchDetails[m.matchNo])
      ? recentMatchDetails[m.matchNo]
      : (isCurrent ? { scorers, assists } : null);

    const mScorers = mDetails ? mDetails.scorers : null;
    const mAssists = mDetails ? mDetails.assists : null;

    if ((mScorers && mScorers.length > 0) || (mAssists && mAssists.length > 0)) {
      const detailRows = [];
      if (mScorers && mScorers.length > 0) {
        const itemContents = [
          { type: 'text', text: '⚽', size: 'xs', flex: 0, color: colors.textMuted }
        ];
        let isFirst = true;
        for (const s of mScorers) {
          if (!isFirst) {
            itemContents.push({ type: 'text', text: '•', size: 'xs', color: colors.textMutedDark, flex: 0, margin: 'xs' });
          }
          isFirst = false;
          const og = s.ownGoal ? '🥅' : '';
          const nameText = s.goal > 1 ? `${s.name}(${s.goal})${og}` : `${s.name}${og}`;

          const picUrl = s.pictureUrl || s.badgeUrl;
          if (picUrl) {
            const avatarBox = createMemberAvatarBox(picUrl, '20px');
            if (avatarBox) itemContents.push(avatarBox);
          }

          itemContents.push({
            type: 'text',
            text: nameText,
            size: 'sm',
            color: s.nameColor || colors.textMutedLight,
            flex: 0,
            weight: 'bold'
          });
        }

        detailRows.push({
          type: 'box',
          layout: 'horizontal',
          margin: 'xs',
          alignItems: 'center',
          contents: itemContents
        });
      }
      if (mAssists && mAssists.length > 0) {
        const itemContents = [
          { type: 'text', text: '👟', size: 'xs', flex: 0, color: colors.textMuted }
        ];
        let isFirst = true;
        for (const a of mAssists) {
          if (!isFirst) {
            itemContents.push({ type: 'text', text: '•', size: 'xs', color: colors.textMutedDark, flex: 0, margin: 'xs' });
          }
          isFirst = false;
          const nameText = a.assist > 1 ? `${a.name}(${a.assist})` : a.name;

          const picUrl = a.pictureUrl || a.badgeUrl;
          if (picUrl) {
            const avatarBox = createMemberAvatarBox(picUrl, '20px');
            if (avatarBox) itemContents.push(avatarBox);
          }

          itemContents.push({
            type: 'text',
            text: nameText,
            size: 'sm',
            color: a.nameColor || colors.textMutedLight,
            flex: 0,
            weight: 'bold'
          });
        }

        detailRows.push({
          type: 'box',
          layout: 'horizontal',
          margin: 'xs',
          alignItems: 'center',
          contents: itemContents
        });
      }

      if (detailRows.length > 0) {
        bodyContents.push({
          type: 'box',
          layout: 'vertical',
          backgroundColor: isCurrent ? colors.bgDetail : colors.bgRound,
          cornerRadius: 'sm',
          paddingAll: 'xs',
          margin: 'xs',
          contents: detailRows
        });
      }
    }
  }

  // ── Rounds ──
  for (const [roundNum, roundMatches] of Object.entries(rounds)) {
    // Round label
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'xs',
      backgroundColor: colors.bgRound,
      paddingStart: 'xs',
      paddingEnd: 'xs',
      paddingTop: 'xs',
      paddingBottom: 'xs',
      cornerRadius: 'sm',
      contents: [
        { type: 'text', text: `▶ รอบที่ ${roundNum}`, size: 'xs', weight: 'bold', color: colors.textAccent }
      ]
    });

    for (const m of roundMatches) {
      renderMatchRow(m);
    }
  }

  // ── Ellipsis & Last Match ──
  const lastMatch = matches.length > 0 ? matches[matches.length - 1] : null;
  if (lastMatch && lastMatch.matchNo > maxMatchNo) {
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'xs',
      justifyContent: 'center',
      alignItems: 'center',
      contents: [
        { type: 'text', text: '• • •', size: 'sm', color: colors.textMutedDark, align: 'center' }
      ]
    });

    const lastRound = lastMatch.round;
    const maxRenderedRound = displayMatches.length > 0 ? Math.max(...displayMatches.map(m => m.round)) : 0;
    if (lastRound > maxRenderedRound) {
      bodyContents.push({
        type: 'box',
        layout: 'vertical',
        margin: 'xs',
        backgroundColor: colors.bgRound,
        paddingStart: 'xs',
        paddingEnd: 'xs',
        paddingTop: 'xs',
        paddingBottom: 'xs',
        cornerRadius: 'sm',
        contents: [
          { type: 'text', text: `▶ รอบที่ ${lastRound} (แมตช์สุดท้าย)`, size: 'xs', weight: 'bold', color: colors.textAccent }
        ]
      });
    }

    renderMatchRow(lastMatch);
  }

  // ── Standings table at the bottom ──
  if (table && table.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'xs', color: colors.separator });
    bodyContents.push({ type: 'text', text: '📊 ตารางคะแนน', size: 'sm', weight: 'bold', color: colors.textPrimary, margin: 'xs' });

    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'xs',
      contents: [
        { type: 'text', text: 'ทีม', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 4 },
        { type: 'text', text: 'W', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
        { type: 'text', text: 'D', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
        { type: 'text', text: 'L', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
        { type: 'text', text: 'GD', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
        { type: 'text', text: 'PTS', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' }
      ]
    });

    const medals = ['🏆', '🥈', '🥉', '4️⃣'];
    table.forEach((row, i) => {
      const gdStr = row.gd > 0 ? `+${row.gd}` : `${row.gd}`;
      bodyContents.push({
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        contents: [
          { type: 'text', text: `${medals[i] || (i + 1 + '.')} ${row.team}`, size: 'sm', color: colors.tdc(row.team), flex: 4, weight: i === 0 ? 'bold' : 'regular' },
          { type: 'text', text: `${row.w}`, size: 'sm', color: colors.textMutedLight, flex: 1, align: 'center' },
          { type: 'text', text: `${row.d}`, size: 'sm', color: colors.textMutedLight, flex: 1, align: 'center' },
          { type: 'text', text: `${row.l}`, size: 'sm', color: colors.textMutedLight, flex: 1, align: 'center' },
          { type: 'text', text: gdStr, size: 'sm', color: row.gd >= 0 ? (colors.name === 'white' ? '#15803d' : '#88ff88') : (colors.name === 'white' ? '#dc2626' : '#ff8888'), flex: 1, align: 'center' },
          { type: 'text', text: `${row.pts}`, size: 'sm', color: colors.textPrimary, flex: 1, align: 'center', weight: 'bold' }
        ]
      });
    });
  }

  bodyContents.push({ type: 'separator', margin: 'xs', color: colors.separator });
  bodyContents.push({
    type: 'text',
    text: `สิ้นสุด ${endTime} น.  |  ${totalRounds} รอบ  |  ${totalHours} ชม.`,
    size: 'sm',
    color: colors.textMuted,
    align: 'center',
    margin: 'xs'
  });

  const bubble = {
    type: 'bubble',
    size: 'giga',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      paddingAll: 'sm',
      contents: bodyContents
    }
  };

  const headerUrl = imageUrl || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg';
  if (headerUrl && headerUrl.toLowerCase() !== 'none') {
    bubble.header = {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgHeader,
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: headerUrl,
          size: 'full',
          aspectRatio: '20:7',
          aspectMode: 'cover'
        }
      ]
    };
  }

  return bubble;
}

function makeBoxButton(label, text, color, flexVal = 1, size = 'sm', wrap = false) {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: color,
    cornerRadius: 'md',
    paddingTop: 'sm',
    paddingBottom: 'sm',
    action: {
      type: 'message',
      label: label,
      text: text
    },
    contents: [
      {
        type: 'text',
        text: label,
        color: '#ffffff',
        align: 'center',
        weight: 'bold',
        size: size,
        wrap: wrap
      }
    ],
    flex: flexVal
  };
}

function makeDisabledBoxButton(label, color = '#9ca3af', flexVal = 1, size = 'sm', wrap = false) {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: color,
    cornerRadius: 'md',
    paddingTop: 'sm',
    paddingBottom: 'sm',
    contents: [
      {
        type: 'text',
        text: label,
        color: '#ffffff',
        align: 'center',
        weight: 'bold',
        size: size,
        wrap: wrap
      }
    ],
    flex: flexVal
  };
}

function createMemberAvatarBox(url, size = '24px') {
  if (!url || typeof url !== 'string' || !url.trim().startsWith('http')) return null;
  let secureUrl = url.trim();
  if (secureUrl.startsWith('http://')) {
    secureUrl = secureUrl.replace(/^http:\/\//i, 'https://');
  }
  return {
    type: 'box',
    layout: 'vertical',
    width: size,
    height: size,
    cornerRadius: '100px',
    flex: 0,
    contents: [
      {
        type: 'image',
        url: secureUrl,
        size: 'full',
        aspectRatio: '1:1',
        aspectMode: 'cover'
      }
    ]
  };
}

function makeMemberColumn(p, index, colors, isCurrent = false) {
  const contents = [];
  if (index !== null && index !== undefined && index !== '') {
    contents.push({
      type: 'box',
      layout: 'vertical',
      width: '22px',
      contents: [
        { type: 'text', text: `${index}.`, size: 'sm', color: isCurrent ? colors.textAccent : colors.textMuted, align: 'end' }
      ]
    });
  }

  if (p.pictureUrl) {
    const avatarBox = createMemberAvatarBox(p.pictureUrl, '24px');
    if (avatarBox) {
      avatarBox.margin = 'md';
      contents.push(avatarBox);
    }
  } else {
    contents.push({
      type: 'box',
      layout: 'vertical',
      width: '24px',
      height: '24px',
      cornerRadius: '100px',
      flex: 0,
      contents: [
        {
          type: 'text',
          text: '⚽',
          size: 'xs',
          align: 'center',
          gravity: 'center'
        }
      ],
      margin: 'xs'
    });
  }

  const badgeSize = p.badgeSize || '20px';
  if (p.badgeUrl) {
    contents.push({
      type: 'box',
      layout: 'vertical',
      width: badgeSize,
      height: badgeSize,
      flex: 0,
      contents: [
        {
          type: 'image',
          url: p.badgeUrl,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'fit',
          animated: true
        }
      ],
      margin: 'sm'
    });
  }

  if (p.hofBadges && p.hofBadges.length > 0) {
    for (const hb of p.hofBadges) {
      contents.push({
        type: 'box',
        layout: 'vertical',
        width: hb.size || '20px',
        height: hb.size || '20px',
        flex: 0,
        contents: [
          {
            type: 'image',
            url: hb.url,
            size: 'full',
            aspectRatio: '1:1',
            aspectMode: 'fit',
            animated: true
          }
        ],
        margin: 'sm'
      });
    }
  } else if (p.hofCount && p.hofCount > 0 && p.hofBadgeUrl) {
    const hSize = p.hofBadgeSize || '20px';
    contents.push({
      type: 'box',
      layout: 'vertical',
      width: hSize,
      height: hSize,
      flex: 0,
      contents: [
        {
          type: 'image',
          url: p.hofBadgeUrl,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'fit',
          animated: true
        }
      ],
      margin: 'sm'
    });
  }
  /*else {
    contents.push({
      type: 'box',
      layout: 'vertical',
      width: badgeSize,
      height: badgeSize,
      flex: 0,
      contents: [{ type: 'filler' }],
      margin: 'xs'
    });
  }*/

  let displayName = `${p.donate || ''}${p.name}`;
  let textColor = p.nameColor || colors.memberNameSpecial;
  /*if (isCurrent) {
    displayName += ' 👈';
    textColor = colors.textAccent;
  }*/

  contents.push({
    type: 'text',
    text: displayName,
    size: 'sm',
    weight: 'bold',
    color: textColor,
    flex: 1,
    margin: 'sm'
  });

  const rowObj = {
    type: 'box',
    layout: 'horizontal',
    flex: 1,
    alignItems: 'center',
    contents: contents
  };

  if (isCurrent) {
    rowObj.backgroundColor = colors.bgCurrent;
    rowObj.borderColor = colors.borderCurrent;
    rowObj.cornerRadius = 'md';
    rowObj.paddingStart = 'sm';
    rowObj.paddingEnd = 'sm';
    rowObj.paddingTop = 'xs';
    rowObj.paddingBottom = 'xs';
  }

  return rowObj;
}

function makeTwoColumnMemberRows(list, colors) {
  if (!list || list.length === 0) return [];
  const half = Math.ceil(list.length / 2);
  const rows = [];

  for (let i = 0; i < half; i++) {
    const p1 = list[i];
    const p2Index = i + half;
    const p2 = p2Index < list.length ? list[p2Index] : null;

    const cols = [
      makeMemberColumn(p1, i + 1, colors, p1 ? Boolean(p1.isCurrent) : false)
    ];

    if (p2) {
      cols.push(makeMemberColumn(p2, p2Index + 1, colors, Boolean(p2.isCurrent)));
    } else {
      cols.push({ type: 'box', layout: 'horizontal', flex: 1, contents: [{ type: 'filler' }] });
    }

    rows.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'xs',
      contents: cols
    });
  }

  return rows;
}

function buildMemberWeekFlex(title, dateStr, maxPlayers, players, reserves, goalies, imageUrl, theme, autoRegCount = 0, timeRange = '17:30-20:00') {
  const bodyContents = [];
  let finalImageUrl = imageUrl;
  if (!finalImageUrl) {
    finalImageUrl = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQuyGBcXBYCphjV9yKqgZyNEWCvdbbLtn6ILg&s';
  }
  const colors = getThemeColors(theme);

  // ── Premium Body Header ──
  const headerSubContents = [];
  headerSubContents.push({
    type: 'text',
    text: `เสาร์ที่ ${dateStr}  ⏰ ${timeRange || '17:30-20:00'} น.`,
    size: 'xs',
    color: colors.textMuted
  });

  const extraCounts = [];
  if (goalies.length > 0) extraCounts.push(`🧤 ${goalies.length}`);
  if (reserves.length > 0) extraCounts.push(`⏳ ${reserves.length}`);
  if (extraCounts.length > 0) {
    headerSubContents.push({
      type: 'text',
      text: extraCounts.join('  '),
      size: 'xs',
      color: colors.textMuted,
      margin: 'md'
    });
  }

  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    backgroundColor: colors.bgHeader,
    paddingAll: 'md',
    cornerRadius: 'md',
    alignItems: 'center',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        contents: [
          {
            type: 'text',
            text: title === "ลงชื่อ" ? "⚽ ลงชื่อเตะบอล" : `📋 ${title}`,
            weight: 'bold',
            size: 'lg',
            color: colors.textPrimary
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'xs',
            contents: headerSubContents
          }
        ]
      },
      {
        type: 'box',
        layout: 'vertical',
        flex: 0,
        alignItems: 'flex-end',
        contents: [
          {
            type: 'text',
            text: `${players.length}/${maxPlayers}`,
            weight: 'bold',
            size: 'lg',
            color: colors.textAccent
          }
        ]
      }
    ]
  });

  // Progress Bar showing member signup progress
  const progressContents = [];
  const isWhite = colors.name === 'white';
  const currentCount = players.length;
  const totalSlots = Number(maxPlayers) || 20;

  // Determine progress bar color based on percentage
  let barColor;
  const ratio = totalSlots > 0 ? (currentCount / totalSlots) : 0;
  if (ratio >= 1.0) {
    barColor = isWhite ? '#dc2626' : '#ef4444'; // Red
  } else if (ratio > 0.8) {
    barColor = isWhite ? '#ca8a04' : '#eab308'; // Yellow
  } else {
    barColor = isWhite ? '#16a34a' : '#22c55e'; // Green
  }

  if (currentCount > 0) {
    progressContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: barColor,
      height: '8px',
      cornerRadius: 'md',
      flex: currentCount,
      contents: [{ type: 'filler' }]
    });
  }

  const remaining = totalSlots - currentCount;
  if (remaining > 0) {
    progressContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: isWhite ? '#e2e8f0' : '#2a2a4a',
      height: '8px',
      cornerRadius: 'md',
      flex: remaining,
      contents: [{ type: 'filler' }]
    });
  }

  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    height: '8px',
    margin: 'md',
    contents: progressContents
  });

  //bodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });

  // Players section
  if (players.length > 0) {
    bodyContents.push({
      type: 'text',
      text: `▶ รายชื่อ`,
      size: 'sm',
      weight: 'bold',
      color: colors.textAccent,
      margin: 'sm'
    });

    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      contents: makeTwoColumnMemberRows(players, colors)
    });
  }

  // Reserves section
  if (reserves.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'sm', color: colors.separator });
    bodyContents.push({
      type: 'text',
      text: '⏳ รายชื่อสำรอง',
      size: 'sm',
      weight: 'bold',
      color: colors.name === 'white' ? '#ea580c' : '#ffaa66',
      margin: 'sm'
    });

    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      contents: makeTwoColumnMemberRows(reserves, colors)
    });
  }

  // Goalies section
  if (goalies.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'sm', color: colors.separator });
    bodyContents.push({
      type: 'text',
      text: '🧤 รายชื่อโกล์',
      size: 'sm',
      weight: 'bold',
      color: colors.name === 'white' ? '#15803d' : '#44cc66',
      margin: 'sm'
    });

    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      contents: makeTwoColumnMemberRows(goalies, colors)
    });
  }

  // Quick Action Buttons
  const buttonRegisterColor = isWhite ? '#16a34a' : '#22c55e'; // Green
  const buttonCancelColor = isWhite ? '#dc2626' : '#ef4444'; // Red

  bodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
  bodyContents.push({
    type: 'text',
    text: `▶ ลงชื่อ เสาร์ที่ ${dateStr} @ ${timeRange || '17:30-20:00'} น.`,
    size: 'sm',
    weight: 'bold',
    color: colors.textAccent,
    margin: 'sm'
  });
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    margin: 'md',
    contents: [
      makeBoxButton('👍 ลงชื่อ', '+1', buttonRegisterColor),
      makeBoxButton('❌ ยกเลิก', '-1', buttonCancelColor)
    ]
  });
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    margin: 'md',
    contents: [
      makeBoxButton('📱 QR ค่าสนาม', '/qr', '#088181ff'),
      makeBoxButton('📋 เมนูอื่นๆ', '/menu', '#9b9807ff')
    ]
  });

  const topStatsColor = isWhite ? '#e7d015ff' : '#dbb104ff';
  const bottomStatsColor = isWhite ? '#ef4444' : '#b91c1c';
  const personalStatsColor = isWhite ? '#0284c7' : '#0ea5e9';

  bodyContents.push({ type: 'separator', margin: 'sm', color: colors.separator });
  bodyContents.push({
    type: 'text',
    text: '▶ ทำเนียบและสถิติ',
    size: 'sm',
    weight: 'bold',
    color: colors.textAccent,
    margin: 'sm'
  });
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    margin: 'xs',
    contents: [
      makeBoxButton('🏆 ผู้นำ', '/top', topStatsColor),
      makeBoxButton('📉 ซึมเศร้า', '/bottom', bottomStatsColor),
      makeBoxButton('👑 MVP', '/mvplist', '#dbb104ff'),
      makeBoxButton('📊 ส่วนตัว', '/stat', personalStatsColor)
    ]
  });

  /*bodyContents.push({ type: 'separator', margin: 'sm', color: colors.separator });
  bodyContents.push({
    type: 'text',
    text: `▶ ลงทะเบียนอัตโนมัติ (${autoRegCount}/24)`,
    size: 'sm',
    weight: 'bold',
    color: colors.textAccent,
    margin: 'sm'
  });

  const isFull = autoRegCount >= 24;
  const registerButton = isFull
    ? makeDisabledBoxButton('สมัคร (เต็ม)', '#9ca3af')
    : makeBoxButton('➕ สมัคร', '+autoreg', buttonRegisterColor);

  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    margin: 'xs',
    contents: [
      makeBoxButton('📋 รายชื่อ', '/autoreglist', topStatsColor),
      registerButton,
      makeBoxButton('➖ ยกเลิก', '-autoreg', buttonCancelColor)
    ]
  });*/

  const bubble = {
    type: 'bubble',
    size: 'giga',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      paddingAll: 'md',
      contents: bodyContents
    }
  };

  if (finalImageUrl && finalImageUrl.toLowerCase() !== 'none') {
    bubble.header = {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgHeader,
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: finalImageUrl,
          size: 'full',
          aspectRatio: '20:5',
          aspectMode: 'cover'
        }
      ]
    };
  }

  return bubble;
}

function buildWelcomeFlex(displayName, theme, imageUrl, dateStr = '') {
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  const bgMain = isWhite ? '#ffffff' : '#0d0d1a';
  const textPrimary = isWhite ? '#0f172a' : '#ffffff';
  const textMuted = isWhite ? '#64748b' : '#a0a8c0';
  const cardBg = isWhite ? '#f8fafc' : '#16122d';
  const cardBorder = isWhite ? '#e2e8f0' : '#2a2a4a';
  const accentColor = isWhite ? '#15803d' : '#44cc66';

  const bodyContents = [
    // Badge Row
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: isWhite ? '#e0f2fe' : '#0c4a6e',
          cornerRadius: 'md',
          paddingStart: 'md',
          paddingEnd: 'md',
          paddingTop: 'xs',
          paddingBottom: 'xs',
          contents: [
            {
              type: 'text',
              text: 'NEW MEMBER',
              color: isWhite ? '#0369a1' : '#38bdf8',
              size: 'xxs',
              weight: 'bold'
            }
          ]
        }
      ]
    },
    // Member Name
    {
      type: 'text',
      text: displayName,
      weight: 'bold',
      size: '3xl',
      color: textPrimary
    },
    // Welcome Text
    {
      type: 'text',
      text: 'ยินดีต้อนรับเข้าร่วมทีมเตะบอลก๊วนเราครับ! ดีใจที่ได้คุณมาร่วมสนุกด้วยกัน ⚽\nคุณสามารถใช้งานเมนูบริการด้านล่างนี้ได้ทันทีครับ:',
      wrap: true,
      size: 'sm',
      color: textMuted
    },
    {
      type: 'separator',
      color: colors.separator,
      margin: 'md'
    }
  ];

  // Section 1: ลงชื่อเตะบอล
  const buttonRegisterColor = isWhite ? '#16a34a' : '#22c55e'; // Green
  const buttonCancelColor = isWhite ? '#dc2626' : '#ef4444'; // Red

  bodyContents.push({
    type: 'text',
    text: `▶ ลงชื่อสัปดาห์นี้ เสาร์ที่ ${dateStr}`,
    size: 'sm',
    weight: 'bold',
    color: colors.textAccent,
    margin: 'sm'
  });
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    margin: 'xs',
    contents: [
      makeBoxButton('👍 ลงชื่อ', '+1', buttonRegisterColor),
      makeBoxButton('❌ ยกเลิก', '-1', buttonCancelColor),
      makeBoxButton('💰 จ่ายเงิน', '/qr', '004466')
    ]
  });

  // Section 2: ทำเนียบและสถิติ
  const topStatsColor = isWhite ? '#e7d015ff' : '#dbb104ff';
  const bottomStatsColor = isWhite ? '#ef4444' : '#b91c1c';
  const personalStatsColor = isWhite ? '#0284c7' : '#0ea5e9';

  bodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
  bodyContents.push({
    type: 'text',
    text: '▶ ทำเนียบและสถิติ',
    size: 'sm',
    weight: 'bold',
    color: colors.textAccent,
    margin: 'sm'
  });
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    margin: 'xs',
    contents: [
      makeBoxButton('🏆 อันดับผู้นำ', '/top', topStatsColor),
      makeBoxButton('📉 ทำเนียบซึมเศร้า', '/bottom', bottomStatsColor),
      makeBoxButton('📊 สถิติส่วนตัว', '/stat', personalStatsColor)
    ]
  });

  // Section 3: ลงทะเบียนอัตโนมัติ
  /*bodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
  bodyContents.push({
    type: 'text',
    text: '▶ ลงทะเบียนอัตโนมัติ',
    size: 'sm',
    weight: 'bold',
    color: colors.textAccent,
    margin: 'sm'
  });
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    margin: 'xs',
    contents: [
      makeBoxButton('📋 รายชื่อ', '/autoreglist', topStatsColor),
      makeBoxButton('➕ สมัคร', '+autoreg', buttonRegisterColor),
      makeBoxButton('➖ ยกเลิก', '-autoreg', buttonCancelColor)
    ]
  });*/

  const bubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: bgMain,
      spacing: 'md',
      paddingAll: 'lg',
      contents: bodyContents
    }
  };

  const headerUrl = imageUrl || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg';
  if (headerUrl && headerUrl.toLowerCase() !== 'none') {
    bubble.header = {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: headerUrl,
          size: 'full',
          aspectRatio: '20:10',
          aspectMode: 'cover'
        }
      ]
    };
  }

  return bubble;
}
function buildRegisterFlex(dateStr, currentCount, maxPlayers, theme, imageUrl = null) {
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  const bgMain = isWhite ? '#ffffff' : '#0d0d1a';
  const textPrimary = isWhite ? '#0f172a' : '#ffffff';
  const textMuted = isWhite ? '#64748b' : '#a0a8c0';
  const accentColor = isWhite ? '#15803d' : '#44cc66';
  const buttonColor = isWhite ? '#16a34a' : '#22c55e'; // Vibrant green
  const cardBg = isWhite ? '#f8fafc' : '#16122d';
  const cardBorder = isWhite ? '#e2e8f0' : '#2a2a4a';

  // Determine progress bar color based on percentage
  let barColor;
  const totalSlots = Number(maxPlayers) || 20;
  const ratio = totalSlots > 0 ? (currentCount / totalSlots) : 0;
  if (ratio >= 1.0) {
    barColor = isWhite ? '#dc2626' : '#ef4444'; // Red
  } else if (ratio > 0.8) {
    barColor = isWhite ? '#ca8a04' : '#eab308'; // Yellow
  } else {
    barColor = isWhite ? '#16a34a' : '#22c55e'; // Green
  }

  const progressContents = [];
  if (currentCount > 0) {
    progressContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: barColor,
      height: '8px',
      cornerRadius: 'md',
      flex: currentCount,
      contents: [{ type: 'filler' }]
    });
  }
  const remaining = maxPlayers - currentCount;
  if (remaining > 0) {
    progressContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: isWhite ? '#e2e8f0' : '#2a2a4a',
      height: '8px',
      cornerRadius: 'md',
      flex: remaining,
      contents: [{ type: 'filler' }]
    });
  }

  const bubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: bgMain,
      spacing: 'md',
      paddingAll: 'lg',
      contents: [
        // Badge Row
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              backgroundColor: isWhite ? '#fee2e2' : '#7f1d1d',
              cornerRadius: 'md',
              paddingStart: 'md',
              paddingEnd: 'md',
              paddingTop: 'xs',
              paddingBottom: 'xs',
              contents: [
                {
                  type: 'text',
                  text: '⚽ ลงชื่อเตะบอล',
                  color: isWhite ? '#dc2626' : '#fca5a5',
                  size: 'md',
                  weight: 'bold'
                }
              ]
            }
          ]
        },
        // Title & Date
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            {
              type: 'text',
              text: `📅 วันเสาร์ที่ ${dateStr}`,
              weight: 'bold',
              size: 'md',
              color: accentColor
            }
          ]
        },
        // Summary & Progress Bar Box
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: cardBg,
          borderColor: cardBorder,
          cornerRadius: 'md',
          paddingAll: 'md',
          spacing: 'xs',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: '👥 ลงชื่อ',
                  size: 'sm',
                  weight: 'bold',
                  color: textPrimary,
                  flex: 1
                },
                {
                  type: 'text',
                  text: `${currentCount} / ${maxPlayers} คน`,
                  size: 'sm',
                  weight: 'bold',
                  color: accentColor,
                  align: 'end',
                  flex: 1
                }
              ]
            },
            // Progress Bar Track Container
            {
              type: 'box',
              layout: 'horizontal',
              height: '8px',
              margin: 'sm',
              contents: progressContents
            }
          ]
        },
        // Description Text
        {
          type: 'text',
          text: 'เปิดลงชื่อสำหรับแมตช์เตะบอลสัปดาห์นี้แล้วครับ สมาชิกทุกคนสามารถกดปุ่มลงชื่อด้านล่าง หรือพิมพ์ +1 ในแชทได้เลย!',
          wrap: true,
          size: 'sm',
          color: textMuted
        },
        {
          type: 'separator',
          color: isWhite ? '#e2e8f0' : '#2a2a4a',
          margin: 'sm'
        },
        // Action Button
        {
          type: 'button',
          action: {
            type: 'message',
            label: '👍 ลงชื่อเข้าเล่น (+1)',
            text: '+1'
          },
          style: 'primary',
          color: buttonColor,
          height: 'sm',
          margin: 'sm'
        }
      ]
    }
  };

  const headerUrl = imageUrl || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg';
  if (headerUrl && headerUrl.toLowerCase() !== 'none') {
    bubble.header = {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: headerUrl,
          size: 'full',
          aspectRatio: '20:10',
          aspectMode: 'cover'
        }
      ]
    };
  }

  return bubble;
}

function buildAutoRegFlex(action, memberName, list, theme) {
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  const bgMain = isWhite ? '#ffffff' : '#0d0d1a';
  const textPrimary = isWhite ? '#0f172a' : '#ffffff';
  const textMuted = isWhite ? '#64748b' : '#a0a8c0';
  const cardBg = isWhite ? '#f8fafc' : '#16122d';
  const cardBorder = isWhite ? '#e2e8f0' : '#2a2a4a';
  const buttonColor = isWhite ? '#16a34a' : '#22c55e'; // Vibrant green

  let badgeText = '';
  let badgeBg = '';
  let badgeTextColor = '';
  let title = '';
  let description = '';
  let bodyContents = [];

  const countStr = list ? ` (${list.length}/24)` : '';
  if (action === 'list') {
    badgeText = `📋 รายชื่อลงทะเบียนอัตโนมัติ${countStr}`;
    badgeBg = isWhite ? '#e0f2fe' : '#0c4a6e';
    badgeTextColor = isWhite ? '#0369a1' : '#38bdf8';
    title = `รายชื่อลงทะเบียนอัตโนมัติ${countStr}`;
  } else if (action === 'add') {
    badgeText = `✅ สมัครลงทะเบียนอัตโนมัติสำเร็จ${countStr}`;
    badgeBg = isWhite ? '#dcfce7' : '#064e3b';
    badgeTextColor = isWhite ? '#15803d' : '#4ade80';
    title = `สมัครลงทะเบียนอัตโนมัติสำเร็จ${countStr}`;

    const displayMember = typeof memberName === 'object' && memberName !== null ? memberName : { name: memberName };
    description = `เพิ่มคุณ ${displayMember.name} ในรายชื่อลงทะเบียนอัตโนมัติสำเร็จแล้ว\n\nระบบจะลงชื่อเข้าเล่นให้คุณโดยอัตโนมัติ เมื่อมีการเปิดรอบสัปดาห์ใหม่ ⚽`;

    bodyContents.push({
      type: 'text',
      text: description,
      wrap: true,
      size: 'sm',
      color: textMuted,
      margin: 'md'
    });
  } else if (action === 'remove') {
    badgeText = `❌ ยกเลิกลงทะเบียนอัตโนมัติ${countStr}`;
    badgeBg = isWhite ? '#fee2e2' : '#7f1d1d';
    badgeTextColor = isWhite ? '#b91c1c' : '#fca5a5';
    title = `ยกเลิกลงทะเบียนอัตโนมัติ${countStr}`;

    const displayMember = typeof memberName === 'object' && memberName !== null ? memberName : { name: memberName };
    description = `นำคุณ ${displayMember.name} ออกจากรายชื่อลงทะเบียนอัตโนมัติเรียบร้อยแล้ว`;

    bodyContents.push({
      type: 'text',
      text: description,
      wrap: true,
      size: 'sm',
      color: textMuted,
      margin: 'md'
    });
  } else if (action === 'already') {
    badgeText = `ℹ️ สมัครลงทะเบียนอัตโนมัติไว้อยู่แล้ว${countStr}`;
    badgeBg = isWhite ? '#fef3c7' : '#78350f';
    badgeTextColor = isWhite ? '#b45309' : '#f59e0b';
    title = `สมัครลงทะเบียนอัตโนมัติไว้อยู่แล้ว${countStr}`;

    const displayMember = typeof memberName === 'object' && memberName !== null ? memberName : { name: memberName };
    description = `คุณ ${displayMember.name} สมัครลงทะเบียนอัตโนมัติไว้อยู่แล้วครับ`;

    bodyContents.push({
      type: 'text',
      text: description,
      wrap: true,
      size: 'sm',
      color: textMuted,
      margin: 'md'
    });
  } else if (action === 'full') {
    badgeText = `🚫 ไม่สามารถลงทะเบียนอัตโนมัติได้${countStr}`;
    badgeBg = isWhite ? '#fee2e2' : '#7f1d1d';
    badgeTextColor = isWhite ? '#b91c1c' : '#fca5a5';
    title = `ไม่สามารถลงทะเบียนอัตโนมัติได้${countStr}`;

    description = 'ไม่สามารถลงทะเบียนอัตโนมัติได้ เนื่องจากโควตาเต็มแล้ว (สูงสุด 24 คน) ⚽';

    bodyContents.push({
      type: 'text',
      text: description,
      wrap: true,
      size: 'sm',
      color: textMuted,
      margin: 'md'
    });
  }

  const displayMember = typeof memberName === 'object' && memberName !== null ? memberName : { name: memberName };
  if (!list || list.length === 0) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: cardBg,
      borderColor: cardBorder,
      borderWidth: 'normal',
      cornerRadius: 'md',
      paddingAll: 'lg',
      margin: 'md',
      alignItems: 'center',
      contents: [
        {
          type: 'text',
          text: '📝 ยังไม่มีสมาชิกลงทะเบียนอัตโนมัติ',
          color: textPrimary,
          size: 'sm',
          weight: 'bold',
          align: 'center'
        },
        {
          type: 'text',
          text: 'กดปุ่ม "+ สมัครลงชื่อ" ด้านล่าง เพื่อลงชื่อเข้าเล่นโดยอัตโนมัติทุกสัปดาห์',
          color: textMuted,
          size: 'xs',
          wrap: true,
          align: 'center',
          margin: 'sm'
        }
      ]
    });
  } else {
    // Capacity Progress Bar
    const currentCount = list.length;
    const maxPlayers = 24;
    const ratio = Math.min(1.0, currentCount / maxPlayers);
    let barColor = isWhite ? '#16a34a' : '#22c55e';
    if (ratio >= 1.0) barColor = isWhite ? '#dc2626' : '#ef4444';
    else if (ratio > 0.8) barColor = isWhite ? '#ca8a04' : '#eab308';

    const progressContents = [];
    if (currentCount > 0) {
      progressContents.push({
        type: 'box',
        layout: 'vertical',
        backgroundColor: barColor,
        height: '6px',
        cornerRadius: 'md',
        flex: currentCount,
        contents: [{ type: 'filler' }]
      });
    }
    const remaining = maxPlayers - currentCount;
    if (remaining > 0) {
      progressContents.push({
        type: 'box',
        layout: 'vertical',
        backgroundColor: isWhite ? '#e2e8f0' : '#2a2a4a',
        height: '6px',
        cornerRadius: 'md',
        flex: remaining,
        contents: [{ type: 'filler' }]
      });
    }

    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: cardBg,
      borderColor: cardBorder,
      borderWidth: 'normal',
      cornerRadius: 'md',
      paddingAll: 'md',
      margin: 'md',
      contents: [
        // Capacity Header Box
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: '📊 จำนวนสมาชิกที่ลงทะเบียน',
              size: 'xs',
              weight: 'bold',
              color: textMuted,
              flex: 1
            },
            {
              type: 'text',
              text: `${currentCount} / ${maxPlayers} คน`,
              size: 'xs',
              weight: 'bold',
              color: barColor,
              align: 'end',
              flex: 1
            }
          ]
        },
        // Progress bar container
        {
          type: 'box',
          layout: 'horizontal',
          height: '6px',
          margin: 'xs',
          contents: progressContents
        }
      ]
    });

    // Render 2 columns top-to-bottom using makeTwoColumnMemberRows
    const preparedList = list.map(m => {
      const isCurrent = Boolean(displayMember && m.id === displayMember.id);
      return { ...m, isCurrent };
    });

    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: cardBg,
      borderColor: cardBorder,
      borderWidth: 'normal',
      cornerRadius: 'md',
      paddingAll: 'sm',
      margin: 'md',
      spacing: 'xs',
      contents: makeTwoColumnMemberRows(preparedList, colors)
    });
  }

  // Construct footer buttons (uniform 3-button menu across all actions)
  const isFull = list && list.length >= 24;
  const registerButton = isFull
    ? makeDisabledBoxButton('สมัคร (เต็ม)', '#9ca3af')
    : makeBoxButton('➕ สมัคร', '+autoreg', buttonColor);

  const footerButtons = [
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'sm',
      contents: [
        makeBoxButton('📋 รายชื่อ', '/autoreglist', buttonColor),
        registerButton,
        makeBoxButton('➖ ยกเลิก', '-autoreg', isWhite ? '#ef4444' : '#b91c1c')
      ]
    }
  ];

  const bubble = {
    type: 'bubble',
    size: 'giga',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: bgMain,
      spacing: 'md',
      paddingAll: 'lg',
      contents: [
        // Badge Row
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              backgroundColor: badgeBg,
              cornerRadius: 'md',
              paddingStart: 'md',
              paddingEnd: 'md',
              paddingTop: 'xs',
              paddingBottom: 'xs',
              contents: [
                {
                  type: 'text',
                  text: badgeText,
                  color: badgeTextColor,
                  size: 'sm',
                  weight: 'bold'
                }
              ]
            }
          ]
        },
        // Body contents (table list or description)
        ...bodyContents,
        {
          type: 'separator',
          color: isWhite ? '#e2e8f0' : '#2a2a4a',
          margin: 'md'
        },
        // Action Buttons
        ...footerButtons
      ]
    }
  };

  return bubble;
}

function buildMemberStatsFlex(data, theme) {
  const { member, stats, firstMatchDate, colorStats, luckyColor } = data;
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  const bgMain = isWhite ? '#ffffff' : '#0d0d1a';
  const bgHeader = isWhite ? '#f1f5f9' : '#1a1a2e';
  const separatorColor = isWhite ? '#e2e8f0' : '#2a2a4a';

  let durationText = '';
  if (firstMatchDate) {
    const firstDate = new Date(firstMatchDate);
    const now = new Date();
    let years = now.getFullYear() - firstDate.getFullYear();
    let months = now.getMonth() - firstDate.getMonth();
    if (months < 0) {
      years--;
      months += 12;
    }
    const parts = [];
    if (years > 0) parts.push(`${years} ปี`);
    if (months > 0 || years === 0) parts.push(`${months} เดือน`);
    durationText = ` (${parts.join(' ')})`;
  }

  const makeStatRow = (icon, label, yearVal, allTimeVal, isEven) => {
    const rowBg = isEven ? (isWhite ? '#f8fafc' : '#12192c') : null;
    const rowObj = {
      type: 'box',
      layout: 'horizontal',
      paddingAll: 'sm',
      alignItems: 'center',
      contents: [
        {
          type: 'text',
          text: `${icon} ${label}`,
          size: 'xs',
          color: colors.textPrimary,
          weight: 'bold',
          flex: 4
        },
        {
          type: 'text',
          text: String(yearVal),
          size: 'xs',
          color: colors.textAccent,
          weight: 'bold',
          align: 'center',
          flex: 2
        },
        {
          type: 'text',
          text: String(allTimeVal),
          size: 'xs',
          color: colors.textMutedLight,
          weight: 'bold',
          align: 'center',
          flex: 2
        }
      ]
    };
    if (rowBg) {
      rowObj.backgroundColor = rowBg;
    }
    return rowObj;
  };

  const bodyContents = [];

  // ── Header card with player info ──
  const playerProfileBlock = [];

  // Profile Avatar Box (Left)
  if (member.pictureUrl) {
    playerProfileBlock.push({
      type: 'box',
      layout: 'vertical',
      width: '64px',
      height: '64px',
      cornerRadius: '100px',
      flex: 0,
      contents: [
        {
          type: 'image',
          url: member.pictureUrl,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'cover'
        }
      ]
    });
  } else {
    // Fallback: Default placeholder avatar/icon if no pictureUrl is available
    playerProfileBlock.push({
      type: 'box',
      layout: 'vertical',
      width: '64px',
      height: '64px',
      cornerRadius: '100px',
      backgroundColor: isWhite ? '#e2e8f0' : '#1e1e38',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 0,
      contents: [
        {
          type: 'text',
          text: '👤',
          size: '3xl',
          align: 'center',
          gravity: 'center'
        }
      ]
    });
  }

  // Name & Badges Info Box (Right)
  const infoContents = [];

  // Badges (placed in front of the name)
  if (member.badgeUrl) {
    infoContents.push({
      type: 'box',
      layout: 'vertical',
      width: member.badgeSize || '20px',
      height: member.badgeSize || '20px',
      flex: 0,
      contents: [
        {
          type: 'image',
          url: member.badgeUrl,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'cover',
          animated: true
        }
      ]
    });
  }

  if (member.hofBadges && member.hofBadges.length > 0) {
    for (const hb of member.hofBadges) {
      infoContents.push({
        type: 'box',
        layout: 'vertical',
        width: hb.size || '20px',
        height: hb.size || '20px',
        flex: 0,
        contents: [
          {
            type: 'image',
            url: hb.url,
            size: 'full',
            aspectRatio: '1:1',
            aspectMode: 'cover',
            animated: true
          }
        ],
        margin: 'sm'
      });
    }
  } else if (member.hofCount && member.hofCount > 0 && member.hofBadgeUrl) {
    infoContents.push({
      type: 'box',
      layout: 'vertical',
      width: member.hofBadgeSize || '20px',
      height: member.hofBadgeSize || '20px',
      flex: 0,
      contents: [
        {
          type: 'image',
          url: member.hofBadgeUrl,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'cover',
          animated: true
        }
      ],
      margin: 'sm'
    });
  }

  // Name and Duration
  infoContents.push({
    type: 'text',
    text: `${member.name}${durationText}`,
    weight: 'bold',
    size: 'sm',
    wrap: true,
    color: member.nameColor || colors.textPrimary,
    gravity: 'center',
    margin: 'sm',
    flex: 1
  });

  playerProfileBlock.push({
    type: 'box',
    layout: 'horizontal',
    flex: 1,
    margin: 'md',
    alignItems: 'center',
    contents: infoContents
  });

  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    backgroundColor: bgHeader,
    paddingAll: 'md',
    cornerRadius: 'md',
    alignItems: 'center',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        flex: 1,
        contents: playerProfileBlock
      },
      {
        type: 'text',
        text: '⚽ สถิติส่วนตัว',
        size: 'sm',
        color: colors.textMuted,
        align: 'end',
        gravity: 'center',
        flex: 0
      }
    ]
  });

  bodyContents.push({ type: 'separator', margin: 'md', color: separatorColor });

  // ── Column Headers ──
  const currentYear = new Date().getFullYear();
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    paddingAll: 'sm',
    contents: [
      { type: 'text', text: 'ประเภทสถิติ', size: 'xxs', color: colors.textMutedDark, weight: 'bold', flex: 4 },
      { type: 'text', text: `ปีนี้ (${currentYear})`, size: 'xxs', color: colors.textMutedDark, weight: 'bold', align: 'center', flex: 2 },
      { type: 'text', text: 'ทั้งหมด', size: 'xxs', color: colors.textMutedDark, weight: 'bold', align: 'center', flex: 2 }
    ]
  });

  bodyContents.push({ type: 'separator', margin: 'xs', color: separatorColor });

  // ── Rows ──
  bodyContents.push(makeStatRow('⚽', 'ประตู (Goals)', stats.goals.year, stats.goals.alltime, false));
  bodyContents.push(makeStatRow('👟', 'แอสซิสต์ (Assists)', stats.assists.year, stats.assists.alltime, true));
  bodyContents.push(makeStatRow('🥅', 'สปายฝั่งตรงข้าม (OG)', stats.owngoals.year, stats.owngoals.alltime, false));

  const mvpYear = stats.mvp ? stats.mvp.year : 0;
  const mvpAlltime = stats.mvp ? stats.mvp.alltime : 0;
  bodyContents.push(makeStatRow('🌟', 'MVP ประจำสัปดาห์', mvpYear, mvpAlltime, true));

  const bestRatYear = (stats.bestRating && stats.bestRating.year) ? stats.bestRating.year : '0.0';
  const bestRatAlltime = (stats.bestRating && stats.bestRating.alltime) ? stats.bestRating.alltime : '0.0';
  bodyContents.push(makeStatRow('⭐', 'เรตติ้งสูงสุด (Best)', bestRatYear, bestRatAlltime, false));

  bodyContents.push(makeStatRow('📊', 'คะแนนเฉลี่ย (Avg Pts)', stats.avgpts.year.toFixed(2), stats.avgpts.alltime.toFixed(2), true));
  bodyContents.push(makeStatRow('🏟️', 'นัดที่ลงเล่น (Matches)', stats.matches.year, stats.matches.alltime, false));
  bodyContents.push(makeStatRow('📅', 'สัปดาห์ที่ร่วม (Weeks)', stats.weeks.year, stats.weeks.alltime, true));

  bodyContents.push(makeStatRow('📈', '% ชนะ (Win %)', stats.win.yearPct + '%', stats.win.alltimePct + '%', false));

  const champYearStr = `${stats.champ.year} (${stats.champ.yearPct}%)`;
  const champAlltimeStr = `${stats.champ.alltime} (${stats.champ.alltimePct}%)`;
  bodyContents.push(makeStatRow('👑', 'แชมป์ประจำสัปดาห์', champYearStr, champAlltimeStr, true));

  const bottomYearStr = `${stats.bottom.year} (${stats.bottom.yearPct}%)`;
  const bottomAlltimeStr = `${stats.bottom.alltime} (${stats.bottom.alltimePct}%)`;
  bodyContents.push(makeStatRow('📉', 'ซึมเศร้าประจำสัปดาห์', bottomYearStr, bottomAlltimeStr, false));

  // ── Team Color Stats Section ──
  if (colorStats && colorStats.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'md', color: separatorColor });

    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: '🎨 อัตราชนะตามสีทีม (% Win by Color)',
          size: 'xs',
          color: colors.textMutedDark,
          weight: 'bold',
          flex: 1
        }
      ]
    });

    bodyContents.push({ type: 'separator', margin: 'xs', color: separatorColor });

    const translateColor = (col) => {
      if (!col) return 'ไม่มี (None)';
      const cl = col.toLowerCase();
      if (cl === 'red') return 'สีแดง (Red)';
      if (cl === 'green') return 'สีเขียว (Green)';
      if (cl === 'black') return 'สีดำ (Black)';
      if (cl === 'white') return 'สีขาว (White)';
      return col;
    };

    const luckyColorText = luckyColor ? translateColor(luckyColor) : 'ไม่มี (None)';
    const luckyColorHex = luckyColor ? colors.tdc(luckyColor) : colors.textMuted;

    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      paddingAll: 'sm',
      alignItems: 'center',
      contents: [
        {
          type: 'text',
          text: '✨ สีนำโชค (Lucky Color)',
          size: 'xs',
          color: colors.textPrimary,
          weight: 'bold',
          flex: 4
        },
        {
          type: 'text',
          text: luckyColorText,
          size: 'xs',
          color: luckyColorHex,
          weight: 'bold',
          align: 'end',
          flex: 4
        }
      ]
    });

    bodyContents.push({ type: 'separator', margin: 'xs', color: separatorColor });

    colorStats.forEach((c, index) => {
      const isEven = index % 2 === 1;
      const rowBg = isEven ? (isWhite ? '#f8fafc' : '#12192c') : null;

      const rowObj = {
        type: 'box',
        layout: 'horizontal',
        paddingAll: 'sm',
        alignItems: 'center',
        contents: [
          {
            type: 'text',
            text: `● ทีม${translateColor(c.color)}`,
            size: 'xs',
            color: colors.tdc(c.color),
            weight: 'bold',
            flex: 4
          },
          {
            type: 'text',
            text: `${c.winRate}%`,
            size: 'xs',
            color: colors.textAccent,
            weight: 'bold',
            align: 'center',
            flex: 2
          },
          {
            type: 'text',
            text: `${c.wins}/${c.matches} นัด`,
            size: 'xs',
            color: colors.textMutedLight,
            weight: 'bold',
            align: 'center',
            flex: 2
          }
        ]
      };
      if (rowBg) {
        rowObj.backgroundColor = rowBg;
      }
      bodyContents.push(rowObj);
    });
  }

  bodyContents.push({ type: 'separator', margin: 'md', color: separatorColor });

  const buttonColor = isWhite ? '#16a34a' : '#22c55e';
  const topStatsColor = isWhite ? '#e7d015ff' : '#dbb104ff';
  const bottomStatsColor = isWhite ? '#ef4444' : '#b91c1c';

  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    margin: 'md',
    contents: [
      makeBoxButton('🏆 อันดับผู้นำ', '/top', topStatsColor),
      makeBoxButton('📉 ทำเนียบซึมเศร้า', '/bottom', bottomStatsColor),
      makeBoxButton('👍 สถิติส่วนตัว', '/stat', buttonColor)
    ]
  });

  const bubble = {
    type: 'bubble',
    size: 'giga',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: bgMain,
      paddingAll: 'md',
      contents: bodyContents
    }
  };

  return bubble;
}

function buildRegisterClosedFlex(theme, imageUrl = null) {
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  const bgMain = isWhite ? '#ffffff' : '#0d0d1a';
  const textPrimary = isWhite ? '#0f172a' : '#ffffff';
  const textMuted = isWhite ? '#64748b' : '#a0a8c0';
  const buttonColor = isWhite ? '#16a34a' : '#22c55e'; // Vibrant green
  const cardBg = isWhite ? '#fee2e2' : '#2d1616'; // Subtle red tint
  const cardBorder = isWhite ? '#fca5a5' : '#4a2a2a';

  const bubble = {
    type: 'bubble',
    size: 'giga',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: bgMain,
      spacing: 'md',
      contents: [
        // Badge
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              backgroundColor: isWhite ? '#fee2e2' : '#7f1d1d',
              cornerRadius: 'md',
              paddingStart: 'md',
              paddingEnd: 'md',
              paddingTop: 'xs',
              paddingBottom: 'xs',
              contents: [
                {
                  type: 'text',
                  text: '🚫 ระบบปิดรับลงชื่อแล้ว',
                  color: isWhite ? '#b91c1c' : '#fca5a5',
                  size: 'lg',
                  weight: 'bold'
                }
              ]
            }
          ]
        },
        // Title
        /*{
          type: 'text',
          text: 'ระบบปิดรับลงชื่อแล้ว',
          weight: 'bold',
          size: 'lg',
          wrap: true,
          color: textPrimary
        },*/
        // Card Container
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: cardBg,
          borderColor: cardBorder,
          cornerRadius: 'md',
          paddingAll: 'md',
          contents: [
            {
              type: 'text',
              text: 'ขออภัย ระบบปิดรับลงชื่อสำหรับสัปดาห์นี้แล้ว\n\n(ปิดลงชื่อทุกวันเสาร์ เวลา 19:00 น. เป็นต้นไป จนกว่าจะมีการเปิดรอบสัปดาห์ใหม่ ⚽)',
              wrap: true,
              size: 'xs',
              color: isWhite ? '#991b1b' : '#f87171',
              weight: 'bold'
            }
          ]
        },
        // Description/Action Hint
        {
          type: 'text',
          text: 'คุณสามารถกดปุ่มด้านล่างเพื่อตรวจสอบรายชื่อผู้เข้าเล่น หรือสมาชิกลงชื่ออัตโนมัติในระบบได้ครับ',
          wrap: true,
          size: 'xs',
          color: textMuted
        },
        {
          type: 'separator',
          color: isWhite ? '#e2e8f0' : '#2a2a4a',
          margin: 'sm'
        },
        // Footer Buttons
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            makeBoxButton('📋 ดูสมาชิกที่ลงชื่อ', '/register', buttonColor, 1, 'xs', true),
            makeBoxButton('👤 รายชื่อลงทะเบียนอัตโนมัติ', '/autoreglist', isWhite ? '#64748b' : '#334155', 1, 'xs', true)
          ]
        }
      ]
    }
  };

  const headerUrl = imageUrl || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg';
  if (headerUrl && headerUrl.toLowerCase() !== 'none') {
    bubble.header = {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: headerUrl,
          size: 'full',
          aspectRatio: '20:10',
          aspectMode: 'cover'
        }
      ]
    };
  }

  return bubble;
}

function buildAutoRegFullFlex(theme, imageUrl = null) {
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  const bgMain = isWhite ? '#ffffff' : '#0d0d1a';
  const textPrimary = isWhite ? '#0f172a' : '#ffffff';
  const textMuted = isWhite ? '#64748b' : '#a0a8c0';
  const buttonColor = isWhite ? '#16a34a' : '#22c55e'; // Vibrant green
  const cardBg = isWhite ? '#fee2e2' : '#2d1616'; // Subtle red/orange tint
  const cardBorder = isWhite ? '#fca5a5' : '#4a2a2a';

  const bubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: bgMain,
      spacing: 'md',
      contents: [
        // Badge
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              backgroundColor: isWhite ? '#fee2e2' : '#7f1d1d',
              cornerRadius: 'md',
              paddingStart: 'md',
              paddingEnd: 'md',
              paddingTop: 'xs',
              paddingBottom: 'xs',
              contents: [
                {
                  type: 'text',
                  text: '🚫 ลงชื่ออัตโนมัติเต็มแล้ว',
                  color: isWhite ? '#b91c1c' : '#fca5a5',
                  size: 'lg',
                  weight: 'bold'
                }
              ]
            }
          ]
        },
        // Title
        /*{
          type: 'text',
          text: 'รายชื่อลงชื่อออโต้เต็มแล้ว',
          weight: 'bold',
          size: 'lg',
          wrap: true,
          color: textPrimary
        },*/
        // Card Container
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: cardBg,
          borderColor: cardBorder,
          cornerRadius: 'md',
          paddingAll: 'md',
          contents: [
            {
              type: 'text',
              text: 'ขออภัย ไม่สามารถลงชื่อเพิ่มได้ เนื่องจากรายชื่อสมัครลงทะเบียนอัตโนมัติเต็มแล้ว (สูงสุด 24 คน)',
              wrap: true,
              size: 'xs',
              color: isWhite ? '#991b1b' : '#f87171',
              weight: 'bold'
            }
          ]
        },
        // Description/Action Hint
        {
          type: 'text',
          text: 'คุณสามารถตรวจสอบรายชื่อทั้งหมดในระบบได้จากปุ้มด้านล่าง',
          wrap: true,
          size: 'xs',
          color: textMuted
        },
        {
          type: 'separator',
          color: isWhite ? '#e2e8f0' : '#2a2a4a',
          margin: 'sm'
        },
        // Footer Buttons
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            makeBoxButton('📋 ดูรายชื่อออโต้', '/autoreglist', buttonColor, 1, 'xs', true)
          ]
        }
      ]
    }
  };



  return bubble;
}

function buildMenuFlex(dateStr, theme, title = null, autoRegCount = 0) {
  const bodyContents = [];
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  if (title) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: isWhite ? '#fee2e2' : '#7f1d1d',
      borderColor: isWhite ? '#fecaca' : '#991b1b',
      cornerRadius: 'md',
      paddingAll: 'md',
      contents: [
        {
          type: 'text',
          text: title,
          wrap: true,
          size: 'xs',
          color: isWhite ? '#b91c1c' : '#fca5a5',
          weight: 'bold'
        }
      ]
    });
  }

  // Section 1: ลงชื่อเตะบอล
  const buttonRegisterColor = isWhite ? '#16a34a' : '#22c55e'; // Green
  const buttonCancelColor = isWhite ? '#dc2626' : '#ef4444'; // Red

  bodyContents.push({
    type: 'text',
    text: `▶ ลงชื่อสัปดาห์นี้ เสาร์ที่ ${dateStr}`,
    size: 'sm',
    weight: 'bold',
    color: colors.textAccent,
    margin: title ? 'sm' : 'none'
  });
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    margin: 'xs',
    contents: [
      makeBoxButton('👍 ลงชื่อ', '+1', buttonRegisterColor),
      makeBoxButton('❌ ยกเลิก', '-1', buttonCancelColor),
      makeBoxButton('📱 QR ค่าสนาม', '/qr', '#088181ff')
    ]
  });

  // Section 2: ทำเนียบและสถิติ
  const topStatsColor = isWhite ? '#e7d015ff' : '#dbb104ff';
  const bottomStatsColor = isWhite ? '#ef4444' : '#b91c1c';
  const personalStatsColor = isWhite ? '#0284c7' : '#0ea5e9';

  bodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
  bodyContents.push({
    type: 'text',
    text: '▶ ทำเนียบและสถิติ',
    size: 'sm',
    weight: 'bold',
    color: colors.textAccent,
    margin: 'sm'
  });
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    margin: 'xs',
    contents: [
      makeBoxButton('🏆 ผู้นำ', '/top', topStatsColor),
      makeBoxButton('📉 ซึมเศร้า', '/bottom', bottomStatsColor),
      makeBoxButton('👑 MVP', '/mvplist', '#dbb104ff'),
      makeBoxButton('📊 สถิติส่วนตัว', '/stat', personalStatsColor)
    ]
  });

  // Section 3: ลงทะเบียนอัตโนมัติ
  bodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
  bodyContents.push({
    type: 'text',
    text: `▶ ลงทะเบียนอัตโนมัติ (${autoRegCount}/24)`,
    size: 'sm',
    weight: 'bold',
    color: colors.textAccent,
    margin: 'sm'
  });

  const isFull = autoRegCount >= 24;
  const registerButton = isFull
    ? makeDisabledBoxButton('สมัคร (เต็ม)', '#9ca3af')
    : makeBoxButton('➕ สมัคร', '+autoreg', buttonRegisterColor);

  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    margin: 'xs',
    contents: [
      makeBoxButton('📋 รายชื่อ', '/autoreglist', topStatsColor),
      registerButton,
      makeBoxButton('➖ ยกเลิก', '-autoreg', buttonCancelColor)
    ]
  });

  const bubble = {
    type: 'bubble',
    size: 'giga',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      paddingAll: 'md',
      contents: bodyContents
    }
  };

  return bubble;
}

function buildQrFlex(amount, promptPayNumber, theme, qrUrl) {
  const colors = getThemeColors(theme);
  const finalQrUrl = qrUrl;

  return {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      spacing: 'md',
      paddingAll: 'lg',
      contents: [
        {
          type: 'text',
          text: 'สแกน QR Code เพื่อชำระเงิน',
          weight: 'bold',
          size: 'md',
          color: colors.textPrimary,
          align: 'center'
        },
        {
          type: 'image',
          url: finalQrUrl,
          aspectMode: 'fit',
          size: 'full',
          aspectRatio: '1:1',
          margin: 'md'
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: 'ค่าสนาม',
                  size: 'sm',
                  color: colors.textMuted,
                  flex: 3
                },
                {
                  type: 'text',
                  text: `${amount} บาท`,
                  size: 'sm',
                  weight: 'bold',
                  color: colors.textAccent,
                  flex: 7,
                  align: 'end'
                }
              ]
            }
          ]
        },
        {
          type: 'separator',
          color: colors.separator
        },
        {
          type: 'text',
          text: 'หลังจากสแกนชำระเงินเรียบร้อยแล้ว รอซัก 2-3 นาที แล้วค่อยกดส่ง บางธนาคารอาจจะยัง ไม่อัพเดทสลิปให้ระบบภายนอกตรวจสอบครับ',
          size: 'xs',
          color: colors.textMuted,
          wrap: true,
          align: 'start',
          margin: 'md'
        }
      ]
    }
  };
}

function buildSlipListFlex(slips, theme) {
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';
  const baseUrl = getBaseUrl();

  if (!slips || slips.length === 0) {
    return {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: colors.bgMain,
        paddingAll: 'lg',
        contents: [
          {
            type: 'text',
            text: '📋 สลิปรอตรวจสอบ',
            weight: 'bold',
            size: 'lg',
            color: colors.textPrimary
          },
          {
            type: 'text',
            text: 'ไม่มีสลิปที่รอตรวจสอบในขณะนี้',
            size: 'sm',
            color: colors.textMuted,
            margin: 'md',
            wrap: true
          }
        ]
      }
    };
  }

  const bubbles = [];
  for (const slip of slips) {
    const senderName = (slip.sender_name || 'ไม่ทราบ').replace('@', '');
    const dateStr = slip.created_at ? new Date(slip.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-';
    const slipImgUrl = slip.image_path ? `${baseUrl}${slip.image_path}` : null;

    let headerTitle = '📋 สลิปรอตรวจสอบ';
    let statusText = 'รอตรวจสอบ';
    let statusColor = isWhite ? '#d97706' : '#fbbf24';
    let showVerifyButton = true;

    if (slip.status === 'success') {
      headerTitle = '✅ สลิปตรวจสอบแล้ว';
      statusText = 'ตรวจสอบแล้ว ✅';
      statusColor = isWhite ? '#16a34a' : '#22c55e';
      showVerifyButton = false;
    } else if (slip.status === 'duplicate') {
      headerTitle = '⚠️ สลิปซ้ำ';
      statusText = 'สลิปซ้ำ ⚠️';
      statusColor = isWhite ? '#dc2626' : '#ef4444';
      showVerifyButton = false;
    } else if (slip.status === 'not_me') {
      headerTitle = '📝 สลิปโอนบัญชีอื่น';
      statusText = 'ไม่เกี่ยวกับค่าสนาม 📝';
      statusColor = colors.textMuted;
      showVerifyButton = false;
    }

    const bodyContents = [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'text',
            text: headerTitle,
            weight: 'bold',
            size: 'md',
            color: colors.textPrimary,
            flex: 3
          },
          {
            type: 'text',
            text: `#${slip.id}`,
            size: 'sm',
            color: colors.textMuted,
            align: 'end',
            flex: 1
          }
        ]
      },
      { type: 'separator', margin: 'md', color: colors.separator },
      {
        type: 'box',
        layout: 'vertical',
        margin: 'md',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '👤 ผู้ส่ง:', size: 'xs', color: colors.textMuted, flex: 2 },
              { type: 'text', text: senderName, size: 'xs', color: colors.textPrimary, weight: 'bold', flex: 4 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '📅 วันที่:', size: 'xs', color: colors.textMuted, flex: 2 },
              { type: 'text', text: dateStr, size: 'xs', color: colors.textPrimary, flex: 4 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '📌 สถานะ:', size: 'xs', color: colors.textMuted, flex: 2 },
              { type: 'text', text: statusText, size: 'xs', color: statusColor, weight: 'bold', flex: 4 }
            ]
          }
        ]
      }
    ];

    // Add slip image preview if available
    if (slipImgUrl) {
      bodyContents.push({
        type: 'image',
        url: slipImgUrl,
        size: 'full',
        aspectRatio: '4:3',
        aspectMode: 'cover',
        margin: 'md'
      });
    }

    // Verify button if unverified/noticed
    if (showVerifyButton) {
      bodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
      bodyContents.push({
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        margin: 'md',
        contents: [
          makeBoxButton('✅ ตรวจสอบสลิป', `/verify ${slip.id}`, isWhite ? '#16a34a' : '#22c55e')
        ]
      });
    }

    bubbles.push({
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: colors.bgMain,
        paddingAll: 'lg',
        contents: bodyContents
      }
    });
  }

  if (bubbles.length === 1) {
    return bubbles[0];
  }

  return {
    type: 'carousel',
    contents: bubbles
  };
}

function buildScorerRowFlex(icon, match_goals, goal_status, assets, resolveMemberDisplayInfo) {
  const spans = [];

  spans.push({
    type: "span",
    text: `${icon} `,
    color: "#a0a8c0"
  });

  let isFirst = true;
  for (const member of match_goals) {
    if (!isFirst) {
      spans.push({
        type: "span",
        text: " • ",
        color: "#7878a8"
      });
    }
    isFirst = false;

    const info = resolveMemberDisplayInfo(member, assets ? assets.badges : {}, assets ? assets.donateColors : [], assets ? assets.hofCounts : {}, assets ? assets.hofBadge : {}, assets ? assets.hofAwards : {});

    let nameText = (info.name || 'ไม่ระบุ').replace(/^@+/, '');
    if (member.goal > 1) {
      nameText = `+(${member.goal})${nameText}`;
    }
    if (member.statusid == 2) {
      nameText += "🥅";
    } else if (member.statusid == 1) {
      nameText += "🔄";
    }

    spans.push({
      type: "span",
      text: nameText || 'ไม่ระบุ',
      color: info.nameColor || (goal_status === 3 ? '#bbddff' : '#ddddff'),
      weight: 'bold'
    });
  }

  return {
    type: "text",
    text: icon,
    contents: spans,
    size: "xs",
    wrap: true
  };
}

function buildTableWeekFlex(dateStr, weekTables, teamColors) {
  const tables = [
    {
      type: "text",
      text: `Table Week - ${dateStr}`,
      weight: "bold",
      size: "lg",
      align: "center",
    },
    {
      type: "separator",
      margin: "none",
      color: "#000000"
    },
    {
      type: "separator",
      color: "#FFFFFF",
      margin: "md"
    },
    {
      type: "box",
      layout: "baseline",
      margin: "xs",
      contents: [
        { type: "icon", size: "xs", url: "https://commons.wikimedia.org/wiki/File:BLANK_ICON.png" },
        { type: "text", text: "Team", weight: "bold", size: "sm", flex: 1 },
        { type: "text", text: "W", wrap: true, weight: "bold", size: "sm", align: "center", flex: 1 },
        { type: "text", text: "D", weight: "bold", size: "sm", align: "center", flex: 1 },
        { type: "text", text: "L", weight: "bold", size: "sm", align: "center", flex: 1 },
        { type: "text", text: "G", weight: "bold", size: "sm", align: "center", flex: 1 },
        { type: "text", text: "A", weight: "bold", size: "sm", align: "center", flex: 1 },
        { type: "text", text: "PTS", weight: "bold", size: "sm", align: "center", flex: 1 }
      ]
    }
  ];

  let i = 0;
  for (const table of weekTables) {
    let top_url = "https://commons.wikimedia.org/wiki/File:BLANK_ICON.png";
    if (i === 0) {
      top_url = "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png";
    }
    const team = teamColors.find(tc => tc.id === table.team_week_id) || {};
    tables.push({
      type: "box",
      layout: "baseline",
      margin: "xs",
      flex: 1,
      contents: [
        { type: "icon", size: "xs", url: top_url },
        { type: "text", text: `${table.color}`, color: `${team.code || '#ffffff'}`, size: "sm", weight: "bold", flex: 1 },
        { type: "text", text: `${table.w}`, align: "center", size: "sm", flex: 1 },
        { type: "text", text: `${table.d}`, size: "sm", align: "center", flex: 1 },
        { type: "text", text: `${table.l}`, size: "sm", align: "center", flex: 1 },
        { type: "text", text: `${table.G}`, size: "sm", align: "center", flex: 1 },
        { type: "text", text: `${table.A}`, size: "sm", align: "center", flex: 1 },
        { type: "text", text: `${table.pts}`, size: "sm", align: "center", flex: 1 }
      ]
    });
    i++;
  }
  return tables;
}

/**
 * Build Flex bubble for /top (stat ranking tables for scorers, assists, avg pts, bottom, lucky colors).
 */
function buildTopStatFlex(result, type, header, icon, url, theme, assets = {}, resolveInfoFn) {
  const colors = getThemeColors(theme);
  const bodyContents = [];

  // Stat header card
  bodyContents.push({
    type: 'box',
    layout: 'vertical',
    backgroundColor: colors.bgHeader,
    paddingAll: 'md',
    cornerRadius: 'md',
    contents: [
      {
        type: 'text',
        text: `${icon} ${header}`,
        weight: 'bold',
        size: 'md',
        color: colors.textPrimary,
        align: 'center'
      }
    ]
  });

  const rankIcons = ['🥇', '🥈', '🥉'];
  result.forEach((member, i) => {
    let nameBoxContents = [];
    let nameColor = colors.textMutedLight;
    let valText = "";
    const rankLabel = rankIcons[i] || `${i + 1}.`;
    const isTop = i === 0;

    if (type == 6) {
      const wins = Number(member.wins || 0);
      const matches = Number(member.matches || 0);
      const winRate = matches > 0 ? ((wins / matches) * 100).toFixed(1) : '0.0';
      valText = `${winRate}% (${wins}/${matches})`;

      const translateColor = (col) => {
        if (!col) return '';
        const cl = col.toLowerCase();
        if (cl === 'red') return 'แดง (Red)';
        if (cl === 'green') return 'เขียว (Green)';
        if (cl === 'black') return 'ดำ (Black)';
        if (cl === 'white') return 'ขาว (White)';
        if (cl === 'yellow') return 'เหลือง (Yellow)';
        return col;
      };
      const displayName = `● ทีม${translateColor(member.color)}`;
      nameColor = colors.tdc(member.color);
      nameBoxContents.push({
        type: 'text',
        text: displayName,
        size: 'xs',
        color: nameColor,
        flex: 1,
        margin: 'sm'
      });
    } else {
      const info = resolveInfoFn ? resolveInfoFn(member, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards) : member;
      valText = `${member.goal}`;
      /*if (type == 4) {
        valText = `${member.goal} ครั้ง`;
      } else {
        valText = `${member.goal}`;
      }*/

      if (i < 3) {
        // TOP 3: Render rank medal, avatar picture, rank badge, HOF crowns, and donator colored name
        nameBoxContents.push({
          type: 'text',
          text: rankLabel,
          size: 'xs',
          flex: 0
        });

        if (info.pictureUrl) {
          const avatarBox = createMemberAvatarBox(info.pictureUrl, '24px');
          if (avatarBox) {
            avatarBox.margin = 'sm';
            nameBoxContents.push(avatarBox);
          }
        }

        if (info.badgeUrl) {
          nameBoxContents.push({
            type: 'box',
            layout: 'vertical',
            width: info.badgeSize || '20px',
            height: info.badgeSize || '20px',
            flex: 0,
            margin: 'sm',
            contents: [
              {
                type: 'image',
                url: info.badgeUrl,
                size: 'full',
                aspectRatio: '1:1',
                aspectMode: 'fit',
                animated: true
              }
            ]
          });
        }

        if (info.hofBadges && info.hofBadges.length > 0) {
          for (const hb of info.hofBadges) {
            nameBoxContents.push({
              type: 'box',
              layout: 'vertical',
              width: hb.size || '20px',
              height: hb.size || '20px',
              flex: 0,
              margin: 'sm',
              contents: [
                {
                  type: 'image',
                  url: hb.url,
                  size: 'full',
                  aspectRatio: '1:1',
                  aspectMode: 'fit',
                  animated: true
                }
              ]
            });
          }
        } else if (info.hofCount && info.hofCount > 0 && info.hofBadgeUrl) {
          nameBoxContents.push({
            type: 'box',
            layout: 'vertical',
            width: info.hofBadgeSize || '20px',
            height: info.hofBadgeSize || '20px',
            flex: 0,
            margin: 'sm',
            contents: [
              {
                type: 'image',
                url: info.hofBadgeUrl,
                size: 'full',
                aspectRatio: '1:1',
                aspectMode: 'fit',
                animated: true
              }
            ]
          });
        }

        const displayName = info.name || info.alias || '';
        nameColor = info.nameColor || colors.textMutedLight;
        nameBoxContents.push({
          type: 'text',
          text: displayName,
          size: 'xs',
          color: nameColor,
          weight: isTop ? 'bold' : 'regular',
          flex: 1,
          margin: 'xs'
        });
      } else {
        // Rank 4+: Simple text row
        const displayName = rankLabel + " " + (info.name || info.alias || '');
        nameColor = info.nameColor || colors.textMutedLight;
        nameBoxContents.push({
          type: 'text',
          text: displayName,
          size: 'xs',
          color: nameColor,
          flex: 1,
          margin: 'sm'
        });
      }
    }

    const rowContents = [
      {
        type: 'box',
        layout: 'horizontal',
        flex: 3,
        margin: 'sm',
        alignItems: 'center',
        contents: nameBoxContents
      },
      {
        type: 'text',
        text: valText,
        size: 'xs',
        color: isTop ? colors.textAccent : colors.textMutedLight,
        flex: 2,
        align: 'end'
      }
    ];

    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'xs',
      alignItems: 'center',
      contents: rowContents
    });
  });

  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgHeader,
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: url || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
          size: 'full',
          aspectRatio: '6:3',
          aspectMode: 'cover'
        }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      paddingAll: 'sm',
      contents: bodyContents
    }
  };
}

/**
 * Build Flex carousel for /team (team roster flex cards).
 */
function buildTeamWeekFlex(teamColors, teamMembersMap, theme, assets = {}, resolveInfoFn) {
  const colors = getThemeColors(theme);
  const carousel = { type: 'carousel', contents: [] };

  for (const team of teamColors) {
    const teamColor = team.teamColor;
    const bodyContents = [];

    const team_members = teamMembersMap[team.id] || [];
    if (team_members.length > 0) {
      let idx = 0;
      for (const member of team_members) {
        const info = resolveInfoFn ? resolveInfoFn(member, assets.badges, assets.donateColors, assets.hofCounts, assets.hofBadge, assets.hofAwards) : member;
        const col = makeMemberColumn(info, idx + 1, colors, false);
        bodyContents.push({
          type: 'box',
          layout: 'horizontal',
          margin: 'xs',
          alignItems: 'center',
          contents: [col]
        });
        idx++;
      }
    } else {
      bodyContents.push({
        type: 'text',
        text: 'ยังไม่มีสมาชิกในทีมนี้',
        size: 'xs',
        color: colors.textMutedDark,
        align: 'center',
        margin: 'md'
      });
    }

    const teamHeaderColor = teamColor && teamColor.code ? teamColor.code : colors.bgHeader;
    carousel.contents.push({
      type: 'bubble',
      size: 'deca',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: teamHeaderColor,
        paddingAll: 'none',
        contents: [
          {
            type: 'image',
            url: teamColor ? teamColor.url : 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
            size: 'full',
            aspectRatio: '6:2',
            aspectMode: 'cover'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: colors.bgMain,
        paddingAll: 'sm',
        contents: bodyContents
      }
    });
  }

  return carousel;
}

function buildMvpListFlex(mvpData, theme) {
  const { year, bestRating, bestRaw, yrBenchmark, bestMvpBadgeUrl, bestMvpPlayers, totalWeeks, weeks } = mvpData;
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  const bgMain = isWhite ? '#ffffff' : '#0d0d1a';
  const bgCard = isWhite ? '#f8fafc' : '#141428';
  const bgHeader = isWhite ? '#f1f5f9' : '#1a1a2e';
  const separatorColor = isWhite ? '#e2e8f0' : '#2a2a4a';

  if (!weeks || weeks.length === 0) {
    return {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: bgMain,
        paddingAll: 'lg',
        contents: [
          {
            type: 'text',
            text: `🌟 ทำเนียบ MVP ประจำปี ${year}`,
            weight: 'bold',
            size: 'lg',
            color: colors.textPrimary,
            align: 'center'
          },
          {
            type: 'text',
            text: `ยังไม่มีข้อมูล MVP สำหรับปี ${year}`,
            size: 'sm',
            color: colors.textMuted,
            align: 'center',
            margin: 'md'
          }
        ]
      }
    };
  }

  const chunkSize = 12;
  const bubbles = [];
  const totalPages = Math.ceil(weeks.length / chunkSize);

  for (let page = 0; page < totalPages; page++) {
    const chunk = weeks.slice(page * chunkSize, (page + 1) * chunkSize);
    const bodyContents = [];

    // Header Title
    bodyContents.push({
      type: 'text',
      text: `🌟 ทำเนียบ MVP ประจำปี ${year}`,
      weight: 'bold',
      size: 'md',
      color: colors.textPrimary,
      align: 'center'
    });

    if (totalPages > 1) {
      bodyContents.push({
        type: 'text',
        text: `หน้า ${page + 1}/${totalPages} (${totalWeeks} สัปดาห์)`,
        size: 'xs',
        color: colors.textMuted,
        align: 'center',
        margin: 'xs'
      });
    }

    // 👑 Noticeable Best MVP Top Highlight Card (Only shown on Page 1)
    if (page === 0 && bestMvpPlayers && bestMvpPlayers.length > 0) {
      const titleContents = [];
      if (bestMvpBadgeUrl) {
        titleContents.push({
          type: 'box',
          layout: 'vertical',
          width: '22px',
          height: '22px',
          flex: 0,
          contents: [
            {
              type: 'image',
              url: bestMvpBadgeUrl,
              size: 'full',
              aspectRatio: '1:1',
              aspectMode: 'cover',
              animated: true
            }
          ]
        });
      }
      titleContents.push({
        type: 'text',
        text: 'MVP of the Year!',
        weight: 'bold',
        size: 'xs',
        color: '#f59e0b',
        flex: 1,
        margin: bestMvpBadgeUrl ? 'xs' : 'none'
      });

      const topMvpContents = [
        {
          type: 'box',
          layout: 'horizontal',
          alignItems: 'center',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              alignItems: 'center',
              flex: 1,
              contents: titleContents
            },
            { type: 'text', text: `⭐ ${Number(bestRating || 0).toFixed(1)}`, weight: 'bold', size: 'xs', color: '#d97706', align: 'end' }
          ]
        }
      ];

      bestMvpPlayers.forEach(p => {
        const statsStr = `⚽ ${p.goals} 👟 ${p.assists}${p.cleanSheets > 0 ? ` 🧤 ${p.cleanSheets}` : ''} • Score: ${p.rawScore.toFixed(2)}`;
        const avatarUrl = p.info ? p.info.pictureUrl : null;
        const nameColor = (p.info && p.info.nameColor) || (isWhite ? '#1e293b' : '#ffffff');

        const pBadges = [];
        if (p.info && p.info.badgeUrl) {
          pBadges.push({
            type: 'box',
            layout: 'vertical',
            width: '14px',
            height: '14px',
            flex: 0,
            contents: [{ type: 'image', url: p.info.badgeUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover', animated: true }]
          });
        }
        if (p.info && p.info.hofBadges && p.info.hofBadges.length > 0) {
          for (const hb of p.info.hofBadges) {
            if (hb.url) {
              pBadges.push({
                type: 'box',
                layout: 'vertical',
                width: '14px',
                height: '14px',
                flex: 0,
                contents: [{ type: 'image', url: hb.url, size: 'full', aspectRatio: '1:1', aspectMode: 'cover', animated: true }]
              });
            }
          }
        } else if (p.info && p.info.hofBadgeUrl) {
          pBadges.push({
            type: 'box',
            layout: 'vertical',
            width: '14px',
            height: '14px',
            flex: 0,
            contents: [{ type: 'image', url: p.info.hofBadgeUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover', animated: true }]
          });
        }
        pBadges.push({
          type: 'text',
          text: (p.name || '').substring(1) || '',
          weight: 'bold',
          size: 'sm',
          color: nameColor,
          margin: 'xs',
          flex: 1
        });

        topMvpContents.push({
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          alignItems: 'center',
          contents: [
            avatarUrl ? {
              type: 'box',
              layout: 'vertical',
              width: '48px',
              height: '48px',
              cornerRadius: '100px',
              borderWidth: 'normal',
              borderColor: '#f59e0b',
              flex: 0,
              contents: [
                {
                  type: 'image',
                  url: avatarUrl,
                  size: 'full',
                  aspectRatio: '1:1',
                  aspectMode: 'cover',
                  animated: true
                }
              ]
            } : {
              type: 'box',
              layout: 'vertical',
              width: '34px',
              height: '34px',
              cornerRadius: '100px',
              backgroundColor: isWhite ? '#fef3c7' : '#3b2d10',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 0,
              contents: [{ type: 'text', text: '👑', size: 'md', align: 'center', gravity: 'center' }]
            },
            {
              type: 'box',
              layout: 'vertical',
              flex: 1,
              margin: 'sm',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  alignItems: 'center',
                  contents: pBadges
                },
                {
                  type: 'text',
                  text: statsStr,
                  size: 'xxs',
                  color: isWhite ? '#475569' : '#e2e8f0',
                  margin: 'xs'
                },
                {
                  type: 'text',
                  text: `${p.dateStr || ''}`,
                  size: 'xxs',
                  color: colors.textMuted,
                  margin: 'xs'
                }
              ]
            }
          ]
        });
      });

      bodyContents.push({
        type: 'box',
        layout: 'vertical',
        backgroundColor: isWhite ? '#fffbeb' : '#231d0a',
        cornerRadius: 'md',
        borderWidth: 'normal',
        borderColor: '#d97706',
        paddingAll: 'sm',
        margin: 'sm',
        contents: topMvpContents
      });
    }

    if (totalPages > 1) {
      bodyContents.push({
        type: 'text',
        text: `หน้า ${page + 1}/${totalPages} (${totalWeeks} สัปดาห์)`,
        size: 'xs',
        color: colors.textMuted,
        margin: 'xs'
      });
    }

    bubbles.push({
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: bgMain,
        paddingAll: 'sm',
        contents: bodyContents
      }
    });
  }

  if (bubbles.length === 1) {
    return bubbles[0];
  }

  return {
    type: 'carousel',
    contents: bubbles
  };
}

function formatTeamDisplayName(rawColor) {
  if (!rawColor) return 'ทีม';
  const c = String(rawColor).trim();
  const colorMap = {
    'white': 'ขาว',
    'red': 'แดง',
    'green': 'เขียว',
    'blue': 'น้ำเงิน',
    'yellow': 'เหลือง',
    'black': 'ดำ',
    'orange': 'ส้ม',
    'pink': 'ชมพู',
    'purple': 'ม่วง',
    'sky': 'ฟ้า',
    'cyan': 'ฟ้า',
    'grey': 'เทา',
    'gray': 'เทา'
  };
  let thaiColor = colorMap[c.toLowerCase()] || c;
  thaiColor = thaiColor.replace(/^ทีม(สี)?/, '').replace(/^สี/, '').trim();
  return `ทีม${thaiColor}`;
}

function getTeamHeaderTheme(rawColor) {
  const c = String(rawColor || '').toLowerCase().replace(/^ทีม(สี)?/, '').replace(/^สี/, '').trim();
  const themes = {
    'ขาว': { bg: '#F1F5F9', titleColor: '#0F172A', subColor: '#475569', badgeBg: '#CBD5E1', badgeText: '#0F172A', dot: '#94A3B8' },
    'white': { bg: '#F1F5F9', titleColor: '#0F172A', subColor: '#475569', badgeBg: '#CBD5E1', badgeText: '#0F172A', dot: '#94A3B8' },
    'เหลือง': { bg: '#EAB308', titleColor: '#000000', subColor: '#1E293B', badgeBg: '#CA8A04', badgeText: '#FFFFFF', dot: '#713F12' },
    'yellow': { bg: '#EAB308', titleColor: '#000000', subColor: '#1E293B', badgeBg: '#CA8A04', badgeText: '#FFFFFF', dot: '#713F12' },
    'แดง': { bg: '#B91C1C', titleColor: '#FFFFFF', subColor: '#FECACA', badgeBg: '#7F1D1D', badgeText: '#FEE2E2', dot: '#F87171' },
    'red': { bg: '#B91C1C', titleColor: '#FFFFFF', subColor: '#FECACA', badgeBg: '#7F1D1D', badgeText: '#FEE2E2', dot: '#F87171' },
    'เขียว': { bg: '#15803D', titleColor: '#FFFFFF', subColor: '#DCFCE7', badgeBg: '#14532D', badgeText: '#BBF7D0', dot: '#4ADE80' },
    'green': { bg: '#15803D', titleColor: '#FFFFFF', subColor: '#DCFCE7', badgeBg: '#14532D', badgeText: '#BBF7D0', dot: '#4ADE80' },
    'น้ำเงิน': { bg: '#1D4ED8', titleColor: '#FFFFFF', subColor: '#DBEAFE', badgeBg: '#1E3A8A', badgeText: '#BFDBFE', dot: '#60A5FA' },
    'blue': { bg: '#1D4ED8', titleColor: '#FFFFFF', subColor: '#DBEAFE', badgeBg: '#1E3A8A', badgeText: '#BFDBFE', dot: '#60A5FA' },
    'ฟ้า': { bg: '#0284C7', titleColor: '#FFFFFF', subColor: '#E0F2FE', badgeBg: '#075985', badgeText: '#BAE6FD', dot: '#38BDF8' },
    'cyan': { bg: '#0284C7', titleColor: '#FFFFFF', subColor: '#E0F2FE', badgeBg: '#075985', badgeText: '#BAE6FD', dot: '#38BDF8' },
    'ดำ': { bg: '#18181B', titleColor: '#FFFFFF', subColor: '#A1A1AA', badgeBg: '#27272A', badgeText: '#E4E4E7', dot: '#71717A' },
    'black': { bg: '#18181B', titleColor: '#FFFFFF', subColor: '#A1A1AA', badgeBg: '#27272A', badgeText: '#E4E4E7', dot: '#71717A' },
    'ส้ม': { bg: '#C2410C', titleColor: '#FFFFFF', subColor: '#FFEDD5', badgeBg: '#7C2D12', badgeText: '#FED7AA', dot: '#FB923C' },
    'orange': { bg: '#C2410C', titleColor: '#FFFFFF', subColor: '#FFEDD5', badgeBg: '#7C2D12', badgeText: '#FED7AA', dot: '#FB923C' },
    'ชมพู': { bg: '#BE185D', titleColor: '#FFFFFF', subColor: '#FCE7F3', badgeBg: '#831843', badgeText: '#FBCFE8', dot: '#F472B6' },
    'pink': { bg: '#BE185D', titleColor: '#FFFFFF', subColor: '#FCE7F3', badgeBg: '#831843', badgeText: '#FBCFE8', dot: '#F472B6' },
    'ม่วง': { bg: '#6D28D9', titleColor: '#FFFFFF', subColor: '#EDE9FE', badgeBg: '#4C1D95', badgeText: '#DDD6FE', dot: '#A78BFA' },
    'purple': { bg: '#6D28D9', titleColor: '#FFFFFF', subColor: '#EDE9FE', badgeBg: '#4C1D95', badgeText: '#DDD6FE', dot: '#A78BFA' }
  };
  return themes[c] || { bg: '#0B0F19', titleColor: '#FFFFFF', subColor: '#94A3B8', badgeBg: '#1E293B', badgeText: '#38BDF8', dot: '#3B82F6' };
}

function buildFormationFlex(formationsData, theme, dateStr = '', timeRange = '') {
  if (!formationsData || formationsData.length === 0) return null;

            const posBadgeColor = {
              'GK': '#EAB308',
              'DF': '#3B82F6',
              'DW': '#06B6D4',
              'MF': '#8B5CF6',
              'CF': '#EF4444'
            };

            const renderPlayerNode = (slot, defaultPosCode, teamColorHex, momPlayerId = null) => {
              const primary = (slot && slot.primary !== undefined) ? slot.primary : slot;
              const alternate = (slot && slot.alternate) ? slot.alternate : null;

              if (!primary) {
                return {
                  type: 'box',
                  layout: 'vertical',
                  width: '92px',
                  alignItems: 'center',
                  contents: [
                    {
                      type: 'box',
                      layout: 'vertical',
                      width: '32px',
                      height: '32px',
                      cornerRadius: '16px',
                      borderWidth: '1px',
                      borderColor: '#FFFFFF44',
                      backgroundColor: '#00000040',
                      alignItems: 'center',
                      justifyContent: 'center',
                      contents: [
                        {
                          type: 'text',
                          text: defaultPosCode === 'GK' ? 'GK' : defaultPosCode,
                          color: '#FFFFFF88',
                          size: 'xxs',
                          weight: 'bold',
                          align: 'center'
                        }
                      ]
                    },
                    {
                      type: 'box',
                      layout: 'vertical',
                      backgroundColor: '#00000066',
                      cornerRadius: '4px',
                      paddingStart: '4px',
                      paddingEnd: '4px',
                      paddingTop: '1px',
                      paddingBottom: '1px',
                      offsetTop: '2px',
                      contents: [
                        {
                          type: 'text',
                          text: defaultPosCode === 'GK' ? 'หมุนเวียน' : '-',
                          color: '#FFFFFF88',
                          size: 'xxs',
                          align: 'center'
                        }
                      ]
                    }
                  ]
                };
              }

              const isPrimaryMom = momPlayerId && primary.id === momPlayerId;
              const isAltMom = momPlayerId && alternate && alternate.id === momPlayerId;
              const posCode = (primary.effectivePos || primary.pos_code || defaultPosCode || 'MF').toUpperCase();
              const primaryName = (primary.name || primary.alias || 'Player').replace(/^@/, '');
              
              const pWStat = primary.weekStats || {};
              const pHasWRating = pWStat.rating && pWStat.rating !== '-' && Number(pWStat.rating) > 0;
              const pWRatingStr = pHasWRating ? `⭐${pWStat.rating}` : '⭐n/a';
              const pStatsLine = `${pWRatingStr} (⚽${pWStat.goals || 0} 👟${pWStat.assists || 0})`;

              if (!alternate) {
                return {
                  type: 'box',
                  layout: 'vertical',
                  width: '108px',
                  alignItems: 'center',
                  action: primary.id ? {
                    type: 'postback',
                    label: primaryName,
                    data: `action=player_info&id=${primary.id}`
                  } : undefined,
                  contents: [
                    {
                      type: 'box',
                      layout: 'vertical',
                      width: '36px',
                      height: '36px',
                      cornerRadius: '18px',
                      borderWidth: isPrimaryMom ? '3px' : '2px',
                      borderColor: isPrimaryMom ? '#F59E0B' : '#FFFFFF',
                      backgroundColor: teamColorHex || '#1E293B',
                      alignItems: 'center',
                      justifyContent: 'center',
                      contents: primary.picture_url ? [
                        {
                          type: 'image',
                          url: primary.picture_url,
                          size: 'full',
                          aspectRatio: '1:1',
                          aspectMode: 'cover'
                        }
                      ] : [
                        {
                          type: 'text',
                          text: posCode,
                          color: '#FFFFFF',
                          size: 'xxs',
                          weight: 'bold',
                          align: 'center',
                          gravity: 'center'
                        }
                      ]
                    },
                    {
                      type: 'box',
                      layout: 'vertical',
                      backgroundColor: isPrimaryMom ? '#1A1608F4' : '#000000CC',
                      borderWidth: '1px',
                      borderColor: isPrimaryMom ? '#F59E0BCC' : '#FFFFFF22',
                      cornerRadius: '5px',
                      paddingStart: '6px',
                      paddingEnd: '6px',
                      paddingTop: '2px',
                      paddingBottom: '3px',
                      offsetTop: '2px',
                      alignItems: 'center',
                      contents: [
                        {
                          type: 'text',
                          text: isPrimaryMom ? `👑[${posCode}] ${primaryName}` : `[${posCode}] ${primaryName}`,
                          color: isPrimaryMom ? '#FDE047' : '#FFFFFF',
                          size: 'xxs',
                          weight: 'bold',
                          wrap: true,
                          maxLines: 2,
                          align: 'center'
                        },
                        {
                          type: 'text',
                          text: pStatsLine,
                          size: 'xxs',
                          color: '#FACC15',
                          align: 'center',
                          wrap: true
                        }
                      ]
                    }
                  ]
                };
              }

              const altName = (alternate.name || alternate.alias || 'Alt').replace(/^@/, '');
              const aWStat = alternate.weekStats || {};
              const aHasWRating = aWStat.rating && aWStat.rating !== '-' && Number(aWStat.rating) > 0;
              const aWRatingStr = aHasWRating ? `⭐${aWStat.rating}` : '⭐n/a';
              const aStatsLine = `${aWRatingStr} (⚽${aWStat.goals || 0} 👟${aWStat.assists || 0})`;

              return {
                type: 'box',
                layout: 'vertical',
                width: '118px',
                alignItems: 'center',
                contents: [
                  {
                    type: 'box',
                    layout: 'horizontal',
                    alignItems: 'center',
                    justifyContent: 'center',
                    contents: [
                      {
                        type: 'box',
                        layout: 'vertical',
                        width: '32px',
                        height: '32px',
                        cornerRadius: '16px',
                        borderWidth: isPrimaryMom ? '3px' : '2px',
                        borderColor: isPrimaryMom ? '#F59E0B' : '#FFFFFF',
                        backgroundColor: teamColorHex || '#1E293B',
                        alignItems: 'center',
                        justifyContent: 'center',
                        action: primary.id ? {
                          type: 'postback',
                          label: primaryName,
                          data: `action=player_info&id=${primary.id}`
                        } : undefined,
                        contents: primary.picture_url ? [
                          {
                            type: 'image',
                            url: primary.picture_url,
                            size: 'full',
                            aspectRatio: '1:1',
                            aspectMode: 'cover'
                          }
                        ] : [
                          {
                            type: 'text',
                            text: posCode,
                            color: '#FFFFFF',
                            size: 'xxs',
                            weight: 'bold',
                            align: 'center',
                            gravity: 'center'
                          }
                        ]
                      },
                      { type: 'text', text: '/', color: '#38BDF8', size: 'xxs', weight: 'bold', margin: 'xs', flex: 0 },
                      {
                        type: 'box',
                        layout: 'vertical',
                        width: '32px',
                        height: '32px',
                        cornerRadius: '16px',
                        borderWidth: isAltMom ? '3px' : '2px',
                        borderColor: isAltMom ? '#F59E0B' : '#38BDF8',
                        backgroundColor: '#0C2A44',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: 'xs',
                        action: alternate.id ? {
                          type: 'postback',
                          label: altName,
                          data: `action=player_info&id=${alternate.id}`
                        } : undefined,
                        contents: alternate.picture_url ? [
                          {
                            type: 'image',
                            url: alternate.picture_url,
                            size: 'full',
                            aspectRatio: '1:1',
                            aspectMode: 'cover'
                          }
                        ] : [
                          {
                            type: 'text',
                            text: `(${posCode})`,
                            color: '#38BDF8',
                            size: 'xxs',
                            weight: 'bold',
                            align: 'center',
                            gravity: 'center'
                          }
                        ]
                      }
                    ]
                  },
                  {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: '#071828F4',
                    borderWidth: '1px',
                    borderColor: (isPrimaryMom || isAltMom) ? '#F59E0BCC' : '#38BDF888',
                    cornerRadius: '5px',
                    paddingStart: '6px',
                    paddingEnd: '6px',
                    paddingTop: '2px',
                    paddingBottom: '3px',
                    offsetTop: '2px',
                    alignItems: 'center',
                    contents: [
                      {
                        type: 'text',
                        text: `[${posCode}] ${isPrimaryMom ? '👑' : ''}${primaryName} / ${isAltMom ? '👑' : ''}(${altName})`,
                        color: isPrimaryMom ? '#FDE047' : '#FFFFFF',
                        size: 'xxs',
                        weight: 'bold',
                        wrap: true,
                        maxLines: 2,
                        align: 'center'
                      },
                      {
                        type: 'text',
                        text: pStatsLine,
                        size: 'xxs',
                        color: '#FACC15',
                        align: 'center',
                        wrap: true
                      },
                      {
                        type: 'text',
                        text: `(${aStatsLine})`,
                        size: 'xxs',
                        color: isAltMom ? '#FDE047' : '#38BDF8',
                        align: 'center',
                        wrap: true
                      }
                    ]
                  }
                ]
              };
            };

            const bubbles = formationsData.map(team => {
              const colorHex = tdc(team.teamColor) || '#3B82F6';
              const slots = team.slots || { CF: [], MF: [], DW: [], DF: [], GK: [], alternates: [] };
              const teamNameFormatted = formatTeamDisplayName(team.teamColor);
              const headerTheme = getTeamHeaderTheme(team.teamColor);

              // Identify Man of the Match (MOM) for this team
              const allTeamMembers = team.members || [];
              let momPlayer = null;
              let topScore = -1;
              for (const m of allTeamMembers) {
                const wRating = parseFloat(m.weekStats?.rating || 0) || 0;
                const wGoals = Number(m.weekStats?.goals || 0) || 0;
                const wAssists = Number(m.weekStats?.assists || 0) || 0;
                const totalPoints = wRating * 10 + (wGoals * 4) + (wAssists * 3);
                if (totalPoints > topScore && wRating > 0) {
                  topScore = totalPoints;
                  momPlayer = m;
                }
              }
              if (!momPlayer && allTeamMembers.length > 0) {
                momPlayer = allTeamMembers.reduce((best, m) => {
                  const bRating = parseFloat(best.yearStats?.rating || best.rank || 0) || 0;
                  const mRating = parseFloat(m.yearStats?.rating || m.rank || 0) || 0;
                  return mRating > bRating ? m : best;
                }, allTeamMembers[0]);
              }
              const momPlayerId = momPlayer ? momPlayer.id : null;

              // Row 1: CF (Center Forward / Strikers) - Supports 1 or 2 CFs dynamically
              const cfNodes = slots.CF.length > 0
                ? slots.CF.map(p => renderPlayerNode(p, 'CF', colorHex, momPlayerId))
                : [renderPlayerNode(null, 'CF', colorHex, momPlayerId)];

              const cfRow = {
                type: 'box',
                layout: 'horizontal',
                justifyContent: cfNodes.length > 1 ? 'space-around' : 'center',
                paddingStart: cfNodes.length > 1 ? '12px' : '0px',
                paddingEnd: cfNodes.length > 1 ? '12px' : '0px',
                alignItems: 'center',
                contents: cfNodes
              };

              // Row 2: MF (Midfielders) - Supports 1, 2, or 3 MFs dynamically
              const mfNodes = slots.MF.length > 0
                ? slots.MF.map(p => renderPlayerNode(p, 'MF', colorHex, momPlayerId))
                : [renderPlayerNode(null, 'MF', colorHex, momPlayerId)];

              const mfRow = {
                type: 'box',
                layout: 'horizontal',
                justifyContent: mfNodes.length > 1 ? 'space-around' : 'center',
                paddingStart: mfNodes.length > 1 ? (mfNodes.length >= 3 ? '4px' : '12px') : '0px',
                paddingEnd: mfNodes.length > 1 ? (mfNodes.length >= 3 ? '4px' : '12px') : '0px',
                alignItems: 'center',
                contents: mfNodes
              };

              // Row 3: DW (Defensive Wings / Wingers)
              const dwNodes = (slots.DW && slots.DW.length > 0)
                ? slots.DW.map(s => renderPlayerNode(s, 'DW', colorHex, momPlayerId))
                : [renderPlayerNode(null, 'DW', colorHex, momPlayerId), renderPlayerNode(null, 'DW', colorHex, momPlayerId)];

              const dwRow = {
                type: 'box',
                layout: 'horizontal',
                justifyContent: 'space-between',
                paddingStart: '4px',
                paddingEnd: '4px',
                alignItems: 'center',
                contents: dwNodes.length === 1 ? [dwNodes[0], renderPlayerNode(null, 'DW', colorHex, momPlayerId)] : dwNodes.slice(0, 2)
              };

              // Row 4: DF (Defenders / Centre Backs) - Supports 1, 2, or 3 DFs dynamically
              const dfNodes = slots.DF.length > 0
                ? slots.DF.map(p => renderPlayerNode(p, 'DF', colorHex, momPlayerId))
                : [renderPlayerNode(null, 'DF', colorHex, momPlayerId)];

              const dfRow = {
                type: 'box',
                layout: 'horizontal',
                justifyContent: dfNodes.length > 1 ? 'space-around' : 'center',
                paddingStart: dfNodes.length > 1 ? (dfNodes.length >= 3 ? '4px' : '12px') : '0px',
                paddingEnd: dfNodes.length > 1 ? (dfNodes.length >= 3 ? '4px' : '12px') : '0px',
                alignItems: 'center',
                contents: dfNodes
              };

              // Row 5: GK (Goalkeeper) - open/unassigned if team has no dedicated GK
              const gkNode = slots.GK.length > 0
                ? renderPlayerNode(slots.GK[0], 'GK', colorHex, momPlayerId)
                : renderPlayerNode(null, 'GK', colorHex, momPlayerId);

              const gkRow = {
                type: 'box',
                layout: 'horizontal',
                justifyContent: 'center',
                alignItems: 'center',
                contents: [gkNode]
              };

              // Body contents: Tactical pitch container with authentic soccer pitch markings
              const bodyContents = [
                {
                  type: 'box',
                  layout: 'vertical',
                  height: '530px',
                  borderWidth: '2px',
                  borderColor: '#FFFFFF66',
                  cornerRadius: 'md',
                  paddingAll: 'xs',
                  justifyContent: 'space-between',
                  background: {
                    type: 'linearGradient',
                    angle: '180deg',
                    startColor: '#166534',
                    endColor: '#14532D'
                  },
                  contents: [
                    // Top Halfway Line
                    {
                      type: 'box',
                      layout: 'vertical',
                      position: 'absolute',
                      offsetTop: '0px',
                      offsetStart: '0px',
                      offsetEnd: '0px',
                      height: '1px',
                      backgroundColor: '#FFFFFF55',
                      contents: [{ type: 'filler' }]
                    },
                    // Center Circle Arc (Top)
                    {
                      type: 'box',
                      layout: 'vertical',
                      position: 'absolute',
                      offsetTop: '-24px',
                      offsetStart: '122px',
                      width: '48px',
                      height: '48px',
                      cornerRadius: '24px',
                      borderWidth: '1px',
                      borderColor: '#FFFFFF55',
                      contents: [{ type: 'filler' }]
                    },
                    // Penalty Area (18-Yard Box at Bottom)
                    {
                      type: 'box',
                      layout: 'vertical',
                      position: 'absolute',
                      offsetBottom: '0px',
                      offsetStart: '60px',
                      offsetEnd: '60px',
                      height: '80px',
                      borderWidth: '1px',
                      borderColor: '#FFFFFF55',
                      contents: [{ type: 'filler' }]
                    },

                    // Tactical Player Rows
                    cfRow,
                    mfRow,
                    dwRow,
                    dfRow,
                    gkRow
                  ]
                }
              ];

              // Bottom Bar: Man of the Match (MOM) Highlight
              // Bottom Bar: Always present Man of the Match (MOM) Highlight with fixed height
              const momName = momPlayer ? (momPlayer.name || momPlayer.alias || 'Player').replace(/^@/, '') : '-';
              const momRatingStr = momPlayer && momPlayer.weekStats?.rating && momPlayer.weekStats.rating !== '-'
                ? `⭐${momPlayer.weekStats.rating}`
                : (momPlayer && momPlayer.rank ? `⭐Rank ${parseFloat(momPlayer.rank).toFixed(1)}` : '⭐-');
              const momGoals = Number(momPlayer?.weekStats?.goals || 0);
              const momAssists = Number(momPlayer?.weekStats?.assists || 0);
              const momStatsDesc = momPlayer ? `${momRatingStr} (⚽${momGoals} 👟${momAssists})` : '⭐- (⚽0 👟0)';

              bodyContents.push({
                type: 'box',
                layout: 'horizontal',
                height: '34px',
                backgroundColor: '#0F172ACC',
                borderColor: momPlayer ? '#F59E0B88' : '#33415588',
                borderWidth: '1px',
                cornerRadius: 'md',
                paddingStart: 'sm',
                paddingEnd: 'sm',
                margin: 'sm',
                alignItems: 'center',
                justifyContent: 'space-between',
                contents: [
                  {
                    type: 'text',
                    text: `👑 MOM: ${momName}`,
                    size: 'xxs',
                    color: '#FCD34D',
                    weight: 'bold',
                    flex: 1
                  },
                  {
                    type: 'text',
                    text: momStatsDesc,
                    size: 'xxs',
                    color: '#FBBF24',
                    weight: 'bold',
                    flex: 0,
                    align: 'end'
                  }
                ]
              });

              return {
                type: 'bubble',
                size: 'giga',
                header: {
                  type: 'box',
                  layout: 'vertical',
                  backgroundColor: headerTheme.bg,
                  paddingStart: 'md',
                  paddingEnd: 'md',
                  paddingTop: 'sm',
                  paddingBottom: 'sm',
                  height: '60px',
                  justifyContent: 'center',
                  contents: [
                    {
                      type: 'box',
                      layout: 'horizontal',
                      alignItems: 'center',
                      contents: [
                        {
                          type: 'text',
                          text: '●',
                          color: headerTheme.dot,
                          size: 'sm',
                          flex: 0
                        },
                        {
                          type: 'text',
                          text: teamNameFormatted,
                          weight: 'bold',
                          size: 'sm',
                          color: headerTheme.titleColor,
                          flex: 1,
                          margin: 'sm'
                        },
                        ...(dateStr ? [{
                          type: 'text',
                          text: `📅 ${dateStr}`,
                          size: 'xxs',
                          color: headerTheme.subColor,
                          align: 'end',
                          flex: 0
                        }] : [])
                      ]
                    },
                    {
                      type: 'box',
                      layout: 'horizontal',
                      margin: 'xs',
                      alignItems: 'center',
                      contents: [
                        {
                          type: 'text',
                          text: `📋 ${team.formationName || 'ผังการเล่น'} (${team.totalPlayers || 0} คน)`,
                          size: 'xs',
                          color: headerTheme.titleColor,
                          weight: 'bold',
                          flex: 1
                        },
                        ...(timeRange ? [{
                          type: 'text',
                          text: `⏰ ${timeRange}`,
                          size: 'xxs',
                          color: headerTheme.subColor,
                          align: 'end',
                          flex: 0
                        }] : [])
                      ]
                    }
                  ]
                },
                body: {
                  type: 'box',
                  layout: 'vertical',
                  paddingAll: 'sm',
                  background: {
                    type: 'linearGradient',
                    angle: '180deg',
                    startColor: '#15803D',
                    endColor: '#14532D'
                  },
                  contents: bodyContents
                },
                footer: {
                  type: 'box',
                  layout: 'vertical',
                  backgroundColor: '#0B0F19',
                  paddingAll: 'xs',
                  height: '28px',
                  justifyContent: 'center',
                  contents: [
                    {
                      type: 'box',
                      layout: 'horizontal',
                      justifyContent: 'space-around',
                      contents: [
                        { type: 'text', text: '⚡ CF', size: 'xxs', color: '#EF4444', weight: 'bold' },
                        { type: 'text', text: '⚙️ MF', size: 'xxs', color: '#8B5CF6', weight: 'bold' },
                        { type: 'text', text: '🏃 DW', size: 'xxs', color: '#06B6D4', weight: 'bold' },
                        { type: 'text', text: '🛡️ DF', size: 'xxs', color: '#3B82F6', weight: 'bold' },
                        { type: 'text', text: '🧤 GK', size: 'xxs', color: '#EAB308', weight: 'bold' }
                      ]
                    }
                  ]
                }
              };
            });

            if (bubbles.length === 1) {
              return bubbles[0];
            }

            const fullCarousel = {
              type: 'carousel',
              contents: bubbles
            };

            // If entire carousel payload is under LINE's 45KB safe threshold, send as single carousel
            if (JSON.stringify(fullCarousel).length < 45000) {
              return fullCarousel;
            }

            // If carousel exceeds 45KB (e.g. 5-6 teams), chunk into multiple carousels (3 teams each) so LINE API accepts cleanly
            const chunked = [];
            const chunkSize = 3;
            for (let i = 0; i < bubbles.length; i += chunkSize) {
              const slice = bubbles.slice(i, i + chunkSize);
              if (slice.length === 1) {
                chunked.push(slice[0]);
              } else {
                chunked.push({
                  type: 'carousel',
                  contents: slice
                });
              }
            }

            return chunked;
          }

module.exports = {
  report_template,
  tpl_bubble,
  tpl_carousel,
  replacePlaceholders,
  replaceFlex,
  buildScheduleFlex,
  buildNowFlex,
  buildLiveFlex,
  buildMemberWeekFlex,
  buildWelcomeFlex,
  buildRegisterFlex,
  buildAutoRegFlex,
  buildRegisterClosedFlex,
  buildAutoRegFullFlex,
  buildMemberStatsFlex,
  buildMvpListFlex,
  getThemeColors,
  buildMenuFlex,
  buildQrFlex,
  makeMemberColumn,
  buildSlipListFlex,
  buildScorerRowFlex,
  buildTableWeekFlex,
  buildTopStatFlex,
  buildTeamWeekFlex,
  buildFormationFlex
};

