const { pool } = require('../config/db');

function formatarMetaMensal(linha) {
  return {
    id: linha.id,
    mes: linha.periodo,
    tipo: linha.tipo_medida,
    valorAlvo: linha.valor_alvo,
  };
}

function formatarMetaAnual(linha) {
  return {
    id: linha.id,
    ano: Number(linha.periodo),
    valorAlvo: linha.valor_alvo,
  };
}

async function listarMensais(req, res) {
  try {
    const [linhas] = await pool.query(
      "SELECT * FROM metas WHERE usuario_id = ? AND tipo = 'mensal' ORDER BY periodo",
      [req.usuarioId]
    );
    res.json({ metas: linhas.map(formatarMetaMensal) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar metas mensais.' });
  }
}

async function criarMensal(req, res) {
  try {
    const { mes, tipo, valorAlvo } = req.body;

    if (!mes || !tipo || valorAlvo === undefined || valorAlvo === null) {
      return res.status(400).json({ erro: 'Preencha mês, tipo e valor alvo.' });
    }

    if (!['faturamento', 'clientes'].includes(tipo)) {
      return res.status(400).json({ erro: 'Tipo de meta inválido.' });
    }

    const [resultado] = await pool.query(
      "INSERT INTO metas (usuario_id, tipo, tipo_medida, periodo, valor_alvo) VALUES (?, 'mensal', ?, ?, ?)",
      [req.usuarioId, tipo, mes, valorAlvo]
    );

    const [linhas] = await pool.query('SELECT * FROM metas WHERE id = ?', [resultado.insertId]);
    res.status(201).json({ meta: formatarMetaMensal(linhas[0]) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar meta mensal.' });
  }
}

async function removerMensal(req, res) {
  try {
    const { id } = req.params;
    const [resultado] = await pool.query(
      "DELETE FROM metas WHERE id = ? AND usuario_id = ? AND tipo = 'mensal'",
      [id, req.usuarioId]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Meta não encontrada.' });
    }

    res.status(204).send();
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao remover meta mensal.' });
  }
}

async function listarAnuais(req, res) {
  try {
    const [linhas] = await pool.query(
      "SELECT * FROM metas WHERE usuario_id = ? AND tipo = 'anual' ORDER BY periodo",
      [req.usuarioId]
    );
    res.json({ metas: linhas.map(formatarMetaAnual) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar metas anuais.' });
  }
}

async function salvarAnual(req, res) {
  try {
    const { ano, valorAlvo } = req.body;

    if (!ano || valorAlvo === undefined || valorAlvo === null) {
      return res.status(400).json({ erro: 'Preencha o ano e o valor alvo.' });
    }

    const periodo = String(ano);

    const [existentes] = await pool.query(
      "SELECT id FROM metas WHERE usuario_id = ? AND tipo = 'anual' AND periodo = ?",
      [req.usuarioId, periodo]
    );

    let id;
    if (existentes.length > 0) {
      id = existentes[0].id;
      await pool.query('UPDATE metas SET valor_alvo = ? WHERE id = ?', [valorAlvo, id]);
    } else {
      const [resultado] = await pool.query(
        "INSERT INTO metas (usuario_id, tipo, tipo_medida, periodo, valor_alvo) VALUES (?, 'anual', NULL, ?, ?)",
        [req.usuarioId, periodo, valorAlvo]
      );
      id = resultado.insertId;
    }

    const [linhas] = await pool.query('SELECT * FROM metas WHERE id = ?', [id]);
    res.status(201).json({ meta: formatarMetaAnual(linhas[0]) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao salvar meta anual.' });
  }
}

module.exports = { listarMensais, criarMensal, removerMensal, listarAnuais, salvarAnual };