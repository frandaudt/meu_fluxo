// src/controllers/alertasController.js
// "Precisa da sua atenção" (Início) e o sininho do cabeçalho.
// Junta dois tipos de aviso:
//  1. notificações gravadas na tabela notificacoes (novo agendamento pelo bot/link,
//     novo cliente pelo WhatsApp, vaga liberada...), que somem quando são lidas;
//  2. avisos calculados na hora (atendimentos sem status, a receber, cliente em risco),
//     que somem sozinhos quando a situação é resolvida.
// Regra geral do sistema: o aviso só AVISA; quem decide é a pessoa.
const { pool } = require('../config/db');
const { contarNaFila } = require('./listaEsperaController');

/** Data de hoje no horário de Brasília ('2026-10-17'), mesmo com o servidor em UTC. */
function hojeBrasilia() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10);
}

/** Quantos dias entre duas datas 'YYYY-MM-DD'. */
function diasEntre(inicio, fim) {
  const [a1, m1, d1] = inicio.split('-').map(Number);
  const [a2, m2, d2] = fim.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

function ontemDe(data) {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}

function dataCurta(data) {
  const [, mes, dia] = data.split('-');
  return `${dia}/${mes}`;
}

function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Link do WhatsApp do próprio aparelho com a mensagem pronta (seção 3.11). */
function linkWhatsapp(telefone, texto) {
  let numero = String(telefone || '').replace(/\D/g, '');
  if (!numero) return null;
  if (numero.length <= 11) numero = `55${numero}`; // sem o código do país: Brasil
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/** Cor, botão e tela de destino de cada tipo de notificação gravada (coluna tipo). */
const TIPOS_NOTIFICACAO = {
  novo_agendamento_bot: { cor: 'agendado', rotulo: 'Ver agenda', link: '/agenda' },
  novo_agendamento_link: { cor: 'agendado', rotulo: 'Ver agenda', link: '/agenda' },
  novo_cliente_bot: { cor: 'agendado', rotulo: 'Ver clientes', link: '/clientes' },
  novo_cliente_link: { cor: 'agendado', rotulo: 'Ver clientes', link: '/clientes' },
  vaga_liberada: { cor: 'aviso', rotulo: 'Ver lista de espera', link: '/lista-espera' },
};

// GET /api/alertas
async function listar(req, res) {
  try {
    const usuarioId = req.usuarioId;
    const hoje = hojeBrasilia();
    const ehDono = req.papel === 'dono';
    const veValores = req.permissoes.includes('financeiro');
    const alertas = [];

    // ---------------------------------------------------------------
    // 1. Notificações ainda não lidas (as mais novas primeiro)
    // ---------------------------------------------------------------
    // colunas da tabela: titulo, mensagem, tipo, lida, criado_em
    // (não tem coluna de link: a tela de destino sai do tipo, em TIPOS_NOTIFICACAO)
    const [notificacoes] = await pool.query(
      `SELECT id, tipo, titulo, mensagem, criado_em
         FROM notificacoes
        WHERE usuario_id = ? AND lida = 0
        ORDER BY criado_em DESC
        LIMIT 20`,
      [usuarioId]
    );
    for (const n of notificacoes) {
      const tipo = TIPOS_NOTIFICACAO[n.tipo] || { cor: 'agendado', rotulo: 'Ver', link: null };
      alertas.push({
        id: `n${n.id}`,
        tipo: n.tipo,
        cor: tipo.cor,
        texto: n.mensagem || n.titulo,
        acao: tipo.link ? { rotulo: tipo.rotulo, link: tipo.link } : null,
        notificacaoId: n.id,
      });
    }

    // ---------------------------------------------------------------
    // 2. Atendimentos de dias anteriores que ainda estão como "agendado"
    //    (o status nunca muda sozinho: o sistema só avisa)
    // ---------------------------------------------------------------
    const [semStatus] = await pool.query(
      `SELECT data FROM agendamentos
        WHERE usuario_id = ? AND status = 'agendado' AND data < ?
        ORDER BY data`,
      [usuarioId, hoje]
    );
    if (semStatus.length > 0) {
      const qtd = semStatus.length;
      const todosDeOntem = semStatus.every(a => a.data === ontemDe(hoje));
      const quando = todosDeOntem ? 'de ontem' : 'de dias anteriores';
      alertas.push({
        id: 'sem-status',
        tipo: 'sem_status',
        cor: 'aviso',
        texto: qtd === 1
          ? `1 atendimento ${quando} ainda está como "agendado".`
          : `${qtd} atendimentos ${quando} ainda estão como "agendado".`,
        // abre a Agenda no dia mais antigo que ficou sem status
        acao: { rotulo: 'Atualizar status', link: `/agenda?data=${semStatus[0].data}` },
      });
    }

    // ---------------------------------------------------------------
    // 3. A receber: atendimentos realizados com pagamento pendente
    // ---------------------------------------------------------------
    const [pendentes] = await pool.query(
      `SELECT a.id, a.data, a.valor_cobrado, a.desconto, c.nome
         FROM agendamentos a
         JOIN clientes c ON c.id = a.cliente_id
        WHERE a.usuario_id = ? AND a.status = 'realizado' AND a.status_pagamento = 'pendente'
        ORDER BY a.data DESC`,
      [usuarioId]
    );
    if (pendentes.length > 0) {
      if (veValores) {
        // dono (ou atendente com acesso ao Financeiro): um aviso só, com o total
        const total = pendentes.reduce((soma, a) => soma + Number(a.valor_cobrado || 0) - Number(a.desconto || 0), 0);
        const qtd = pendentes.length;
        alertas.push({
          id: 'a-receber',
          tipo: 'a_receber',
          cor: 'aviso',
          texto: `${moeda(total)} a receber de ${qtd} ${qtd === 1 ? 'atendimento realizado' : 'atendimentos realizados'}.`,
          acao: { rotulo: 'Ir para A receber', link: '/financeiro' },
        });
      } else {
        // atendente: sem valores, um aviso por cliente, com "Receber agora"
        for (const a of pendentes.slice(0, 5)) {
          alertas.push({
            id: `receber-${a.id}`,
            tipo: 'nao_pagou',
            cor: 'aviso',
            texto: `${a.nome} ainda não pagou o atendimento de ${dataCurta(a.data)}.`,
            acao: { rotulo: 'Receber agora', link: `/agenda?ag=${a.id}&acao=pagamento` },
          });
        }
      }
    }

    // ---------------------------------------------------------------
    // 4. Clientes em risco (só o dono)
    //    Em risco = dias sem vir > 1,5 × ritmo do cliente (média de dias entre visitas);
    //    com só 1 visita, mais de 30 dias. Mais de 90 dias já é "inativo" (não avisa).
    //    Quem já tem um horário marcado não entra.
    // ---------------------------------------------------------------
    if (ehDono) {
      const [visitas] = await pool.query(
        `SELECT a.cliente_id, a.data, c.nome, c.telefone, s.nome AS servico
           FROM agendamentos a
           JOIN clientes c ON c.id = a.cliente_id
           JOIN servicos s ON s.id = a.servico_id
          WHERE a.usuario_id = ? AND a.status = 'realizado'
          ORDER BY a.cliente_id, a.data`,
        [usuarioId]
      );
      const [comHorario] = await pool.query(
        `SELECT DISTINCT cliente_id FROM agendamentos
          WHERE usuario_id = ? AND status = 'agendado' AND data >= ?`,
        [usuarioId, hoje]
      );
      const temHorarioMarcado = new Set(comHorario.map(l => l.cliente_id));

      // agrupa as visitas por cliente
      const porCliente = new Map();
      for (const v of visitas) {
        if (!porCliente.has(v.cliente_id)) porCliente.set(v.cliente_id, []);
        porCliente.get(v.cliente_id).push(v);
      }

      const emRisco = [];
      for (const [clienteId, lista] of porCliente) {
        if (temHorarioMarcado.has(clienteId)) continue;
        const datas = [...new Set(lista.map(v => v.data))]; // várias no mesmo dia contam como 1 visita
        const ultima = lista[lista.length - 1];
        const diasSemVir = diasEntre(datas[datas.length - 1], hoje);
        const ritmo = datas.length > 1
          ? Math.max(1, Math.round(diasEntre(datas[0], datas[datas.length - 1]) / (datas.length - 1)))
          : null;
        const risco = diasSemVir <= 90 && (ritmo ? diasSemVir > 1.5 * ritmo : diasSemVir > 30);
        if (risco) emRisco.push({ ...ultima, diasSemVir, ritmo });
      }

      // os que estão há mais tempo sem vir primeiro; no máximo 3 para não lotar o card
      emRisco.sort((a, b) => b.diasSemVir - a.diasSemVir);
      for (const c of emRisco.slice(0, 3)) {
        const primeiroNome = String(c.nome).trim().split(/\s+/)[0];
        const mensagem = `Oi ${primeiroNome}, faz um tempinho que você não aparece por aqui! Quer agendar seu ${String(c.servico).toLowerCase()}?`;
        alertas.push({
          id: `risco-${c.cliente_id}`,
          tipo: 'em_risco',
          cor: 'perigo',
          texto: c.ritmo
            ? `${c.nome} não vem há ${c.diasSemVir} dias — costuma voltar a cada ${c.ritmo}.`
            : `${c.nome} não vem há ${c.diasSemVir} dias.`,
          acao: { rotulo: 'Chamar no WhatsApp', whatsapp: linkWhatsapp(c.telefone, mensagem) },
        });
      }
    }

    // quantos estão na lista de espera (bolinha do menu e número da Início)
    let aguardandoNaLista = 0;
    try {
      aguardandoNaLista = await contarNaFila(usuarioId);
    } catch (erro) {
      console.error('Não foi possível contar a lista de espera:', erro.message);
    }

    res.json({ alertas, total: alertas.length, aguardandoNaLista });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao carregar os avisos.' });
  }
}

// PUT /api/alertas/notificacoes/:id/lida
async function marcarLida(req, res) {
  try {
    const [resultado] = await pool.query(
      'UPDATE notificacoes SET lida = 1 WHERE id = ? AND usuario_id = ?',
      [req.params.id, req.usuarioId]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Aviso não encontrado.' });
    }
    res.status(204).send();
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao marcar o aviso como lido.' });
  }
}

module.exports = { listar, marcarLida };
