const { pool } = require('../config/db');

function formatarHorario(linha) {
  return {
    blocoMin: linha.bloco_min,
    dias: typeof linha.dias === 'string' ? JSON.parse(linha.dias) : linha.dias,
  };
}

async function obter(req, res) {
  try {
    const [linhas] = await pool.query(
      'SELECT * FROM horarios_trabalho WHERE usuario_id = ?',
      [req.usuarioId]
    );

    if (linhas.length === 0) {
      return res.json({ horario: null });
    }

    res.json({ horario: formatarHorario(linhas[0]) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar horário de trabalho.' });
  }
}

async function salvar(req, res) {
  try {
    const { blocoMin, dias } = req.body;

    if (![15, 30, 45, 60].includes(Number(blocoMin)) || !Array.isArray(dias) || dias.length !== 7) {
      return res.status(400).json({ erro: 'Horário de trabalho inválido.' });
    }

    const diasJson = JSON.stringify(dias);

    await pool.query(
      `INSERT INTO horarios_trabalho (usuario_id, bloco_min, dias)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE bloco_min = VALUES(bloco_min), dias = VALUES(dias)`,
      [req.usuarioId, blocoMin, diasJson]
    );

    const [linhas] = await pool.query(
      'SELECT * FROM horarios_trabalho WHERE usuario_id = ?',
      [req.usuarioId]
    );

    res.json({ horario: formatarHorario(linhas[0]) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao salvar horário de trabalho.' });
  }
}

module.exports = { obter, salvar };