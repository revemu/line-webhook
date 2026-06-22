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
    layout: 'vertical',
    backgroundColor: colors.bgHeader,
    paddingAll: 'md',
    cornerRadius: 'md',
    contents: [
      {
        type: 'text',
        text: `⚽ ตารางแข่งขัน`,
        weight: 'bold',
        size: 'lg',
        color: colors.textPrimary,
        align: 'center'
      },
      {
        type: 'text',
        text: `เสาร์ที่ ${date}`,
        size: 'sm',
        color: colors.textMuted,
        align: 'center',
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
      { type: 'text', text: `🕐 ${startTime}–${endTime}`, size: 'sm', color: colors.textMutedDark, flex: 1 },
      { type: 'text', text: `${matchMinutes} นาที/แมตช์`, size: 'sm', color: colors.textMutedDark, flex: 1, align: 'center' },
      { type: 'text', text: `${totalMatches} แมตช์`, size: 'sm', color: colors.textMutedDark, flex: 1, align: 'end' }
    ]
  });

  bodyContents.push({ type: 'separator', margin: 'sm', color: colors.separator });

  // ── Column header ──
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'sm',
    contents: [
      { type: 'text', text: '#', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
      { type: 'text', text: 'เวลา', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 2, align: 'center' },
      { type: 'text', text: 'ทีม', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 6, align: 'center' }
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
        { type: 'text', text: `▶ รอบที่ ${roundNum}`, size: 'sm', weight: 'bold', color: colors.textAccent }
      ]
    });

    for (const m of roundMatches) {
      bodyContents.push({
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        contents: [
          { type: 'text', text: `${m.matchNo}`, size: 'sm', color: colors.textMuted, flex: 1, align: 'center' },
          { type: 'text', text: `${m.startTime}`, size: 'sm', color: colors.textMutedLight, flex: 2, align: 'center' },
          {
            type: 'box',
            layout: 'horizontal',
            flex: 6,
            contents: [
              { type: 'text', text: m.teamA, size: 'sm', color: colors.tdc(m.teamA), weight: 'bold', align: 'end', flex: 2 },
              { type: 'text', text: 'vs', size: 'sm', color: colors.textMuted, align: 'center', flex: 1 },
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
        contents: makeHeaderContents('image', 'https://api.revemu.org/green_pulse_true.png', 'แมตช์ปัจจุบัน', cur.matchNo, cur.startTime, true)
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
    const scorerText = scorers.map(s => {
      const og = s.ownGoal ? '🥅' : '';
      return s.goal > 1 ? `${s.name}(${s.goal})${og}` : `${s.name}${og}`;
    }).join('  ');
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'sm',
      contents: [
        { type: 'text', text: '⚽', size: 'xs', flex: 0, color: colors.textMuted },
        { type: 'text', text: scorerText, size: 'xs', color: colors.textMutedLight, flex: 1, margin: 'sm', wrap: true }
      ]
    });
  }

  // ── Assists ──
  if (assists && assists.length > 0) {
    const assistText = assists.map(a => a.assist > 1 ? `${a.name}(${a.assist})` : a.name).join('  ');
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'xs',
      contents: [
        { type: 'text', text: '👟', size: 'xs', flex: 0, color: colors.textMuted },
        { type: 'text', text: assistText, size: 'xs', color: colors.textMutedLight, flex: 1, margin: 'sm', wrap: true }
      ]
    });
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
        { type: 'text', text: 'ทีม', size: 'xxs', weight: 'bold', color: colors.textMutedDark, flex: 3 },
        { type: 'text', text: 'GD', size: 'xxs', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
        { type: 'text', text: 'แต้ม', size: 'xxs', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'end' }
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
          { type: 'text', text: `${medals[i] || (i + 1 + '.')} ${row.team}`, size: 'xs', color: colors.textMutedLight, flex: 3, weight: i === 0 ? 'bold' : 'regular' },
          { type: 'text', text: gdStr, size: 'xs', color: row.gd >= 0 ? (colors.name === 'white' ? '#15803d' : '#88ff88') : (colors.name === 'white' ? '#dc2626' : '#ff8888'), flex: 1, align: 'center' },
          { type: 'text', text: `${row.pts}`, size: 'xs', color: colors.textPrimary, flex: 1, align: 'end', weight: 'bold' }
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
            url: 'https://api.revemu.org/green_pulse_true.png',
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
          const scorerText = scorers.map(s => {
            const og = s.ownGoal ? '🥅' : '';
            return s.goal > 1 ? `${s.name}(${s.goal})${og}` : `${s.name}${og}`;
          }).join('  ');
          detailRows.push({
            type: 'box',
            layout: 'horizontal',
            margin: 'xs',
            contents: [
              { type: 'text', text: '⚽', size: 'sm', flex: 0, color: colors.textMuted },
              { type: 'text', text: scorerText, size: 'sm', color: colors.textMutedLight, flex: 1, margin: 'sm', wrap: true }
            ]
          });
        }
        if (assists && assists.length > 0) {
          const assistText = assists.map(a => a.assist > 1 ? `${a.name}(${a.assist})` : a.name).join('  ');
          detailRows.push({
            type: 'box',
            layout: 'horizontal',
            margin: 'xs',
            contents: [
              { type: 'text', text: '👟', size: 'sm', flex: 0, color: colors.textMuted },
              { type: 'text', text: assistText, size: 'sm', color: colors.textMutedLight, flex: 1, margin: 'sm', wrap: true }
            ]
          });
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
        { type: 'text', text: 'ทีม', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 3 },
        { type: 'text', text: 'GD', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'center' },
        { type: 'text', text: 'แต้ม', size: 'sm', weight: 'bold', color: colors.textMutedDark, flex: 1, align: 'end' }
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
          { type: 'text', text: `${medals[i] || (i + 1 + '.')} ${row.team}`, size: 'sm', color: colors.textMutedLight, flex: 3, weight: i === 0 ? 'bold' : 'regular' },
          { type: 'text', text: gdStr, size: 'sm', color: row.gd >= 0 ? (colors.name === 'white' ? '#15803d' : '#88ff88') : (colors.name === 'white' ? '#dc2626' : '#ff8888'), flex: 1, align: 'center' },
          { type: 'text', text: `${row.pts}`, size: 'sm', color: colors.textPrimary, flex: 1, align: 'end', weight: 'bold' }
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

function buildMemberWeekFlex(title, dateStr, maxPlayers, players, reserves, goalies, imageUrl, theme) {
  const bodyContents = [];
  const finalImageUrl = imageUrl || 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQuyGBcXBYCphjV9yKqgZyNEWCvdbbLtn6ILg&s';
  const colors = getThemeColors(theme);

  // Subtitle showing counts
  const countParts = [];
  countParts.push({ type: 'text', text: `👤 ลงชื่อ: ${players.length}/${maxPlayers}`, size: 'sm', color: colors.textMuted, flex: 1 });
  if (goalies.length > 0) {
    countParts.push({ type: 'text', text: `,🧤 โกล์: ${goalies.length}`, size: 'sm', color: colors.textMuted, flex: 1, align: 'start' });
  }
  if (reserves.length > 0) {
    countParts.push({ type: 'text', text: `,⏳ สำรอง: ${reserves.length}`, size: 'sm', color: colors.textMuted, flex: 1, align: 'start' });
  }

  countParts.push({ type: 'text', text: `⏱️ เสาร์ที่ ${dateStr}`, size: 'sm', color: colors.textMuted, flex: 1, align: 'end' });

  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'sm',
    contents: countParts
  });

  bodyContents.push({ type: 'separator', margin: 'sm', color: colors.separator });

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
        {
          type: 'box',
          layout: 'horizontal',
          flex: 1,
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              width: '22px',
              contents: [
                { type: 'text', text: `${i + 1}.`, size: 'sm', color: colors.textMuted, align: 'end' }
              ]
            },
            { type: 'text', text: `${p1.donate}${p1.name}`, size: 'sm', color: colors.textPrimary, flex: 1, margin: 'sm' }
          ]
        }
      ];

      if (p2) {
        cols.push({
          type: 'box',
          layout: 'horizontal',
          flex: 1,
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              width: '22px',
              contents: [
                { type: 'text', text: `${i + 2}.`, size: 'sm', color: colors.textMuted, align: 'end' }
              ]
            },
            { type: 'text', text: `${p2.donate}${p2.name}`, size: 'sm', color: colors.textPrimary, flex: 1, margin: 'sm' }
          ]
        });
      } else {
        cols.push({ type: 'box', layout: 'horizontal', flex: 1, contents: [] });
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
      goalieRows.push({
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            width: '22px',
            contents: [
              { type: 'text', text: `${i + 1}.`, size: 'sm', color: colors.textMuted, align: 'end' }
            ]
          },
          { type: 'text', text: `${goalies[i].donate}${goalies[i].name}`, size: 'sm', color: colors.textPrimary, flex: 1, margin: 'sm' }
        ]
      });
    }
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      contents: goalieRows
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
      reserveRows.push({
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            width: '22px',
            contents: [
              { type: 'text', text: `${i + 1}.`, size: 'sm', color: colors.textMuted, align: 'end' }
            ]
          },
          { type: 'text', text: `${reserves[i].donate}${reserves[i].name}`, size: 'sm', color: colors.textPrimary, flex: 1, margin: 'sm' }
        ]
      });
    }
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      contents: reserveRows
    });
  }

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
  getThemeColors
};