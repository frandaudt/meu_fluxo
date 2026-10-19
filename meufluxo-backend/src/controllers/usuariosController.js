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

// paletas do Perfil › Aparência (os nomes batem com o TEMAS_PRONTOS do front)
const PALETAS = ['salvia', 'oceano', 'lavanda', 'rose', 'terracota', 'grafite', 'personalizada'];
const COR_REGEX = /^#[0-9a-fA-F]{6}$/;

/** Linha do banco → aparência que o front aplica ao abrir o sistema. */
function formatarAparencia(linha) {
  return {
    paleta: PALETAS.includes(linha && linha.paleta) ? linha.paleta : 'salvia',
    corPrimaria: linha && linha.cor_primaria ? linha.cor_primaria : null,
    tamanhoTexto: linha && linha.tamanho_texto === 'grande' ? 'grande' : 'normal',
  };
}

/** A aparência vale para o negócio inteiro: o atendente usa a do dono. */
async function aparenciaDoNegocio(donoId) {
  const [linhas] = await pool.query(
    'SELECT paleta, cor_primaria, tamanho_texto FROM usuarios WHERE id = ?',
    [donoId]
  );
  return formatarAparencia(linhas[0]);
}

// converte a linha do banco (nome_negocio) pro formato que o front usa (nomeNegocio)
// aparencia: a do negócio (para o atendente, a do dono)
function formatarUsuario(usuarioDb, aparencia) {
  return {
    id: usuarioDb.id,
    nome: usuarioDb.nome,
    email: usuarioDb.email,
    telefone: usuarioDb.telefone,
    nomeNegocio: usuarioDb.nome_negocio,
    papel: usuarioDb.papel || 'dono',
    // o front usa para esconder menus e telas; quem garante mesmo é a API (permitir)
    permissoes: usuarioDb.papel === 'atendente' ? lerPermissoes(usuarioDb.permissoes) : PERMISSOES.slice(),
    trocarSenha: !!usuarioDb.trocar_senha,
    foto: usuarioDb.foto || null, // imagem 256x256 em base64 (ou null = mostra a inicial)
    aparencia: aparencia || formatarAparencia(usuarioDb),
  };
}

/** Busca o usuário logado já no formato do front (com a aparência do negócio). */
async function carregarUsuarioFormatado(id) {
  const [linhas] = await pool.query(
    `SELECT id, nome, email, telefone, nome_negocio, papel, dono_id, permissoes, trocar_senha,
            foto, paleta, cor_primaria, tamanho_texto
       FROM usuarios WHERE id = ?`,
    [id]
  );
  const usuarioDb = linhas[0];
  if (!usuarioDb) return null;
  const aparencia = usuarioDb.papel === 'atendente' && usuarioDb.dono_id
    ? await aparenciaDoNegocio(usuarioDb.dono_id)
    : formatarAparencia(usuarioDb);
  return formatarUsuario(usuarioDb, aparencia);
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

    res.json({ usuario: await carregarUsuarioFormatado(usuarioDb.id), token: gerarToken(usuarioDb) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login.' });
  }
}

async function obterPerfil(req, res) {
  try {
    const usuario = await carregarUsuarioFormatado(req.usuarioLogadoId);
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }
    res.json({ usuario });
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
    if (req.papel === 'atendente') {
      // o nome do negócio é do dono; o atendente muda só os próprios dados
      await pool.query(
        'UPDATE usuarios SET nome = ?, email = ?, telefone = ? WHERE id = ?',
        [nome, email, telefone || null, req.usuarioLogadoId]
      );
    } else {
      await pool.query(
        'UPDATE usuarios SET nome = ?, email = ?, telefone = ?, nome_negocio = ? WHERE id = ?',
        [nome, email, telefone || null, nomeNegocio || null, req.usuarioLogadoId]
      );
    }

    res.json({ usuario: await carregarUsuarioFormatado(req.usuarioLogadoId) });
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


// PUT /api/usuarios/foto → { foto: 'data:image/jpeg;base64,...' } ou { foto: null } para remover
// O front já manda a imagem recortada em 256x256 (fica bem pequena, uns 20 KB).
async function salvarFoto(req, res) {
  const { foto } = req.body;

  if (foto !== null) {
    if (typeof foto !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(foto)) {
      return res.status(400).json({ erro: 'Envie uma imagem JPG, PNG ou WEBP.' });
    }
    if (foto.length > 300 * 1024) {
      return res.status(400).json({ erro: 'A foto ficou grande demais. Escolha outra imagem.' });
    }
  }

  try {
    await pool.query('UPDATE usuarios SET foto = ? WHERE id = ?', [foto, req.usuarioLogadoId]);
    res.json({ usuario: await carregarUsuarioFormatado(req.usuarioLogadoId) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao salvar a foto.' });
  }
}

// GET /api/usuarios/aparencia → a aparência do negócio (o app aplica ao abrir)
async function obterAparencia(req, res) {
  try {
    res.json({ aparencia: await aparenciaDoNegocio(req.usuarioId) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar a aparência.' });
  }
}

// PUT /api/usuarios/aparencia → { paleta, corPrimaria, tamanhoTexto } (só o dono; vale para a equipe toda)
async function salvarAparencia(req, res) {
  const { paleta, corPrimaria, tamanhoTexto } = req.body;

  if (!PALETAS.includes(paleta)) {
    return res.status(400).json({ erro: 'Paleta inválida.' });
  }
  if (paleta === 'personalizada' && !COR_REGEX.test(String(corPrimaria || ''))) {
    return res.status(400).json({ erro: 'Escolha a cor principal.' });
  }
  if (!['normal', 'grande'].includes(tamanhoTexto)) {
    return res.status(400).json({ erro: 'Tamanho do texto inválido.' });
  }

  try {
    await pool.query(
      'UPDATE usuarios SET paleta = ?, cor_primaria = ?, tamanho_texto = ? WHERE id = ?',
      [paleta, paleta === 'personalizada' ? corPrimaria.toLowerCase() : null, tamanhoTexto, req.usuarioId]
    );
    res.json({ aparencia: await aparenciaDoNegocio(req.usuarioId) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao salvar a aparência.' });
  }
}

// GET /api/usuarios/exportar → tudo do negócio num objeto só (o front gera o .json)
// Backup + portabilidade (LGPD). Senha e login do Google nunca saem.
async function exportarDados(req, res) {
  const id = req.usuarioId;
  try {
    const [[perfil]] = await pool.query(
      `SELECT nome, email, telefone, nome_negocio, slug, descricao_negocio, endereco_negocio,
              paleta, cor_primaria, tamanho_texto
         FROM usuarios WHERE id = ?`,
      [id]
    );
    const consultar = async (sql) => (await pool.query(sql, [id]))[0];

    const dados = {
      sistema: 'MeuFluxo',
      versao: 1,
      exportadoEm: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
      perfil,
      equipe: await consultar("SELECT nome, email, permissoes, ultimo_acesso FROM usuarios WHERE dono_id = ? AND papel = 'atendente'"),
      clientes: await consultar('SELECT id, nome, telefone, email, endereco, origem, criado_em FROM clientes WHERE usuario_id = ? ORDER BY nome'),
      servicos: await consultar('SELECT * FROM servicos WHERE usuario_id = ? ORDER BY nome'),
      agendamentos: await consultar('SELECT * FROM agendamentos WHERE usuario_id = ? ORDER BY data, horario'),
      despesas: await consultar('SELECT * FROM despesas WHERE usuario_id = ? ORDER BY mes, id'),
      metas: await consultar('SELECT * FROM metas WHERE usuario_id = ? ORDER BY tipo, periodo'),
      horarioTrabalho: (await consultar('SELECT bloco_min, dias FROM horarios_trabalho WHERE usuario_id = ?'))[0] || null,
      folgas: await consultar('SELECT data, horario_inicio, horario_fim, motivo FROM bloqueios WHERE usuario_id = ? ORDER BY data'),
      listaEspera: await consultar('SELECT * FROM lista_espera WHERE usuario_id = ? ORDER BY criado_em'),
    };

    // o id do dono não interessa a quem lê o arquivo
    for (const lista of [dados.servicos, dados.agendamentos, dados.despesas, dados.metas, dados.listaEspera]) {
      for (const linha of lista) delete linha.usuario_id;
    }
    if (dados.horarioTrabalho && typeof dados.horarioTrabalho.dias === 'string') {
      try { dados.horarioTrabalho.dias = JSON.parse(dados.horarioTrabalho.dias); } catch {}
    }

    res.json(dados);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao juntar os seus dados.' });
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
  salvarFoto,
  obterAparencia,
  salvarAparencia,
  exportarDados,
  validarSenha,
};
