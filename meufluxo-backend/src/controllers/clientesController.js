// src/controllers/clientesController.js
const { pool } = require('../config/db');

async function listar(req, res) {
  try {
    const [linhas] = await pool.query(
      'SELECT id, nome, telefone, email, endereco FROM clientes WHERE usuario_id = ? ORDER BY nome',
      [req.usuarioId]
    );
    res.json({ clientes: linhas });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar clientes.' });
  }
}

async function criar(req, res) {
  const { nome, telefone, email, endereco } = req.body;

  if (!nome) {
    return res.status(400).json({ erro: 'O nome do cliente é obrigatório.' });
  }

  if (telefone && telefone.length > 15) {
    return res.status(400).json({ erro: 'O telefone informado está incorreto.' });
  }

  if (email) {
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ erro: 'Digite um e-mail válido.' });
    }
  }

  try {
    const [resultado] = await pool.query(
      'INSERT INTO clientes (usuario_id, nome, telefone, email, endereco) VALUES (?, ?, ?, ?, ?)',
      [req.usuarioId, nome, telefone || null, email || null, endereco || null]
    );

    res.status(201).json({
      cliente: { id: resultado.insertId, nome, telefone: telefone || null, email: email || null, endereco: endereco || null },
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar cliente.' });
  }
}

async function atualizar(req, res) {
  const { id } = req.params;
  const { nome, telefone, email, endereco } = req.body;

  if (!nome) {
    return res.status(400).json({ erro: 'O nome do cliente é obrigatório.' });
  }

  if (telefone && telefone.length > 15) {
    return res.status(400).json({ erro: 'O telefone informado está incorreto.' });
  }

  if (email) {
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ erro: 'Digite um e-mail válido.' });
    }
  }

  try {
    const [resultado] = await pool.query(
      'UPDATE clientes SET nome = ?, telefone = ?, email = ?, endereco = ? WHERE id = ? AND usuario_id = ?',
      [nome, telefone || null, email || null, endereco || null, id, req.usuarioId]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado.' });
    }

    res.json({ cliente: { id: Number(id), nome, telefone: telefone || null, email: email || null, endereco: endereco || null } });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao atualizar cliente.' });
  }
}

async function remover(req, res) {
  const { id } = req.params;

  try {
    const [resultado] = await pool.query(
      'DELETE FROM clientes WHERE id = ? AND usuario_id = ?',
      [id, req.usuarioId]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado.' });
    }

    res.json({ mensagem: 'Cliente removido com sucesso.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao remover cliente.' });
  }
}

module.exports = { listar, criar, atualizar, remover };
