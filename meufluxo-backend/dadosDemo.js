// dadosDemo.js — cria (ou recria) a conta de DEMONSTRAÇÃO do MeuFluxo.
//
// Como usar (dentro da pasta meufluxo-backend):
//     node dadosDemo.js
//
// O que faz:
//  - apaga a conta demo anterior (só ela: as outras contas não são tocadas);
//  - cria um salão completo, com as datas contadas a partir de HOJE:
//    ~10 semanas de histórico, a agenda dos próximos dias, clientes fiéis,
//    novos e em risco, lista de espera, folga, despesas, metas, avisos e
//    uma atendente.
// Rode de novo no dia da apresentação para os dados ficarem "frescos".
//
// Entrar:  demo@meufluxo.com      / Demo@2026   (dona)
//          atendente@meufluxo.com / Atende@2026 (atendente)
require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('./src/config/db');

const DONA = { nome: 'Carla Mendes', email: 'demo@meufluxo.com', senha: 'Demo@2026', telefone: '(11) 94000-1234' };
const ATENDENTE = { nome: 'Bianca Rocha', email: 'atendente@meufluxo.com', senha: 'Atende@2026' };
const NEGOCIO = {
  nome: 'Studio Sublime',
  slug: 'studio-sublime',
  descricao: 'Cabelo, unhas e sobrancelha',
  endereco: 'Rua das Flores, 120 · Osasco',
};

// seg a sex 09:00–19:00 (almoço 12:00–13:00), sábado 09:00–15:00, domingo fechado
const DIAS = [
  { ativo: false, inicio: '09:00', fim: '19:00' },
  ...[1, 2, 3, 4, 5].map(() => ({ ativo: true, inicio: '09:00', fim: '19:00', pausaInicio: '12:00', pausaFim: '13:00' })),
  { ativo: true, inicio: '09:00', fim: '15:00' },
];
const BLOCO = 30;

const SERVICOS = [
  { nome: 'Corte feminino', categoria: 'Cabelo', valor: 80, duracao: 60 },
  { nome: 'Escova', categoria: 'Cabelo', valor: 60, duracao: 45 },
  { nome: 'Coloração', categoria: 'Cabelo', valor: 180, duracao: 120 },
  { nome: 'Manicure', categoria: 'Unhas', valor: 35, duracao: 45 },
  { nome: 'Pedicure', categoria: 'Unhas', valor: 40, duracao: 45 },
  { nome: 'Design de sobrancelha', categoria: 'Sobrancelha', valor: 45, duracao: 30 },
];

// perfil: fiel (vem a cada N dias), ocasional, risco (vinha sempre e sumiu),
// inativo (sumiu há meses), novo (chegou este mês)
const CLIENTES = [
  ['Ana Souza', 'fiel', 14, 'Manicure', 'whatsapp'],
  ['Juliana Prado', 'fiel', 21, 'Escova', 'sistema'],
  ['Mariana Lopes', 'fiel', 28, 'Corte feminino', 'sistema'],
  ['Patrícia Gomes', 'fiel', 14, 'Manicure', 'link'],
  ['Fernanda Lima', 'fiel', 21, 'Design de sobrancelha', 'whatsapp'],
  ['Renata Alves', 'fiel', 35, 'Coloração', 'sistema'],
  ['Camila Ribeiro', 'fiel', 14, 'Pedicure', 'sistema'],
  ['Larissa Martins', 'fiel', 21, 'Escova', 'link'],
  ['Beatriz Costa', 'ocasional', 30, 'Corte feminino', 'sistema'],
  ['Gabriela Nunes', 'ocasional', 40, 'Manicure', 'whatsapp'],
  ['Aline Ferreira', 'ocasional', 35, 'Design de sobrancelha', 'sistema'],
  ['Vanessa Rocha', 'ocasional', 45, 'Escova', 'link'],
  ['Tatiane Barbosa', 'ocasional', 30, 'Pedicure', 'sistema'],
  ['Sônia Alves', 'risco', 21, 'Manicure', 'sistema'],
  ['Cristina Duarte', 'risco', 28, 'Corte feminino', 'sistema'],
  ['Elaine Moreira', 'risco', 21, 'Escova', 'whatsapp'],
  ['Rosana Teixeira', 'inativo', 30, 'Coloração', 'sistema'],
  ['Débora Cardoso', 'inativo', 30, 'Manicure', 'sistema'],
  ['Isabela Freitas', 'novo', 0, 'Design de sobrancelha', 'link'],
  ['Letícia Araújo', 'novo', 0, 'Manicure', 'whatsapp'],
  ['Priscila Mendes', 'novo', 0, 'Escova', 'sistema'],
  ['Natália Pires', 'novo', 0, 'Corte feminino', 'whatsapp'],
];

// ---------------------------------------------------------------------
// datas (sempre no horário de Brasília)
// ---------------------------------------------------------------------
const agora = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
const HOJE = agora.slice(0, 10);
function somarDias(data, n) {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
const diaSemana = (data) => new Date(`${data}T12:00:00Z`).getUTCDay();
const paraMin = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const paraHora = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// números "aleatórios" sempre iguais (o resultado é o mesmo toda vez que roda)
let semente = 20261105;
function aleatorio() {
  semente = (semente + 0x6d2b79f5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const escolher = (lista) => lista[Math.floor(aleatorio() * lista.length)];

// folga (dia inteiro) daqui a 8 dias, se não cair no domingo
let FOLGA = somarDias(HOJE, 8);
if (diaSemana(FOLGA) === 0) FOLGA = somarDias(FOLGA, 1);

/** Dia em que o salão abre? */
function abre(data) {
  return DIAS[diaSemana(data)].ativo && data !== FOLGA;
}

// ---------------------------------------------------------------------
// agenda: encaixa cada atendimento no primeiro horário livre do dia
// ---------------------------------------------------------------------
const ocupados = new Map(); // data → [{ ini, fim }]
function livre(data, ini, fim) {
  const d = DIAS[diaSemana(data)];
  if (ini < paraMin(d.inicio) || fim > paraMin(d.fim)) return false;
  if (d.pausaInicio && ini < paraMin(d.pausaFim) && fim > paraMin(d.pausaInicio)) return false;
  return !(ocupados.get(data) || []).some(o => ini < o.fim && fim > o.ini);
}
/** Procura um horário no dia (começando num horário "preferido") ou nos dias seguintes. */
function reservar(data, duracao, limiteDias = 4) {
  for (let tentativa = 0; tentativa <= limiteDias; tentativa++) {
    const dia = somarDias(data, tentativa);
    if (!abre(dia)) continue;
    const d = DIAS[diaSemana(dia)];
    const inicios = [];
    for (let m = paraMin(d.inicio); m + duracao <= paraMin(d.fim); m += BLOCO) inicios.push(m);
    // começa num ponto sorteado do dia, para a agenda não ficar toda de manhã
    const deslocamento = Math.floor(aleatorio() * inicios.length);
    for (let i = 0; i < inicios.length; i++) {
      const ini = inicios[(i + deslocamento) % inicios.length];
      if (livre(dia, ini, ini + duracao)) {
        if (!ocupados.has(dia)) ocupados.set(dia, []);
        ocupados.get(dia).push({ ini, fim: ini + duracao });
        return { data: dia, horario: paraHora(ini) };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------
async function apagarDemoAnterior(conexao) {
  const [[antiga]] = await conexao.query("SELECT id FROM usuarios WHERE email = ? AND papel = 'dono'", [DONA.email]);
  await conexao.query("DELETE FROM usuarios WHERE email = ? AND papel = 'atendente'", [ATENDENTE.email]);
  if (!antiga) return;
  const id = antiga.id;
  for (const tabela of ['lista_espera', 'agendamentos', 'notificacoes', 'bloqueios', 'mensagens_prontas',
    'bot_conversas', 'whatsapp_config', 'codigos_verificacao', 'clientes', 'servicos', 'despesas', 'metas', 'horarios_trabalho']) {
    await conexao.query(`DELETE FROM ${tabela} WHERE usuario_id = ?`, [id]);
  }
  await conexao.query('DELETE FROM usuarios WHERE dono_id = ?', [id]);
  await conexao.query('DELETE FROM usuarios WHERE id = ?', [id]);
}

async function criar() {
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    await apagarDemoAnterior(conexao);

    // ---------- dona e negócio ----------
    const [dona] = await conexao.query(
      'INSERT INTO usuarios (nome, email, senha_hash, telefone, nome_negocio) VALUES (?, ?, ?, ?, ?)',
      [DONA.nome, DONA.email, await bcrypt.hash(DONA.senha, 10), DONA.telefone, NEGOCIO.nome]
    );
    const donaId = dona.insertId;
    // link de agendamento (se o endereço já for de outra conta, usa outro)
    const [[slugEmUso]] = await conexao.query('SELECT id FROM usuarios WHERE slug = ?', [NEGOCIO.slug]);
    await conexao.query(
      'UPDATE usuarios SET slug = ?, link_ativo = 1, descricao_negocio = ?, endereco_negocio = ? WHERE id = ?',
      [slugEmUso ? `${NEGOCIO.slug}-demo` : NEGOCIO.slug, NEGOCIO.descricao, NEGOCIO.endereco, donaId]
    );

    // ---------- atendente (só pode mexer no horário, além do básico) ----------
    const [atendente] = await conexao.query(
      `INSERT INTO usuarios (nome, email, senha_hash, papel, dono_id, trocar_senha, permissoes)
       VALUES (?, ?, ?, 'atendente', ?, 0, ?)`,
      [ATENDENTE.nome, ATENDENTE.email, await bcrypt.hash(ATENDENTE.senha, 10), donaId, JSON.stringify(['horario'])]
    );
    const atendenteId = atendente.insertId;

    // ---------- horário, folga e WhatsApp ----------
    await conexao.query('INSERT INTO horarios_trabalho (usuario_id, bloco_min, dias) VALUES (?, ?, ?)', [donaId, BLOCO, JSON.stringify(DIAS)]);
    await conexao.query(
      'INSERT INTO bloqueios (usuario_id, data, horario_inicio, horario_fim, motivo) VALUES (?, ?, NULL, NULL, ?)',
      [donaId, FOLGA, 'Curso: Curso de coloração']
    );
    await conexao.query('INSERT INTO whatsapp_config (usuario_id, ativo) VALUES (?, 1)', [donaId]);

    // ---------- serviços ----------
    const servicos = {};
    for (const s of SERVICOS) {
      const [r] = await conexao.query(
        'INSERT INTO servicos (usuario_id, nome, categoria, valor, duracao_min) VALUES (?, ?, ?, ?, ?)',
        [donaId, s.nome, s.categoria, s.valor, s.duracao]
      );
      servicos[s.nome] = { id: r.insertId, ...s };
    }

    // ---------- clientes ----------
    const clientes = [];
    const diaDoMes = Number(HOJE.slice(8, 10));
    let novos = 0;
    for (let i = 0; i < CLIENTES.length; i++) {
      const [nome, perfil, cada, favorito, origem] = CLIENTES[i];
      // novos: cadastrados neste mês (contam na meta "clientes novos")
      const desde = perfil === 'novo'
        ? somarDias(HOJE, -Math.min(++novos, diaDoMes - 1))
        : somarDias(HOJE, -(120 + i * 9));
      const telefone = `(11) 9${String(8100 + i * 37).padStart(4, '0')}-${String(1000 + i * 211).slice(-4)}`;
      const [r] = await conexao.query(
        'INSERT INTO clientes (usuario_id, nome, telefone, email, endereco, origem, criado_em) VALUES (?, ?, ?, NULL, NULL, ?, ?)',
        [donaId, nome, telefone, origem, `${desde} 10:00:00`]
      );
      clientes.push({ id: r.insertId, nome, perfil, cada, favorito, origem, desde });
    }

    // ---------- atendimentos: passado (≈10 semanas) e próximos dias ----------
    const atendimentos = [];
    const marcar = (cliente, servicoNome, dataDesejada, extra = {}) => {
      const servico = servicos[servicoNome];
      const vaga = reservar(dataDesejada, servico.duracao);
      if (!vaga) return null;
      const a = { cliente, servico, ...vaga, ...extra };
      atendimentos.push(a);
      return a;
    };
    const outroServico = (fav) => (aleatorio() < 0.75 ? fav : escolher(SERVICOS).nome);

    for (const c of clientes) {
      if (c.perfil === 'fiel' || c.perfil === 'ocasional') {
        // última visita há poucos dias, e daí para trás no ritmo do cliente
        let data = somarDias(HOJE, -Math.floor(aleatorio() * c.cada));
        while (data > somarDias(HOJE, -72)) {
          if (data < HOJE) marcar(c, outroServico(c.favorito), data);
          data = somarDias(data, -(c.cada + Math.floor(aleatorio() * 5) - 2));
        }
        // fiéis já têm o próximo horário marcado
        if (c.perfil === 'fiel') {
          const ultima = atendimentos.filter(a => a.cliente === c).map(a => a.data).sort().pop() || HOJE;
          let proxima = somarDias(ultima, c.cada);
          if (proxima <= HOJE) proxima = somarDias(HOJE, 1 + Math.floor(aleatorio() * 6));
          marcar(c, c.favorito, proxima);
        }
      }
      if (c.perfil === 'risco') {
        // vinha no ritmo certinho e parou há uns 50 dias
        let data = somarDias(HOJE, -(48 + Math.floor(aleatorio() * 8)));
        for (let k = 0; k < 4; k++) {
          marcar(c, c.favorito, data);
          data = somarDias(data, -c.cada);
        }
      }
      if (c.perfil === 'inativo') {
        marcar(c, c.favorito, somarDias(HOJE, -(100 + Math.floor(aleatorio() * 30))));
      }
      if (c.perfil === 'novo') {
        // primeira visita logo depois do cadastro; metade já marcou a próxima
        marcar(c, c.favorito, c.desde);
        if (aleatorio() < 0.5) marcar(c, c.favorito, somarDias(HOJE, 2 + Math.floor(aleatorio() * 5)));
      }
    }

    // completa os dias com clientes fiéis e ocasionais que "passaram" a mais
    // (passado: 4 a 7 por dia; próximos dias: vai esvaziando, como numa agenda de verdade)
    const frequentes = clientes.filter(c => c.perfil === 'fiel' || c.perfil === 'ocasional');
    for (let n = -70; n <= 14; n++) {
      const data = somarDias(HOJE, n);
      if (!abre(data)) continue;
      const sabado = diaSemana(data) === 6;
      const alvo = n < 0 ? (sabado ? 3 : 4) + Math.floor(aleatorio() * 4)
        : n <= 2 ? 3 + Math.floor(aleatorio() * 3)
        : n <= 7 ? 1 + Math.floor(aleatorio() * 3)
        : Math.floor(aleatorio() * 2);
      let tentativas = 0;
      while ((ocupados.get(data) || []).length < alvo && tentativas++ < 20) {
        const c = escolher(frequentes);
        const servico = servicos[outroServico(c.favorito)];
        const vaga = reservar(data, servico.duracao, 0); // só nesse dia
        if (vaga) atendimentos.push({ cliente: c, servico, ...vaga });
      }
    }

    // amanhã sempre tem movimento (Lembretes de amanhã na Início)
    let amanha = somarDias(HOJE, 1);
    while (!abre(amanha)) amanha = somarDias(amanha, 1);
    for (const nome of ['Beatriz Costa', 'Gabriela Nunes', 'Tatiane Barbosa']) {
      const c = clientes.find(x => x.nome === nome);
      marcar(c, c.favorito, amanha);
    }

    // status de cada atendimento
    const agoraMin = paraMin(agora.slice(11, 16));
    for (const a of atendimentos) {
      const passou = a.data < HOJE || (a.data === HOJE && paraMin(a.horario) + a.servico.duracao <= agoraMin);
      a.origem = escolher(['sistema', 'sistema', 'sistema', 'whatsapp', 'link']);
      a.criadoPor = a.origem === 'sistema' ? (aleatorio() < 0.3 ? atendenteId : donaId) : null;
      a.criadoEm = `${somarDias(a.data, -(2 + Math.floor(aleatorio() * 10)))} ${paraHora(540 + Math.floor(aleatorio() * 20) * 30)}:00`;
      if (!passou) {
        a.status = 'agendado';
        continue;
      }
      const sorte = aleatorio();
      if (sorte < 0.05) {
        a.status = 'nao_compareceu';
      } else if (sorte < 0.11) {
        a.status = 'cancelado';
        a.canceladoPor = aleatorio() < 0.7 ? 'cliente' : 'profissional';
        a.motivo = a.canceladoPor === 'cliente' ? escolher(['Imprevisto no trabalho', 'Ficou doente', null]) : 'Reorganização da agenda';
      } else {
        a.status = 'realizado';
        a.valorCobrado = a.servico.valor;
        a.desconto = aleatorio() < 0.1 ? 5 : 0;
        // dos últimos 4 dias, alguns ainda não pagaram (Financeiro › A receber)
        const recente = a.data >= somarDias(HOJE, -4);
        if (recente && aleatorio() < 0.3) {
          a.statusPagamento = 'pendente';
          a.desconto = 0;
        } else {
          a.statusPagamento = 'pago';
          a.forma = escolher(['pix', 'pix', 'pix', 'credito', 'debito', 'dinheiro']);
          a.pagoEm = `${a.data} ${paraHora(paraMin(a.horario) + a.servico.duracao)}:00`;
          a.recebidoPor = aleatorio() < 0.3 ? atendenteId : donaId;
        }
      }
      a.statusEm = `${a.data} ${paraHora(Math.min(paraMin(a.horario) + a.servico.duracao, 23 * 60))}:00`;
    }

    // amanhã: a primeira cliente da manhã cancelou → abre vaga para a lista de espera
    const cancelouAmanha = atendimentos
      // de manhã e com tempo para a manicure de quem está esperando (45 min)
      .filter(a => a.data === amanha && a.status === 'agendado' && paraMin(a.horario) < 12 * 60 && a.servico.duracao >= 45)
      .sort((x, y) => x.horario.localeCompare(y.horario))[0];
    if (cancelouAmanha) {
      cancelouAmanha.status = 'cancelado';
      cancelouAmanha.canceladoPor = 'cliente';
      cancelouAmanha.motivo = 'Cancelado pelo WhatsApp';
      cancelouAmanha.origem = 'whatsapp';
      cancelouAmanha.statusEm = `${HOJE} 08:40:00`;
    }

    // grava os atendimentos (de 50 em 50, para ir rápido no banco remoto)
    for (let i = 0; i < atendimentos.length; i += 50) {
      const lote = atendimentos.slice(i, i + 50);
      const [r] = await conexao.query(
        `INSERT INTO agendamentos
           (usuario_id, cliente_id, servico_id, data, horario, status, origem, criado_por, criado_em, status_em,
            valor_cobrado, desconto, forma_pagamento, status_pagamento, pago_em, recebido_por, cancelado_por, motivo_cancelamento)
         VALUES ?`,
        [lote.map(a => [
          donaId, a.cliente.id, a.servico.id, a.data, a.horario, a.status, a.origem, a.criadoPor, a.criadoEm, a.statusEm || null,
          a.valorCobrado ?? null, a.desconto || 0, a.forma || null, a.statusPagamento || 'pendente', a.pagoEm || null,
          a.recebidoPor || null, a.canceladoPor || null, a.motivo || null,
        ])]
      );
      lote.forEach((a, k) => (a.id = r.insertId + k));
    }

    // ---------- lista de espera ----------
    const cliente = (nome) => clientes.find(c => c.nome === nome);
    const espera = async (c, servicoNome, dataPreferida, periodo, origem, status, criado, agendamentoId = null, observacao = null) => {
      await conexao.query(
        `INSERT INTO lista_espera
           (usuario_id, cliente_id, servico_id, data_preferida, horario_preferido, periodo, observacao, origem, status, agendamento_id, criado_em)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [donaId, c.id, servicos[servicoNome].id, dataPreferida, periodo, observacao, origem, status, agendamentoId, `${criado} 09:30:00`]
      );
    };
    await espera(cliente('Letícia Araújo'), 'Manicure', amanha, 'manha', 'whatsapp', 'aguardando', somarDias(HOJE, -2));
    await espera(cliente('Vanessa Rocha'), 'Escova', null, 'tarde', 'link', 'aguardando', somarDias(HOJE, -1));
    await espera(cliente('Aline Ferreira'), 'Design de sobrancelha', somarDias(amanha, 2), 'qualquer', 'sistema', 'aguardando', HOJE, null, 'Pode ser em qualquer horário');
    const encaixado = atendimentos.find(a => a.cliente.nome === 'Juliana Prado' && a.data < HOJE && a.status === 'realizado');
    if (encaixado) await espera(cliente('Juliana Prado'), 'Escova', encaixado.data, 'qualquer', 'sistema', 'convertido', somarDias(encaixado.data, -3), encaixado.id);
    await espera(cliente('Débora Cardoso'), 'Manicure', somarDias(HOJE, -10), 'manha', 'whatsapp', 'cancelado', somarDias(HOJE, -14));

    // ---------- avisos (sininho e "Precisa da sua atenção") ----------
    const dia = (d) => `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][diaSemana(d)]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
    const avisos = [];
    if (cancelouAmanha) {
      avisos.push(['Vaga liberada', `Vaga liberada: ${dia(amanha)} às ${cancelouAmanha.horario} (${cancelouAmanha.cliente.nome} cancelou). Letícia Araújo é a 1ª da lista de espera para esse horário.`, 'vaga_liberada']);
    }
    avisos.push(['Novo cliente pelo WhatsApp', 'Natália Pires falou com o bot e foi cadastrada com o telefone do WhatsApp.', 'novo_cliente_bot']);
    const peloLink = atendimentos.find(a => a.status === 'agendado' && a.data > HOJE && a.cliente.origem === 'link');
    if (peloLink) {
      peloLink.origem = 'link';
      await conexao.query("UPDATE agendamentos SET origem = 'link' WHERE id = ?", [peloLink.id]);
      avisos.push(['Novo agendamento pelo link', `${peloLink.cliente.nome} agendou ${peloLink.servico.nome} para ${dia(peloLink.data)} às ${peloLink.horario} pelo link.`, 'novo_agendamento_link']);
    }
    for (const [titulo, mensagem, tipo] of avisos) {
      await conexao.query('INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo) VALUES (?, ?, ?, ?)', [donaId, titulo, mensagem, tipo]);
    }

    // ---------- despesas (mês atual e os 2 anteriores) ----------
    for (let m = 0; m < 3; m++) {
      const [a, mm] = HOJE.split('-').map(Number);
      const ref = new Date(Date.UTC(a, mm - 1 - m, 1)).toISOString().slice(0, 10);
      const fixas = [['Aluguel', 1500], ['Energia elétrica', 230 + m * 15], ['Internet', 120], ['Produtos e materiais', 640 - m * 40]];
      for (const [descricao, valor] of fixas) {
        await conexao.query("INSERT INTO despesas (usuario_id, descricao, valor, tipo, mes) VALUES (?, ?, ?, 'fixa', ?)", [donaId, descricao, valor, ref]);
      }
      if (m === 1) {
        await conexao.query("INSERT INTO despesas (usuario_id, descricao, valor, tipo, mes) VALUES (?, ?, ?, 'emergencial', ?)", [donaId, 'Conserto do secador', 180, ref]);
      }
    }

    // ---------- metas ----------
    const mesAtual = HOJE.slice(0, 7);
    await conexao.query("INSERT INTO metas (usuario_id, tipo, tipo_medida, periodo, valor_alvo) VALUES (?, 'mensal', 'faturamento', ?, 9000)", [donaId, mesAtual]);
    await conexao.query("INSERT INTO metas (usuario_id, tipo, tipo_medida, periodo, valor_alvo) VALUES (?, 'mensal', 'clientes', ?, 6)", [donaId, mesAtual]);
    await conexao.query("INSERT INTO metas (usuario_id, tipo, tipo_medida, periodo, valor_alvo) VALUES (?, 'anual', NULL, ?, 100000)", [donaId, HOJE.slice(0, 4)]);

    await conexao.commit();

    const contar = (s) => atendimentos.filter(a => a.status === s).length;
    console.log('\nConta de demonstração criada! ✔');
    console.log(`  ${clientes.length} clientes, ${SERVICOS.length} serviços, ${atendimentos.length} atendimentos`);
    console.log(`  (${contar('realizado')} realizados, ${contar('agendado')} agendados, ${contar('cancelado')} cancelados, ${contar('nao_compareceu')} faltas)`);
    console.log(`  folga em ${FOLGA}, lista de espera com 3 pessoas aguardando`);
    console.log(`\n  Dona:      ${DONA.email} / ${DONA.senha}`);
    console.log(`  Atendente: ${ATENDENTE.email} / ${ATENDENTE.senha}\n`);
  } catch (erro) {
    await conexao.rollback();
    console.error('\nNão deu para criar a demonstração (nada foi alterado):', erro.message);
    process.exitCode = 1;
  } finally {
    conexao.release();
    await pool.end();
  }
}

criar();
