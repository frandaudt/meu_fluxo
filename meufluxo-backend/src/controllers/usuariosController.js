// src/controllers/usuariosController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { PERMISSOES, lerPermissoes } = require('../middlewares/auth');

// o token leva o papel e o dono, para o middleware saber de quem são os dados
function gerarToken(usuarioDb) {
  return jwt.sign(
    { id: usuarioDb.id, papel: usuarioDb.papel || 'dono', donoId: usuarioDb.dono_id || null },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// converte a linha do banco (nome_negocio) pro formato que o front usa (nomeNegocio)
function formatarUsuario(usuarioDb) {
  return {
    id: usuarioDb.id,
    nome: usuarioDb.nome,
    email: usuarioDb.email,
    telefone: usuarioDb.telefone,
    nomeNegocio: usuarioDb.nome_negocio,
    papel: usuarioDb.papel || 'dono',
    trocarSenha: !!usuarioDb.trocar_senha,
  };
}

/** Regra de senha (a mesma do front): mínimo 8 caracteres, uma maiúscula e um caractere especial. */
function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Z]/.test(senha)) return 'A senha precisa ter pelo menos uma letra maiúscula.';
  if (!/[^A-Za-z0-9]/.test(senha)) return 'A senha precisa ter pelo menos um caractere especial.';
  return null;
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
  const erroSenha = validarSenha(senha);
  if (erroSenha) {
    return res.status(400).json({ erro: erroSenha });
  }

  try {
    const senhaHash = await bcrypt.hash(senha, 10);

    const [resultado] = await pool.query(
      'INSERT INTO usuarios (nome, email, senha_hash, telefone, nome_negocio) VALUES (?, ?, ?, ?, ?)',
      [nome, email, senhaHash, telefone || null, nomeNegocio || null]
    );

    // quem se cadastra pela tela de cadastro é sempre o dono do negócio
    const usuarioDb = {
      id: resultado.insertId,
      nome,
      email,
      telefone: telefone || null,
      nome_negocio: nomeNegocio || null,
      papel: 'dono',
      dono_id: null,
      trocar_senha: 0,
    };

    res.status(201).json({ usuario: formatarUsuario(usuarioDb), token: gerarToken(usuarioDb) });
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

    // conta criada pelo "Continuar com Google" ainda não tem senha
    if (!usuarioDb.senha_hash) {
      return res.status(401).json({ erro: 'Essa conta entra pelo botão "Continuar com Google".' });
    }

    const senhaConfere = await bcrypt.compare(senha, usuarioDb.senha_hash);
    if (!senhaConfere) {
      return res.status(401).json({ erro: 'Email ou senha incorretos.' });
    }

    // usado na aba Equipe ("último acesso hoje")
    await pool.query('UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = ?', [usuarioDb.id]);

    res.json({ usuario: formatarUsuario(usuarioDb), token: gerarToken(usuarioDb) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login.' });
  }
}

async function obterPerfil(req, res) {
  try {
    const [linhas] = await pool.query(
      'SELECT id, nome, email, telefone, nome_negocio, papel, trocar_senha FROM usuarios WHERE id = ?',
      [req.usuarioLogadoId]
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
      [nome, email, telefone || null, nomeNegocio || null, req.usuarioLogadoId]
    );

    const [linhas] = await pool.query(
      'SELECT id, nome, email, telefone, nome_negocio, papel, trocar_senha FROM usuarios WHERE id = ?',
      [req.usuarioLogadoId]
    );
    res.json({ usuario: formatarUsuario(linhas[0]) });
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
  const erroSenha = validarSenha(novaSenha);
  if (erroSenha) {
    return res.status(400).json({ erro: erroSenha });
  }

  try {
    // sempre a senha de quem está logado (nunca a do dono, se for atendente)
    const [linhas] = await pool.query('SELECT senha_hash FROM usuarios WHERE id = ?', [req.usuarioLogadoId]);
    const usuarioDb = linhas[0];

    if (!usuarioDb || !usuarioDb.senha_hash) {
      return res.status(400).json({ erro: 'Essa conta entra pelo Google e ainda não tem senha.' });
    }

    const senhaConfere = await bcrypt.compare(senhaAtual, usuarioDb.senha_hash);
    if (!senhaConfere) {
      return res.status(401).json({ erro: 'Senha atual incorreta.' });
    }

    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);
    // trocar_senha = 0: o atendente que entrou com senha provisória já trocou
    await pool.query(
      'UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?',
      [novaSenhaHash, req.usuarioLogadoId]
    );

    res.json({ mensagem: 'Senha alterada com sucesso.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao trocar senha.' });
  }
}

// só o dono chega aqui (rota protegida com somenteDono)
async function excluirConta(req, res) {
  const usuarioId = req.usuarioId;
  const conexao = await pool.getConnection();

  try {
    await conexao.beginTransaction();

    // Ordem importa por causa das FKs: lista de espera e agendamentos
    // referenciam clientes e serviços, então saem primeiro.
    // (bloqueios, notificações, WhatsApp e códigos saem sozinhos pelo ON DELETE CASCADE)
    await conexao.query('DELETE FROM lista_espera WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM agendamentos WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM clientes WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM servicos WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM despesas WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM metas WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM horarios_trabalho WHERE usuario_id = ?', [usuarioId]);
    await conexao.query('DELETE FROM usuarios WHERE dono_id = ?', [usuarioId]); // atendentes
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
  validarSenha,
};