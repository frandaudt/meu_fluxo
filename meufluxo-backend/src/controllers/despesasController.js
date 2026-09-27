const { pool } = require('../config/db');

function formatarDespesa(linha) {
  return {
    id: linha.id,
    descricao: linha.descricao,
    valor: linha.valor,
    tipo: linha.tipo,
    mes: typeof linha.mes === 'string' ? linha.mes.slice(0, 7) : linha.mes,
  };
}

async function listar(req, res) {
  try {
    const [linhas] = await pool.query(
      'SELECT * FROM despesas WHERE usuario_id = ? ORDER BY mes DESC, id DESC',
      [req.usuarioId]
    );
    res.json({ despesas: linhas.map(formatarDespesa) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar despesas.' });
  }
}

async function criar(req, res) {
  try {
    const { descricao, valor, tipo, mes } = req.body;

    if (!descricao || valor === undefined || valor === null || !tipo || !mes) {
      return res.status(400).json({ erro: 'Preencha descrição, valor, tipo e mês.' });
    }

    if (!['fixa', 'emergencial'].includes(tipo)) {
      return res.status(400).json({ erro: 'Tipo inválido.' });
    }

    const mesData = `${mes}-01`;

    const [resultado] = await pool.query(
      'INSERT INTO despesas (usuario_id, descricao, valor, tipo, mes) VALUES (?, ?, ?, ?, ?)',
      [req.usuarioId, descricao, valor, tipo, mesData]
    );

    const [linhas] = await pool.query('SELECT * FROM despesas WHERE id = ?', [resultado.insertId]);
    res.status(201).json({ despesa: formatarDespesa(linhas[0]) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar despesa.' });
  }
}

async function remover(req, res) {
  try {
    const { id } = req.params;
    const [resultado] = await pool.query(
      'DELETE FROM despesas WHERE id = ? AND usuario_id = ?',
      [id, req.usuarioId]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Despesa não encontrada.' });
    }

    res.status(204).send();
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao remover despesa.' });
  }
}

module.exports = { listar, criar, remover };