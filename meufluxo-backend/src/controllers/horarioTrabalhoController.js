// src/controllers/horarioTrabalhoController.js
// Horário de trabalho (com a pausa do almoço) e as folgas/feriados (tabela bloqueios).
// Colunas de bloqueios: data, horario_inicio, horario_fim (NULL = dia inteiro), motivo.
// Vale para a Início, a Agenda, a busca e, depois, o bot e o link de agendamento.
const { pool } = require('../config/db');

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const BLOCOS = [15, 30, 45, 60];

function paraMinutos(hhmm) {
  const [h, m] = String(hhmm).split(':');
  return Number(h) * 60 + Number(m);
}

/** Hoje no horário de Brasília ('YYYY-MM-DD'). */
function hojeBrasilia() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10);
}

function formatarHorario(linha) {
  return {
    blocoMin: linha.bloco_min,
    dias: typeof linha.dias === 'string' ? JSON.parse(linha.dias) : linha.dias,
  };
}

function formatarBloqueio(linha) {
  return {
    id: linha.id,
    data: String(linha.data).slice(0, 10),
    horaInicio: linha.horario_inicio ? String(linha.horario_inicio).slice(0, 5) : null, // null = dia inteiro
    horaFim: linha.horario_fim ? String(linha.horario_fim).slice(0, 5) : null,
    descricao: linha.motivo || '',
  };
}

/** Folgas de hoje em diante (as que já passaram não interessam mais). */
async function bloqueiosFuturos(usuarioId) {
  const [linhas] = await pool.query(
    'SELECT * FROM bloqueios WHERE usuario_id = ? AND data >= ? ORDER BY data, horario_inicio',
    [usuarioId, hojeBrasilia()]
  );
  return linhas.map(formatarBloqueio);
}

/**
 * Confere e limpa os 7 dias que vieram do front.
 * Cada dia: { ativo, inicio, fim, pausaInicio, pausaFim } (pausa vazia = sem pausa).
 * Devolve { dias } ou { erro }.
 */
function limparDias(dias) {
  const nomes = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  if (!Array.isArray(dias) || dias.length !== 7) return { erro: 'Horário de trabalho inválido.' };

  const limpos = [];
  for (let i = 0; i < 7; i++) {
    const d = dias[i] || {};
    const dia = {
      ativo: !!d.ativo,
      inicio: HORA_REGEX.test(d.inicio) ? d.inicio : '08:00',
      fim: HORA_REGEX.test(d.fim) ? d.fim : '18:00',
      pausaInicio: HORA_REGEX.test(d.pausaInicio) ? d.pausaInicio : '',
      pausaFim: HORA_REGEX.test(d.pausaFim) ? d.pausaFim : '',
    };

    if (dia.ativo) {
      if (paraMinutos(dia.fim) <= paraMinutos(dia.inicio)) {
        return { erro: `${nomes[i]}: o horário de fechar precisa ser depois do de abrir.` };
      }
      // pausa: as duas horas ou nenhuma, e dentro do expediente
      if (!!dia.pausaInicio !== !!dia.pausaFim) {
        return { erro: `${nomes[i]}: preencha o começo e o fim da pausa (ou deixe as duas vazias).` };
      }
      if (dia.pausaInicio) {
        const pi = paraMinutos(dia.pausaInicio);
        const pf = paraMinutos(dia.pausaFim);
        if (pf <= pi || pi <= paraMinutos(dia.inicio) || pf >= paraMinutos(dia.fim)) {
          return { erro: `${nomes[i]}: a pausa precisa ficar dentro do horário de trabalho.` };
        }
      }
    }
    limpos.push(dia);
  }
  if (!limpos.some(d => d.ativo)) return { erro: 'Marque ao menos um dia de trabalho.' };
  return { dias: limpos };
}

// GET /api/horario-trabalho → { horario, bloqueios }
async function obter(req, res) {
  try {
    const [linhas] = await pool.query(
      'SELECT * FROM horarios_trabalho WHERE usuario_id = ?',
      [req.usuarioId]
    );
    res.json({
      horario: linhas.length ? formatarHorario(linhas[0]) : null,
      bloqueios: await bloqueiosFuturos(req.usuarioId),
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar horário de trabalho.' });
  }
}

// PUT /api/horario-trabalho → { blocoMin, dias }
async function salvar(req, res) {
  try {
    const { blocoMin } = req.body;
    if (!BLOCOS.includes(Number(blocoMin))) {
      return res.status(400).json({ erro: 'Escolha o tamanho de cada horário.' });
    }
    const { dias, erro } = limparDias(req.body.dias);
    if (erro) return res.status(400).json({ erro });

    await pool.query(
      `INSERT INTO horarios_trabalho (usuario_id, bloco_min, dias)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE bloco_min = VALUES(bloco_min), dias = VALUES(dias)`,
      [req.usuarioId, Number(blocoMin), JSON.stringify(dias)]
    );

    const [linhas] = await pool.query(
      'SELECT * FROM horarios_trabalho WHERE usuario_id = ?',
      [req.usuarioId]
    );

    res.json({ horario: formatarHorario(linhas[0]), bloqueios: await bloqueiosFuturos(req.usuarioId) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao salvar horário de trabalho.' });
  }
}

// GET /api/horario-trabalho/bloqueios → folgas e feriados de hoje em diante
async function listarBloqueios(req, res) {
  try {
    res.json({ bloqueios: await bloqueiosFuturos(req.usuarioId) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar as folgas.' });
  }
}

/** '2026-10-20' + 1 dia → '2026-10-21' (sem fuso: conta só a data). */
function somarUmDia(data) {
  const [ano, mes, dia] = data.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + 1));
  return d.toISOString().slice(0, 10);
}

// POST /api/horario-trabalho/bloqueios → { data, dataFim, descricao, horaInicio, horaFim }
// - um dia só: pode ser o dia inteiro ou só um período (horaInicio/horaFim);
// - vários dias (dataFim depois de data, ex.: férias): cada dia vira uma linha, sempre o dia inteiro.
async function criarBloqueio(req, res) {
  const { data } = req.body;
  const dataFim = req.body.dataFim || data;
  const descricao = String(req.body.descricao || '').trim();
  let horaInicio = req.body.horaInicio || null;
  let horaFim = req.body.horaFim || null;

  if (!DATA_REGEX.test(String(data || '')) || !DATA_REGEX.test(String(dataFim || ''))) {
    return res.status(400).json({ erro: 'Escolha a data.' });
  }
  if (data < hojeBrasilia()) {
    return res.status(400).json({ erro: 'Essa data já passou.' });
  }
  if (dataFim < data) {
    return res.status(400).json({ erro: 'A data final precisa ser depois da inicial.' });
  }
  if (!descricao) {
    return res.status(400).json({ erro: 'Dê um nome para o bloqueio (ex.: Férias, Folga, Finados).' });
  }
  if (descricao.length > 150) {
    return res.status(400).json({ erro: 'O nome pode ter no máximo 150 caracteres.' });
  }

  // monta a lista de dias (no máximo 90, para ninguém bloquear o ano inteiro sem querer)
  const dias = [];
  for (let d = data; d <= dataFim; d = somarUmDia(d)) {
    dias.push(d);
    if (dias.length > 90) {
      return res.status(400).json({ erro: 'Bloqueie no máximo 90 dias de uma vez.' });
    }
  }
  if (dias.length > 1) {
    horaInicio = null; // vários dias: sempre o dia inteiro
    horaFim = null;
  }

  if (!!horaInicio !== !!horaFim) {
    return res.status(400).json({ erro: 'Preencha as duas horas, ou marque "dia inteiro".' });
  }
  if (horaInicio && (!HORA_REGEX.test(horaInicio) || !HORA_REGEX.test(horaFim) || paraMinutos(horaFim) <= paraMinutos(horaInicio))) {
    return res.status(400).json({ erro: 'A hora final precisa ser depois da inicial.' });
  }

  try {
    const ids = [];
    for (const dia of dias) {
      const [resultado] = await pool.query(
        'INSERT INTO bloqueios (usuario_id, data, horario_inicio, horario_fim, motivo) VALUES (?, ?, ?, ?, ?)',
        [req.usuarioId, dia, horaInicio, horaFim, descricao]
      );
      ids.push(resultado.insertId);
    }

    // avisa se já tem gente marcada no período bloqueado (os agendamentos continuam)
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM agendamentos
        WHERE usuario_id = ? AND data BETWEEN ? AND ? AND status = 'agendado'
          ${horaInicio ? 'AND horario >= ? AND horario < ?' : ''}`,
      horaInicio ? [req.usuarioId, data, dataFim, horaInicio, horaFim] : [req.usuarioId, data, dataFim]
    );

    const [linhas] = await pool.query('SELECT * FROM bloqueios WHERE id IN (?) ORDER BY data', [ids]);
    res.status(201).json({ bloqueios: linhas.map(formatarBloqueio), agendamentosNoPeriodo: Number(total) || 0 });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao bloquear o dia.' });
  }
}

// DELETE /api/horario-trabalho/bloqueios/:id
async function removerBloqueio(req, res) {
  try {
    const [resultado] = await pool.query(
      'DELETE FROM bloqueios WHERE id = ? AND usuario_id = ?',
      [req.params.id, req.usuarioId]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Bloqueio não encontrado.' });
    }
    res.json({ mensagem: 'Bloqueio removido.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao remover o bloqueio.' });
  }
}

module.exports = { obter, salvar, listarBloqueios, criarBloqueio, removerBloqueio };
