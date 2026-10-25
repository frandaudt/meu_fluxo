// src/controllers/servicosController.js
const { pool } = require('../config/db');

function formatarServico(servicoDb) {
  return {
    id: servicoDb.id,
    nome: servicoDb.nome,
    categoria: servicoDb.categoria,
    valor: servicoDb.valor,
    duracaoMin: servicoDb.duracao_min,
    // aparece no link de agendamento e no menu do bot (tela WhatsApp)
    mostrarNoBot: servicoDb.mostrar_no_bot === undefined ? true : !!servicoDb.mostrar_no_bot,
  };
}

async function listar(req, res) {
  try {
    const [linhas] = await pool.query(
      'SELECT id, nome, categoria, valor, duracao_min, mostrar_no_bot FROM servicos WHERE usuario_id = ? ORDER BY nome',
      [req.usuarioId]
    );
    res.json({ servicos: linhas.map(formatarServico) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar serviços.' });
  }
}

async function criar(req, res) {
  const { nome, categoria, valor, duracaoMin } = req.body;

  if (!nome || valor === undefined || valor === null) {
    return res.status(400).json({ erro: 'Nome e valor são obrigatórios.' });
  }

  const duracao = duracaoMin || 0;

  try {
    const [resultado] = await pool.query(
      'INSERT INTO servicos (usuario_id, nome, categoria, valor, duracao_min) VALUES (?, ?, ?, ?, ?)',
      [req.usuarioId, nome, categoria || null, valor, duracao]
    );

    res.status(201).json({
      servico: { id: resultado.insertId, nome, categoria: categoria || null, valor, duracaoMin: duracao, mostrarNoBot: true },
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar serviço.' });
  }
}

async function atualizar(req, res) {
  const { id } = req.params;
  const { nome, categoria, valor, duracaoMin } = req.body;

  if (!nome || valor === undefined || valor === null) {
    return res.status(400).json({ erro: 'Nome e valor são obrigatórios.' });
  }

  const duracao = duracaoMin || 0;

  try {
    const [resultado] = await pool.query(
      'UPDATE servicos SET nome = ?, categoria = ?, valor = ?, duracao_min = ? WHERE id = ? AND usuario_id = ?',
      [nome, categoria || null, valor, duracao, id, req.usuarioId]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Serviço não encontrado.' });
    }

    const [[linha]] = await pool.query('SELECT * FROM servicos WHERE id = ?', [id]);
    res.json({ servico: formatarServico(linha) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao atualizar serviço.' });
  }
}

async function remover(req, res) {
  const { id } = req.params;

  try {
    const [resultado] = await pool.query(
      'DELETE FROM servicos WHERE id = ? AND usuario_id = ?',
      [id, req.usuarioId]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Serviço não encontrado.' });
    }

    res.json({ mensagem: 'Serviço removido com sucesso.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao remover serviço.' });
  }
}

// PUT /api/servicos/:id/mostrar → { mostrarNoBot: true | false } (interruptor da tela WhatsApp)
async function alterarVisibilidade(req, res) {
  try {
    const [resultado] = await pool.query(
      'UPDATE servicos SET mostrar_no_bot = ? WHERE id = ? AND usuario_id = ?',
      [req.body.mostrarNoBot ? 1 : 0, req.params.id, req.usuarioId]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Serviço não encontrado.' });
    }
    res.json({ mostrarNoBot: !!req.body.mostrarNoBot });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao salvar.' });
  }
}

module.exports = { listar, criar, atualizar, remover, alterarVisibilidade };