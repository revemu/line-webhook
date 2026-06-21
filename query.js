const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const flex = require('./flex');

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

async function resetMemberTeam() {
  const week = await queryWeekID();
  let query = `update member_team_week_tbl set team_id=0 where week_id=${week[0].id}`;

  const res = await executeQuery(query);
  //console.log(res) ;
  return res;

}

async function newMember(lineID, name) {
  const query = "insert into member_tbl values(null, ?, 0, 0, 0, ?, ?, 0)";
  const res = await executeQuery(query, [name, name.replace('@', ''), lineID]);
  return res;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function newTeamColorWeek(color, index, week_id) {
  query = `insert team_color_week_tbl values(null, ${index}, ${week_id}, '${color}')`;
  console.log(query);


  const res = await executeQuery(query);
  //console.log(res) ;
  return res;
}

async function addTeamColorWeek(count = 3) {
  let colors = [
    'Red', 'White', 'Black'
  ];
  const week = await queryWeekID();
  let query = `select * from team_color_week_tbl where week_id=${week[0].id}`;
  const res = await executeQuery(query);
  //console.log(res) ;
  //return res ;
  if (res.length == 0) {
    colors = shuffleArray(colors);
    //console.log(colors) ;
    for (let i = 0; i < colors.length; i++) {
      newTeamColorWeek(colors[i], i + 1, week[0].id)
    }
  } else {
    console.log("Team color week already exist!");
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

async function getFormatDate(date, format = 'short') {
  const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  const thaiMonthsShort = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  const d = ('0' + date.getDate()).slice(-2);
  let y = date.getFullYear().toString();
  let month;
  switch (format) {
    case 'full':
      month = thaiMonths[date.getMonth()];
      break;
    case 'short':
      month = thaiMonthsShort[date.getMonth()];
      y = `${y.slice(-2)}`;
      break;
  }



  return `${d} ${month} ${y}`;
}

async function getShortDate(date) {
  const y = date.getFullYear();
  const d = ('0' + date.getDate()).slice(-2);
  const m = ('0' + (date.getMonth() + 1)).slice(-2);
  return `${y}-${m}-${d}`;

}
async function newWeek(week_date) {
  const week = await queryWeekID();
  const y = week_date.getFullYear();
  const date_str = await getShortDate(week_date);
  const last_week = await getShortDate(new Date(week[0].date));
  let new_week_num = week[0].number;
  console.log(last_week + " === " + date_str);
  if (last_week != date_str) {
    new_week_num = week[0].number + 1;
    query = `insert into week_tbl values(null, '${new_week_num}', '${date_str}', 2, '${y}', 24)`;
    //console.log(query) ;


    const res = await executeQuery(query);
    //console.log(res) ;
    //return res ;
  } else {
    console.log(date_str + " already exist!");
  }
  await addTeamColorWeek();
}

async function updateMaxNumberWeek(max_number = 24) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    const query = "update week_tbl set max=? where id=?";
    const res = await executeQuery(query, [max_number, week_id]);
    return res;
  }
}

async function updateMemberDebt(member_id) {
  let query1 = ""

  query1 = "update member_tbl set power=0 where id=?";
  const res1 = await executeQuery(query1, [member_id]);

  //console.log(res) ;
  return res1;
}

async function updateMemberWeek(member_id, value, type = 0) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    let query;
    let query1 = ""
    if (type == 0) {
      query = "update member_team_week_tbl set pay=? where member_id=? and week_id=?";
      query1 = "update member_tbl set power=? where id=?";
      const res1 = await executeQuery(query1, [0, member_id]);
    } else if (type == 1) {
      query = "update member_team_week_tbl set team_id=? where member_id=? and week_id=?";
    }

    const res = await executeQuery(query, [value, member_id, week_id]);
    //console.log(res) ;
    return res;
  }
}

async function queryWeekDate(week_id = 0) {
  let query = "";
  if (week_id == 0) {
    query = "SELECT id, number, date FROM week_tbl ORDER BY NUMBER DESC LIMIT 1";
    return await executeQuery(query);
  } else {
    query = "SELECT id, number, date FROM week_tbl where id=?";
    return await executeQuery(query, [week_id]);
  }
}

async function queryWeekID(week_id = 0) {
  let query = "";
  if (week_id == 0) {
    query = "SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date, max FROM week_tbl ORDER BY NUMBER DESC LIMIT 1";
    return await executeQuery(query);
  } else {
    query = "SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date, max FROM week_tbl where id=?";
    return await executeQuery(query, [week_id]);
  }
}

async function unregisterMember(member_id) {
  const week = await queryWeekID();
  if (week.length > 0) {
    const week_id = week[0].id;
    const query = "SELECT * from member_team_week_tbl where week_id=? and member_id=?";
    const res = await executeQuery(query, [week_id, member_id]);
    //console.log(`${res.length}`)
    if (res.length > 0) {
      //console.log(`${week_id}`)
      const query = "delete from member_team_week_tbl where member_id=? and week_id=?";
      //console.log(query) ;
      const reg_res = await executeQuery(query, [member_id, week_id]);
      //console.log(reg_res) ;
      return true;
    } else {
      return false;
    }
  }
  //console.log(res) ;
  return false;
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

  const query = `update member_tbl set week_id=1 where id=${member_id}`;

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
      const debt = check_res[0].power;
      console.log(`ยอดค้าง ${debt}`);
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

async function queryMatchGoal(match_id, goal_status = 0) {
  let status;
  let icon = "";
  let url = "";
  let size = ""
  let offsetTop;
  let offsetStart;
  if (goal_status == 0) {
    status = " <= 2";
    icon = "⚽";
    url = "https://api.revemu.org/ball_ico.png";
    size = "md";
    offsetTop = "xs";
    offsetStart = "xs";
  } else if (goal_status == 3) {
    status = " = 3";
    icon = "👟";
    url = "https://api.revemu.org/boot_ico.png";
    size = "lg";
    offsetTop = "sm";
    offsetStart = "none";
  }

  query = `SELECT member_tbl.name, member_tbl.alias, goal_status_tbl.status,match_goal_tbl.status as statusid, count(*) as goal FROM match_goal_tbl, member_tbl, goal_status_tbl WHERE match_goal_tbl.match_id=${match_id} and match_goal_tbl.member_id = member_tbl.id and match_goal_tbl.status ${status} and match_goal_tbl.status=goal_status_tbl.id group by member_tbl.id`

  let member_list = " ";
  const match_goals = await executeQuery(query);
  let i = 0;
  if (match_goals.length > 0) {

    member_list = "";
    for (const member of match_goals) {
      //console.log(`${member.name} ${match_id}`) ;
      //console.log(member) ;

      if (i > 0) {
        member_list += ", "
      }
      if (member.goal > 1) {
        member_list += `+(${member.goal})`;
      }
      if (member.alias == '') {
        member_list += member.name;
      } else {
        member_list += member.alias;
      }
      if (member.statusid == 2) {
        member_list += "🥅";
      } else if (member.statusid == 1) {
        member_list += "🔄";
      }
      //member_list += member.name ;
      i++;
      //console.log(member) ;
    }
    //if (i == 0) member_list = "-" ;

  }
  const box =
  {
    type: "box",
    layout: "baseline",
    //"margin": "xs",
    "flex": 1,
    contents: [
      {
        "type": "icon",
        "size": size,
        "url": url,
        "offsetTop": offsetTop
      },
      {
        type: "text",
        text: `${member_list}`,
        size: "xs"
      }
    ],
    "spacing": "sm",
    "offsetStart": offsetStart
  }
  return box;
}

async function getTeamColorWeek(week_id) {

  query = `select team_color_week_tbl.id, team_color_week_tbl.color,  template_tpl.url, template_tpl.code from team_color_week_tbl, template_tpl where week_id=${week_id} and team_color_week_tbl.color = template_tpl.value`;

  const result = await executeQuery(query);
  if (result.length > 0) {
    return result;
  }

}

async function getTemplate(name, value) {
  query = `select * from template_tpl where name='${name}' and value='${value}'`;

  const result = await executeQuery(query);
  if (result.length > 0) {
    return result[0];
  }
}

async function getTeamColor(color) {
  query = `select * from template_tpl where name='team_color' and value='${color}'`;

  const result = await executeQuery(query);
  if (result.length > 0) {
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

      bubble.body.contents = [];
      let tables = [];
      const date = new Date(res[0].date);
      const date_str = await getFormatDate(date);
      tables.push(
        {
          type: "text",
          text: `Table Week - ${date_str}`,
          weight: "bold",
          size: "lg",
          align: "center",
          //color: teamColor.code
        }, {
        type: "separator",
        margin: "none",
        color: "#000000"
      },
        {
          type: "separator",
          color: "#FFFFFF",
          margin: "md"
        }
      );

      tables.push({
        "type": "box",
        "layout": "baseline",
        "margin": "xs",
        "contents": [
          {
            "type": "icon",
            "size": "xs",
            "url": "https://commons.wikimedia.org/wiki/File:BLANK_ICON.png"
          },
          {
            "type": "text",
            "text": "Team",
            "weight": "bold",
            "size": "sm",
            "flex": 1
          },
          {
            "type": "text",
            "text": "W",
            "wrap": true,
            "weight": "bold",
            "size": "sm",
            "align": "center",
            "flex": 1
          },
          {
            "type": "text",
            "text": "D",
            "weight": "bold",
            "size": "sm",
            "align": "center",
            "flex": 1
          },
          {
            "type": "text",
            "text": "L",
            "weight": "bold",
            "size": "sm",
            "align": "center",
            "flex": 1
          },
          {
            "type": "text",
            "text": "G",
            "weight": "bold",
            "size": "sm",
            "align": "center",
            "flex": 1
          },
          {
            "type": "text",
            "text": "A",
            "weight": "bold",
            "size": "sm",
            "align": "center",
            "flex": 1
          },
          {
            "type": "text",
            "text": "PTS",
            "weight": "bold",
            "size": "sm",
            "align": "center",
            "flex": 1
          }
        ]
      });
      //console.log(tables[0]) ;
      //return tables ;
      //var bubble = new Array(team_colors.length) ;
      var i = 0;
      let team_colors = await getTeamColorWeek(week_id);
      //team_colors = team_colors[0] ;
      //console.log(team_colors) ;
      for (const table of week_tables) {
        let top = "";
        let top_url = "https://commons.wikimedia.org/wiki/File:BLANK_ICON.png"
        if (i == 0) {
          top = "🏆";
          top_url = "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png"
        }
        //const teamColor = await getTeamColor(team.color) ;
        //const bubble =  Object.assign({}, flex.tpl_bubble);
        const team = team_colors.filter(team => team.id === table.team_week_id)[0];
        //console.log(table) ;
        const table_box = {
          "type": "box",
          "layout": "baseline",
          "margin": "xs",
          "flex": 1
        };
        table_box.contents = [];

        table_box.contents.push(
          {
            "type": "icon",
            "size": "xs",
            "url": top_url
          },
          {
            "type": "text",
            "text": `${table.color}`,
            "color": `${team.code}`,
            "size": "sm",
            "weight": "bold",
            "flex": 1
          },
          {
            "type": "text",
            "text": `${table.w}`,
            "align": "center",
            "size": "sm",
            "flex": 1
          },
          {
            "type": "text",
            "text": `${table.d}`,
            "size": "sm",
            "align": "center",
            "flex": 1
          },
          {
            "type": "text",
            "text": `${table.l}`,
            "size": "sm",
            "align": "center",
            "flex": 1
          },
          {
            "type": "text",
            "text": `${table.G}`,
            "size": "sm",
            "align": "center",
            "flex": 1
          },
          {
            "type": "text",
            "text": `${table.A}`,
            "size": "sm",
            "align": "center",
            "flex": 1
          },
          {
            "type": "text",
            "text": `${table.pts}`,
            "size": "sm",
            "align": "center",
            "flex": 1
          }
        );
        //console.log(table_box) ;
        tables.push(table_box);
        i++;
        //if (i > 2) break ;
      }
      console.log(JSON.stringify(bubble));
      return tables;
    }


  }
}

async function getMatchWeek(week_id = 0) {

  res = await queryWeekID(week_id);
  console.log(res);
  if (res.length > 0) {
    if (week_id == 0) {
      week_id = res[0].id;
    }
    const matches = await queryMatchWeek(week_id);
    console.log(matches);
    if (matches.length > 0) {
      const date = new Date(res[0].date);
      const date_str = await getFormatDate(date);
      let team_colors = await getTeamColorWeek(week_id);

      const bodyContents = [];

      // Maps team color name → a readable display color on dark backgrounds
      const teamDisplayColor = (colorName, code) => {
        const n = (colorName || '').toLowerCase();
        if (n === 'black') return '#999999';   // dark grey, readable on dark bg
        if (n === 'white') return '#ffffff';
        if (n === 'red')   return '#ff5566';   // bright red
        if (n === 'green') return '#44cc66';   // bright green
        // fallback: brighten dark DB codes
        if (!code || code.length < 7) return '#ffffff';
        const r = parseInt(code.slice(1, 3), 16);
        const g = parseInt(code.slice(3, 5), 16);
        const b = parseInt(code.slice(5, 7), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.40 ? '#ffffff' : code;
      };

      // ── Header ──
      bodyContents.push({
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1a1a2e',
        paddingAll: 'md',
        cornerRadius: 'md',
        contents: [
          {
            type: 'text',
            text: '\u26bd \u0e1c\u0e25\u0e01\u0e32\u0e23\u0e41\u0e02\u0e48\u0e07\u0e02\u0e31\u0e19',
            weight: 'bold',
            size: 'lg',
            color: '#ffffff',
            align: 'center'
          },
          {
            type: 'text',
            text: `\u0e40\u0e2a\u0e32\u0e23\u0e4c\u0e17\u0e35\u0e48 ${date_str}`,
            size: 'sm',
            color: '#a0a8c0',
            align: 'center',
            margin: 'xs'
          }
        ]
      });

      // ── Match cards ──
      for (const match of matches) {
        const team_a = team_colors.filter(t => t.id === match.team_a_id)[0];
        const team_b = team_colors.filter(t => t.id === match.team_b_id)[0];

        const goalBox   = await queryMatchGoal(match.id, 0);
        const assistBox = await queryMatchGoal(match.id, 3);

        const styleGoalBox = (box, isAssist) => {
          if (!box) return null;
          const textNode = box.contents && box.contents[1];
          if (!textNode) return null;
          const textVal = textNode.text ? textNode.text.trim() : '';
          if (textVal === '' || textVal === ' ') return null;
          return {
            type: 'box',
            layout: 'horizontal',
            margin: 'xs',
            paddingStart: 'sm',
            contents: [
              { type: 'text', text: isAssist ? '\ud83d\udc5f' : '\u26bd', size: 'xs', flex: 0 },
              {
                type: 'text',
                text: textVal,
                size: 'xs',
                color: isAssist ? '#bbddff' : '#ddddff',
                flex: 1,
                margin: 'sm',
                wrap: true
              }
            ]
          };
        };

        const scorerRow = styleGoalBox(goalBox, false);
        const assistRow = styleGoalBox(assistBox, true);

        const cardContents = [
          {
            type: 'text',
            text: `\u0e41\u0e21\u0e15\u0e0a\u0e4c [${match.match_num}]`,
            size: 'xs',
            color: '#a0a8c0',
            align: 'center'
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: team_a ? team_a.color : '?', size: 'lg', weight: 'bold', color: team_a ? teamDisplayColor(team_a.color, team_a.code) : '#ffffff', flex: 2, align: 'end' },
              {
                type: 'text',
                text: `${match.team_a_goal} - ${match.team_b_goal}`,
                size: 'lg',
                weight: 'bold',
                color: '#e94560',
                flex: 1,
                align: 'center'
              },
              { type: 'text', text: team_b ? team_b.color : '?', size: 'lg', weight: 'bold', color: team_b ? teamDisplayColor(team_b.color, team_b.code) : '#ffffff', flex: 2, align: 'start' }
            ]
          }
        ];

        if (scorerRow) cardContents.push(scorerRow);
        if (assistRow) cardContents.push(assistRow);

        bodyContents.push({
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#1a1a2e',
          paddingAll: 'sm',
          cornerRadius: 'md',
          margin: 'sm',
          contents: cardContents
        });
      }

      // ── Standings ──
      const tableRows = await queryTableWeek(week_id);
      if (tableRows && tableRows.length > 0) {
        bodyContents.push({ type: 'separator', margin: 'md', color: '#2a2a4a' });
        bodyContents.push({
          type: 'text',
          text: '\ud83d\udcca \u0e15\u0e32\u0e23\u0e32\u0e07\u0e04\u0e30\u0e41\u0e19\u0e19',
          size: 'sm',
          weight: 'bold',
          color: '#e0e0ff',
          margin: 'md'
        });

        bodyContents.push({
          type: 'box',
          layout: 'horizontal',
          margin: 'xs',
          contents: [
            { type: 'text', text: '\u0e17\u0e35\u0e21', size: 'xxs', weight: 'bold', color: '#7878a8', flex: 4 },
            { type: 'text', text: 'W',   size: 'xxs', weight: 'bold', color: '#7878a8', flex: 1, align: 'center', margin: 'lg' },
            { type: 'text', text: 'D',   size: 'xxs', weight: 'bold', color: '#7878a8', flex: 1, align: 'center' },
            { type: 'text', text: 'L',   size: 'xxs', weight: 'bold', color: '#7878a8', flex: 1, align: 'center' },
            { type: 'text', text: 'GD',  size: 'xxs', weight: 'bold', color: '#7878a8', flex: 1, align: 'center' },
            { type: 'text', text: 'PTS', size: 'xxs', weight: 'bold', color: '#7878a8', flex: 1, align: 'center' }
          ]
        });

        const medals = ['\ud83e\udd47', '\ud83e\udd48', '\ud83e\udd49', '4\ufe0f\u20e3'];
        tableRows.forEach((row, i) => {
          const gd = (row.G || 0) - (row.A || 0);
          const gdStr = gd > 0 ? `+${gd}` : `${gd}`;
          const teamColor = team_colors.filter(t => t.id === row.team_week_id)[0];
          bodyContents.push({
            type: 'box',
            layout: 'horizontal',
            margin: 'xs',
            contents: [
              { type: 'text', text: `${medals[i] || (i + 1 + '.')} ${row.color}`, size: 'xs', color: teamDisplayColor(row.color, teamColor ? teamColor.code : null), flex: 4, weight: i === 0 ? 'bold' : 'regular' },
              { type: 'text', text: `${row.w}`,   size: 'xs', color: '#aaaacc', flex: 1, align: 'center', margin: 'lg' },
              { type: 'text', text: `${row.d}`,   size: 'xs', color: '#aaaacc', flex: 1, align: 'center' },
              { type: 'text', text: `${row.l}`,   size: 'xs', color: '#aaaacc', flex: 1, align: 'center' },
              { type: 'text', text: gdStr, size: 'xs', color: gd >= 0 ? '#88ff88' : '#ff8888', flex: 1, align: 'center' },
              { type: 'text', text: `${row.pts}`, size: 'xs', color: '#ffffff', flex: 1, align: 'center', weight: 'bold' }
            ]
          });
        });
      }

      return {
        type: 'bubble',
        size: 'giga',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#0f3460',
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
          backgroundColor: '#0d0d1a',
          paddingAll: 'sm',
          contents: bodyContents
        }
      };
    }


  }
}


// Maps team color name → a readable display color on dark backgrounds
function teamDisplayColor(colorName, code) {
  const n = (colorName || '').toLowerCase();
  if (n === 'black') return '#999999';
  if (n === 'white') return '#ffffff';
  if (n === 'red')   return '#ff5566';
  if (n === 'green') return '#44cc66';
  if (!code || code.length < 7) return '#ffffff';
  const r = parseInt(code.slice(1, 3), 16);
  const g = parseInt(code.slice(3, 5), 16);
  const b = parseInt(code.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.40 ? '#ffffff' : code;
}

async function getTeamWeek(week_id = 0) {

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
      const carousel = { type: 'carousel', contents: [] };

      for (const team of team_colors) {
        const teamColor = await getTeamColor(team.color);
        const displayColor = teamDisplayColor(team.color, teamColor ? teamColor.code : null);

        const bodyContents = [];

        // ── Team header card ──
        bodyContents.push({
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#1a1a2e',
          paddingAll: 'md',
          cornerRadius: 'md',
          contents: [
            {
              type: 'text',
              text: team.color,
              weight: 'bold',
              size: 'lg',
              color: displayColor,
              align: 'center'
            },
            {
              type: 'text',
              text: '⚽ ทีมสัปดาห์นี้',
              size: 'xxs',
              color: '#a0a8c0',
              align: 'center',
              margin: 'xs'
            }
          ]
        });

        bodyContents.push({ type: 'separator', margin: 'sm', color: '#2a2a4a' });

        // ── Member list ──
        query = `select member_team_week_tbl.*, member_tbl.name AS line_name from member_team_week_tbl left join member_tbl on member_team_week_tbl.member_id = member_tbl.id where member_team_week_tbl.week_id=${week_id} and member_team_week_tbl.team_id=${team.id}`;
        console.log(query);
        const team_members = await executeQuery(query);
        if (team_members.length > 0) {
          let idx = 0;
          for (const member of team_members) {
            const isFirst = idx === 0;
            bodyContents.push({
              type: 'box',
              layout: 'horizontal',
              margin: 'xs',
              contents: [
                {
                  type: 'text',
                  text: `${idx + 1}.`,
                  size: 'xs',
                  color: '#555577',
                  flex: 0,
                  margin: 'none'
                },
                {
                  type: 'text',
                  text: member.line_name.replace('@', ''),
                  size: 'sm',
                  color: '#ddddff',
                  flex: 1,
                  margin: 'sm'
                }
              ]
            });
            idx++;
          }
        } else {
          bodyContents.push({
            type: 'text',
            text: 'ยังไม่มีสมาชิกในทีมนี้',
            size: 'xs',
            color: '#555577',
            align: 'center',
            margin: 'md'
          });
        }

        carousel.contents.push({
          type: 'bubble',
          size: 'micro',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#0f3460',
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
            backgroundColor: '#0d0d1a',
            paddingAll: 'sm',
            contents: bodyContents
          }
        });
      }

      return carousel;
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

  query = `SELECT * from member_tbl where week_id = 1`;
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

async function getMemberWeek0(type = 0) {
  let header = "";
  let body = "";
  let sub = {};
  let query = "";
  let start = ""
  const res = await queryWeekID();

  if (res.length > 0) {
    const week_id = res[0].id;
    const max_players = res[0].max;
    query = `SELECT member_tbl.name, member_tbl.alias, member_team_week_tbl.team_id, member_team_week_tbl.team, member_team_week_tbl.pay, member_tbl.team_id, member_tbl.id, member_tbl.donate, member_tbl.team_id, team_fav.emoticon FROM member_team_week_tbl INNER JOIN member_tbl ON member_tbl.id = member_team_week_tbl.member_id LEFT JOIN team_fav ON member_tbl.team_id=team_fav.id where member_team_week_tbl.week_id = ${week_id}`;
    if (type == 0) {
      header = "คนที่ยังไมได้จ่ายค่าสนาม";
      query += " and pay=0";
    } else if (type == 1) {
      header = "ลงชื่อเตะบอล";
      start = "+"
    }

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
        let donate = await getDonateBadge(member.donate);
        let name_display = member.name;
        if (member.id == 116 || member.id == 16) {
          name_display = member.alias;
        } else {
          name_display = member.name;
        }

        if (type == 1) {
          if (member.team_id == 100) {
            goal++;
            goal_str += (goal) + ". " + donate + name_display + "\n";
          } else {

            //index = player ;
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
      //console.log(`player: ${player} reserve: ${reserve} goal: ${goal}`);
      let str = header + body;
      header = `+${player}`;
      if (reserve > 0) str += reserve_str;
      if (goal > 0) str += goal_str;
      if (reserve > 0) header += `(${reserve})`;
      if (goal > 0) header += `(${goal})`;
      //if (debt_count > 0) str += debt_str;

      str = `${header} ${str}`;

      return [str, sub];
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

async function getMemberWeek(type = 0) {
  let header = "";
  let body = "";
  let query = "";
  let start = ""
  const res = await queryWeekID();

  if (res.length > 0) {
    const week_id = res[0].id;
    query = `SELECT member_tbl.name, member_tbl.alias, member_team_week_tbl.team_id, member_team_week_tbl.team, member_team_week_tbl.pay, member_tbl.team_id, member_tbl.id, member_tbl.donate, member_tbl.team_id, team_fav.emoticon FROM member_team_week_tbl INNER JOIN member_tbl ON member_tbl.id = member_team_week_tbl.member_id LEFT JOIN team_fav ON member_tbl.team_id=team_fav.id where member_team_week_tbl.week_id = ${week_id}`;
    if (type == 0) {
      header = "คนที่ยังไมได้จ่ายค่าสนาม";
      query += " and pay=0";
    } else if (type == 1) {
      header = "ลงชื่อเตะบอล";
      start = "+"
    }

    /*const check = `SELECT * from member_tbl where power > 0`;
    const check_res = await executeQuery(check);
    let debt_str = "\n=== สมาชิกที่มียอดค้าง ===\n"
    let debt_count = 0;
    if (check_res.length > 0) {
      for (const member of check_res) {
        debt_count++;
        debt_str += `${debt_count}. ${member.name} - ${member.power}บาท\n`;
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
        let donate = await getDonateBadge(member.donate);

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

async function getMemberWeek2(type = 0) {
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
    query = `SELECT member_tbl.name, member_tbl.line_user_id, member_tbl.alias, member_team_week_tbl.team_id, member_team_week_tbl.team, member_team_week_tbl.pay, member_tbl.power, member_tbl.id, member_tbl.donate, member_tbl.team_id, team_fav.emoticon FROM member_team_week_tbl INNER JOIN member_tbl ON member_tbl.id = member_team_week_tbl.member_id LEFT JOIN team_fav ON member_tbl.team_id=team_fav.id where member_team_week_tbl.week_id = ${week_id}`;
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
        let donate = await getDonateBadge(member.donate);

        let member_name = member.name;
        if (type == 1) {
          if (member.power == 1000) {
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
          if (result.length < 21) {
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
      header = `+${player}`;
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

async function getTopStat(limit = 10, type = 0) {
  let header = "";
  let icon = "";
  let query = "";
  let status = "";
  const res = await getTemplate('top', type);
  let url = res ? res.url : '';

  if (type == 0) {
    status = "< 2";
    header = "Top Scorer";
    icon = "⚽";
  } else if (type == 1) {
    status = "= 3";
    header = "Top Assist";
    icon = "👟";
  } else if (type == 2) {
    status = "= 2";
    header = "Own Goal";
    icon = "🥅";
  } else if (type == 4) {
    header = "Avg Pts";
    icon = "📊";
  }

  query = `SELECT member_tbl.name, member_tbl.alias, goal_status_tbl.status, match_goal_tbl.status as statusid, count(*) as goal FROM match_goal_tbl, member_tbl, goal_status_tbl , match_stat_tbl , week_tbl WHERE match_goal_tbl.member_id = member_tbl.id and match_goal_tbl.status ${status} and match_goal_tbl.status=goal_status_tbl.id AND match_goal_tbl.match_id = match_stat_tbl.id AND match_stat_tbl.week_id = week_tbl.id And YEAR(week_tbl.date) = YEAR(CURRENT_DATE()) and member_tbl.id <> 121 and member_tbl.id <> 169 and member_tbl.team_id <> 101 group by member_tbl.id order by goal DESC limit ${limit}`;

  if (type == 4) {
    query = `SELECT 
    member_tbl.name, 
    member_tbl.alias, 
    SUM(table_week_tbl.pts) 
        / sum(table_week_tbl.w + table_week_tbl.d + table_week_tbl.l) AS pts,
        sum(table_week_tbl.w + table_week_tbl.d + table_week_tbl.l) AS m
FROM member_team_week_tbl
JOIN table_week_tbl ON member_team_week_tbl.team_id = table_week_tbl.team_week_id
JOIN member_tbl     ON member_team_week_tbl.member_id = member_tbl.id
JOIN week_tbl       ON table_week_tbl.week_id = week_tbl.id
WHERE week_tbl.year = YEAR(CURRENT_DATE())
GROUP BY member_tbl.id, member_tbl.name, member_tbl.alias
HAVING COUNT(table_week_tbl.id) > (
    SELECT COUNT(*) * 0.5
    FROM week_tbl
    WHERE week_tbl.year = YEAR(CURRENT_DATE())
)
ORDER BY pts DESC limit ${limit}`;
  }

  const result = await executeQuery(query);
  if (result.length > 0) {
    const currentYear = new Date().getFullYear();

    const bodyContents = [];

    // ── Stat header card ──
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1a1a2e',
      paddingAll: 'md',
      cornerRadius: 'md',
      contents: [
        {
          type: 'text',
          text: `${icon} ${header}`,
          weight: 'bold',
          size: 'md',
          color: '#ffffff',
          align: 'center'
        },
        {
          type: 'text',
          text: `Top ${limit}  (${currentYear})`,
          size: 'xxs',
          color: '#a0a8c0',
          align: 'center',
          margin: 'xs'
        }
      ]
    });

    bodyContents.push({ type: 'separator', margin: 'sm', color: '#2a2a4a' });

    // ── Rank rows ──
    const rankIcons = ['🥇', '🥈', '🥉'];
    result.forEach((member, i) => {
      const displayName = (member.alias && member.alias !== '' ? member.alias : member.name).replace('@', '');
      let valText = "";
      if (type == 4) {
        valText = `${Number(member.pts).toFixed(2)} (${member.m})`;
      } else {
        valText = `${member.goal}`;
      }

      const rankLabel = rankIcons[i] || `${i + 1}.`;
      const isTop = i === 0;

      bodyContents.push({
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        contents: [
          {
            type: 'text',
            text: rankLabel,
            size: 'xs',
            flex: 0,
            margin: 'none',
            gravity: 'center'
          },
          {
            type: 'text',
            text: displayName,
            size: 'xs',
            color: isTop ? '#ffffff' : '#ccccee',
            weight: isTop ? 'bold' : 'regular',
            flex: 3,
            margin: 'sm'
          },
          {
            type: 'text',
            text: valText,
            size: 'xs',
            color: isTop ? '#e94560' : '#aaaacc',
            weight: isTop ? 'bold' : 'regular',
            flex: 2,
            align: 'end'
          }
        ]
      });
    });

    return {
      type: 'bubble',
      size: 'hecto',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0f3460',
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
        backgroundColor: '#0d0d1a',
        paddingAll: 'sm',
        contents: bodyContents
      }
    };
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
    const check = `SELECT * from member_tbl where power > 0`;
    const check_res = await executeQuery(check);

    if (check_res.length > 0) {
      for (const member of check_res) {
        debt_count++;
        let name = member.name;
        let line_id = member.line_user_id;
        if (line_id != null && line_id != "") {
          name = `user${debt_count}`;
          debt_str += `${debt_count}. {${name}} - ${member.power} บาท\n`;
          sub[name] = {
            "type": "mention",
            "mentionee":
            {
              "type": "user",
              "userId": line_id
            }
          };
        } else {
          debt_str += `${debt_count}. ${name} - ${member.power} บาท\n`;
        }
      }
      if (type == 0) {
        await updateAlertCall(1);
      }
    }

  }
  debt_str += "** ข้อความแจ้งเตือนวันละครั้ง **";
  return [debt_str, sub, debt_count, proceed];

}


async function getScheduleText(startTimeStr = '17:00', matchMin = 8, breakMin = 2, totalHours = 3) {
  // Fetch current week team colors
  const week = await queryWeekID();
  if (!week || week.length === 0) return 'ยังไม่มีข้อมูลสัปดาห์นี้';

  const week_id = week[0].id;
  const team_colors = await getTeamColorWeek(week_id);

  if (!team_colors || team_colors.length < 2) {
    return 'ยังไม่มีข้อมูลทีมในสัปดาห์นี้ (ใช้คำสั่ง randomteam ก่อน)';
  }

  // Build team list (up to 4)
  const teams = team_colors.slice(0, 4).map(t => t.color);
  const numTeams = teams.length;

  // Number of unique pairs in one round-robin cycle
  const cycleLen = (numTeams * (numTeams - 1)) / 2; // = 6 for 4 teams

  // Parse start time and slot sizes (support both '17:30' and '17.30')
  const [startH, startM] = startTimeStr.replace('.', ':').split(':').map(Number);
  const startTotal = startH * 60 + (startM || 0);
  const slotMin = matchMin + breakMin;
  const maxMatches = Math.floor((totalHours * 60) / slotMin);

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
      const opp  = others[j];                        // anchor's opponent this sub-round
      const pair = others.filter((_, k) => k !== j); // the other two teams

      pool.push([anchor, opp]);                       // anchor's match first
      if (pool.length < maxMatches) {
        pool.push([pair[0], pair[1]]);                // then the other pair
      }
    }
    poolRound++;
  }

  // -----------------------------------------------------------
  // Greedy scheduler: enforce BOTH constraints simultaneously
  //   1. No team PLAYS 3+ consecutive matches
  //   2. No team RESTS 3+ consecutive matches
  //
  // For each slot, scan remaining pool for the first match (a,b) where:
  //   - Neither a nor b has played 2 consecutive  (play constraint)
  //   - No non-playing team has already rested 2 consecutive (rest constraint)
  // -----------------------------------------------------------
  const consec     = new Array(numTeams).fill(0);   // consecutive PLAY streak
  const lastSlot   = new Array(numTeams).fill(-2);  // last slot team played
  const restConsec = new Array(numTeams).fill(0);   // consecutive REST streak
  const lastRest   = new Array(numTeams).fill(-2);  // last slot team rested
  const remaining  = [...pool];
  const matchups   = [];

  for (let slot = 0; slot < maxMatches; slot++) {
    let chosen = -1;

    for (let i = 0; i < remaining.length; i++) {
      const [a, b] = remaining[i];

      // --- Play constraint ---
      const aC = lastSlot[a] === slot - 1 ? consec[a] : 0;
      const bC = lastSlot[b] === slot - 1 ? consec[b] : 0;
      if (aC >= 2 || bC >= 2) continue;

      // --- Rest constraint ---
      // If we pick (a,b), every other team is resting this slot.
      // Reject if that would give any of them a 3rd consecutive rest.
      let restOk = true;
      for (let t = 0; t < numTeams; t++) {
        if (t === a || t === b) continue; // playing, not resting
        const tR = lastRest[t] === slot - 1 ? restConsec[t] : 0;
        if (tR >= 2) { restOk = false; break; }
      }
      if (!restOk) continue;

      chosen = i;
      break;
    }

    // Fallback safety net (shouldn't trigger with 4 teams)
    if (chosen === -1) chosen = 0;

    const [a, b] = remaining.splice(chosen, 1)[0];
    matchups.push([a, b]);

    // Update tracking for ALL teams
    for (let t = 0; t < numTeams; t++) {
      if (t === a || t === b) {
        // Playing this slot
        consec[t]   = lastSlot[t] === slot - 1 ? consec[t] + 1 : 1;
        lastSlot[t] = slot;
        restConsec[t] = 0; // reset rest streak when playing
      } else {
        // Resting this slot
        restConsec[t] = lastRest[t] === slot - 1 ? restConsec[t] + 1 : 1;
        lastRest[t]   = slot;
      }
    }
  }

  const totalRounds = Math.ceil(maxMatches / cycleLen);

  const toTime = (mins) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // Format output
  const thaiMonthsShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const dateObj = new Date(week[0].date || Date.now());
  const dateStr = `${dateObj.getDate()} ${thaiMonthsShort[dateObj.getMonth()]} ${String(dateObj.getFullYear()).slice(-2)}`;

  const lines = [];
  lines.push(`⚽ ตารางแข่งขัน เสาร์ที่ ${dateStr}`);
  lines.push(`🕐 เริ่ม ${startTimeStr} น. | ${matchMin} นาที/แมตช์`);
  lines.push(`👥 ${numTeams} ทีม | ${matchups.length} แมตช์ (${totalRounds} รอบ) | ${totalHours} ชม.`);
  lines.push(`⚠️ เล่น/พักติดต่อกันได้สูงสุด 2 แมตช์เท่านั้น`);
  lines.push('─'.repeat(30));

  matchups.forEach((m, i) => {
    // New round header every cycleLen matches
    if (i % cycleLen === 0) {
      lines.push(`▶ รอบที่ ${Math.floor(i / cycleLen) + 1}`);
    }

    const slotStart = startTotal + i * slotMin;
    const resting = teams.filter((_, idx) => idx !== m[0] && idx !== m[1]).join(', ');
    lines.push(`[${i + 1}] ${toTime(slotStart)}-${toTime(slotStart + matchMin)}  ${teams[m[0]]} vs ${teams[m[1]]}  (พัก: ${resting})`);
  });

  lines.push('─'.repeat(30));
  lines.push(`สิ้นสุด ${toTime(startTotal + matchups.length * slotMin)} น.`);

  // ── Build schedule JSON ──
  const scheduleMatches = matchups.map((m, i) => ({
    matchNo: i + 1,
    round: Math.floor(i / cycleLen) + 1,
    startTime: toTime(startTotal + i * slotMin),
    endTime: toTime(startTotal + i * slotMin + matchMin),
    teamA: teams[m[0]],
    teamAId: team_colors[m[0]].id,
    teamB: teams[m[1]],
    teamBId: team_colors[m[1]].id,
    resting: teams.filter((_, idx) => idx !== m[0] && idx !== m[1])
  }));

  // ── Sync with match_stat_tbl to find current & next match ──
  let currentMatchNo = 1;
  let nextMatchNo = 2;
  try {
    const dbMatches = await queryMatchWeek(week_id);
    if (dbMatches && dbMatches.length > 0) {
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
  const nextMatch    = scheduleMatches.find(m => m.matchNo === nextMatchNo)    || null;

  const scheduleJson = {
    generatedAt: new Date().toISOString(),
    weekId: week_id,
    date: dateStr,
    startTime: startTimeStr,
    matchMinutes: matchMin,
    breakMinutes: breakMin,
    totalHours: totalHours,
    teams: teams,
    totalMatches: scheduleMatches.length,
    totalRounds: totalRounds,
    endTime: toTime(startTotal + scheduleMatches.length * slotMin),
    currentMatch,
    nextMatch,
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

// ── Live current/next match lookup ──
// Reads the schedule list from schedule.json but re-queries match_stat_tbl
// for the latest match_num so it is always up to date.
async function getCurrentMatch() {
  const jsonPath = path.join(__dirname, 'schedule.json');
  if (!require('fs').existsSync(jsonPath)) return null;

  const sched = JSON.parse(require('fs').readFileSync(jsonPath, 'utf8'));
  const schedMatches = sched.matches;
  if (!schedMatches || schedMatches.length === 0) return null;

  let currentMatchNo = 1;
  let nextMatchNo    = Math.min(2, schedMatches.length);
  let currentDbRow   = null;

  const week = await queryWeekID();
  if (week && week.length > 0) {
    const dbMatches = await queryMatchWeek(week[0].id);
    if (dbMatches && dbMatches.length > 0) {
      const maxDbMatchNum = Math.max(...dbMatches.map(r => r.match_num));
      currentMatchNo = maxDbMatchNum;
      nextMatchNo    = Math.min(maxDbMatchNum + 1, schedMatches.length);
      currentDbRow   = dbMatches.find(r => r.match_num === maxDbMatchNum);
    }
  }

  const currentMatch = schedMatches.find(m => m.matchNo === currentMatchNo) || schedMatches[0];
  const nextMatch    = schedMatches.find(m => m.matchNo === nextMatchNo && nextMatchNo !== currentMatchNo) || null;

  // ── Live score from match_stat_tbl ──
  let score = null;
  let scorers = [];
  let assists = [];

  if (currentDbRow) {
    score = {
      teamA: currentDbRow.team_a_goal ?? 0,
      teamB: currentDbRow.team_b_goal ?? 0
    };

    // Scorers: goal_status <= 2
    const scorerQ = `SELECT member_tbl.name, member_tbl.alias, match_goal_tbl.status as statusid, count(*) as goal
      FROM match_goal_tbl
      JOIN member_tbl ON match_goal_tbl.member_id = member_tbl.id
      WHERE match_goal_tbl.match_id = ${currentDbRow.id} AND match_goal_tbl.status <= 2
      GROUP BY member_tbl.id, match_goal_tbl.status`;
    const scorerRows = await executeQuery(scorerQ);
    scorers = scorerRows.map(r => ({
      name: r.alias && r.alias !== '' ? r.alias : r.name,
      goal: r.goal,
      ownGoal: r.statusid === 2
    }));

    // Assists: goal_status = 3
    const assistQ = `SELECT member_tbl.name, member_tbl.alias, count(*) as assist
      FROM match_goal_tbl
      JOIN member_tbl ON match_goal_tbl.member_id = member_tbl.id
      WHERE match_goal_tbl.match_id = ${currentDbRow.id} AND match_goal_tbl.status = 3
      GROUP BY member_tbl.id`;
    const assistRows = await executeQuery(assistQ);
    assists = assistRows.map(r => ({
      name: r.alias && r.alias !== '' ? r.alias : r.name,
      assist: r.assist
    }));
  }

  // ── Week table (team, GD, pts) ──
  let table = [];
  if (week && week.length > 0) {
    const tableRows = await queryTableWeek(week[0].id);
    if (tableRows && tableRows.length > 0) {
      table = tableRows.map(r => ({
        team: r.color,
        gd: (r.G - r.A),
        pts: r.pts
      }));
    }
  }

  return { currentMatch, nextMatch, score, scorers, assists, table, weekId: sched.weekId, date: sched.date };
}

module.exports = {
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
  updateMemberDebt,
  updateMemberWeek,
  updateMaxNumberWeek,
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
  getCurrentMatch
};