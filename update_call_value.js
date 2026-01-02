const mysql = require('mysql2/promise');
require('dotenv').config({ quiet: true });

const dbConfig = {
    host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

async function executeUpdate() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('Connected to database.');

        // Correcting the typo from 'va;ue' to 'value'
        const query = "update template_tpl set value=0 where name='call'";
        console.log(`Executing query: ${query}`);

        const [result] = await connection.execute(query);
        console.log('Update success. Result:', result);
    } catch (error) {
        console.error('Update failed:', error);
    } finally {
        if (connection) {
            await connection.end();
            console.log('Connection closed.');
        }
    }
}

executeUpdate();
