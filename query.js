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
    if (type == 0) {
        const res = await queryWeekID() ;
        
        if (res.length > 0) {
            if (res.length > 0) {
                const week_id = res[0].id ;
                const query = "select * from member_team_week_tbl where week_id=" +  week_id;
                const res = await executeQuery(query) ;
                console.log(res) ;
            }
            
        }
        
    }

}

module.exports = {
  testConnection,
  executeQuery,
  queryWeekID,
  getMemberWeek
};