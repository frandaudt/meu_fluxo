// src/controllers/usuariosController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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

/**
 * Linha do banco → aparência que o front aplica ao abrir o sistema.
 * Personalizada: cor_primaria + (opcionais) cor_acento e cor_destaque.
 * Sem acento/destaque, o front calcula pelo círculo cromático.
 */
function formatarAparencia(linha) {
  const cor = (valor) => (valor && COR_REGEX.test(valor) ? String(valor).toLowerCase() : null);
  return {
    paleta: PALETAS.includes(linha && linha.paleta) ? linha.paleta : 'salvia',
    corPrimaria: cor(linha && linha.cor_primaria),
    corAcento: cor(linha && linha.cor_acento),
    corDestaque: cor(linha && linha.cor_destaque),
    tamanhoTexto: linha && linha.tamanho_texto === 'grande' ? 'grande' : 'normal',
  };
}

/** A aparência vale para o negócio inteiro: o atendente usa a do dono. */
async function aparenciaDoNegocio(donoId) {
  // SELECT * para continuar funcionando mesmo antes de criar as colunas cor_acento / cor_destaque
  const [linhas] = await pool.query(
    'SELECT * FROM usuarios WHERE id = ?',
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
    temSenha: usuarioDb.senha_hash === undefined ? true : !!usuarioDb.senha_hash, // conta só do Google: false
    temGoogle: !!usuarioDb.google_id,
    foto: usuarioDb.foto || null, // imagem 256x256 em base64 (ou null = mostra a inicial)
    aparencia: aparencia || formatarAparencia(usuarioDb),
  };
}

/** Busca o usuário logado já no formato do front (com a aparência do negócio). */
async function carregarUsuarioFormatado(id) {
  const [linhas] = await pool.query(
    'SELECT * FROM usuarios WHERE id = ?', // o formatarUsuario escolhe o que sai (a senha nunca sai)
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

// PUT /api/usuarios/aparencia → { paleta, corPrimaria, corAcento, corDestaque, tamanhoTexto }
// (só o dono; vale para a equipe toda). Acento e destaque vazios = calculados pelo círculo cromático.
async function salvarAparencia(req, res) {
  const { paleta, corPrimaria, tamanhoTexto } = req.body;
  const corAcento = req.body.corAcento || null;
  const corDestaque = req.body.corDestaque || null;

  if (!PALETAS.includes(paleta)) {
    return res.status(400).json({ erro: 'Paleta inválida.' });
  }
  if (paleta === 'personalizada' && !COR_REGEX.test(String(corPrimaria || ''))) {
    return res.status(400).json({ erro: 'Escolha a cor principal.' });
  }
  if ((corAcento && !COR_REGEX.test(corAcento)) || (corDestaque && !COR_REGEX.test(corDestaque))) {
    return res.status(400).json({ erro: 'Cor de acento ou de destaque inválida.' });
  }
  if (!['normal', 'grande'].includes(tamanhoTexto)) {
    return res.status(400).json({ erro: 'Tamanho do texto inválido.' });
  }

  try {
    const personalizada = paleta === 'personalizada';
    await pool.query(
      'UPDATE usuarios SET paleta = ?, cor_primaria = ?, cor_acento = ?, cor_destaque = ?, tamanho_texto = ? WHERE id = ?',
      [
        paleta,
        personalizada ? corPrimaria.toLowerCase() : null,
        personalizada && corAcento ? corAcento.toLowerCase() : null,
        personalizada && corDestaque ? corDestaque.toLowerCase() : null,
        tamanhoTexto,
        req.usuarioId,
      ]
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

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

/** "Studio Francisco Beleza" → "studio-francisco-beleza" (sem acento, só letras, números e hífen). */
function gerarSlug(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'meu-negocio';
}

function formatarLink(linha) {
  return {
    slug: linha.slug,
    linkAtivo: !!linha.link_ativo,
    nomeNegocio: linha.nome_negocio || linha.nome,
    descricaoNegocio: linha.descricao_negocio || '',
    enderecoNegocio: linha.endereco_negocio || '',
  };
}

// GET /api/usuarios/link → endereço do link de agendamento (cria um na primeira vez)
async function obterLink(req, res) {
  try {
    const [[dono]] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [req.usuarioId]);
    if (!dono) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    if (!dono.slug) {
      // primeira vez: cria a partir do nome do negócio (ou do nome), sem repetir o de outro negócio
      const base = gerarSlug(dono.nome_negocio || dono.nome);
      for (let n = 1; n < 50 && !dono.slug; n++) {
        const tentativa = n === 1 ? base : `${base}-${n}`;
        try {
          await pool.query('UPDATE usuarios SET slug = ? WHERE id = ? AND slug IS NULL', [tentativa, req.usuarioId]);
          dono.slug = tentativa;
        } catch (erro) {
          if (erro.code !== 'ER_DUP_ENTRY') throw erro;
        }
      }
    }
    res.json({ link: formatarLink(dono) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar o link de agendamento.' });
  }
}

// PUT /api/usuarios/link → { slug, linkAtivo, descricaoNegocio, enderecoNegocio }
async function salvarLink(req, res) {
  const slug = String(req.body.slug || '').trim().toLowerCase();
  const descricao = String(req.body.descricaoNegocio || '').trim().slice(0, 100) || null;
  const endereco = String(req.body.enderecoNegocio || '').trim().slice(0, 150) || null;

  if (!SLUG_REGEX.test(slug)) {
    return res.status(400).json({ erro: 'O endereço pode ter de 3 a 60 letras minúsculas, números e hífen (ex.: studio-francisco).' });
  }
  try {
    await pool.query(
      'UPDATE usuarios SET slug = ?, link_ativo = ?, descricao_negocio = ?, endereco_negocio = ? WHERE id = ?',
      [slug, req.body.linkAtivo ? 1 : 0, descricao, endereco, req.usuarioId]
    );
    const [[dono]] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [req.usuarioId]);
    res.json({ link: formatarLink(dono) });
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erro: 'Esse endereço já está sendo usado por outro negócio. Escolha outro.' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao salvar o link de agendamento.' });
  }
}

// =====================================================================
//  E-MAIL (Brevo) — "Esqueci minha senha" e "Criar senha"
//  Variáveis de ambiente (no .env e no Render, NUNCA no código):
//    BREVO_API_KEY    → chave da API do Brevo
//    EMAIL_REMETENTE  → e-mail verificado no Brevo (quem envia)
//  Sem BREVO_API_KEY (testando no computador), o código aparece no terminal.
// =====================================================================
const MINUTOS_CODIGO = 15;

async function enviarEmail(para, nome, assunto, html) {
  const chave = process.env.BREVO_API_KEY;
  if (!chave) {
    console.log(`\n[E-MAIL de teste, sem BREVO_API_KEY] Para: ${para}\nAssunto: ${assunto}\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}\n`);
    return;
  }
  const resposta = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': chave, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'MeuFluxo', email: process.env.EMAIL_REMETENTE },
      to: [{ email: para, name: nome || para }],
      subject: assunto,
      htmlContent: html,
    }),
  });
  if (!resposta.ok) {
    throw new Error(`Brevo respondeu ${resposta.status}: ${await resposta.text()}`);
  }
}

function htmlDoCodigo(nome, codigo) {
  const primeiroNome = String(nome || '').trim().split(/\s+/)[0] || 'Olá';
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#2c3730">
    <h2 style="color:#55634e;margin-bottom:4px">MeuFluxo</h2>
    <p>Oi, ${primeiroNome}!</p>
    <p>Use este código para criar a sua nova senha:</p>
    <p style="font-size:32px;font-weight:bold;letter-spacing:6px;background:#eef1ea;padding:14px;text-align:center;border-radius:10px">${codigo}</p>
    <p>Ele vale por ${MINUTOS_CODIGO} minutos e só pode ser usado uma vez.</p>
    <p style="color:#5f685c;font-size:13px">Se não foi você que pediu, pode ignorar este e-mail: a sua senha continua a mesma.</p>
  </div>`;
}

function agoraBrasilia() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
}

// POST /api/usuarios/senha/codigo → { email }
// Responde sempre a mesma coisa (não conta para estranhos quais e-mails existem).
async function enviarCodigoSenha(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const resposta = { mensagem: 'Se esse e-mail estiver cadastrado, enviamos um código. Confira também a caixa de spam.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'Digite um e-mail válido.' });
  }

  try {
    const [[usuario]] = await pool.query('SELECT id, nome, email FROM usuarios WHERE LOWER(email) = ?', [email]);
    if (!usuario) return res.json(resposta);

    // um código de 6 números; os anteriores deixam de valer
    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const agora = new Date();
    const expira = new Date(agora.getTime() + MINUTOS_CODIGO * 60000)
      .toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
    await pool.query(
      "UPDATE codigos_verificacao SET usado = 1 WHERE usuario_id = ? AND finalidade = 'recuperar_senha' AND usado = 0",
      [usuario.id]
    );
    await pool.query(
      "INSERT INTO codigos_verificacao (usuario_id, codigo, finalidade, expira_em) VALUES (?, ?, 'recuperar_senha', ?)",
      [usuario.id, codigo, expira]
    );

    await enviarEmail(usuario.email, usuario.nome, `Seu código do MeuFluxo: ${codigo}`, htmlDoCodigo(usuario.nome, codigo));
    res.json(resposta);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos.' });
  }
}

// POST /api/usuarios/senha/redefinir → { email, codigo, novaSenha }: troca a senha e já entra
async function redefinirSenhaComCodigo(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const codigo = String(req.body.codigo || '').replace(/\D/g, '');
  const erroSenha = validarSenha(req.body.novaSenha);
  if (!email || codigo.length !== 6) {
    return res.status(400).json({ erro: 'Digite o código de 6 números que chegou no seu e-mail.' });
  }
  if (erroSenha) return res.status(400).json({ erro: erroSenha });

  try {
    const [[usuario]] = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = ?', [email]);
    const [[registro]] = usuario
      ? await pool.query(
        `SELECT id FROM codigos_verificacao
          WHERE usuario_id = ? AND finalidade = 'recuperar_senha' AND codigo = ? AND usado = 0 AND expira_em >= ?
          ORDER BY id DESC LIMIT 1`,
        [usuario.id, codigo, agoraBrasilia()]
      )
      : [[null]];
    if (!registro) {
      return res.status(400).json({ erro: 'Código errado ou vencido. Peça um novo código.' });
    }

    const senhaHash = await bcrypt.hash(req.body.novaSenha, 10);
    await pool.query('UPDATE codigos_verificacao SET usado = 1 WHERE id = ?', [registro.id]);
    await pool.query(
      'UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, ultimo_acesso = NOW() WHERE id = ?',
      [senhaHash, usuario.id]
    );

    res.json({ usuario: await carregarUsuarioFormatado(usuario.id), token: gerarToken(usuario) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível trocar a senha.' });
  }
}

// =====================================================================
//  "CONTINUAR COM GOOGLE"
//  Variável de ambiente: GOOGLE_CLIENT_ID (o mesmo do Google Cloud Console).
// =====================================================================

// GET /api/usuarios/config → o que a tela de login precisa saber (sem segredos)
function configPublica(req, res) {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
}

/** Confere com o Google se o "crachá" (ID token) é verdadeiro e foi feito para o nosso site. */
async function verificarTokenGoogle(credential) {
  const resposta = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!resposta.ok) return null;
  const dados = await resposta.json();
  const emissorOk = dados.iss === 'accounts.google.com' || dados.iss === 'https://accounts.google.com';
  if (!emissorOk || dados.aud !== process.env.GOOGLE_CLIENT_ID) return null;
  if (dados.email_verified !== true && dados.email_verified !== 'true') return null;
  if (Number(dados.exp) * 1000 < Date.now()) return null;
  return { googleId: String(dados.sub), email: String(dados.email).toLowerCase(), nome: dados.name || dados.email };
}

// POST /api/usuarios/google → { credential }: entra (ou cria a conta de dono) com o Google
async function entrarComGoogle(req, res) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ erro: 'O login com Google ainda não foi configurado.' });
  }
  try {
    const google = await verificarTokenGoogle(String(req.body.credential || ''));
    if (!google) return res.status(401).json({ erro: 'Não foi possível confirmar a sua conta Google. Tente de novo.' });

    let [[usuario]] = await pool.query('SELECT * FROM usuarios WHERE google_id = ?', [google.googleId]);
    if (!usuario) {
      // já tem conta com esse e-mail (com senha, ou atendente criado pelo dono): liga ao Google
      [[usuario]] = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = ?', [google.email]);
      if (usuario) {
        await pool.query('UPDATE usuarios SET google_id = ? WHERE id = ?', [google.googleId, usuario.id]);
      } else {
        // conta nova: sempre dono do próprio negócio, sem senha (entra só pelo Google até criar uma)
        const [resultado] = await pool.query(
          "INSERT INTO usuarios (nome, email, senha_hash, google_id, papel) VALUES (?, ?, NULL, ?, 'dono')",
          [String(google.nome).slice(0, 100), google.email, google.googleId]
        );
        [[usuario]] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [resultado.insertId]);
      }
    }

    await pool.query('UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = ?', [usuario.id]);
    res.json({ usuario: await carregarUsuarioFormatado(usuario.id), token: gerarToken(usuario) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao entrar com o Google.' });
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
  obterLink,
  salvarLink,
  enviarCodigoSenha,
  redefinirSenhaComCodigo,
  configPublica,
  entrarComGoogle,
  validarSenha,
};
