// src/controllers/listaEsperaController.js
// Lista de espera: clientes que queriam um horário que estava cheio.
//
// Colunas da tabela lista_espera (banco do Aiven):
//   cliente_id, servico_id, data_preferida (NULL = qualquer dia), horario_preferido (NULL = qualquer horário),
//   periodo ('manha' | 'tarde' | 'qualquer'), observacao, origem ('sistema' | 'whatsapp' | 'link'),
//   status: 'aguardando' → na fila
//           'contatado'  → na fila, e já foi avisado pelo WhatsApp que abriu vaga
//           'convertido' → encaixado (virou agendamento, agendamento_id preenchido)
//           'cancelado'  → desistiu (removido da fila)
//   "Expirou" não é gravado: é quem continua na fila com a data desejada já passada (RN10).
//   criado_em, atualizado_em (quando saiu da fila).
const { pool } = require('../config/db');

const PERIODOS = ['manha', 'tarde', 'qualquer'];
const ORIGENS = ['sistema', 'whatsapp', 'link'];
const NA_FILA = ['aguardando', 'contatado'];
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DIAS_PROCURA = 14; // "qualquer dia": procura vaga nos próximos 14 dias
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// =====================================================================
//  DATAS E HORAS (sempre no horário de Brasília)
// =====================================================================
function paraMinutos(hhmm) {
  const [h, m] = String(hhmm).split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function paraHora(minutos) {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

function agoraBrasilia() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
}

function hojeBrasilia() {
  return agoraBrasilia().slice(0, 10);
}

function somarDias(data, dias) {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

function diaDaSemana(data) {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/** '2026-10-17' + '10:00' → 'sáb 17/10 às 10:00' */
function textoVaga(data, horario) {
  return `${DIAS_SEMANA[diaDaSemana(data)]} ${data.slice(8, 10)}/${data.slice(5, 7)} às ${horario}`;
}

// =====================================================================
//  HORÁRIOS LIVRES (a mesma conta da Início e da Agenda)
//  livre = expediente − pausa − folgas − agendamentos que ocupam horário
// =====================================================================

/** Junta numa ida ao banco tudo o que é preciso para achar vagas entre duas datas. */
async function carregarAgenda(usuarioId, de, ate) {
  const [[horarioRow]] = await pool.query('SELECT * FROM horarios_trabalho WHERE usuario_id = ?', [usuarioId]);
  let dias = null;
  if (horarioRow) {
    dias = typeof horarioRow.dias === 'string' ? JSON.parse(horarioRow.dias) : horarioRow.dias;
  }
  if (!Array.isArray(dias) || dias.length !== 7) {
    // padrão do sistema: segunda a sábado, 08:00 às 18:00
    dias = [0, 1, 2, 3, 4, 5, 6].map(i => ({ ativo: i !== 0, inicio: '08:00', fim: '18:00' }));
  }
  const blocoMin = [15, 30, 45, 60].includes(Number(horarioRow?.bloco_min)) ? Number(horarioRow.bloco_min) : 30;

  const [bloqueios] = await pool.query(
    'SELECT data, horario_inicio, horario_fim, motivo FROM bloqueios WHERE usuario_id = ? AND data BETWEEN ? AND ?',
    [usuarioId, de, ate]
  );
  const [agendamentos] = await pool.query(
    `SELECT a.data, a.horario, s.duracao_min
       FROM agendamentos a JOIN servicos s ON s.id = a.servico_id
      WHERE a.usuario_id = ? AND a.data BETWEEN ? AND ? AND a.status IN ('agendado', 'realizado')`,
    [usuarioId, de, ate]
  );
  return { dias, blocoMin, bloqueios, agendamentos };
}

/** Intervalos livres de um dia, em minutos: [{ ini, fim }]. Hoje: só a partir de agora. */
function livresDoDia(agenda, data) {
  const config = agenda.dias[diaDaSemana(data)];
  if (!config || !config.ativo) return [];
  const doDia = agenda.bloqueios.filter(b => String(b.data).slice(0, 10) === data);
  if (doDia.some(b => !b.horario_inicio)) return []; // folga do dia inteiro

  const inicioDia = paraMinutos(config.inicio);
  const fimDia = paraMinutos(config.fim);
  let cursor = inicioDia;
  const hoje = hojeBrasilia();
  if (data < hoje) return [];
  if (data === hoje) {
    const agora = agoraBrasilia();
    const agoraMin = paraMinutos(agora.slice(11, 16));
    cursor = Math.max(cursor, Math.ceil(agoraMin / agenda.blocoMin) * agenda.blocoMin);
  }

  const ocupados = agenda.agendamentos
    .filter(a => String(a.data).slice(0, 10) === data)
    .map(a => ({ ini: paraMinutos(String(a.horario).slice(0, 5)), fim: paraMinutos(String(a.horario).slice(0, 5)) + (a.duracao_min || 30) }));
  if (config.pausaInicio && config.pausaFim) {
    ocupados.push({ ini: paraMinutos(config.pausaInicio), fim: paraMinutos(config.pausaFim) });
  }
  for (const b of doDia) {
    ocupados.push({ ini: paraMinutos(String(b.horario_inicio).slice(0, 5)), fim: paraMinutos(String(b.horario_fim).slice(0, 5)) });
  }
  ocupados.sort((a, b) => a.ini - b.ini);

  const livres = [];
  for (const o of ocupados) {
    if (o.ini > cursor) livres.push({ ini: cursor, fim: Math.min(o.ini, fimDia) });
    cursor = Math.max(cursor, o.fim);
  }
  if (fimDia > cursor) livres.push({ ini: cursor, fim: fimDia });
  return livres.filter(l => l.fim > l.ini);
}

/**
 * Primeira vaga que serve para a entrada (RN-LE1): dia certo (ou qualquer dia),
 * dentro do período (manhã começa antes das 12h, tarde a partir das 12h)
 * e com tempo livre para a duração do serviço.
 * Devolve { data, horario } ou null.
 */
function vagaPara(agenda, entrada, duracao, dataUnica = null) {
  const hoje = hojeBrasilia();
  const datas = dataUnica
    ? [dataUnica]
    : entrada.data_preferida
      ? [String(entrada.data_preferida).slice(0, 10)]
      : Array.from({ length: DIAS_PROCURA }, (_, i) => somarDias(hoje, i));

  for (const data of datas) {
    if (data < hoje) continue;
    if (entrada.data_preferida && String(entrada.data_preferida).slice(0, 10) !== data) continue;
    for (const livre of livresDoDia(agenda, data)) {
      let inicio;
      if (entrada.horario_preferido) {
        inicio = paraMinutos(String(entrada.horario_preferido).slice(0, 5)); // quer exatamente esse horário
      } else {
        const minimo = entrada.periodo === 'tarde' ? Math.max(livre.ini, 12 * 60) : livre.ini;
        inicio = Math.ceil(minimo / agenda.blocoMin) * agenda.blocoMin; // começa num horário "redondo"
        if (inicio < livre.ini) inicio = livre.ini;
      }
      if (inicio < livre.ini || inicio + duracao > livre.fim) continue;
      if (entrada.periodo === 'manha' && inicio >= 12 * 60) continue;
      if (entrada.periodo === 'tarde' && inicio < 12 * 60) continue;
      return { data, horario: paraHora(inicio) };
    }
  }
  return null;
}

// =====================================================================
//  FORMATAÇÃO
// =====================================================================
const SELECT_ENTRADAS = `
  SELECT le.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone,
         s.nome AS servico_nome, s.duracao_min, s.valor AS servico_valor,
         a.data AS ag_data, a.horario AS ag_horario, a.criado_em AS ag_criado_em
    FROM lista_espera le
    JOIN clientes c ON c.id = le.cliente_id
    JOIN servicos s ON s.id = le.servico_id
    LEFT JOIN agendamentos a ON a.id = le.agendamento_id`;

function formatarEntrada(linha, vaga = null) {
  const dataPreferida = linha.data_preferida ? String(linha.data_preferida).slice(0, 10) : null;
  let situacao = linha.status === 'convertido' ? 'encaixado'
    : linha.status === 'cancelado' ? 'desistiu'
    : linha.status === 'contatado' ? 'avisado'
    : 'aguardando';
  // RN10: a data desejada passou e ninguém encaixou → expirou
  if ((situacao === 'aguardando' || situacao === 'avisado') && dataPreferida && dataPreferida < hojeBrasilia()) {
    situacao = 'expirado';
  }
  return {
    id: linha.id,
    clienteId: linha.cliente_id,
    clienteNome: linha.cliente_nome,
    clienteTelefone: linha.cliente_telefone,
    servicoId: linha.servico_id,
    servicoNome: linha.servico_nome,
    duracao: linha.duracao_min || 30,
    valor: Number(linha.servico_valor) || 0,
    dataPreferida,                                                    // null = qualquer dia
    horarioPreferido: linha.horario_preferido ? String(linha.horario_preferido).slice(0, 5) : null,
    periodo: PERIODOS.includes(linha.periodo) ? linha.periodo : 'qualquer',
    observacao: linha.observacao || '',
    origem: ORIGENS.includes(linha.origem) ? linha.origem : 'sistema',
    situacao,                                                         // aguardando | avisado | encaixado | desistiu | expirado
    criadoEm: linha.criado_em || null,
    saiuEm: linha.atualizado_em || linha.ag_criado_em || null,        // quando saiu da fila
    agendamentoId: linha.agendamento_id || null,
    encaixadoEm: linha.ag_data ? { data: String(linha.ag_data).slice(0, 10), horario: String(linha.ag_horario).slice(0, 5) } : null,
    vaga,                                                             // { data, horario } quando há vaga compatível agora
  };
}

/** Confere cliente, serviço, data, período e horário do formulário. Devolve { dados } ou { erro }. */
async function lerFormulario(body, usuarioId) {
  const clienteId = Number(body.clienteId);
  const servicoId = Number(body.servicoId);
  const dataPreferida = body.dataPreferida || null;
  const horarioPreferido = body.horarioPreferido || null;
  const periodo = PERIODOS.includes(body.periodo) ? body.periodo : 'qualquer';
  const observacao = String(body.observacao || '').trim().slice(0, 500) || null;

  if (!clienteId || !servicoId) return { erro: 'Escolha o cliente e o serviço.' };
  if (dataPreferida && (!DATA_REGEX.test(dataPreferida) || dataPreferida < hojeBrasilia())) {
    return { erro: 'Escolha um dia de hoje em diante (ou "qualquer dia").' };
  }
  if (horarioPreferido && !HORA_REGEX.test(horarioPreferido)) return { erro: 'Horário inválido.' };

  const [[cliente]] = await pool.query('SELECT id FROM clientes WHERE id = ? AND usuario_id = ?', [clienteId, usuarioId]);
  if (!cliente) return { erro: 'Cliente inválido.' };
  const [[servico]] = await pool.query('SELECT id FROM servicos WHERE id = ? AND usuario_id = ?', [servicoId, usuarioId]);
  if (!servico) return { erro: 'Serviço inválido.' };

  return { dados: { clienteId, servicoId, dataPreferida, horarioPreferido, periodo, observacao } };
}

// =====================================================================
//  ROTAS
// =====================================================================

// GET /api/lista-espera → { aguardando, historico, numeros, destaque }
async function listar(req, res) {
  try {
    const usuarioId = req.usuarioId;
    const hoje = hojeBrasilia();
    const mes = hoje.slice(0, 7);

    const [linhas] = await pool.query(`${SELECT_ENTRADAS} WHERE le.usuario_id = ? ORDER BY le.criado_em, le.id`, [usuarioId]);
    const agenda = await carregarAgenda(usuarioId, hoje, somarDias(hoje, DIAS_PROCURA));

    const aguardando = [];
    const historico = [];
    for (const linha of linhas) {
      const base = formatarEntrada(linha);
      if (base.situacao === 'aguardando' || base.situacao === 'avisado') {
        aguardando.push(formatarEntrada(linha, vagaPara(agenda, linha, linha.duracao_min || 30)));
      } else {
        historico.push(base);
      }
    }

    // histórico: os mais recentes primeiro (no máximo 20)
    const quando = (e) => String(e.situacao === 'expirado' ? e.dataPreferida : e.saiuEm || e.criadoEm || '');
    historico.sort((a, b) => quando(b).localeCompare(quando(a)));

    // números do mês
    const doMes = (e) => quando(e).slice(0, 7) === mes;
    const encaixadosMes = historico.filter(e => e.situacao === 'encaixado' && doMes(e));
    const numeros = {
      aguardando: aguardando.length,
      encaixadosMes: encaixadosMes.length,
      recuperadoMes: encaixadosMes.reduce((soma, e) => soma + e.valor, 0),
      desistiramMes: historico.filter(e => (e.situacao === 'desistiu' || e.situacao === 'expirado') && doMes(e)).length,
    };

    // destaque: a 1ª da fila que tem vaga (e quem cancelou aquele horário, se foi um cancelamento)
    let destaque = null;
    const primeira = aguardando.find(e => e.vaga);
    if (primeira) {
      const [[cancelado]] = await pool.query(
        `SELECT c.nome FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id
          WHERE a.usuario_id = ? AND a.data = ? AND a.horario = ? AND a.status = 'cancelado'
          ORDER BY a.status_em DESC LIMIT 1`,
        [usuarioId, primeira.vaga.data, `${primeira.vaga.horario}:00`]
      );
      destaque = {
        entradaId: primeira.id,
        data: primeira.vaga.data,
        horario: primeira.vaga.horario,
        texto: textoVaga(primeira.vaga.data, primeira.vaga.horario),
        quemCancelou: cancelado ? cancelado.nome : null,
      };
    }

    res.json({ aguardando, historico: historico.slice(0, 20), numeros, destaque });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao carregar a lista de espera.' });
  }
}

// POST /api/lista-espera → { clienteId, servicoId, dataPreferida, periodo, horarioPreferido, observacao }
async function criar(req, res) {
  try {
    const { dados, erro } = await lerFormulario(req.body, req.usuarioId);
    if (erro) return res.status(400).json({ erro });

    // a mesma pessoa não entra duas vezes na fila para o mesmo serviço e dia
    const [[repetida]] = await pool.query(
      `SELECT id FROM lista_espera
        WHERE usuario_id = ? AND cliente_id = ? AND servico_id = ? AND status IN ('aguardando', 'contatado')
          AND (data_preferida <=> ?)`,
      [req.usuarioId, dados.clienteId, dados.servicoId, dados.dataPreferida]
    );
    if (repetida) {
      return res.status(409).json({ erro: 'Esse cliente já está na fila para esse serviço e dia.' });
    }

    const origem = ORIGENS.includes(req.body.origem) ? req.body.origem : 'sistema';
    const [resultado] = await pool.query(
      `INSERT INTO lista_espera
         (usuario_id, cliente_id, servico_id, data_preferida, horario_preferido, periodo, observacao, origem, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aguardando')`,
      [req.usuarioId, dados.clienteId, dados.servicoId, dados.dataPreferida, dados.horarioPreferido, dados.periodo, dados.observacao, origem]
    );
    const [[linha]] = await pool.query(`${SELECT_ENTRADAS} WHERE le.id = ?`, [resultado.insertId]);
    res.status(201).json({ entrada: formatarEntrada(linha) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao adicionar na lista de espera.' });
  }
}

// PUT /api/lista-espera/:id → editar quem ainda está na fila
async function atualizar(req, res) {
  try {
    const { dados, erro } = await lerFormulario(req.body, req.usuarioId);
    if (erro) return res.status(400).json({ erro });

    const [resultado] = await pool.query(
      `UPDATE lista_espera
          SET cliente_id = ?, servico_id = ?, data_preferida = ?, horario_preferido = ?, periodo = ?, observacao = ?
        WHERE id = ? AND usuario_id = ? AND status IN ('aguardando', 'contatado')`,
      [dados.clienteId, dados.servicoId, dados.dataPreferida, dados.horarioPreferido, dados.periodo, dados.observacao, req.params.id, req.usuarioId]
    );
    if (resultado.affectedRows === 0) return res.status(404).json({ erro: 'Essa pessoa não está mais na fila.' });

    const [[linha]] = await pool.query(`${SELECT_ENTRADAS} WHERE le.id = ?`, [req.params.id]);
    res.json({ entrada: formatarEntrada(linha) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao editar.' });
  }
}

// DELETE /api/lista-espera/:id → "Remover": sai da fila como desistiu (fica no histórico)
async function remover(req, res) {
  try {
    const [resultado] = await pool.query(
      `UPDATE lista_espera SET status = 'cancelado', atualizado_em = ?
        WHERE id = ? AND usuario_id = ? AND status IN ('aguardando', 'contatado')`,
      [agoraBrasilia(), req.params.id, req.usuarioId]
    );
    if (resultado.affectedRows === 0) return res.status(404).json({ erro: 'Essa pessoa não está mais na fila.' });
    res.json({ mensagem: 'Removido da fila.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao remover da fila.' });
  }
}

// PUT /api/lista-espera/:id/avisado → clicou em "Avisar pelo WhatsApp" (continua na fila)
async function marcarAvisado(req, res) {
  try {
    await pool.query(
      "UPDATE lista_espera SET status = 'contatado' WHERE id = ? AND usuario_id = ? AND status = 'aguardando'",
      [req.params.id, req.usuarioId]
    );
    res.json({ mensagem: 'Marcado como avisado.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao marcar como avisado.' });
  }
}

// POST /api/lista-espera/:id/encaixar → { data, horario }: cria o agendamento e tira da fila
async function encaixar(req, res) {
  const { data, horario } = req.body;
  if (!DATA_REGEX.test(String(data || '')) || !HORA_REGEX.test(String(horario || ''))) {
    return res.status(400).json({ erro: 'Escolha o dia e o horário.' });
  }

  try {
    const [[linha]] = await pool.query(
      `${SELECT_ENTRADAS} WHERE le.id = ? AND le.usuario_id = ? AND le.status IN ('aguardando', 'contatado')`,
      [req.params.id, req.usuarioId]
    );
    if (!linha) return res.status(404).json({ erro: 'Essa pessoa não está mais na fila.' });

    // confere se o horário ainda está livre (alguém pode ter marcado nesse meio tempo)
    const agenda = await carregarAgenda(req.usuarioId, data, data);
    const inicio = paraMinutos(horario);
    const cabe = livresDoDia(agenda, data).some(l => inicio >= l.ini && inicio + (linha.duracao_min || 30) <= l.fim);
    if (!cabe) {
      return res.status(409).json({ erro: 'Esse horário não está mais livre. Escolha outro.' });
    }

    const observacao = linha.observacao ? String(linha.observacao).slice(0, 255) : null;
    const valores = [req.usuarioId, linha.cliente_id, linha.servico_id, data, horario, observacao, req.usuarioLogadoId];
    let resultado;
    try {
      [resultado] = await pool.query(
        `INSERT INTO agendamentos (usuario_id, cliente_id, servico_id, data, horario, status, observacao, origem, criado_por)
         VALUES (?, ?, ?, ?, ?, 'agendado', ?, 'lista_espera', ?)`,
        valores
      );
    } catch (erro) {
      // se a coluna origem do banco não tiver a opção 'lista_espera', grava como 'sistema'
      if (erro.code !== 'WARN_DATA_TRUNCATED' && erro.code !== 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' && erro.errno !== 1265) throw erro;
      [resultado] = await pool.query(
        `INSERT INTO agendamentos (usuario_id, cliente_id, servico_id, data, horario, status, observacao, origem, criado_por)
         VALUES (?, ?, ?, ?, ?, 'agendado', ?, 'sistema', ?)`,
        valores
      );
    }

    await pool.query(
      "UPDATE lista_espera SET status = 'convertido', agendamento_id = ?, atualizado_em = ? WHERE id = ?",
      [resultado.insertId, agoraBrasilia(), linha.id]
    );

    res.status(201).json({
      agendamentoId: resultado.insertId,
      mensagem: `${linha.cliente_nome} encaixada em ${textoVaga(data, horario)}.`,
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao encaixar.' });
  }
}

// =====================================================================
//  VAGA LIBERADA (chamado pela Agenda ao cancelar ou reagendar)
// =====================================================================

/**
 * Um horário ficou livre: se alguém da fila serve para ele, grava o aviso
 * "vaga liberada" (aparece no sininho e na Início). Nunca encaixa sozinho.
 * Erros aqui não atrapalham o cancelamento: só ficam no log.
 */
async function avisarVagaLiberada(usuarioId, data, horario, motivo) {
  try {
    if (!data || data < hojeBrasilia()) return;
    const [fila] = await pool.query(
      `SELECT le.*, c.nome AS cliente_nome, s.duracao_min
         FROM lista_espera le
         JOIN clientes c ON c.id = le.cliente_id
         JOIN servicos s ON s.id = le.servico_id
        WHERE le.usuario_id = ? AND le.status IN ('aguardando', 'contatado')
          AND (le.data_preferida IS NULL OR le.data_preferida = ?)
        ORDER BY le.criado_em, le.id`,
      [usuarioId, data]
    );
    if (fila.length === 0) return;

    const agenda = await carregarAgenda(usuarioId, data, data);
    const inicioLiberado = paraMinutos(horario);
    for (const entrada of fila) {
      const vaga = vagaPara(agenda, entrada, entrada.duracao_min || 30, data);
      // serve se a vaga encontrada é no mesmo trecho livre que acabou de abrir
      if (!vaga) continue;
      const trecho = livresDoDia(agenda, data).find(l => paraMinutos(vaga.horario) >= l.ini && paraMinutos(vaga.horario) < l.fim);
      if (!trecho || inicioLiberado < trecho.ini || inicioLiberado >= trecho.fim) continue;

      const quem = motivo ? ` (${motivo})` : ''; // ex.: "(Sônia Alves cancelou)"
      await pool.query(
        "INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo) VALUES (?, ?, ?, 'vaga_liberada')",
        [
          usuarioId,
          'Vaga liberada',
          `Vaga liberada: ${textoVaga(vaga.data, vaga.horario)}${quem}. ${entrada.cliente_nome} é a 1ª da lista de espera para esse horário.`,
        ]
      );
      return; // RN09: só a mais antiga
    }
  } catch (erro) {
    console.error('Aviso de vaga liberada falhou:', erro);
  }
}

/** Quantos estão na fila (bolinha do menu e número da Início). */
async function contarNaFila(usuarioId) {
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM lista_espera
      WHERE usuario_id = ? AND status IN ('aguardando', 'contatado')
        AND (data_preferida IS NULL OR data_preferida >= ?)`,
    [usuarioId, hojeBrasilia()]
  );
  return Number(total) || 0;
}

module.exports = {
  listar,
  criar,
  atualizar,
  remover,
  marcarAvisado,
  encaixar,
  avisarVagaLiberada,
  contarNaFila,
  // usados pelo link público de agendamento (próxima parte)
  carregarAgenda,
  livresDoDia,
  NA_FILA,
};
