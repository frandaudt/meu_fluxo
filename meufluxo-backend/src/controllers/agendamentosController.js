const { pool } = require('../config/db');

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
