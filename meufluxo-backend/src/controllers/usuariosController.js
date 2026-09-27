// src/controllers/usuariosController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

function gerarToken(usuarioId) {
  return jwt.sign({ id: usuarioId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// converte a linha do banco (nome_negocio) pro formato que o front usa (nomeNegocio)
function formatarUsuario(usuarioDb) {
  return {
    id: usuarioDb.id,
    nome: usuarioDb.nome,
    email: usuarioDb.email,
    telefone: usuarioDb.telefone,
    nomeNegocio: usuarioDb.nome_negocio,
  };
}

async function cadastrar(req, res) {
  const { nome, email, senha, telefone, nomeNegocio } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios.' });
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ erro: 'Digite um e-mail válido.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  }
  if (!/[A-Z]/.test(senha)) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos uma letra maiúscula.' });
  }
  if (!/[^A-Za-z0-9]/.test(senha)) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos um caractere especial.' });
  }


  try {
    const senhaHash = await bcrypt.hash(senha, 10);

    const [resultado] = await pool.query(
      'INSERT INTO usuarios (nome, email, senha_hash, telefone, nome_negocio) VALUES (?, ?, ?, ?, ?)',
      [nome, email, senhaHash, telefone || null, nomeNegocio || null]
    );

    const usuario = {
      id: resultado.insertId,
      nome,
      email,
      telefone: telefone || null,
      nomeNegocio: nomeNegocio || null,
    };

    const token = gerarToken(usuario.id);
    res.status(201).json({ usuario, token });
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erro: 'Esse email já está cadastrado.' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar usuário.' });
  }
}

async function login(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios.' });
  }

  try {
    const [linhas] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]);
    const usuarioDb = linhas[0];

    if (!usuarioDb) {
      return res.status(401).json({ erro: 'Email ou senha incorretos.' });
    }

    const senhaConfere = await bcrypt.compare(senha, usuarioDb.senha_hash);
    if (!senhaConfere) {
      return res.status(401).json({ erro: 'Email ou senha incorretos.' });
    }

    const token = gerarToken(usuarioDb.id);
    res.json({ usuario: formatarUsuario(usuarioDb), token });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login.' });
  }
}

async function obterPerfil(req, res) {
  try {
    const [linhas] = await pool.query(
      'SELECT id, nome, email, telefone, nome_negocio FROM usuarios WHERE id = ?',
      [req.usuarioId]
    );
    const usuarioDb = linhas[0];
    if (!usuarioDb) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }
    res.json({ usuario: formatarUsuario(usuarioDb) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar perfil.' });
  }
}

async function atualizarPerfil(req, res) {
  const { nome, email, telefone, nomeNegocio } = req.body;

  if (!nome || !email) {
    return res.status(400).json({ erro: 'Nome e email são obrigatórios.' });
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ erro: 'Digite um e-mail válido.' });
  }

  try {
    await pool.query(
      'UPDATE usuarios SET nome = ?, email = ?, telefone = ?, nome_negocio = ? WHERE id = ?',
      [nome, email, telefone || null, nomeNegocio || null, req.usuarioId]
    );

    res.json({
      usuario: {
        id: req.usuarioId,
        nome,
        email,
        telefone: telefone || null,
        nomeNegocio: nomeNegocio || null,
      },
    });
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erro: 'Esse email já está em uso por outra conta.' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao atualizar perfil.' });
  }
}

async function trocarSenha(req, res) {
  const { senhaAtual, novaSenha } = req.body;

  if (!senhaAtual || !novaSenha) {
    return res.status(400).json({ erro: 'Informe a senha atual e a nova senha.' });
  }
  if (novaSenha.length < 6) {
    return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 6 caracteres.' });
  }
  if (novaSenha.length < 6) {
  return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 6 caracteres.' });
  }
  if (!/[A-Z]/.test(novaSenha)) {
    return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos uma letra maiúscula.' });
  }
  if (!/[^A-Za-z0-9]/.test(novaSenha)) {
    return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos um caractere especial.' });
  }

  try {
    const [linhas] = await pool.query('SELECT senha_hash FROM usuarios WHERE id = ?', [req.usuarioId]);
    const usuarioDb = linhas[0];

    const senhaConfere = await bcrypt.compare(senhaAtual, usuarioDb.senha_hash);
    if (!senhaConfere) {
      return res.status(401).json({ erro: 'Senha atual incorreta.' });
    }

    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);
    await pool.query('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [novaSenhaHash, req.usuarioId]);

    res.json({ mensagem: 'Senha alterada com sucesso.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao trocar senha.' });
  }
}

async function excluirConta(req, res) {
  const usuarioId = req.usuarioId;
  const conexao = await pool.getConnection();

  try {
    await conexao.beginTransaction();

    // Ordem importa por causa das FKs: agendamentos referencia
    // clientes e serviços, então ele sai primeiro.
    await conexao.query('DELETE FROM agendamentos WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM clientes WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM servicos WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM despesas WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM metas WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM horarios_trabalho WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM usuarios WHERE id = ?', [usuarioId]);

    await conexao.commit();
    res.status(200).json({ mensagem: 'Conta excluída com sucesso.' });
  } catch (erro) {
    await conexao.rollback();
    console.error('Erro ao excluir conta:', erro);
    res.status(500).json({ erro: 'Não foi possível excluir a conta.' });
  } finally {
    conexao.release();
  }
}

module.exports = {
  cadastrar,
  login,
  obterPerfil,
  atualizarPerfil,
  trocarSenha,
  excluirConta,
};
