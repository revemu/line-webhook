const mysql = require('mysql2/promise');
require('dotenv').config();

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
const pool = mysql.createPool(dbConfig);

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
    throw error;
  }
}

async function queryWeekID() {
    const query = "SELECT id, number, DATE_FORMAT(date, '%e %b %Y') as date FROM week_tbl ORDER BY NUMBER DESC LIMIT 1" ;
    const res = await executeQuery(query) ;
    console.log(res) ;
    return res ;
}

async function getMemberWeek(type = 0) {
    let header ;
    let body ;
    let query ;
    const res = await queryWeekID() ;
    
    if (res.length > 0) {
            const week_id = res[0].id ;
            query = "select * from member_team_week_tbl where week_id=" + week_id;
            if (type == 0) {
                header = " คนที่ยังไมได้จ่ายค่าสนาม" ;
                query += " and pay=0" ; 
            }
            
            const result = await executeQuery(query) ;
            if (result.length > 0) {
                let header = result.length + header + "\n\n";
                let i = 0;
                for (const member of result) {
                    body += i + ". " + member.name + "\n";
                    i++ ;
                }
                console.log(header + body)
            }
            
            
    }
        
}
        

module.exports = {
  testConnection,
  executeQuery,
  queryWeekID,
  getMemberWeek
};