// src/controllers/publicoController.js
// Página pública de agendamento (/agendar/:slug), SEM login.
// O cliente escolhe o serviço, o dia e o horário, informa nome e WhatsApp e pronto.
//
// Proteções (além do limite por IP no app.js):
//  - interruptor do link (usuarios.link_ativo);
//  - campo "armadilha" (site): pessoas não veem, robôs preenchem → recusado;
//  - por telefone: no máximo 2 agendamentos futuros feitos pelo link;
//  - por negócio: no máximo 30 agendamentos pelo link por dia;
//  - o horário é conferido de novo na hora de gravar (pode ter sido ocupado).
// Nenhuma mensagem automática é enviada: o dono vê o aviso no sininho.
const { pool } = require('../config/db');
const { carregarAgenda, livresDoDia } = require('./listaEsperaController');

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DIAS_MOSTRADOS = 14;
const MAX_FUTUROS_POR_TELEFONE = 2;
const MAX_POR_DIA_NO_NEGOCIO = 30;
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const PALETAS = ['salvia', 'oceano', 'lavanda', 'rose', 'terracota', 'grafite', 'personalizada'];

function paraMinutos(hhmm) {
  const [h, m] = String(hhmm).split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function paraHora(minutos) {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

function hojeBrasilia() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10);
}

function somarDias(data, dias) {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

function diaDaSemana(data) {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

const soDigitos = (t) => String(t || '').replace(/\D/g, '');

/** '11977771010' → '(11) 97777-1010' */
function formatarTelefone(digitos) {
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return digitos;
}

/** Acha o negócio pelo slug (só se o link estiver ligado). */
async function negocioPeloSlug(slug) {
  const [[negocio]] = await pool.query(
    "SELECT * FROM usuarios WHERE slug = ? AND papel = 'dono'",
    [String(slug || '').toLowerCase()]
  );
  if (!negocio || !negocio.link_ativo) return null;
  return negocio;
}

async function servicoDoNegocio(negocioId, servicoId) {
  const [[servico]] = await pool.query(
    'SELECT id, nome, valor, duracao_min FROM servicos WHERE id = ? AND usuario_id = ? AND mostrar_no_bot = 1',
    [servicoId, negocioId]
  );
  return servico || null;
}

/** Inícios possíveis do serviço num dia (de "bloco" em "bloco", cabendo a duração inteira). */
function horariosDoDia(agenda, data, duracao) {
  const horarios = [];
  for (const livre of livresDoDia(agenda, data)) {
    let inicio = Math.ceil(livre.ini / agenda.blocoMin) * agenda.blocoMin;
    for (; inicio + duracao <= livre.fim; inicio += agenda.blocoMin) {
      horarios.push(paraHora(inicio));
    }
  }
  return horarios;
}

/** O dia não abre (dia da semana desmarcado ou folga do dia inteiro). */
function diaFechado(agenda, data) {
  const config = agenda.dias[diaDaSemana(data)];
  if (!config || !config.ativo) return true;
  return agenda.bloqueios.some(b => String(b.data).slice(0, 10) === data && !b.horario_inicio);
}

/** Acha o cliente pelo telefone (comparando só os números) ou cria um novo (origem = 'link'). */
async function clientePeloTelefone(negocioId, nome, digitos) {
  const [clientes] = await pool.query('SELECT id, nome, telefone FROM clientes WHERE usuario_id = ?', [negocioId]);
  const existente = clientes.find(c => {
    const d = soDigitos(c.telefone);
    // aceita com ou sem o 55 do Brasil na frente
    return d === digitos || d === `55${digitos}` || `55${d}` === digitos;
  });
  if (existente) return { cliente: existente, novo: false };

  try {
    const [resultado] = await pool.query(
      "INSERT INTO clientes (usuario_id, nome, telefone, origem) VALUES (?, ?, ?, 'link')",
      [negocioId, nome, formatarTelefone(digitos)]
    );
    return { cliente: { id: resultado.insertId, nome, telefone: formatarTelefone(digitos) }, novo: true };
  } catch (erro) {
    // se a coluna origem não aceitar 'link', cadastra como 'sistema'
    if (erro.errno !== 1265) throw erro;
    const [resultado] = await pool.query(
      'INSERT INTO clientes (usuario_id, nome, telefone) VALUES (?, ?, ?)',
      [negocioId, nome, formatarTelefone(digitos)]
    );
    return { cliente: { id: resultado.insertId, nome, telefone: formatarTelefone(digitos) }, novo: true };
  }
}

/** Confere nome, WhatsApp, aceite e a armadilha. Devolve { nome, digitos } ou { erro }. */
function lerDadosDoCliente(body) {
  if (body.site) return { erro: 'Não foi possível concluir. Tente de novo.' }; // armadilha preenchida = robô
  const nome = String(body.nome || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const digitos = soDigitos(body.telefone);
  if (nome.length < 2) return { erro: 'Digite o seu nome.' };
  if (digitos.length < 10 || digitos.length > 13) return { erro: 'Digite o seu WhatsApp com DDD.' };
  if (!body.aceite) return { erro: 'Marque a caixa para aceitar receber as mensagens sobre o agendamento.' };
  return { nome, digitos };
}

// GET /api/publico/:slug → cabeçalho do negócio + serviços liberados para o link
async function obterNegocio(req, res) {
  try {
    const negocio = await negocioPeloSlug(req.params.slug);
    if (!negocio) return res.status(404).json({ erro: 'Esse link de agendamento não existe ou está desligado.' });

    const [servicos] = await pool.query(
      'SELECT id, nome, valor, duracao_min FROM servicos WHERE usuario_id = ? AND mostrar_no_bot = 1 ORDER BY nome',
      [negocio.id]
    );

    res.json({
      negocio: {
        nome: negocio.nome_negocio || negocio.nome,
        descricao: negocio.descricao_negocio || '',
        endereco: negocio.endereco_negocio || '',
        foto: negocio.foto || null, // a mesma foto do Perfil (no lugar das iniciais)
        // a página pública usa as cores do negócio
        aparencia: {
          paleta: PALETAS.includes(negocio.paleta) ? negocio.paleta : 'salvia',
          corPrimaria: negocio.cor_primaria || null,
          corAcento: negocio.cor_acento || null,
          corDestaque: negocio.cor_destaque || null,
          tamanhoTexto: 'normal',
        },
      },
      servicos: servicos.map(s => ({ id: s.id, nome: s.nome, valor: Number(s.valor), duracao: s.duracao_min || 30 })),
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível abrir a página. Tente de novo.' });
  }
}

// GET /api/publico/:slug/dias?servicoId= → próximos 14 dias: quantos horários livres em cada (fechado some)
async function listarDias(req, res) {
  try {
    const negocio = await negocioPeloSlug(req.params.slug);
    if (!negocio) return res.status(404).json({ erro: 'Esse link de agendamento não existe ou está desligado.' });
    const servico = await servicoDoNegocio(negocio.id, req.query.servicoId);
    if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado.' });

    const hoje = hojeBrasilia();
    const ultimo = somarDias(hoje, DIAS_MOSTRADOS - 1);
    const agenda = await carregarAgenda(negocio.id, hoje, ultimo);
    const dias = [];
    for (let i = 0; i < DIAS_MOSTRADOS; i++) {
      const data = somarDias(hoje, i);
      if (diaFechado(agenda, data)) continue;
      const horarios = horariosDoDia(agenda, data, servico.duracao_min || 30);
      dias.push({ data, sigla: DIAS_SEMANA[diaDaSemana(data)], livres: horarios.length });
    }
    res.json({ dias });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível carregar os dias.' });
  }
}

// GET /api/publico/:slug/horarios?servicoId=&data= → horários livres do dia para esse serviço
async function listarHorarios(req, res) {
  try {
    const negocio = await negocioPeloSlug(req.params.slug);
    if (!negocio) return res.status(404).json({ erro: 'Esse link de agendamento não existe ou está desligado.' });
    const servico = await servicoDoNegocio(negocio.id, req.query.servicoId);
    if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado.' });
    const data = String(req.query.data || '');
    if (!DATA_REGEX.test(data) || data < hojeBrasilia()) return res.status(400).json({ erro: 'Dia inválido.' });

    const agenda = await carregarAgenda(negocio.id, data, data);
    res.json({ horarios: diaFechado(agenda, data) ? [] : horariosDoDia(agenda, data, servico.duracao_min || 30) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível carregar os horários.' });
  }
}

// POST /api/publico/:slug/agendar → { nome, telefone, servicoId, data, horario, aceite, site }
async function agendar(req, res) {
  try {
    const negocio = await negocioPeloSlug(req.params.slug);
    if (!negocio) return res.status(404).json({ erro: 'Esse link de agendamento não existe ou está desligado.' });

    const dados = lerDadosDoCliente(req.body);
    if (dados.erro) return res.status(400).json({ erro: dados.erro });

    const servico = await servicoDoNegocio(negocio.id, req.body.servicoId);
    if (!servico) return res.status(400).json({ erro: 'Escolha um serviço.' });
    const { data, horario } = req.body;
    if (!DATA_REGEX.test(String(data || '')) || !HORA_REGEX.test(String(horario || '')) || data < hojeBrasilia()) {
      return res.status(400).json({ erro: 'Escolha o dia e o horário.' });
    }

    // limite do negócio: no máximo 30 agendamentos pelo link por dia
    const [[{ hojePeloLink }]] = await pool.query(
      "SELECT COUNT(*) AS hojePeloLink FROM agendamentos WHERE usuario_id = ? AND origem = 'link' AND DATE(criado_em) = ?",
      [negocio.id, hojeBrasilia()]
    );
    if (hojePeloLink >= MAX_POR_DIA_NO_NEGOCIO) {
      return res.status(429).json({ erro: 'Muitos agendamentos hoje pelo link. Fale com o estabelecimento pelo WhatsApp.' });
    }

    // o horário ainda está livre? (alguém pode ter marcado enquanto a pessoa preenchia)
    const agenda = await carregarAgenda(negocio.id, data, data);
    if (diaFechado(agenda, data) || !horariosDoDia(agenda, data, servico.duracao_min || 30).includes(horario)) {
      return res.status(409).json({ erro: 'Esse horário acabou de ser ocupado. Escolha outro.' });
    }

    const { cliente, novo } = await clientePeloTelefone(negocio.id, dados.nome, dados.digitos);

    // limite por telefone: no máximo 2 agendamentos futuros feitos pelo link
    const [[{ futuros }]] = await pool.query(
      `SELECT COUNT(*) AS futuros FROM agendamentos
        WHERE usuario_id = ? AND cliente_id = ? AND origem = 'link' AND status = 'agendado' AND data >= ?`,
      [negocio.id, cliente.id, hojeBrasilia()]
    );
    if (futuros >= MAX_FUTUROS_POR_TELEFONE) {
      return res.status(429).json({ erro: 'Você já tem horários marcados. Para marcar mais, fale com o estabelecimento pelo WhatsApp.' });
    }

    const [resultado] = await pool.query(
      `INSERT INTO agendamentos (usuario_id, cliente_id, servico_id, data, horario, status, origem)
       VALUES (?, ?, ?, ?, ?, 'agendado', 'link')`,
      [negocio.id, cliente.id, servico.id, data, horario]
    );

    // aviso para o dono e a equipe (sininho e Início)
    const quando = `${DIAS_SEMANA[diaDaSemana(data)]} ${data.slice(8, 10)}/${data.slice(5, 7)} às ${horario}`;
    await pool.query(
      "INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo) VALUES (?, ?, ?, 'novo_agendamento_link')",
      [
        negocio.id,
        'Novo agendamento pelo link',
        `${cliente.nome} agendou ${servico.nome} para ${quando} pelo link${novo ? ' (cliente novo, cadastrado agora)' : ''}.`,
      ]
    ).catch(erro => console.error('Aviso do link falhou:', erro.message));

    res.status(201).json({
      agendamento: {
        id: resultado.insertId,
        servico: servico.nome,
        valor: Number(servico.valor),
        duracao: servico.duracao_min || 30,
        data,
        horario,
      },
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível agendar. Tente de novo.' });
  }
}

// POST /api/publico/:slug/espera → { nome, telefone, servicoId, data, aceite, site }: dia lotado → lista de espera
async function entrarNaEspera(req, res) {
  try {
    const negocio = await negocioPeloSlug(req.params.slug);
    if (!negocio) return res.status(404).json({ erro: 'Esse link de agendamento não existe ou está desligado.' });

    const dados = lerDadosDoCliente(req.body);
    if (dados.erro) return res.status(400).json({ erro: dados.erro });
    const servico = await servicoDoNegocio(negocio.id, req.body.servicoId);
    if (!servico) return res.status(400).json({ erro: 'Escolha um serviço.' });
    const data = String(req.body.data || '');
    if (!DATA_REGEX.test(data) || data < hojeBrasilia()) return res.status(400).json({ erro: 'Escolha o dia.' });

    const { cliente } = await clientePeloTelefone(negocio.id, dados.nome, dados.digitos);

    const [[repetida]] = await pool.query(
      `SELECT id FROM lista_espera
        WHERE usuario_id = ? AND cliente_id = ? AND servico_id = ? AND data_preferida = ? AND status IN ('aguardando', 'contatado')`,
      [negocio.id, cliente.id, servico.id, data]
    );
    if (!repetida) {
      await pool.query(
        `INSERT INTO lista_espera (usuario_id, cliente_id, servico_id, data_preferida, periodo, origem, status)
         VALUES (?, ?, ?, ?, 'qualquer', 'link', 'aguardando')`,
        [negocio.id, cliente.id, servico.id, data]
      );
    }
    res.status(201).json({ mensagem: 'Pronto! Se abrir uma vaga nesse dia, o estabelecimento te avisa pelo WhatsApp.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível entrar na lista de espera. Tente de novo.' });
  }
}

module.exports = { obterNegocio, listarDias, listarHorarios, agendar, entrarNaEspera };
