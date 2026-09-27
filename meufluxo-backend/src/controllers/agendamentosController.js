const { pool } = require('../config/db');

function paraMinutos(hhmm) {
  const [h, m] = String(hhmm).split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

// Confere expediente e conflito de horário (mesma regra do front-end).
// Devolve a mensagem do problema, ou null se puder agendar.
// idIgnorado: usado ao reativar um agendamento, para ele não conflitar consigo mesmo.
async function validarHorario(usuarioId, data, horario, servicoId, idIgnorado = null) {
  const [servicoRows] = await pool.query(
    'SELECT duracao_min FROM servicos WHERE id = ? AND usuario_id = ?',
    [servicoId, usuarioId]
  );
  const duracao = servicoRows[0]?.duracao_min || 30;
  const inicioNovo = paraMinutos(horario);
  const fimNovo = inicioNovo + duracao;

  // expediente: só confere se o usuário já salvou um horário de trabalho no Perfil
  const [horarioRows] = await pool.query(
    'SELECT dias FROM horarios_trabalho WHERE usuario_id = ?',
    [usuarioId]
  );
  if (horarioRows.length > 0) {
    const bruto = horarioRows[0].dias;
    const dias = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
    const [ano, mes, dia] = data.split('-').map(Number);
    const diaConfig = dias[new Date(ano, mes - 1, dia).getDay()];

    if (!diaConfig || !diaConfig.ativo) {
      return 'Você não atende nesse dia da semana.';
    }
    if (inicioNovo < paraMinutos(diaConfig.inicio) || fimNovo > paraMinutos(diaConfig.fim)) {
      return `Esse horário fica fora do seu expediente (${diaConfig.inicio} às ${diaConfig.fim}).`;
    }
  }

  // conflito: busca os agendamentos do mesmo dia (menos os cancelados) com a duração de cada serviço
  const [outros] = await pool.query(
    `SELECT a.id, a.horario, s.duracao_min, c.nome AS cliente_nome
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       JOIN clientes c ON c.id = a.cliente_id
      WHERE a.usuario_id = ? AND a.data = ? AND a.status <> 'cancelado' AND a.id <> ?`,
    [usuarioId, data, idIgnorado || 0]
  );

  const conflito = outros.find(o => {
    const inicioOutro = paraMinutos(o.horario);
    const fimOutro = inicioOutro + (o.duracao_min || 30);
    return inicioNovo < fimOutro && inicioOutro < fimNovo;
  });

  if (conflito) {
    return `Esse horário conflita com o agendamento de ${conflito.cliente_nome} às ${String(conflito.horario).slice(0, 5)}.`;
  }

  return null;
}

function formatarAgendamento(linha) {
  return {
    id: linha.id,
    clienteId: linha.cliente_id,
    servicoId: linha.servico_id,
    data: linha.data,
    horario: typeof linha.horario === 'string' ? linha.horario.slice(0, 5) : linha.horario,
    status: linha.status,
  };
}

async function listar(req, res) {
  try {
    const [linhas] = await pool.query(
      'SELECT * FROM agendamentos WHERE usuario_id = ? ORDER BY data, horario',
      [req.usuarioId]
    );
    res.json({ agendamentos: linhas.map(formatarAgendamento) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar agendamentos.' });
  }
}

async function criar(req, res) {
  try {
    const { clienteId, servicoId, data, horario, status } = req.body;

    if (!clienteId || !servicoId || !data || !horario) {
      return res.status(400).json({ erro: 'Preencha cliente, serviço, data e horário.' });
    }

    const [clienteRows] = await pool.query(
      'SELECT id FROM clientes WHERE id = ? AND usuario_id = ?',
      [clienteId, req.usuarioId]
    );
    if (clienteRows.length === 0) {
      return res.status(400).json({ erro: 'Cliente inválido.' });
    }

    const [servicoRows] = await pool.query(
      'SELECT id FROM servicos WHERE id = ? AND usuario_id = ?',
      [servicoId, req.usuarioId]
    );
    if (servicoRows.length === 0) {
      return res.status(400).json({ erro: 'Serviço inválido.' });
    }

    const statusFinal = status || 'agendado';

    const [resultado] = await pool.query(
      'INSERT INTO agendamentos (usuario_id, cliente_id, servico_id, data, horario, status) VALUES (?, ?, ?, ?, ?, ?)',
      [req.usuarioId, clienteId, servicoId, data, horario, statusFinal]
    );

    const [linhas] = await pool.query('SELECT * FROM agendamentos WHERE id = ?', [resultado.insertId]);
    res.status(201).json({ agendamento: formatarAgendamento(linhas[0]) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar agendamento.' });
  }
}

async function atualizarStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['agendado', 'realizado', 'cancelado'].includes(status)) {
      return res.status(400).json({ erro: 'Status inválido.' });
    }

    const [resultado] = await pool.query(
      'UPDATE agendamentos SET status = ? WHERE id = ? AND usuario_id = ?',
      [status, id, req.usuarioId]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    }

    const [linhas] = await pool.query('SELECT * FROM agendamentos WHERE id = ?', [id]);
    res.json({ agendamento: formatarAgendamento(linhas[0]) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao atualizar status.' });
  }
}

async function remover(req, res) {
  try {
    const { id } = req.params;

    const [resultado] = await pool.query(
      'DELETE FROM agendamentos WHERE id = ? AND usuario_id = ?',
      [id, req.usuarioId]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    }

    res.status(204).send();
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao remover agendamento.' });
  }
}

module.exports = { listar, criar, atualizarStatus, remover };
