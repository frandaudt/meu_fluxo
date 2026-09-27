// src/controllers/servicosController.js
const { pool } = require('../config/db');

function formatarServico(servicoDb) {
  return {
    id: servicoDb.id,
    nome: servicoDb.nome,
    categoria: servicoDb.categoria,
    valor: servicoDb.valor,
    duracaoMin: servicoDb.duracao_min,
  };
}

async function listar(req, res) {
  try {
    const [linhas] = await pool.query(
      'SELECT id, nome, categoria, valor, duracao_min FROM servicos WHERE usuario_id = ? ORDER BY nome',
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
      servico: { id: resultado.insertId, nome, categoria: categoria || null, valor, duracaoMin: duracao },
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

    res.json({ servico: { id: Number(id), nome, categoria: categoria || null, valor, duracaoMin: duracao } });
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

module.exports = { listar, criar, atualizar, remover };