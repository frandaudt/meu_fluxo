const { pool } = require('../config/db');

const STATUS = ['agendado', 'realizado', 'cancelado', 'nao_compareceu'];
const FORMAS_PAGAMENTO = ['dinheiro', 'pix', 'debito', 'credito'];

function paraMinutos(hhmm) {
  const [h, m] = String(hhmm).split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/**
 * Data e hora de agora no horário de Brasília, como texto ('2026-10-16 14:32:05').
 * O servidor do Render roda em UTC, então não dá para usar new Date() direto.
 */
function agoraBrasilia() {
  return new Date()
    .toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo', hour12: false })
    .replace('T', ' ');
}

/** Só a data de hoje em Brasília ('2026-10-16'). */
function hojeBrasilia() {
  return agoraBrasilia().slice(0, 10);
}

/** Valor em reais vindo do front: número >= 0 com 2 casas, ou null se for inválido. */
function lerValor(valor) {
  const numero = Number(valor);
  if (valor === '' || valor === null || valor === undefined || !Number.isFinite(numero) || numero < 0) return null;
  return Math.round(numero * 100) / 100;
}

// Confere expediente e conflito de horário (mesma regra do front-end).
// Devolve a mensagem do problema, ou null se puder agendar.
// idIgnorado: usado ao reagendar, para o agendamento não conflitar consigo mesmo.
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

  // conflito: busca os agendamentos do mesmo dia que ainda ocupam horário
  const [outros] = await pool.query(
    `SELECT a.id, a.horario, s.duracao_min, c.nome AS cliente_nome
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       JOIN clientes c ON c.id = a.cliente_id
      WHERE a.usuario_id = ? AND a.data = ? AND a.status IN ('agendado', 'realizado') AND a.id <> ?`,
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

// SELECT usado em todas as respostas: traz junto o nome de quem criou e de quem recebeu
const SELECT_AGENDAMENTO = `
  SELECT a.*, uc.nome AS criado_por_nome, ur.nome AS recebido_por_nome
    FROM agendamentos a
    LEFT JOIN usuarios uc ON uc.id = a.criado_por
    LEFT JOIN usuarios ur ON ur.id = a.recebido_por`;

function formatarAgendamento(linha) {
  return {
    id: linha.id,
    clienteId: linha.cliente_id,
    servicoId: linha.servico_id,
    data: linha.data,
    horario: typeof linha.horario === 'string' ? linha.horario.slice(0, 5) : linha.horario,
    status: linha.status,
    observacao: linha.observacao || '',
    origem: linha.origem || 'sistema',
    criadoEm: linha.criado_em || null,
    criadoPorNome: linha.criado_por_nome || null,
    statusEm: linha.status_em || null,
    reagendamentos: linha.reagendamentos || 0,
    // pagamento (só faz sentido quando status = realizado)
    valorCobrado: linha.valor_cobrado,
    desconto: linha.desconto || 0,
    formaPagamento: linha.forma_pagamento,
    statusPagamento: linha.status_pagamento || 'pendente',
    pagoEm: linha.pago_em,
    recebidoPorNome: linha.recebido_por_nome || null,
    // cancelamento
    canceladoPor: linha.cancelado_por,
    motivoCancelamento: linha.motivo_cancelamento || '',
  };
}

async function buscarAgendamento(id, usuarioId) {
  const [linhas] = await pool.query(`${SELECT_AGENDAMENTO} WHERE a.id = ? AND a.usuario_id = ?`, [id, usuarioId]);
  return linhas[0] || null;
}

// GET /api/agendamentos
async function listar(req, res) {
  try {
    const [linhas] = await pool.query(
      `${SELECT_AGENDAMENTO} WHERE a.usuario_id = ? ORDER BY a.data, a.horario`,
      [req.usuarioId]
    );
    res.json({ agendamentos: linhas.map(formatarAgendamento) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar agendamentos.' });
  }
}

// GET /api/agendamentos/a-receber → atendimentos realizados que ainda não foram pagos
async function listarAReceber(req, res) {
  try {
    const [linhas] = await pool.query(
      `${SELECT_AGENDAMENTO}
        WHERE a.usuario_id = ? AND a.status = 'realizado' AND a.status_pagamento = 'pendente'
        ORDER BY a.data DESC, a.horario DESC`,
      [req.usuarioId]
    );
    res.json({ agendamentos: linhas.map(formatarAgendamento) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar os pagamentos pendentes.' });
  }
}

// POST /api/agendamentos → sempre nasce como "agendado"
// (o aviso de conflito é feito no front: a pessoa pode marcar mesmo assim, RN02)
async function criar(req, res) {
  try {
    const { clienteId, servicoId, data, horario, observacao } = req.body;

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

    const [resultado] = await pool.query(
      `INSERT INTO agendamentos
         (usuario_id, cliente_id, servico_id, data, horario, status, observacao, origem, criado_por)
       VALUES (?, ?, ?, ?, ?, 'agendado', ?, 'sistema', ?)`,
      [req.usuarioId, clienteId, servicoId, data, horario, (observacao || '').slice(0, 255) || null, req.usuarioLogadoId]
    );

    const linha = await buscarAgendamento(resultado.insertId, req.usuarioId);
    res.status(201).json({ agendamento: formatarAgendamento(linha) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar agendamento.' });
  }
}

// PUT /api/agendamentos/:id → editar observação ou reagendar (data, horário, serviço)
async function atualizar(req, res) {
  try {
    const { id } = req.params;
    const atual = await buscarAgendamento(id, req.usuarioId);
    if (!atual) {
      return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    }

    const { data, horario, servicoId, observacao } = req.body;
    const campos = [];
    const valores = [];

    // observação pode ser editada em qualquer status
    if (observacao !== undefined) {
      campos.push('observacao = ?');
      valores.push(String(observacao).slice(0, 255) || null);
    }

    const mudaData = data !== undefined && data !== atual.data;
    const mudaHorario = horario !== undefined && horario !== String(atual.horario).slice(0, 5);
    const mudaServico = servicoId !== undefined && Number(servicoId) !== atual.servico_id;

    if (mudaData || mudaHorario || mudaServico) {
      // RN03: só agendamento "agendado" pode ser reagendado
      if (atual.status !== 'agendado') {
        return res.status(409).json({ erro: 'Só dá para reagendar um atendimento que ainda está agendado.' });
      }
      if (mudaServico) {
        const [servicoRows] = await pool.query(
          'SELECT id FROM servicos WHERE id = ? AND usuario_id = ?',
          [servicoId, req.usuarioId]
        );
        if (servicoRows.length === 0) {
          return res.status(400).json({ erro: 'Serviço inválido.' });
        }
        campos.push('servico_id = ?');
        valores.push(servicoId);
      }
      if (mudaData) { campos.push('data = ?'); valores.push(data); }
      if (mudaHorario) { campos.push('horario = ?'); valores.push(horario); }
      // RN05: reagendar altera o mesmo registro e soma +1
      if (mudaData || mudaHorario) campos.push('reagendamentos = reagendamentos + 1');
    }

    if (campos.length > 0) {
      await pool.query(
        `UPDATE agendamentos SET ${campos.join(', ')} WHERE id = ? AND usuario_id = ?`,
        [...valores, id, req.usuarioId]
      );
    }

    const linha = await buscarAgendamento(id, req.usuarioId);
    res.json({ agendamento: formatarAgendamento(linha) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao atualizar o agendamento.' });
  }
}

/**
 * PUT /api/agendamentos/:id/status
 * body:
 *  - { status: 'realizado', pagouAgora: true, valorCobrado, desconto, formaPagamento }
 *  - { status: 'realizado', pagouAgora: false, valorCobrado }        → vai para "A receber"
 *  - { status: 'nao_compareceu' }
 *  - { status: 'cancelado', canceladoPor: 'cliente' | 'profissional', motivo }
 *  - { status: 'agendado' }  → desfazer (só o dono, para corrigir um erro)
 */
async function atualizarStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!STATUS.includes(status)) {
      return res.status(400).json({ erro: 'Status inválido.' });
    }

    const atual = await buscarAgendamento(id, req.usuarioId);
    if (!atual) {
      return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    }

    const agora = agoraBrasilia();

    // ----- desfazer: volta para "agendado" e apaga pagamento/cancelamento (RN03) -----
    if (status === 'agendado') {
      if (req.papel !== 'dono') {
        return res.status(403).json({ erro: 'Só o dono pode desfazer um atendimento finalizado.' });
      }
      if (atual.status === 'agendado') {
        return res.status(409).json({ erro: 'Esse atendimento já está agendado.' });
      }
      await pool.query(
        `UPDATE agendamentos
            SET status = 'agendado', status_em = ?,
                valor_cobrado = NULL, desconto = 0, forma_pagamento = NULL,
                status_pagamento = 'pendente', pago_em = NULL, recebido_por = NULL,
                cancelado_por = NULL, motivo_cancelamento = NULL
          WHERE id = ? AND usuario_id = ?`,
        [agora, id, req.usuarioId]
      );
      const linha = await buscarAgendamento(id, req.usuarioId);
      return res.json({ agendamento: formatarAgendamento(linha) });
    }

    // RN03: realizado, cancelado e não compareceu são finais
    if (atual.status !== 'agendado') {
      return res.status(409).json({ erro: 'Esse atendimento já foi finalizado. Só o dono pode desfazer.' });
    }

    // RN04: não dá para concluir nem marcar falta antes do horário do atendimento
    if (status === 'realizado' || status === 'nao_compareceu') {
      const inicio = `${atual.data} ${String(atual.horario).slice(0, 5)}`;
      if (inicio > agora.slice(0, 16)) {
        return res.status(409).json({ erro: `Isso só pode ser marcado a partir de ${String(atual.horario).slice(0, 5)} do dia do atendimento.` });
      }
    }

    if (status === 'realizado') {
      const [servicoRows] = await pool.query('SELECT valor FROM servicos WHERE id = ?', [atual.servico_id]);
      const precoServico = servicoRows[0]?.valor ?? 0;

      // RN06/RN07: o valor vem com o preço do serviço, pode ser editado e fica gravado no atendimento
      const valorCobrado = req.body.valorCobrado === undefined ? precoServico : lerValor(req.body.valorCobrado);
      if (valorCobrado === null) {
        return res.status(400).json({ erro: 'Informe um valor cobrado válido.' });
      }

      if (req.body.pagouAgora) {
        const desconto = req.body.desconto === undefined || req.body.desconto === '' ? 0 : lerValor(req.body.desconto);
        if (desconto === null || desconto > valorCobrado) {
          return res.status(400).json({ erro: 'O desconto não pode ser maior que o valor cobrado.' });
        }
        if (!FORMAS_PAGAMENTO.includes(req.body.formaPagamento)) {
          return res.status(400).json({ erro: 'Escolha a forma de pagamento.' });
        }
        await pool.query(
          `UPDATE agendamentos
              SET status = 'realizado', status_em = ?, valor_cobrado = ?, desconto = ?,
                  forma_pagamento = ?, status_pagamento = 'pago', pago_em = ?, recebido_por = ?
            WHERE id = ? AND usuario_id = ?`,
          [agora, valorCobrado, desconto, req.body.formaPagamento, agora, req.usuarioLogadoId, id, req.usuarioId]
        );
      } else {
        // vai pagar depois → aparece em Financeiro › A receber
        await pool.query(
          `UPDATE agendamentos
              SET status = 'realizado', status_em = ?, valor_cobrado = ?, status_pagamento = 'pendente'
            WHERE id = ? AND usuario_id = ?`,
          [agora, valorCobrado, id, req.usuarioId]
        );
      }
    }

    if (status === 'nao_compareceu') {
      await pool.query(
        "UPDATE agendamentos SET status = 'nao_compareceu', status_em = ? WHERE id = ? AND usuario_id = ?",
        [agora, id, req.usuarioId]
      );
    }

    if (status === 'cancelado') {
      // RN15: todo cancelamento registra quem cancelou (padrão: profissional) e um motivo opcional
      const canceladoPor = req.body.canceladoPor === 'cliente' ? 'cliente' : 'profissional';
      const motivo = String(req.body.motivo || '').trim().slice(0, 255) || null;
      await pool.query(
        `UPDATE agendamentos
            SET status = 'cancelado', status_em = ?, cancelado_por = ?, motivo_cancelamento = ?
          WHERE id = ? AND usuario_id = ?`,
        [agora, canceladoPor, motivo, id, req.usuarioId]
      );
    }

    const linha = await buscarAgendamento(id, req.usuarioId);
    res.json({ agendamento: formatarAgendamento(linha) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao atualizar status.' });
  }
}

/**
 * PUT /api/agendamentos/:id/pagamento → registrar o pagamento de um atendimento "a receber"
 * body: { valorCobrado, desconto, formaPagamento, pagoEm: 'YYYY-MM-DD' }
 * Liberado para dono e atendente ("Receber agora").
 */
async function registrarPagamento(req, res) {
  try {
    const { id } = req.params;
    const atual = await buscarAgendamento(id, req.usuarioId);
    if (!atual) {
      return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    }
    if (atual.status !== 'realizado') {
      return res.status(409).json({ erro: 'Só atendimento realizado tem pagamento.' });
    }
    if (atual.status_pagamento === 'pago') {
      return res.status(409).json({ erro: 'Esse atendimento já está pago.' });
    }

    const valorCobrado = lerValor(req.body.valorCobrado ?? atual.valor_cobrado);
    if (valorCobrado === null) {
      return res.status(400).json({ erro: 'Informe um valor cobrado válido.' });
    }
    const desconto = req.body.desconto === undefined || req.body.desconto === '' ? 0 : lerValor(req.body.desconto);
    if (desconto === null || desconto > valorCobrado) {
      return res.status(400).json({ erro: 'O desconto não pode ser maior que o valor cobrado.' });
    }
    if (!FORMAS_PAGAMENTO.includes(req.body.formaPagamento)) {
      return res.status(400).json({ erro: 'Escolha a forma de pagamento.' });
    }

    // RN-PAG1: data do pagamento vem com hoje; não aceita data futura nem anterior ao atendimento
    const hoje = hojeBrasilia();
    const dataPagamento = req.body.pagoEm || hoje;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPagamento)) {
      return res.status(400).json({ erro: 'Data do pagamento inválida.' });
    }
    if (dataPagamento > hoje) {
      return res.status(400).json({ erro: 'A data do pagamento não pode ser no futuro.' });
    }
    if (dataPagamento < atual.data) {
      return res.status(400).json({ erro: 'A data do pagamento não pode ser antes do atendimento.' });
    }
    // pago hoje → grava a hora exata; pago em outro dia → meio-dia daquele dia
    const pagoEm = dataPagamento === hoje ? agoraBrasilia() : `${dataPagamento} 12:00:00`;

    await pool.query(
      `UPDATE agendamentos
          SET valor_cobrado = ?, desconto = ?, forma_pagamento = ?,
              status_pagamento = 'pago', pago_em = ?, recebido_por = ?
        WHERE id = ? AND usuario_id = ?`,
      [valorCobrado, desconto, req.body.formaPagamento, pagoEm, req.usuarioLogadoId, id, req.usuarioId]
    );

    const linha = await buscarAgendamento(id, req.usuarioId);
    res.json({ agendamento: formatarAgendamento(linha) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao registrar o pagamento.' });
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

module.exports = {
  listar,
  listarAReceber,
  criar,
  atualizar,
  atualizarStatus,
  registrarPagamento,
  remover,
  validarHorario,
};