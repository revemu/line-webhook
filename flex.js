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
  let jsonString = JSON.stringify(template);

  // Replace all placeholders with actual data
  Object.keys(data).forEach(key => {
    const placeholder = `{{${key}}}`;
    const regex = new RegExp(placeholder, 'g');
    jsonString = jsonString.replace(regex, data[key]);
  });
  console.log(jsonString);
  return JSON.parse(jsonString);
}

function replaceFlex(template, data) {
  let jsonString = template;


  // Replace all placeholders with actual data
  Object.keys(data).forEach(key => {
    const placeholder = `{{${key}}}`;
    const regex = new RegExp(placeholder, 'g');
    jsonString = jsonString.replace(regex, data[key]);
  });
  jsonString = jsonString.replaceAll("'", '"');
  console.log(jsonString);
  return JSON.parse(jsonString);
}

// Team name → readable color on dark background
const tdc = (name) => {
  const n = (name || '').toLowerCase();
  if (n === 'black') return '#999999';
  if (n === 'white') return '#ffffff';
  if (n === 'red') return '#ff5566';
  if (n === 'green') return '#44cc66';
  return '#ffffff';
};

const getThemeColors = (themeName) => {
  const isWhite = (themeName || '').toLowerCase() === 'white';
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
      tdc: (name) => {
        const n = (name || '').toLowerCase();
        if (n === 'black') return '#0f172a';
        if (n === 'white') return '#64748b';
        if (n === 'red') return '#dc2626';
        if (n === 'green') return '#15803d';
        return '#0f172a';
      }
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
      tdc: (name) => {
        const n = (name || '').toLowerCase();
        if (n === 'black') return '#999999';
        if (n === 'white') return '#ffffff';
        if (n === 'red') return '#ff5566';
        if (n === 'green') return '#44cc66';
        return '#ffffff';
      }
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
              { type: 'text', text: m.teamA, size: 'sm', color: colors.tdc(m.teamA), weight: 'bold', align: 'end', flex: 2 },
              { type: 'text', text: vsText, size: 'sm', color: colors.textMuted, align: 'center', flex: 1, weight: dbMatch ? 'bold' : 'regular' },
              { type: 'text', text: m.teamB, size: 'sm', color: colors.tdc(m.teamB), weight: 'bold', align: 'start', flex: 2 }
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

  return {
    type: 'bubble',
    size: 'giga',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgHeader,
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: sched.imageUrl || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
          size: 'full',
          aspectRatio: '10:3',
          aspectMode: 'cover'
        }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      paddingAll: 'md',
      contents: bodyContents
    }
  };
}

/**
 * Build a Flex bubble for /now
 * @param {object} matchInfo - result from getCurrentMatch()
 */
function buildNowFlex(matchInfo, theme) {
  const { currentMatch: cur, nextMatch: nxt, nextMatch2: nxt2, score, scorers, assists, table } = matchInfo;
  const colors = getThemeColors(theme);

  const makeHeaderContents = (iconType, iconText, titleText, matchNo, startTime, useLightColor) => {
    const textColor = useLightColor ? colors.textMuted : colors.textMutedDark;
    return [
      {
        type: 'box',
        layout: 'vertical',
        width: '32px',
        height: '32px',
        flex: 0,
        justifyContent: 'center',
        alignItems: 'center',
        contents: iconType === 'image' ? [
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
      },
      {
        type: 'box',
        layout: 'vertical',
        width: '80px',
        flex: 0,
        justifyContent: 'center',
        contents: [
          {
            type: 'text',
            text: titleText,
            size: 'xs',
            color: textColor,
            gravity: 'center'
          }
        ]
      },
      {
        type: 'box',
        layout: 'vertical',
        width: '35px',
        flex: 0,
        justifyContent: 'center',
        contents: [
          {
            type: 'text',
            text: `[${matchNo}]`,
            size: 'xs',
            color: textColor,
            align: 'center',
            gravity: 'center'
          }
        ]
      },
      {
        type: 'box',
        layout: 'vertical',
        width: '50px',
        flex: 0,
        justifyContent: 'center',
        contents: [
          {
            type: 'text',
            text: startTime,
            size: 'xs',
            color: textColor,
            align: 'center',
            gravity: 'center'
          }
        ]
      }
    ];
  };

  const bodyContents = [];

  // ── Current Match ──
  bodyContents.push({
    type: 'box',
    layout: 'vertical',
    backgroundColor: colors.bgCurrent,
    paddingAll: 'md',
    cornerRadius: 'md',
    borderWidth: 'normal',
    borderColor: colors.borderCurrent,
    contents: [
      // Header: label  [matchNo]  time — all same size
      {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        contents: makeHeaderContents('image', `${getBaseUrl()}/green_pulse_true.png`, 'แมตช์ปัจจุบัน', cur.matchNo, cur.startTime, true)
      },
      // Score row: TeamA  score  TeamB
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'md',
        contents: [
          { type: 'text', text: cur.teamA, size: 'md', weight: 'bold', color: colors.tdc(cur.teamA), flex: 2, align: 'end' },
          {
            type: 'text',
            text: score ? `${score.teamA} - ${score.teamB}` : 'vs',
            size: 'md',
            weight: 'bold',
            color: colors.textAccent,
            flex: 1,
            align: 'center'
          },
          { type: 'text', text: cur.teamB, size: 'md', weight: 'bold', color: colors.tdc(cur.teamB), flex: 2, align: 'start' }
        ]
      }
    ]
  });

  // ── Scorers ──
  if (scorers && scorers.length > 0) {
    for (const s of scorers) {
      const og = s.ownGoal ? '🥅' : '';
      const nameText = s.goal > 1 ? `${s.name}(${s.goal})${og}` : `${s.name}${og}`;

      const rowContents = [
        { type: 'text', text: '⚽', size: 'xs', flex: 0, color: colors.textMuted }
      ];

      const badgeSize = s.badgeSize || '16px';
      if (s.badgeUrl) {
        rowContents.push({
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

      if (s.hofCount && s.hofCount > 0 && s.hofBadgeUrl) {
        const hSize = s.hofBadgeSize || '16px';
        rowContents.push({
          type: 'box',
          layout: 'vertical',
          width: hSize,
          height: hSize,
          flex: 0,
          contents: [
            {
              type: 'image',
              url: s.hofBadgeUrl,
              size: 'full',
              aspectRatio: '1:1',
              aspectMode: 'cover',
              animated: true
            }
          ],
          margin: 'xs'
        });
      }

      rowContents.push({
        type: 'text',
        text: nameText,
        size: 'xs',
        color: s.nameColor || colors.textMutedLight,
        flex: 1,
        margin: 'sm'
      });

      bodyContents.push({
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        alignItems: 'center',
        contents: rowContents
      });
    }
  }

  // ── Assists ──
  if (assists && assists.length > 0) {
    for (const a of assists) {
      const nameText = a.assist > 1 ? `${a.name}(${a.assist})` : a.name;

      const rowContents = [
        { type: 'text', text: '👟', size: 'xs', flex: 0, color: colors.textMuted }
      ];

      const badgeSize = a.badgeSize || '16px';
      if (a.badgeUrl) {
        rowContents.push({
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

      if (a.hofCount && a.hofCount > 0 && a.hofBadgeUrl) {
        const hSize = a.hofBadgeSize || '16px';
        rowContents.push({
          type: 'box',
          layout: 'vertical',
          width: hSize,
          height: hSize,
          flex: 0,
          contents: [
            {
              type: 'image',
              url: a.hofBadgeUrl,
              size: 'full',
              aspectRatio: '1:1',
              aspectMode: 'cover',
              animated: true
            }
          ],
          margin: 'xs'
        });
      }

      rowContents.push({
        type: 'text',
        text: nameText,
        size: 'xs',
        color: a.nameColor || colors.textMutedLight,
        flex: 1,
        margin: 'sm'
      });

      bodyContents.push({
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        alignItems: 'center',
        contents: rowContents
      });
    }
  }

  // ── Next Match ──
  if (nxt) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'sm',
      backgroundColor: colors.bgNext,
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
          contents: [
            { type: 'text', text: nxt.teamA, size: 'md', weight: 'bold', color: colors.tdc(nxt.teamA), flex: 2, align: 'end' },
            { type: 'text', text: 'vs', size: 'md', color: colors.textMuted, flex: 1, align: 'center' },
            { type: 'text', text: nxt.teamB, size: 'md', weight: 'bold', color: colors.tdc(nxt.teamB), flex: 2, align: 'start' }
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
        backgroundColor: colors.bgNext2,
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
            contents: [
              { type: 'text', text: nxt2.teamA, size: 'md', weight: 'bold', color: colors.tdc(nxt2.teamA), flex: 2, align: 'end' },
              { type: 'text', text: 'vs', size: 'md', color: colors.textMutedDark, flex: 1, align: 'center' },
              { type: 'text', text: nxt2.teamB, size: 'md', weight: 'bold', color: colors.tdc(nxt2.teamB), flex: 2, align: 'start' }
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

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgHeader,
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
          size: 'full',
          aspectRatio: '20:7',
          aspectMode: 'cover'
        }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      paddingAll: 'md',
      contents: bodyContents
    }
  };
}

/**
 * Build a Flex bubble for /now2 (live full schedule with current match highlighted)
 * @param {object} matchInfo - result from getCurrentMatch() containing sched, dbMatches, currentMatch, scorers, assists, table
 */
function buildLiveFlex(matchInfo, theme) {
  const { sched, currentMatch, scorers, assists, table, dbMatches, imageUrl } = matchInfo;
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
        text: '⚽ Live! Match',
        weight: 'bold',
        size: 'md',
        color: colors.textPrimary,
        align: 'start'
      },
      {
        type: 'text',
        text: `🕐 ${date} ${startTime}–${endTime}`,
        size: 'sm',
        color: colors.textMuted,
        align: 'end',
        margin: 'xs'
      }
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
      {
        type: 'box',
        layout: 'horizontal',
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            width: '12px',
            height: '12px',
            flex: 0,
            contents: [
              {
                type: 'spacer'
              }
            ]
          },
          { type: 'text', text: '#', size: 'xxs', weight: 'bold', color: colors.textMutedDark, flex: 0, margin: 'xs' }
        ]
      },
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

      const statusDot = isCurrent ? {
        type: 'box',
        layout: 'vertical',
        width: '32px',
        height: '32px',
        flex: 0,
        contents: [
          {
            type: 'image',
            url: `${getBaseUrl()}/green_pulse_true.png`,
            size: 'full',
            aspectRatio: '1:1',
            aspectMode: 'cover',
            animated: true
          }
        ]
      } : {
        type: 'box',
        layout: 'vertical',
        width: '32px',
        height: '32px',
        flex: 0,
        contents: [
          {
            type: 'spacer'
          }
        ]
      };

      const matchBoxContents = [
        {
          type: 'box',
          layout: 'horizontal',
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          contents: [
            statusDot,
            { type: 'text', text: `${m.matchNo}`, size: 'sm', color: isCurrent ? colors.textAccent : colors.textMuted, flex: 0, weight: isCurrent ? 'bold' : 'regular', margin: 'xs' }
          ]
        },
        { type: 'text', text: `${m.startTime}`, size: 'sm', color: isCurrent ? colors.textPrimary : colors.textMutedLight, flex: 2, align: 'center', weight: isCurrent ? 'bold' : 'regular' },
        {
          type: 'box',
          layout: 'horizontal',
          flex: 6,
          alignItems: 'center',
          contents: [
            { type: 'text', text: m.teamA, size: 'sm', color: colors.tdc(m.teamA), weight: 'bold', align: 'end', flex: 2 },
            { type: 'text', text: vsText, size: 'sm', color: isCurrent ? colors.textAccent : colors.textMuted, align: 'center', flex: 1, weight: dbMatch || isCurrent ? 'bold' : 'regular' },
            { type: 'text', text: m.teamB, size: 'sm', color: colors.tdc(m.teamB), weight: 'bold', align: 'start', flex: 2 }
          ]
        }
      ];

      // Define match container styling
      const matchContainer = {
        type: 'box',
        layout: 'horizontal',
        paddingStart: 'sm',
        paddingEnd: 'sm',
        paddingTop: 'xs',
        paddingBottom: 'xs',
        margin: 'xs',
        alignItems: 'center',
        contents: matchBoxContents
      };

      if (isCurrent) {
        matchContainer.paddingTop = 'sm';
        matchContainer.paddingBottom = 'sm';
        matchContainer.backgroundColor = colors.bgCurrent;
        matchContainer.borderWidth = 'normal';
        matchContainer.borderColor = colors.borderCurrent;
        matchContainer.cornerRadius = 'sm';
      }

      bodyContents.push(matchContainer);

      // If it is the current match and there are scorers/assists, display them underneath!
      if (isCurrent) {
        const detailRows = [];
        if (scorers && scorers.length > 0) {
          for (const s of scorers) {
            const og = s.ownGoal ? '🥅' : '';
            const nameText = s.goal > 1 ? `${s.name}(${s.goal})${og}` : `${s.name}${og}`;

            const rowContents = [
              { type: 'text', text: '⚽', size: 'sm', flex: 0, color: colors.textMuted }
            ];

            const badgeSize = s.badgeSize || '16px';
            if (s.badgeUrl) {
              rowContents.push({
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

            if (s.hofCount && s.hofCount > 0 && s.hofBadgeUrl) {
              const hSize = s.hofBadgeSize || '16px';
              rowContents.push({
                type: 'box',
                layout: 'vertical',
                width: hSize,
                height: hSize,
                flex: 0,
                contents: [
                  {
                    type: 'image',
                    url: s.hofBadgeUrl,
                    size: 'full',
                    aspectRatio: '1:1',
                    aspectMode: 'cover',
                    animated: true
                  }
                ],
                margin: 'xs'
              });
            }

            rowContents.push({
              type: 'text',
              text: nameText,
              size: 'sm',
              color: s.nameColor || colors.textMutedLight,
              flex: 1,
              margin: 'sm'
            });

            detailRows.push({
              type: 'box',
              layout: 'horizontal',
              margin: 'xs',
              alignItems: 'center',
              contents: rowContents
            });
          }
        }
        if (assists && assists.length > 0) {
          for (const a of assists) {
            const nameText = a.assist > 1 ? `${a.name}(${a.assist})` : a.name;

            const rowContents = [
              { type: 'text', text: '👟', size: 'sm', flex: 0, color: colors.textMuted }
            ];

            const badgeSize = a.badgeSize || '16px';
            if (a.badgeUrl) {
              rowContents.push({
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

            if (a.hofCount && a.hofCount > 0 && a.hofBadgeUrl) {
              const hSize = a.hofBadgeSize || '16px';
              rowContents.push({
                type: 'box',
                layout: 'vertical',
                width: hSize,
                height: hSize,
                flex: 0,
                contents: [
                  {
                    type: 'image',
                    url: a.hofBadgeUrl,
                    size: 'full',
                    aspectRatio: '1:1',
                    aspectMode: 'cover',
                    animated: true
                  }
                ],
                margin: 'xs'
              });
            }

            rowContents.push({
              type: 'text',
              text: nameText,
              size: 'sm',
              color: a.nameColor || colors.textMutedLight,
              flex: 1,
              margin: 'sm'
            });

            detailRows.push({
              type: 'box',
              layout: 'horizontal',
              margin: 'xs',
              alignItems: 'center',
              contents: rowContents
            });
          }
        }

        if (detailRows.length > 0) {
          bodyContents.push({
            type: 'box',
            layout: 'vertical',
            backgroundColor: colors.bgDetail,
            cornerRadius: 'sm',
            paddingAll: 'sm',
            margin: 'xs',
            contents: detailRows
          });
        }
      }
    }
  }

  // ── Standings table at the bottom ──
  if (table && table.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
    bodyContents.push({ type: 'text', text: '📊 ตารางคะแนน', size: 'sm', weight: 'bold', color: colors.textPrimary, margin: 'md' });

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

    const medals = ['🏆', '🥈', '🥉', '4️⃣'];
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

  bodyContents.push({ type: 'separator', margin: 'sm', color: colors.separator });
  bodyContents.push({
    type: 'text',
    text: `สิ้นสุด ${endTime} น.  |  ${totalRounds} รอบ  |  ${totalHours} ชม.`,
    size: 'sm',
    color: colors.textMuted,
    align: 'center',
    margin: 'sm'
  });

  return {
    type: 'bubble',
    size: 'giga',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgHeader,
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: imageUrl || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
          size: 'full',
          aspectRatio: '10:3',
          aspectMode: 'cover'
        }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      paddingAll: 'md',
      contents: bodyContents
    }
  };
}

function makeBoxButton(label, text, color, flexVal = 1) {
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
        size: 'sm'
      }
    ],
    flex: flexVal
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
    contents.push({
      type: 'box',
      layout: 'vertical',
      width: '24px',
      height: '24px',
      cornerRadius: '100px',
      flex: 0,
      contents: [
        {
          type: 'image',
          url: p.pictureUrl,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'cover'
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
          aspectMode: 'cover',
          animated: true
        }
      ],
      margin: 'sm'
    });
  }

  if (p.hofCount && p.hofCount > 0 && p.hofBadgeUrl) {
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
          aspectMode: 'cover',
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
  if (isCurrent) {
    displayName += ' (คุณ) 👈';
    textColor = colors.textAccent;
  }

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
    rowObj.borderWidth = 'semi-bold';
    rowObj.cornerRadius = 'md';
    rowObj.paddingStart = 'sm';
    rowObj.paddingEnd = 'sm';
    rowObj.paddingTop = 'xs';
    rowObj.paddingBottom = 'xs';
  }

  return rowObj;
}

function buildMemberWeekFlex(title, dateStr, maxPlayers, players, reserves, goalies, imageUrl, theme) {
  const bodyContents = [];
  const finalImageUrl = imageUrl || 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQuyGBcXBYCphjV9yKqgZyNEWCvdbbLtn6ILg&s';
  const colors = getThemeColors(theme);

  // Subtitle showing counts
  const countParts = [];
  let text_row = `👤 ลงชื่อ: ${players.length}/${maxPlayers}`;

  if (reserves.length > 0) {
    text_row += `, ⏳ สำรอง: ${reserves.length}`;
  }
  if (goalies.length > 0) {
    text_row += `,🧤 โกล์: ${goalies.length}`;
  }
  countParts.push({ type: 'text', text: `${text_row}`, size: 'sm', color: colors.textMuted, flex: 1 });
  countParts.push({ type: 'text', text: `⏱️ เสาร์ที่ ${dateStr}`, size: 'sm', color: colors.textMuted, flex: 1, align: 'end' });

  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'sm',
    contents: countParts
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
    margin: 'sm',
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

    const rows = [];
    for (let i = 0; i < players.length; i += 2) {
      const p1 = players[i];
      const p2 = players[i + 1];

      const cols = [
        makeMemberColumn(p1, i + 1, colors)
      ];

      if (p2) {
        cols.push(makeMemberColumn(p2, i + 2, colors));
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

    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      contents: rows
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

    const reserveRows = [];
    for (let i = 0; i < reserves.length; i++) {
      reserveRows.push(makeMemberColumn(reserves[i], i + 1, colors));
    }
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      contents: reserveRows
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

    const goalieRows = [];
    for (let i = 0; i < goalies.length; i++) {
      goalieRows.push(makeMemberColumn(goalies[i], i + 1, colors));
    }
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      contents: goalieRows
    });
  }

  // Quick Action Buttons
  const buttonRegisterColor = isWhite ? '#16a34a' : '#22c55e'; // Green
  const buttonCancelColor = isWhite ? '#dc2626' : '#ef4444'; // Red

  bodyContents.push({ type: 'separator', margin: 'md', color: colors.separator });
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    margin: 'md',
    contents: [
      makeBoxButton('👍 ลงชื่อ (+1)', '+1', buttonRegisterColor),
      makeBoxButton('❌ ยกเลิก (-1)', '-1', buttonCancelColor)
    ]
  });

  const topStatsColor = isWhite ? '#e7d015ff' : '#dbb104ff';
  const bottomStatsColor = isWhite ? '#ef4444' : '#b91c1c';
  const personalStatsColor = isWhite ? '#0284c7' : '#0ea5e9';

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

  return {
    type: 'bubble',
    size: 'giga',
    header: {
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
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: colors.bgMain,
      paddingAll: 'md',
      contents: bodyContents
    }
  };
}

function buildWelcomeFlex(displayName, theme, imageUrl) {
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  const bgMain = isWhite ? '#ffffff' : '#0d0d1a';
  const textPrimary = isWhite ? '#0f172a' : '#ffffff';
  const textMuted = isWhite ? '#64748b' : '#a0a8c0';
  const cardBg = isWhite ? '#f8fafc' : '#16122d';
  const cardBorder = isWhite ? '#e2e8f0' : '#2a2a4a';
  const accentColor = isWhite ? '#15803d' : '#44cc66';
  const buttonColor = isWhite ? '#16a34a' : '#22c55e'; // Vibrant green

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: imageUrl || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
          size: 'full',
          aspectRatio: '20:10',
          aspectMode: 'cover'
        }
      ]
    },
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
          text: 'ยินดีต้อนรับเข้าร่วมทีมเตะบอลก๊วนเราครับ! ดีใจที่ได้คุณมาร่วมสนุกด้วยกัน ขอให้สนุกกับการเล่นฟุตบอลนะครับ ⚽',
          wrap: true,
          size: 'sm',
          color: textMuted
        },
        {
          type: 'separator',
          color: isWhite ? '#e2e8f0' : '#2a2a4a',
          margin: 'md'
        },
        // Quick Action Box
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: cardBg,
          borderColor: cardBorder,
          borderWidth: 'normal',
          cornerRadius: 'md',
          paddingAll: 'md',
          spacing: 'xs',
          contents: [
            {
              type: 'text',
              text: '⚡ ลงชื่อเล่นสัปดาห์นี้',
              weight: 'bold',
              size: 'sm',
              color: accentColor
            },
            {
              type: 'text',
              text: 'กดปุ่มลงชื่อด้านล่าง หรือพิมพ์ +1 เพื่อบันทึกรายชื่อของคุณเข้าตารางเล่นของสัปดาห์นี้ทันที',
              wrap: true,
              size: 'xs',
              color: textMuted
            }
          ]
        },
        // Action Button
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          contents: [
            { type: 'filler' },
            makeBoxButton('👍 ลงชื่อเข้าเล่น (+1)', '+1', buttonColor, 4),
            { type: 'filler' }
          ]
        }
      ]
    }
  };
}
function buildRegisterFlex(dateStr, currentCount, maxPlayers, theme) {
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

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
          size: 'full',
          aspectRatio: '20:10',
          aspectMode: 'cover'
        }
      ]
    },
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
          borderWidth: 'normal',
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
}

function buildAutoRegFlex(action, memberName, list, theme, imageUrl) {
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  const bgMain = isWhite ? '#ffffff' : '#0d0d1a';
  const textPrimary = isWhite ? '#0f172a' : '#ffffff';
  const textMuted = isWhite ? '#64748b' : '#a0a8c0';
  const cardBg = isWhite ? '#f8fafc' : '#16122d';
  const cardBorder = isWhite ? '#e2e8f0' : '#2a2a4a';
  const accentColor = isWhite ? '#15803d' : '#44cc66';
  const buttonColor = isWhite ? '#16a34a' : '#22c55e'; // Vibrant green

  let badgeText = '';
  let badgeBg = '';
  let badgeTextColor = '';
  let title = '';
  let description = '';
  let bodyContents = [];

  if (action === 'list') {
    badgeText = '👤 สมาชิกลงชื่ออัตโนมัติ';
    badgeBg = isWhite ? '#e0f2fe' : '#0c4a6e';
    badgeTextColor = isWhite ? '#0369a1' : '#38bdf8';
    title = 'สมาชิกลงชื่ออัตโนมัติ';
  } else if (action === 'add') {
    badgeText = '✅ สมัครลงชื่ออัตโนมัติสำเร็จ';
    badgeBg = isWhite ? '#dcfce7' : '#064e3b';
    badgeTextColor = isWhite ? '#15803d' : '#4ade80';
    title = 'สมัครลงชื่ออัตโนมัติสำเร็จ';

    const displayMember = typeof memberName === 'object' && memberName !== null ? memberName : { name: memberName };
    description = `เพิ่มคุณ ${displayMember.name} ในรายชื่อลงชื่ออัตโนมัติสำเร็จแล้ว\n\nระบบจะลงชื่อเข้าเล่นให้คุณโดยอัตโนมัติ เมื่อมีการเปิดรอบสัปดาห์ใหม่ ⚽`;

    bodyContents.push({
      type: 'text',
      text: description,
      wrap: true,
      size: 'sm',
      color: textMuted,
      margin: 'md'
    });
  } else if (action === 'remove') {
    badgeText = '❌ ยกเลิกลงชื่ออัตโนมัติ';
    badgeBg = isWhite ? '#fee2e2' : '#7f1d1d';
    badgeTextColor = isWhite ? '#b91c1c' : '#fca5a5';
    title = 'ยกเลิกลงชื่ออัตโนมัติ';

    const displayMember = typeof memberName === 'object' && memberName !== null ? memberName : { name: memberName };
    description = `นำคุณ ${displayMember.name} ออกจากรายชื่อลงชื่ออัตโนมัติเรียบร้อยแล้ว`;

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
      type: 'text',
      text: 'ไม่มีสมาชิกในระบบลงชื่ออัตโนมัติ',
      color: textMuted,
      size: 'sm',
      style: 'italic',
      align: 'center',
      margin: 'md'
    });
  } else {
    // List each member with badge and color
    const listContents = list.map((m, idx) => {
      const isCurrent = displayMember && m.id === displayMember.id;
      const col = makeMemberColumn(m, idx + 1, colors, isCurrent);
      if (idx > 0) {
        col.margin = 'sm';
      }
      return col;
    });

    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: cardBg,
      borderColor: cardBorder,
      borderWidth: 'normal',
      cornerRadius: 'md',
      paddingAll: 'md',
      margin: 'md',
      contents: listContents
    });
  }

  // Construct footer buttons
  const footerButtons = [];
  if (action === 'list') {
    footerButtons.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'sm',
      contents: [
        makeBoxButton('➕ สมัครลงชื่อ', '+autoreg', buttonColor),
        makeBoxButton('➖ ยกเลิก', '-autoreg', isWhite ? '#ef4444' : '#b91c1c')
      ]
    });
  } else if (action === 'add') {
    footerButtons.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'sm',
      contents: [
        makeBoxButton('📋 ดูรายชื่อ', '/autoreglist', buttonColor),
        makeBoxButton('➖ ยกเลิก', '-autoreg', isWhite ? '#ef4444' : '#b91c1c')
      ]
    });
  } else if (action === 'remove') {
    footerButtons.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'sm',
      contents: [
        makeBoxButton('📋 ดูรายชื่อ', '/autoreglist', buttonColor),
        makeBoxButton('➕ สมัครลงชื่อ', '/autoreg', isWhite ? '#64748b' : '#334155')
      ]
    });
  }

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: imageUrl || 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
          size: 'full',
          aspectRatio: '20:10',
          aspectMode: 'cover'
        }
      ]
    },
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
        // Title
        /*{
          type: 'text',
          text: title,
          weight: 'bold',
          size: 'xl',
          color: textPrimary
        },*/
        // Body contents (list or description)
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
}

function buildMemberStatsFlex(data, theme, imageUrl) {
  const { member, stats, firstMatchDate } = data;
  const colors = getThemeColors(theme);
  const isWhite = colors.name === 'white';

  let finalImageUrl = imageUrl;
  if (finalImageUrl) {
    if (!finalImageUrl.startsWith('http://') && !finalImageUrl.startsWith('https://')) {
      const baseUrl = getBaseUrl();
      finalImageUrl = finalImageUrl.startsWith('/') ? `${baseUrl}${finalImageUrl}` : `${baseUrl}/${finalImageUrl}`;
    }
    if (finalImageUrl.startsWith('http://')) {
      finalImageUrl = finalImageUrl.replace('http://', 'https://');
    }
  } else {
    finalImageUrl = 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg';
  }

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

  if (member.hofCount && member.hofCount > 0 && member.hofBadgeUrl) {
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

  return {
    type: 'bubble',
    size: 'giga',
    header: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'none',
      contents: [
        {
          type: 'image',
          url: finalImageUrl,
          size: 'full',
          aspectRatio: '20:6',
          aspectMode: 'cover'
        }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: bgMain,
      paddingAll: 'md',
      contents: bodyContents
    }
  };
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
  buildMemberStatsFlex,
  getThemeColors
};