// src/config/db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true,
});

// Todo o sistema trabalha no horário de Brasília: assim NOW() e CURRENT_TIMESTAMP
// (pago_em, criado_em...) ficam com a hora certa, mesmo com o servidor em outro fuso.
pool.pool.on('connection', (conexao) => {
  conexao.query("SET time_zone = '-03:00'");
});

async function testarConexao() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
    console.log(`[DB] Conectado ao MySQL (banco "${process.env.DB_NAME}")`);
  } finally {
    conn.release();
  }
}

module.exports = { pool, testarConexao };