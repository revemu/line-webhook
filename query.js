const mysql = require('mysql2/promise');
require('dotenv').config();
const flex = require('./flex');

const dbConfig = {
  host: process.env.DB_HOST ,
  user: process.env.DB_USER ,
  password: process.env.DB_PASSWORD ,
  database: process.env.DB_NAME ,
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
    console.log(error) ;
    throw error;
  }
}

async function updateMemberWeek(member_id, value, type = 0) {
  const week = await queryWeekID() ;
  if (week.length > 0) {
    const week_id = week[0].id ;
    let query ;
    if (type == 0) {
      query = `update member_team_week_tbl set pay=${value} where member_id=${member_id} and week_id=${week_id}`
    }

    const res = await executeQuery(query) ;
    //console.log(res) ;
    return res ;
  }
}

async function queryWeekID() {
    const query = "SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date FROM week_tbl ORDER BY NUMBER DESC LIMIT 1" ;
    const res = await executeQuery(query) ;
    //console.log(res) ;
    return res ;
}

async function unregisterMember(member_id) {
    const week = await queryWeekID() ;
    if (week.length > 0) {
      const week_id = week[0].id ;
      const query = `SELECT * from member_team_week_tbl where week_id=${week_id} and member_id=${member_id}`  ;
      const res = await executeQuery(query) ;
      //console.log(`${res.length}`)
      if (res.length > 0) {
        //console.log(`${week_id}`)
        const query = `delete from member_team_week_tbl where member_id=${member_id} and week_id=${week_id}` ;
        //console.log(query) ;
        const reg_res = await executeQuery(query) ;
        //console.log(reg_res) ;
        return true ;
      } else {
        return false ;
      }
    }
    //console.log(res) ;
    return false ;
}

async function registerMember(member_id, member_name) {
    const week = await queryWeekID() ;
    if (week.length > 0) {
      const week_id = week[0].id ;
      const query = `SELECT * from member_team_week_tbl where week_id=${week_id} and member_id=${member_id}`  ;
      const res = await executeQuery(query) ;
      //console.log(`${res.length}`)
      if (res.length > 0) {
        //console.log(`${week_id}`)
        return false ;
      } else {
        const query = `insert into member_team_week_tbl values('',${member_id}, '${member_name}', 0, ${week_id}, 0, 0)`
        //console.log(query) ;
        const reg_res = await executeQuery(query) ;
        //console.log(reg_res) ;
        return true ;
      }
    }
    //console.log(res) ;
    return false ;
}

async function queryMemberbyLineID(lineId) {
    const query = `SELECT * FROM member_tbl where line_user_id='${lineId}'` ;
    const res = await executeQuery(query) ;
    //console.log(res) ;
    return res ;
}

async function queryMemberbyName(name) {
    const query = `SELECT * FROM member_tbl where name='${name}'` ;
    const res = await executeQuery(query) ;
    //console.log(res) ;
    return res ;
}

async function queryMatchGoal(match_id, goal_status = 0) {
  let status ;
  if (goal_status == 0) {
    status = " < 2"
  }
  query = `SELECT member_tbl.name, member_tbl.alias, goal_status_tbl.status,match_goal_tbl.status as statusid, count(*) as goal FROM match_goal_tbl, member_tbl, goal_status_tbl WHERE match_goal_tbl.match_id=${match_id} and match_goal_tbl.member_id = member_tbl.id and match_goal_tbl.status ${status} and match_goal_tbl.status=goal_status_tbl.id group by member_tbl.id`
  const match_goals = await executeQuery(query) ;
  if (res.length > 0) {
    for (const member of match_goals) {
      console.log(member) ;
    }
  }
}

async function getTeamColorWeek(week_id) {

    query = `select team_color_week_tbl.id, team_color_week_tbl.color,  template_tpl.url, template_tpl.code from team_color_week_tbl, template_tpl where week_id=${week_id} and team_color_week_tbl.color = template_tpl.value`;
    
    const result = await executeQuery(query) ;
    if (result.length > 0) {
        return result ;
    }
        
}

async function getTeamColor(color) {
  query = `select * from template_tpl where name='team_color' and value='${color}'`  ;
    
    const result = await executeQuery(query) ;
    if (result.length > 0) {
        return result[0] ;
    }
}

async function queryMatchWeek(week_id) {
  query = `SELECT * FROM match_stat_tbl where week_id = ${week_id} order by match_num`  ;
    
    const result = await executeQuery(query) ;
    if (result.length > 0) {
        return result ;
    }
}

async function getMatchWeek(type = 0) {

    let query = "";
    const res = await queryWeekID() ;
    
    if (res.length > 0) {
        //const week_id = res[0].id ;
        const week_id = 271 ;
        const matches = await queryMatchWeek(week_id) ;
        
        if (matches.length > 0) {
            const bubble =  JSON.parse(JSON.stringify(flex.tpl_bubble)) ;
            bubble.size = "mega" ;
            bubble.hero.url = 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg' ;
            //bubble.hero.url = teamColor.url ;
            bubble.hero.aspectRatio = "12:6"

            bubble.body.contents = [] ;
                
            bubble.body.contents.push(
              {
                type: "text",
                text: `Match Week`,
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
            ) ;
            //var bubble = new Array(team_colors.length) ;
            var i = 0 ;
            let team_colors = await getTeamColorWeek(week_id) ;
            //team_colors = team_colors[0] ;
            console.log(team_colors) ;
            for (const match of matches) {
                //const teamColor = await getTeamColor(team.color) ;
                //const bubble =  Object.assign({}, flex.tpl_bubble);
                const team_a = team_colors.filter(team => team.id === match.team_a_id)[0] ;
                const team_b = team_colors.filter(team => team.id === match.team_b_id)[0] ;
                console.log(team_a) ;
                console.log(team_b) ;
                console.log(`${match.team_a_id} a: ${team_a.color}, ${match.team_b_id} b: ${team_b.color}`)
                console.log(match) ;

                const match_box = {
                    "type": "box",
                    "layout": "baseline",
                    "margin": "md",
                    "contents": [
                    {
                      "type": "text",
                      "text": `Match [${match.match_num}]`,
                      "flex": 0,
                      "weight": "bold",
                      "align": "center",
                      "size": "sm"
                    },
                            {
                      "type": "text",
                      "text": team_a.color,
                      "color": team_a.code,
                      "weight": "bold",
                      "align": "center",
                      "flex": 1,
                      "size": "sm"
                    },
                    {
                      "type": "text",
                      "text": `${match.team_a_goal} - ${match.team_b_goal}`,
                      "flex": 1,
                      "align": "center",
                      "size": "sm"
                      
                    },
                    {
                      "type": "text",
                      "text": team_b.color,
                      "color": team_b.code,
                      "weight": "bold",
                      "flex": 1,
                      "align": "center",
                      "size": "sm"
                    }
                    ],
                    "spacing": "xl"
                  }
                await queryMatchGoal(match.id, 0) ;
                bubble.body.contents.push(match_box) ;
                
                //let msg = [] ;
                
                 
                
                //console.log(JSON.stringify(carousel)) ;
                i++ ;
                break ;
            }
            console.log(JSON.stringify(bubble)) ;
            return bubble ;
        }
                   
    }
        
}

async function getTeamWeek(type = 0) {

    let query = "";
    const res = await queryWeekID() ;
    
    if (res.length > 0) {
        //const week_id = res[0].id ;
        const week_id = 271 ;
        const team_colors = await getTeamColorWeek(week_id) ;
        //let bubble = flex.tpl_bubble ;
        let carousel = flex.tpl_carousel ;
        
        if (team_colors.length > 0) {
            carousel.contents = [] ;
            //var bubble = new Array(team_colors.length) ;
            var i = 0 ;
            for (const team of team_colors) {
                const bubble =  JSON.parse(JSON.stringify(flex.tpl_bubble)) ;
                const teamColor = await getTeamColor(team.color) ;
                //const bubble =  Object.assign({}, flex.tpl_bubble);
                console.log(team.color) ;
                bubble.size = "micro" ;
                //bubble.hero.url = 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg' ;
                bubble.hero.url = teamColor.url ;
                bubble.hero.aspectRatio = "12:6"
                
                //let msg = [] ;
                bubble.body.contents = [] ;
                
                bubble.body.contents.push(
                  {
                    type: "text",
                    text: `${team.color}`,
                    weight: "bold",
                    size: "lg",
                    align: "center",
                    color: teamColor.code
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
                ) ;
                 
                
                query = `select * from member_team_week_tbl where week_id=${ week_id} and team_id=${team.id}`;
                //console.log(team_color) ;
                const team_members = await executeQuery(query) ;
                if (team_members.length > 0) {
                    for (const member of team_members) {
                        bubble.body.contents.push( 
                        {
                            "type": "text",
                            "text": `${member.name.replace('@','')}`,
                            "weight": "regular",
                            "size": "sm",
                            "align": "center"
                        }) ;
                    }
                }
                    //bubble.contents = msg ; 
                
                //bubble.contents = msg ;
                //console.log(bubble.body.contents) ; 

                carousel.contents.push(bubble) ; 
                //console.log(JSON.stringify(carousel)) ;
                i++ ;
                //break ;
            }
            console.log(JSON.stringify(carousel)) ;
            return carousel ;
        }
                   
    }
        
}

async function getMemberWeek() {
    let header = "";
    let body = "";
    let query = "";
    let start = ""
    const res = await queryWeekID() ;
    
    if (res.length > 0) {
        const week_id = res[0].id ;
        query = "select * from member_team_week_tbl where week_id=" + week_id;
        if (type == 0) {
            header = " คนที่ยังไมได้จ่ายค่าสนาม" ;
            query += " and pay=0" ; 
        } else if (type == 1) {
            header = " ลงชื่อเตะบอล" ; 
            start = "+"
        }
        
        const result = await executeQuery(query) ;
        if (result.length > 0) {
            header = start + result.length + header + " เสาร์ที่ " +res[0].date + "\n\n";
            let i = 0;
            for (const member of result) {
                body += (i+1) + ". " + member.name + "\n";
                i++ ;
            }
            //console.log(header + body) ;
            return header + body ;
            
        }               
    }
        
}

async function getTopStat(limit = 10, type = 0) {
    let header = "";
    let body = "";
    let query = "";
    let start = ""
    let status = "" ;
    let msg = [] ;
    if (type < 2) {
      status = "and match_goal_tbl.status < 2" ;
      //header = " Top Scorer    " ;
      
    }
    query = `SELECT member_tbl.name, member_tbl.alias, goal_status_tbl.status, 
match_goal_tbl.status as statusid, count(*) as goal 
FROM match_goal_tbl, member_tbl, goal_status_tbl , match_stat_tbl , week_tbl
WHERE match_goal_tbl.member_id = member_tbl.id ${status}
and match_goal_tbl.status=goal_status_tbl.id
AND match_goal_tbl.match_id = match_stat_tbl.id AND match_stat_tbl.week_id = week_tbl.id 
And YEAR(week_tbl.date) = YEAR(CURRENT_DATE()) and member_tbl.id <> 121 and member_tbl.id <> 169 and member_tbl.id < 9000
group by member_tbl.id order by goal DESC limit ${limit}` ;
    
    const result = await executeQuery(query) ;
    if (result.length > 0) {
        let i = 0;
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        msg.push( 
        {
            "type": "text",
            "text": `${currentYear} Top Scorer`,
            "weight": "bold",
            "size": "xl",
            "align": "center"
        }
      ) ;
        for (const member of result) {
            //body += `${i+1}. ${member.name}  ${member.goal} `;
            msg.push( {
                    "type": "box",
                    "layout": "baseline",
                    "margin": "xs",
                    "contents": [
                      {
                        "type": "text",
                        "text": `${i+1}. ${member.name}`,
                        "weight": "regular",
                        "size": "md",
                        "align": "start"
                      },
                      {
                        "type": "text",
                        "text": `${member.goal}`,
                        "weight": "regular",
                        "size": "md",
                        "align": "end"
                      }
                    ]
                }) ;
            i++ ;
        }
        //console.log(header + body) ;
        return JSON.stringify(msg) ;
        
    }               

        
}
        

module.exports = {
  testConnection,
  executeQuery,
  queryWeekID,
  getTeamWeek,
  getMemberWeek,
  getMatchWeek,
  updateMemberWeek,
  queryMemberbyLineID,
  queryMemberbyName,
  registerMember,
  unregisterMember,
  getTopStat
};