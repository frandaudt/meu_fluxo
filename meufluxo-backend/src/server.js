require('dotenv').config();

const app = require('./app');
const { testarConexao } = require('./config/db');

const PORT = process.env.PORT || 3001;

async function iniciar() {
  try {
    await testarConexao();
    app.listen(PORT, () => {
      console.log(`[Server] Rodando em http://localhost:${PORT}`);
    });
  } catch (erro) {
    console.error('[DB] Falha ao conectar no MySQL:', erro.message);
    process.exit(1);
  }
}

iniciar();