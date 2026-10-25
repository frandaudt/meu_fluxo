// src/controllers/whatsappController.js
// Atendimento automático pelo WhatsApp (bot) + configuração da tela WhatsApp.
//
// Como funciona:
//  - A Meta manda cada mensagem recebida para POST /api/whatsapp/webhook.
//  - O bot lê em que etapa a conversa está (tabela bot_conversas), decide a
//    resposta e manda de volta pela API da Meta.
//  - O simulador da tela WhatsApp usa exatamente o mesmo bot, só que a resposta
//    volta para a tela em vez de ir para a Meta (serve para testar e para a banca).
//
// O que o cliente consegue fazer pelo bot:
//  1 – ver serviços e preços
//  2 – agendar (serviço → dia → horário → confirmar); dia lotado → lista de espera
//  3 – ver os próprios agendamentos e cancelar ou remarcar (RN16: só com 2h ou mais de antecedência)
//
// Aqui também ficam as mensagens prontas por serviço (lembrete, pós, falta, vaga),
// que o dono manda do próprio WhatsApp pelos botões das outras telas.
//
// Variáveis de ambiente (.env / Render), nunca no código:
//  WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET
//  WHATSAPP_NUMERO (opcional, só para mostrar na tela) e WHATSAPP_USUARIO_ID (opcional:
//  qual negócio responde no número; sem ela, é o último dono que ligou o bot).
const crypto = require('crypto');
const { pool } = require('../config/db');
const { carregarAgenda, avisarVagaLiberada } = require('./listaEsperaController');
const { horariosDoDia, diaFechado } = require('./publicoController');

const VERSAO_API = 'v21.0';
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_PROCURA = 14;          // procura dias abertos nas próximas 2 semanas
const DIAS_NO_MENU = 7;           // mostra no máximo 7 dias
const HORARIOS_NO_MENU = 16;      // e no máximo 16 horários
const MINUTOS_CONVERSA = 30;      // depois de 30 min parada, a conversa recomeça do menu
const ANTECEDENCIA_MIN = 120;     // RN16: cancelar/remarcar pelo bot só com 2h ou mais
const MAX_FUTUROS_PELO_BOT = 2;   // cada número: até 2 horários futuros marcados pelo bot

// ---------------------------------------------------------------------
// Respostas do bot (editáveis na tela). Ficam na tabela mensagens_prontas
// com tipo 'bot_...' e servico_id NULL. Sem nada salvo, vale o texto padrão.
// ---------------------------------------------------------------------
const RESPOSTAS = {
  saudacao: {
    titulo: 'Saudação e menu',
    padrao: 'Olá, {nome}! Aqui é o atendimento do {negocio}. Responda com o número:\n1 – Ver serviços e preços\n2 – Agendar um horário\n3 – Meus agendamentos (cancelar ou remarcar)',
  },
  primeiroContato: {
    titulo: 'Primeiro contato (número desconhecido)',
    padrao: 'Olá! Que bom ter você aqui 😊 Para começar, qual é o seu nome?',
  },
  confirmado: {
    titulo: 'Agendamento confirmado',
    padrao: 'Prontinho! {servico} marcado para {data} às {hora}. Te esperamos!',
  },
  semHorario: {
    titulo: 'Dia sem horários (lista de espera)',
    padrao: 'Esse dia está lotado 😕 Quer entrar na lista de espera? Se abrir uma vaga, a gente te avisa. Responda SIM.',
  },
  cancelMenos2h: {
    titulo: 'Cancelar ou remarcar com menos de 2h',
    padrao: 'Faltam menos de 2 horas, então não consigo mudar por aqui. Fale com a gente pelo {telefone}.',
  },
};
const tipoResposta = (chave) => `bot_${chave}`;

// =====================================================================
//  PEQUENAS AJUDAS
// =====================================================================
function agoraBrasilia() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
}
const hojeBrasilia = () => agoraBrasilia().slice(0, 10);

function somarDias(data, dias) {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}
function diaDaSemana(data) {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}
/** '2026-11-01' → 'sáb 01/11' */
const textoDia = (data) => `${DIAS_SEMANA[diaDaSemana(data)]} ${data.slice(8, 10)}/${data.slice(5, 7)}`;
const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const soDigitos = (t) => String(t || '').replace(/\D/g, '');

/** Minutos que faltam até data + hora (as duas no horário de Brasília). */
function minutosAte(data, horario) {
  const agora = agoraBrasilia();
  const alvo = Date.parse(`${data}T${String(horario).slice(0, 5)}:00Z`);
  const atual = Date.parse(`${agora.slice(0, 10)}T${agora.slice(11, 16)}:00Z`);
  return (alvo - atual) / 60000;
}

/** Deixa a resposta do cliente fácil de comparar: minúscula, sem acento, sem espaço sobrando. */
function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** "2", "2.", "opção 2", "2 - agendar" → 2. Sem número → null. */
function numeroEscolhido(texto) {
  const achado = normalizar(texto).match(/^\D{0,10}(\d{1,2})\b/);
  return achado ? Number(achado[1]) : null;
}
const ehSim = (t) => ['sim', 's', '1', 'quero', 'pode', 'confirmo', 'ok'].includes(normalizar(t).replace(/[!.]/g, ''));
const ehNao = (t) => ['nao', 'n', '2', 'nao quero', 'cancela'].includes(normalizar(t).replace(/[!.]/g, ''));

/** Troca {nome}, {negocio}, {servico}, {data}, {hora}, {telefone} pelo valor. */
function preencher(texto, campos) {
  return String(texto).replace(/\{(nome|negocio|servico|data|hora|telefone)\}/g, (_, c) => campos[c] ?? '');
}

/**
 * Telefone do Brasil vira uma "chave": DDD + 8 últimos números.
 * Assim '(11) 98765-4321', '5511987654321' e '551187654321' (a Meta às vezes
 * manda celular sem o 9) são o mesmo cliente.
 */
function chaveTelefone(telefone) {
  let d = soDigitos(telefone);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10) return d;
  return d.slice(0, 2) + d.slice(-8);
}

/** '551187654321' (sem o 9) → '(11) 98765-4321' para gravar no cadastro. */
function telefoneParaCadastro(telefone) {
  let d = soDigitos(telefone);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`; // celular sem o 9
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

// =====================================================================
//  CONFIGURAÇÃO (whatsapp_config + respostas em mensagens_prontas)
// =====================================================================

/** { ativo, cadastroAutomatico } do negócio (sem linha salva: bot ligado, cadastro ligado). */
async function lerConfig(usuarioId) {
  const [[linha]] = await pool.query('SELECT * FROM whatsapp_config WHERE usuario_id = ?', [usuarioId]);
  return {
    ativo: linha ? Boolean(linha.ativo) : false,
    // a coluna cadastro_automatico entra com o ALTER desta parte; sem ela, fica ligado
    cadastroAutomatico: linha && linha.cadastro_automatico !== undefined ? Boolean(linha.cadastro_automatico) : true,
  };
}

/** Os 5 textos do bot (o que estiver salvo ou o padrão). */
async function lerRespostas(usuarioId) {
  const [linhas] = await pool.query(
    "SELECT tipo, mensagem FROM mensagens_prontas WHERE usuario_id = ? AND servico_id IS NULL AND tipo LIKE 'bot\\_%'",
    [usuarioId]
  );
  const respostas = {};
  for (const chave of Object.keys(RESPOSTAS)) {
    const salva = linhas.find(l => l.tipo === tipoResposta(chave));
    respostas[chave] = salva && salva.mensagem.trim() ? salva.mensagem : RESPOSTAS[chave].padrao;
  }
  return respostas;
}

function statusConexao() {
  return {
    conectado: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
    numero: process.env.WHATSAPP_NUMERO || null,
  };
}

// GET /api/whatsapp/config → bot (ligado?, cadastro automático), conexão com a Meta e respostas
async function obterConfig(req, res) {
  try {
    const [config, respostas] = await Promise.all([lerConfig(req.usuarioId), lerRespostas(req.usuarioId)]);
    res.json({
      bot: { ...config, ...statusConexao() },
      respostas,
      respostasPadrao: Object.fromEntries(Object.entries(RESPOSTAS).map(([c, r]) => [c, r.padrao])),
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível carregar o WhatsApp.' });
  }
}

// PUT /api/whatsapp/config → { ativo, cadastroAutomatico }
async function salvarConfig(req, res) {
  try {
    const atual = await lerConfig(req.usuarioId);
    const ativo = typeof req.body.ativo === 'boolean' ? req.body.ativo : atual.ativo;
    const cadastro = typeof req.body.cadastroAutomatico === 'boolean' ? req.body.cadastroAutomatico : atual.cadastroAutomatico;
    try {
      await pool.query(
        `INSERT INTO whatsapp_config (usuario_id, ativo, cadastro_automatico) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE ativo = VALUES(ativo), cadastro_automatico = VALUES(cadastro_automatico)`,
        [req.usuarioId, ativo ? 1 : 0, cadastro ? 1 : 0]
      );
    } catch (erro) {
      if (erro.errno !== 1054) throw erro; // 1054 = coluna não existe (ALTER ainda não rodado)
      await pool.query(
        'INSERT INTO whatsapp_config (usuario_id, ativo) VALUES (?, ?) ON DUPLICATE KEY UPDATE ativo = VALUES(ativo)',
        [req.usuarioId, ativo ? 1 : 0]
      );
    }
    res.json({ bot: { ...(await lerConfig(req.usuarioId)), ...statusConexao() } });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível salvar.' });
  }
}

// PUT /api/whatsapp/respostas → { saudacao, primeiroContato, confirmado, semHorario, cancelMenos2h }
async function salvarRespostas(req, res) {
  try {
    for (const chave of Object.keys(RESPOSTAS)) {
      if (typeof req.body[chave] !== 'string') continue;
      const texto = req.body[chave].trim().slice(0, 1000);
      if (!texto) return res.status(400).json({ erro: `Escreva o texto de "${RESPOSTAS[chave].titulo}".` });

      const [[existe]] = await pool.query(
        'SELECT id FROM mensagens_prontas WHERE usuario_id = ? AND servico_id IS NULL AND tipo = ?',
        [req.usuarioId, tipoResposta(chave)]
      );
      if (existe) {
        await pool.query('UPDATE mensagens_prontas SET mensagem = ?, ativo = 1 WHERE id = ?', [texto, existe.id]);
      } else {
        await pool.query(
          'INSERT INTO mensagens_prontas (usuario_id, servico_id, titulo, mensagem, tipo, ativo) VALUES (?, NULL, ?, ?, ?, 1)',
          [req.usuarioId, RESPOSTAS[chave].titulo, texto, tipoResposta(chave)]
        );
      }
    }
    res.json({ respostas: await lerRespostas(req.usuarioId) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível salvar as respostas.' });
  }
}

// =====================================================================
//  MENSAGENS PRONTAS POR SERVIÇO (o dono envia do próprio WhatsApp, pelo wa.me)
//  Tipos: lembrete (véspera), pos (depois do atendimento), falta (sentimos sua
//  falta) e vaga (lista de espera). servico_id NULL = "Padrão (todos)".
//  Só fica salvo o que a pessoa escolheu ou editou; os modelos prontos ficam no front.
// =====================================================================
const TIPOS_MENSAGEM = ['lembrete', 'pos', 'falta', 'vaga'];
const TITULOS_MENSAGEM = { lembrete: 'Lembrete da véspera', pos: 'Depois do atendimento', falta: 'Sentimos sua falta', vaga: 'Abriu uma vaga' };

async function lerMensagens(usuarioId) {
  const [linhas] = await pool.query(
    `SELECT m.servico_id, m.tipo, m.mensagem, s.nome AS servico_nome
       FROM mensagens_prontas m LEFT JOIN servicos s ON s.id = m.servico_id
      WHERE m.usuario_id = ? AND m.ativo = 1 AND m.tipo IN ('lembrete', 'pos', 'falta', 'vaga')`,
    [usuarioId]
  );
  return linhas.map(l => ({ servicoId: l.servico_id, servicoNome: l.servico_nome || null, tipo: l.tipo, texto: l.mensagem }));
}

// GET /api/whatsapp/mensagens → mensagens salvas (dono e atendentes: usadas nos botões de WhatsApp)
async function listarMensagens(req, res) {
  try {
    const [[negocio]] = await pool.query('SELECT nome, nome_negocio FROM usuarios WHERE id = ?', [req.usuarioId]);
    res.json({ negocio: negocio ? negocio.nome_negocio || negocio.nome : '', mensagens: await lerMensagens(req.usuarioId) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível carregar as mensagens prontas.' });
  }
}

/** Confere tipo e serviço. Devolve { tipo, servicoId } ou { erro }. */
async function lerTipoEServico(usuarioId, tipo, servicoId) {
  if (!TIPOS_MENSAGEM.includes(tipo)) return { erro: 'Tipo de mensagem inválido.' };
  if (servicoId === null || servicoId === undefined || servicoId === '') return { tipo, servicoId: null };
  const [[servico]] = await pool.query('SELECT id FROM servicos WHERE id = ? AND usuario_id = ?', [servicoId, usuarioId]);
  return servico ? { tipo, servicoId: servico.id } : { erro: 'Serviço não encontrado.' };
}

// PUT /api/whatsapp/mensagens → { servicoId (ou null), tipo, texto }: passa a ser a mensagem "Em uso"
async function salvarMensagem(req, res) {
  try {
    const alvo = await lerTipoEServico(req.usuarioId, req.body.tipo, req.body.servicoId);
    if (alvo.erro) return res.status(400).json({ erro: alvo.erro });
    const texto = String(req.body.texto || '').trim().slice(0, 1000);
    if (!texto) return res.status(400).json({ erro: 'Escreva a mensagem.' });

    const [[existe]] = await pool.query(
      'SELECT id FROM mensagens_prontas WHERE usuario_id = ? AND tipo = ? AND servico_id <=> ?',
      [req.usuarioId, alvo.tipo, alvo.servicoId]
    );
    if (existe) {
      await pool.query('UPDATE mensagens_prontas SET mensagem = ?, ativo = 1 WHERE id = ?', [texto, existe.id]);
    } else {
      await pool.query(
        'INSERT INTO mensagens_prontas (usuario_id, servico_id, titulo, mensagem, tipo, ativo) VALUES (?, ?, ?, ?, ?, 1)',
        [req.usuarioId, alvo.servicoId, TITULOS_MENSAGEM[alvo.tipo], texto, alvo.tipo]
      );
    }
    res.json({ mensagens: await lerMensagens(req.usuarioId) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível salvar a mensagem.' });
  }
}

// DELETE /api/whatsapp/mensagens?servicoId=&tipo= → volta a usar o modelo pronto
async function removerMensagem(req, res) {
  try {
    const alvo = await lerTipoEServico(req.usuarioId, req.query.tipo, req.query.servicoId);
    if (alvo.erro) return res.status(400).json({ erro: alvo.erro });
    await pool.query(
      'DELETE FROM mensagens_prontas WHERE usuario_id = ? AND tipo = ? AND servico_id <=> ?',
      [req.usuarioId, alvo.tipo, alvo.servicoId]
    );
    res.json({ mensagens: await lerMensagens(req.usuarioId) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível voltar ao modelo.' });
  }
}

// =====================================================================
//  CONVERSA (tabela bot_conversas: etapa + dados de cada telefone)
// =====================================================================
async function lerConversa(usuarioId, telefone) {
  const [[linha]] = await pool.query(
    `SELECT etapa, dados, TIMESTAMPDIFF(MINUTE, atualizado_em, CURRENT_TIMESTAMP) AS parada
       FROM bot_conversas WHERE usuario_id = ? AND telefone = ?`,
    [usuarioId, telefone]
  );
  if (!linha) return { etapa: 'inicio', dados: {} };
  let dados = linha.dados;
  if (typeof dados === 'string') {
    try { dados = JSON.parse(dados); } catch { dados = {}; }
  }
  // conversa parada há mais de 30 minutos recomeça do menu
  if (Number(linha.parada) > MINUTOS_CONVERSA) return { etapa: 'inicio', dados: {} };
  return { etapa: linha.etapa, dados: dados || {} };
}

async function gravarConversa(usuarioId, telefone, etapa, dados) {
  await pool.query(
    `INSERT INTO bot_conversas (usuario_id, telefone, etapa, dados) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE etapa = VALUES(etapa), dados = VALUES(dados), atualizado_em = CURRENT_TIMESTAMP`,
    [usuarioId, telefone, etapa, JSON.stringify(dados || {})]
  );
}

async function acharCliente(usuarioId, telefone) {
  const chave = chaveTelefone(telefone);
  const [clientes] = await pool.query('SELECT id, nome, telefone FROM clientes WHERE usuario_id = ?', [usuarioId]);
  return clientes.find(c => chaveTelefone(c.telefone) === chave) || null;
}

async function cadastrarCliente(usuarioId, nome, telefone) {
  const [resultado] = await pool.query(
    "INSERT INTO clientes (usuario_id, nome, telefone, origem) VALUES (?, ?, ?, 'whatsapp')",
    [usuarioId, nome, telefoneParaCadastro(telefone)]
  );
  await avisar(usuarioId, 'novo_cliente_bot', 'Novo cliente pelo WhatsApp',
    `${nome} falou com o bot e foi cadastrado(a) com o telefone ${telefoneParaCadastro(telefone)}.`);
  return { id: resultado.insertId, nome, telefone: telefoneParaCadastro(telefone) };
}

/** Grava o aviso do sininho / Início. Se falhar, a conversa continua. */
function avisar(usuarioId, tipo, titulo, mensagem) {
  return pool.query(
    'INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo) VALUES (?, ?, ?, ?)',
    [usuarioId, titulo, mensagem, tipo]
  ).catch(erro => console.error('Aviso do bot falhou:', erro.message));
}

async function servicosDoBot(usuarioId) {
  const [servicos] = await pool.query(
    'SELECT id, nome, valor, duracao_min FROM servicos WHERE usuario_id = ? AND mostrar_no_bot = 1 ORDER BY nome',
    [usuarioId]
  );
  return servicos;
}

/** Próximos dias abertos (até 7), cada um com os horários livres para o serviço. */
async function diasComHorarios(usuarioId, duracao) {
  const hoje = hojeBrasilia();
  const agenda = await carregarAgenda(usuarioId, hoje, somarDias(hoje, DIAS_PROCURA - 1));
  const dias = [];
  for (let i = 0; i < DIAS_PROCURA && dias.length < DIAS_NO_MENU; i++) {
    const data = somarDias(hoje, i);
    if (diaFechado(agenda, data)) continue;
    const horarios = horariosDoDia(agenda, data, duracao);
    if (i === 0 && horarios.length === 0) continue; // hoje já sem horário: nem mostra
    dias.push({ data, livres: horarios.length });
  }
  return dias;
}

async function horariosLivres(usuarioId, data, duracao) {
  const agenda = await carregarAgenda(usuarioId, data, data);
  return diaFechado(agenda, data) ? [] : horariosDoDia(agenda, data, duracao);
}

/** Agendamentos futuros ainda "agendado" do cliente (no máximo 5). */
async function agendamentosFuturos(usuarioId, clienteId) {
  const [linhas] = await pool.query(
    `SELECT a.id, a.data, a.horario, a.servico_id, s.nome AS servico, s.duracao_min
       FROM agendamentos a JOIN servicos s ON s.id = a.servico_id
      WHERE a.usuario_id = ? AND a.cliente_id = ? AND a.status = 'agendado' AND a.data >= ?
      ORDER BY a.data, a.horario LIMIT 5`,
    [usuarioId, clienteId, hojeBrasilia()]
  );
  return linhas
    .map(l => ({ ...l, data: String(l.data).slice(0, 10), horario: String(l.horario).slice(0, 5) }))
    .filter(l => minutosAte(l.data, l.horario) > 0);
}

// =====================================================================
//  O BOT: recebe o texto do cliente e devolve as mensagens de resposta
// =====================================================================
async function responder(negocio, telefone, texto) {
  const usuarioId = negocio.id;
  const [config, respostas] = await Promise.all([lerConfig(usuarioId), lerRespostas(usuarioId)]);
  const conversa = await lerConversa(usuarioId, telefone);
  let { etapa } = conversa;
  const dados = conversa.dados;
  const cliente = await acharCliente(usuarioId, telefone);
  const nomeNegocio = negocio.nome_negocio || negocio.nome;
  const campos = { nome: cliente ? cliente.nome.split(' ')[0] : '', negocio: nomeNegocio, telefone: negocio.telefone || 'telefone do salão' };
  const saida = [];
  const msg = normalizar(texto);

  const irPara = async (novaEtapa, novosDados = {}) => {
    await gravarConversa(usuarioId, telefone, novaEtapa, novosDados);
  };
  const mostrarMenu = async () => {
    saida.push(preencher(respostas.saudacao, campos).replace(/Olá, !/, 'Olá!'));
    await irPara('menu');
  };

  // "menu", "oi", "voltar"... a qualquer momento: volta para o começo
  if (['menu', 'oi', 'ola', 'inicio', 'voltar', 'bom dia', 'boa tarde', 'boa noite'].includes(msg.replace(/[!.?]/g, ''))) {
    etapa = 'inicio';
  }

  // ---------- número desconhecido: pergunta o nome antes de tudo ----------
  if (!cliente && etapa !== 'nome' && config.cadastroAutomatico) {
    saida.push(preencher(respostas.primeiroContato, campos));
    await irPara('nome');
    return saida;
  }

  switch (etapa) {
    case 'nome': {
      const nome = String(texto || '').trim().replace(/\s+/g, ' ').slice(0, 100);
      if (nome.length < 2 || /^\d+$/.test(nome)) {
        saida.push('Não entendi 😅 Me diga o seu nome, por favor.');
        return saida;
      }
      const novo = cliente || await cadastrarCliente(usuarioId, nome, telefone);
      campos.nome = novo.nome.split(' ')[0];
      await mostrarMenu();
      return saida;
    }

    case 'menu': {
      const opcao = numeroEscolhido(texto);
      if (opcao === 1) {
        const servicos = await servicosDoBot(usuarioId);
        if (servicos.length === 0) {
          saida.push('Ainda não temos serviços para mostrar por aqui. Fale com a gente pelo ' + campos.telefone + '.');
        } else {
          saida.push(`Nossos serviços:\n${servicos.map(s => `• ${s.nome} – ${dinheiro(s.valor)} (${s.duracao_min || 30} min)`).join('\n')}\n\nPara agendar, responda 2. Para ver o menu, responda MENU.`);
        }
        return saida;
      }
      if (opcao === 2) return escolherServico();
      if (opcao === 3) return meusAgendamentos();
      await mostrarMenu();
      return saida;
    }

    case 'servico': {
      const servicos = await servicosDoBot(usuarioId);
      const opcao = numeroEscolhido(texto);
      const servico = opcao ? servicos[opcao - 1] : null;
      if (!servico) {
        saida.push('Responda só com o número do serviço 🙂');
        return saida;
      }
      return escolherDia(servico, dados.remarcarId || null);
    }

    case 'dia': {
      const opcao = numeroEscolhido(texto);
      const dia = opcao ? (dados.dias || [])[opcao - 1] : null;
      if (!dia) {
        saida.push('Responda só com o número do dia 🙂');
        return saida;
      }
      const horarios = await horariosLivres(usuarioId, dia.data, dados.duracao);
      if (horarios.length === 0 && dados.remarcarId) {
        saida.push('Esse dia está lotado 😕 Escolha outro dia (responda com o número).');
        return saida;
      }
      if (horarios.length === 0) {
        // dia lotado → oferece a lista de espera (RN-LE2: entra pelo bot)
        saida.push(preencher(respostas.semHorario, { ...campos, data: textoDia(dia.data) }));
        await irPara('espera', { ...dados, data: dia.data });
        return saida;
      }
      const mostrados = horarios.slice(0, HORARIOS_NO_MENU);
      saida.push(`Horários livres em ${textoDia(dia.data)}:\n${mostrados.map((h, i) => `${i + 1} – ${h}`).join('\n')}\n\nResponda com o número do horário.`);
      await irPara('hora', { ...dados, data: dia.data, horarios: mostrados });
      return saida;
    }

    case 'hora': {
      const opcao = numeroEscolhido(texto);
      const horario = opcao ? (dados.horarios || [])[opcao - 1] : null;
      if (!horario) {
        saida.push('Responda só com o número do horário 🙂');
        return saida;
      }
      const pergunta = dados.remarcarId
        ? `Remarcar ${dados.servicoNome} para ${textoDia(dados.data)} às ${horario}?`
        : `Confirma ${dados.servicoNome} em ${textoDia(dados.data)} às ${horario}?`;
      saida.push(`${pergunta}\n1 – Sim\n2 – Não`);
      await irPara('confirmar', { ...dados, horario });
      return saida;
    }

    case 'confirmar': {
      if (ehNao(texto)) {
        saida.push('Tudo bem, não marquei nada.');
        await mostrarMenu();
        return saida;
      }
      if (!ehSim(texto)) {
        saida.push('Responda 1 para confirmar ou 2 para desistir.');
        return saida;
      }
      return gravarAgendamento();
    }

    case 'espera': {
      if (!ehSim(texto)) {
        saida.push('Tudo bem! Se quiser escolher outro dia, responda 2.');
        await irPara('menu');
        return saida;
      }
      const [[repetida]] = await pool.query(
        `SELECT id FROM lista_espera
          WHERE usuario_id = ? AND cliente_id = ? AND servico_id = ? AND data_preferida = ? AND status IN ('aguardando', 'contatado')`,
        [usuarioId, cliente.id, dados.servicoId, dados.data]
      );
      if (!repetida) {
        await pool.query(
          `INSERT INTO lista_espera (usuario_id, cliente_id, servico_id, data_preferida, periodo, origem, status)
           VALUES (?, ?, ?, ?, 'qualquer', 'whatsapp', 'aguardando')`,
          [usuarioId, cliente.id, dados.servicoId, dados.data]
        );
      }
      saida.push(`Pronto, ${campos.nome}! Você está na lista de espera para ${dados.servicoNome} em ${textoDia(dados.data)}. Se abrir uma vaga, a gente te avisa por aqui.`);
      await irPara('menu');
      return saida;
    }

    case 'meus': {
      const opcao = numeroEscolhido(texto);
      const ag = opcao ? (dados.ags || [])[opcao - 1] : null;
      if (!ag) {
        saida.push('Responda com o número do agendamento, ou MENU para voltar.');
        return saida;
      }
      saida.push(`${ag.servico} em ${textoDia(ag.data)} às ${ag.horario}. O que você quer fazer?\n1 – Cancelar\n2 – Remarcar\n3 – Voltar ao menu`);
      await irPara('acao', { ag });
      return saida;
    }

    case 'acao': {
      const opcao = numeroEscolhido(texto);
      const ag = dados.ag;
      if (opcao === 3 || !ag) {
        await mostrarMenu();
        return saida;
      }
      if (opcao !== 1 && opcao !== 2) {
        saida.push('Responda 1 para cancelar, 2 para remarcar ou 3 para voltar.');
        return saida;
      }
      // RN16: pelo bot, só com 2h ou mais de antecedência
      if (minutosAte(ag.data, ag.horario) < ANTECEDENCIA_MIN) {
        saida.push(preencher(respostas.cancelMenos2h, campos));
        await irPara('menu');
        return saida;
      }
      if (opcao === 2) {
        const servicos = await servicosDoBot(usuarioId);
        const servico = servicos.find(s => s.id === ag.servico_id) || { id: ag.servico_id, nome: ag.servico, duracao_min: ag.duracao_min };
        return escolherDia(servico, ag.id);
      }
      saida.push(`Cancelar ${ag.servico} de ${textoDia(ag.data)} às ${ag.horario}?\n1 – Sim, cancelar\n2 – Não`);
      await irPara('cancelar', { ag });
      return saida;
    }

    case 'cancelar': {
      if (!ehSim(texto)) {
        saida.push('Combinado, seu horário continua marcado 👍');
        await irPara('menu');
        return saida;
      }
      const ag = dados.ag;
      const [resultado] = await pool.query(
        `UPDATE agendamentos
            SET status = 'cancelado', status_em = ?, cancelado_por = 'cliente', motivo_cancelamento = 'Cancelado pelo WhatsApp'
          WHERE id = ? AND usuario_id = ? AND status = 'agendado'`,
        [agoraBrasilia(), ag.id, usuarioId]
      );
      if (resultado.affectedRows === 0) {
        saida.push('Esse agendamento já não está mais marcado.');
      } else {
        saida.push(`Cancelado. Quando quiser marcar de novo, é só responder 2 😉`);
        await avisar(usuarioId, 'cancelamento_bot', 'Cancelamento pelo WhatsApp',
          `${cliente.nome} cancelou ${ag.servico} de ${textoDia(ag.data)} às ${ag.horario} pelo WhatsApp.`);
        await avisarVagaLiberada(usuarioId, ag.data, ag.horario, `${cliente.nome} cancelou`);
      }
      await irPara('menu');
      return saida;
    }

    default: // 'inicio' ou qualquer etapa desconhecida
      await mostrarMenu();
      return saida;
  }

  // ---------- passos usados em mais de uma etapa ----------
  async function escolherServico() {
    if (!cliente) {
      // cadastro automático desligado e número desconhecido
      saida.push(`Para o primeiro agendamento, fale com a gente pelo ${campos.telefone} 😊`);
      return saida;
    }
    const [[{ futuros }]] = await pool.query(
      `SELECT COUNT(*) AS futuros FROM agendamentos
        WHERE usuario_id = ? AND cliente_id = ? AND origem = 'whatsapp' AND status = 'agendado' AND data >= ?`,
      [usuarioId, cliente.id, hojeBrasilia()]
    );
    if (futuros >= MAX_FUTUROS_PELO_BOT) {
      saida.push(`Você já tem ${futuros} horários marcados por aqui. Para marcar mais, fale com a gente pelo ${campos.telefone}. Para ver os seus horários, responda 3.`);
      return saida;
    }
    const servicos = await servicosDoBot(usuarioId);
    if (servicos.length === 0) {
      saida.push(`No momento não dá para agendar por aqui. Fale com a gente pelo ${campos.telefone}.`);
      return saida;
    }
    saida.push(`Qual serviço?\n${servicos.map((s, i) => `${i + 1} – ${s.nome} (${dinheiro(s.valor)})`).join('\n')}\n\nResponda com o número.`);
    await irPara('servico');
    return saida;
  }

  async function escolherDia(servico, remarcarId) {
    const duracao = servico.duracao_min || 30;
    const dias = await diasComHorarios(usuarioId, duracao);
    if (dias.length === 0) {
      saida.push(`Não encontrei dias abertos nas próximas 2 semanas. Fale com a gente pelo ${campos.telefone}.`);
      await irPara('menu');
      return saida;
    }
    const linhas = dias.map((d, i) => `${i + 1} – ${textoDia(d.data)}${d.livres === 0 ? ' (lotado)' : ''}`);
    saida.push(`${servico.nome}: qual dia?\n${linhas.join('\n')}\n\nResponda com o número do dia.`);
    await irPara('dia', { servicoId: servico.id, servicoNome: servico.nome, duracao, dias, remarcarId });
    return saida;
  }

  async function meusAgendamentos() {
    if (!cliente) {
      saida.push('Não encontrei agendamentos para este número.');
      return saida;
    }
    const ags = await agendamentosFuturos(usuarioId, cliente.id);
    if (ags.length === 0) {
      saida.push('Você não tem horários marcados. Para agendar, responda 2.');
      return saida;
    }
    saida.push(`Seus horários:\n${ags.map((a, i) => `${i + 1} – ${a.servico}, ${textoDia(a.data)} às ${a.horario}`).join('\n')}\n\nResponda com o número para cancelar ou remarcar.`);
    await irPara('meus', { ags });
    return saida;
  }

  async function gravarAgendamento() {
    // confere de novo: alguém pode ter ocupado o horário enquanto a pessoa respondia
    const livres = await horariosLivres(usuarioId, dados.data, dados.duracao);
    if (!livres.includes(dados.horario)) {
      saida.push('Poxa, esse horário acabou de ser ocupado 😕 Vamos escolher outro?');
      const servicos = await servicosDoBot(usuarioId);
      const servico = servicos.find(s => s.id === dados.servicoId) || { id: dados.servicoId, nome: dados.servicoNome, duracao_min: dados.duracao };
      return escolherDia(servico, dados.remarcarId || null);
    }
    const quando = `${textoDia(dados.data)} às ${dados.horario}`;

    if (dados.remarcarId) {
      const [[antigo]] = await pool.query(
        "SELECT data, horario FROM agendamentos WHERE id = ? AND usuario_id = ? AND status = 'agendado'",
        [dados.remarcarId, usuarioId]
      );
      if (!antigo) {
        saida.push('Esse agendamento já não está mais marcado.');
        await irPara('menu');
        return saida;
      }
      // RN05: reagendar altera o mesmo registro e soma +1
      await pool.query(
        'UPDATE agendamentos SET data = ?, horario = ?, reagendamentos = reagendamentos + 1 WHERE id = ? AND usuario_id = ?',
        [dados.data, dados.horario, dados.remarcarId, usuarioId]
      );
      saida.push(`Remarcado! ${dados.servicoNome} agora é ${quando}. Te esperamos!`);
      await avisar(usuarioId, 'novo_agendamento_bot', 'Remarcação pelo WhatsApp',
        `${cliente.nome} remarcou ${dados.servicoNome} para ${quando} pelo WhatsApp.`);
      await avisarVagaLiberada(usuarioId, String(antigo.data).slice(0, 10), String(antigo.horario).slice(0, 5), `${cliente.nome} remarcou`);
    } else {
      await pool.query(
        `INSERT INTO agendamentos (usuario_id, cliente_id, servico_id, data, horario, status, origem)
         VALUES (?, ?, ?, ?, ?, 'agendado', 'whatsapp')`,
        [usuarioId, cliente.id, dados.servicoId, dados.data, dados.horario]
      );
      saida.push(preencher(respostas.confirmado, { ...campos, servico: dados.servicoNome, data: textoDia(dados.data), hora: dados.horario }));
      await avisar(usuarioId, 'novo_agendamento_bot', 'Novo agendamento pelo WhatsApp',
        `${cliente.nome} agendou ${dados.servicoNome} para ${quando} pelo WhatsApp.`);
    }
    await irPara('menu');
    return saida;
  }
}

// =====================================================================
//  SIMULADOR (tela WhatsApp): o mesmo bot, sem passar pela Meta
// =====================================================================

/** O telefone do simulador vira uma conversa separada ('sim' + números). */
function telefoneSimulado(body) {
  const d = soDigitos(body.telefone);
  return d.length >= 10 && d.length <= 13 ? d : null;
}

// POST /api/whatsapp/simular → { telefone, texto } devolve { respostas: [...] }
async function simular(req, res) {
  try {
    const telefone = telefoneSimulado(req.body);
    const texto = String(req.body.texto || '').slice(0, 500);
    if (!telefone) return res.status(400).json({ erro: 'Digite um telefone com DDD para simular o cliente.' });
    if (!texto.trim()) return res.status(400).json({ erro: 'Escreva uma mensagem.' });

    const [[negocio]] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [req.usuarioId]);
    // a conversa fica guardada como 'sim' + número; o cadastro do cliente usa só os números
    const respostas = await responder(negocio, `sim${telefone}`.slice(0, 20), texto);
    res.json({ respostas });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'O bot não conseguiu responder.' });
  }
}

// POST /api/whatsapp/simular/reiniciar → { telefone } apaga a conversa simulada
async function reiniciarSimulacao(req, res) {
  try {
    const telefone = telefoneSimulado(req.body);
    if (telefone) {
      await pool.query('DELETE FROM bot_conversas WHERE usuario_id = ? AND telefone = ?', [req.usuarioId, `sim${telefone}`.slice(0, 20)]);
    }
    res.json({ ok: true });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível reiniciar.' });
  }
}

// =====================================================================
//  WEBHOOK DA META (sem login: a segurança é o verify token e a assinatura)
// =====================================================================

// GET /api/whatsapp/webhook → a Meta confere se o endereço é nosso
function verificarWebhook(req, res) {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const desafio = req.query['hub.challenge'];
  if (modo === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(desafio));
  }
  res.sendStatus(403);
}

/** Confere a assinatura X-Hub-Signature-256 (prova de que a mensagem veio da Meta). */
function assinaturaValida(req) {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  const recebida = String(req.headers['x-hub-signature-256'] || '');
  if (!segredo || !req.rawBody || !recebida.startsWith('sha256=')) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', segredo).update(req.rawBody).digest('hex');
  const a = Buffer.from(recebida);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Qual negócio atende no número do MeuFluxo. */
async function negocioDoNumero() {
  if (process.env.WHATSAPP_USUARIO_ID) {
    const [[n]] = await pool.query("SELECT * FROM usuarios WHERE id = ? AND papel = 'dono'", [process.env.WHATSAPP_USUARIO_ID]);
    return n || null;
  }
  const [[n]] = await pool.query(
    `SELECT u.* FROM whatsapp_config w JOIN usuarios u ON u.id = w.usuario_id
      WHERE w.ativo = 1 AND u.papel = 'dono' ORDER BY w.atualizado_em DESC LIMIT 1`
  );
  return n || null;
}

/** Manda um texto pelo WhatsApp (API Cloud da Meta). */
async function enviarWhatsapp(para, texto) {
  const resposta = await fetch(`https://graph.facebook.com/${VERSAO_API}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto } }),
  });
  if (!resposta.ok) throw new Error(`Meta respondeu ${resposta.status}: ${await resposta.text()}`);
}

// a Meta às vezes manda a mesma mensagem duas vezes: guarda as últimas para não responder em dobro
const jaRespondidas = new Set();

// POST /api/whatsapp/webhook → mensagem nova de um cliente
async function receberWebhook(req, res) {
  if (!assinaturaValida(req)) {
    console.warn('[WhatsApp] webhook recusado: assinatura inválida ou WHATSAPP_APP_SECRET faltando.');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // responde logo; a Meta reenvia se demorar

  try {
    const mensagens = [];
    for (const entrada of req.body.entry || []) {
      for (const mudanca of entrada.changes || []) {
        for (const m of mudanca.value?.messages || []) mensagens.push(m);
      }
    }
    if (mensagens.length === 0) return; // avisos de "entregue", "lido"...

    const negocio = await negocioDoNumero();
    if (!negocio) return;
    const { ativo } = await lerConfig(negocio.id);
    if (!ativo) return; // bot desligado: ninguém recebe resposta automática

    for (const m of mensagens) {
      if (jaRespondidas.has(m.id)) continue;
      jaRespondidas.add(m.id);
      if (jaRespondidas.size > 500) jaRespondidas.delete(jaRespondidas.values().next().value);

      const texto = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || '';
      if (!texto) {
        await enviarWhatsapp(m.from, 'Por enquanto eu só entendo mensagens de texto 🙂 Responda MENU.');
        continue;
      }
      const respostas = await responder(negocio, m.from, texto);
      for (const r of respostas) await enviarWhatsapp(m.from, r);
    }
  } catch (erro) {
    console.error('[WhatsApp] erro ao responder:', erro);
  }
}

module.exports = {
  obterConfig,
  salvarConfig,
  salvarRespostas,
  listarMensagens,
  salvarMensagem,
  removerMensagem,
  simular,
  reiniciarSimulacao,
  verificarWebhook,
  receberWebhook,
};
