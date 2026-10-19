// src/controllers/equipeController.js
// Atendentes do negócio. Todas as rotas são só do dono (somenteDono).
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { validarSenha } = require('./usuariosController'); // mesma regra de senha do cadastro
const { PERMISSOES, lerPermissoes } = require('../middlewares/auth');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatarPessoa(linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    foto: linha.foto || null,
    papel: linha.papel,
    permissoes: linha.papel === 'atendente' ? lerPermissoes(linha.permissoes) : PERMISSOES.slice(),
    ultimoAcesso: linha.ultimo_acesso, // null = "ainda não entrou"
  };
}

/** Aceita só permissões conhecidas, sem repetir (o que vier diferente é ignorado). */
function limparPermissoes(lista) {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.filter(p => PERMISSOES.includes(p)))];
}

// GET /api/equipe → o dono + os atendentes dele
async function listar(req, res) {
  try {
    const [linhas] = await pool.query(
      `SELECT id, nome, email, papel, permissoes, ultimo_acesso, foto
         FROM usuarios
        WHERE id = ? OR dono_id = ?
        ORDER BY papel = 'atendente', nome`,
      [req.usuarioId, req.usuarioId]
    );
    // a lista de permissões vai junto para o front montar as caixas de marcar
    res.json({ equipe: linhas.map(formatarPessoa), permissoesDisponiveis: PERMISSOES });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar a equipe.' });
  }
}

// POST /api/equipe → cria um atendente com senha provisória e as permissões marcadas
async function criar(req, res) {
  const { nome, email, senha } = req.body;
  const permissoes = limparPermissoes(req.body.permissoes);

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Preencha nome, e-mail e senha provisória.' });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ erro: 'Digite um e-mail válido.' });
  }
  const erroSenha = validarSenha(senha);
  if (erroSenha) {
    return res.status(400).json({ erro: erroSenha });
  }

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    // trocar_senha = 1: no primeiro acesso, o atendente troca a senha provisória
    const [resultado] = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, papel, dono_id, trocar_senha, permissoes)
       VALUES (?, ?, ?, 'atendente', ?, 1, ?)`,
      [nome, email, senhaHash, req.usuarioId, JSON.stringify(permissoes)]
    );

    const [linhas] = await pool.query(
      'SELECT id, nome, email, papel, permissoes, ultimo_acesso FROM usuarios WHERE id = ?',
      [resultado.insertId]
    );
    res.status(201).json({ pessoa: formatarPessoa(linhas[0]) });
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erro: 'Esse e-mail já está cadastrado no MeuFluxo.' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar o acesso.' });
  }
}

// PUT /api/equipe/:id/senha → o dono define uma nova senha provisória
async function redefinirSenha(req, res) {
  const { id } = req.params;
  const { senha } = req.body;

  const erroSenha = validarSenha(senha);
  if (erroSenha) {
    return res.status(400).json({ erro: erroSenha });
  }

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    // só altera atendentes DESTE dono
    const [resultado] = await pool.query(
      `UPDATE usuarios SET senha_hash = ?, trocar_senha = 1
        WHERE id = ? AND dono_id = ? AND papel = 'atendente'`,
      [senhaHash, id, req.usuarioId]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Atendente não encontrado.' });
    }
    res.json({ mensagem: 'Senha redefinida. A pessoa troca no próximo acesso.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao redefinir a senha.' });
  }
}

// PUT /api/equipe/:id/permissoes → o dono marca/desmarca as caixas
// body: { permissoes: ['financeiro', 'servicos', ...] }  (lista vazia = só o básico)
async function atualizarPermissoes(req, res) {
  const { id } = req.params;
  const permissoes = limparPermissoes(req.body.permissoes);

  try {
    const [resultado] = await pool.query(
      `UPDATE usuarios SET permissoes = ?
        WHERE id = ? AND dono_id = ? AND papel = 'atendente'`,
      [JSON.stringify(permissoes), id, req.usuarioId]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Atendente não encontrado.' });
    }
    res.json({ permissoes });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao salvar as permissões.' });
  }
}

// DELETE /api/equipe/:id → remove o acesso do atendente
// (os agendamentos e pagamentos que ele registrou continuam; criado_por/recebido_por viram NULL)
async function remover(req, res) {
  const { id } = req.params;
  try {
    const [resultado] = await pool.query(
      "DELETE FROM usuarios WHERE id = ? AND dono_id = ? AND papel = 'atendente'",
      [id, req.usuarioId]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Atendente não encontrado.' });
    }
    res.json({ mensagem: 'Acesso removido.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao remover o acesso.' });
  }
}

module.exports = { listar, criar, redefinirSenha, atualizarPermissoes, remover };
