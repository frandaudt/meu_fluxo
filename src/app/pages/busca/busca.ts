import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { EntradaFila, RespostaFila, textoQuer } from '../lista-espera/lista-espera';

import {
  API_URL,
  dinheiro,
  interpretarData,
  interpretarHora,
  Expediente,
  HorarioTrabalho,
  horarioPadrao,
  normalizarHorarioTrabalho,
  expedienteDoDia,
  minutosDeTrabalho,
} from '../../app';
import {
  AgendamentoCRM,
  Cliente,
  ROTULO_SITUACAO,
  ServicoCRM,
  dataCurta,
  hojeISO,
  linkWhatsapp,
  mensagemSaudade,
  resumoDoCliente,
  somarDias,
  valorRecebido,
} from '../clientes/clientes';

interface Despesa { id: number; descricao: string; valor: number; tipo: 'fixa' | 'emergencial'; mes: string; }

/** O que a tela mostra, conforme o que foi buscado. */
type Modo = 'vazio' | 'cliente' | 'servico' | 'dia' | 'horario' | 'lista' | 'agendamentos' | 'financeiro' | 'nada';

type Procurar = 'tudo' | 'clientes' | 'servicos' | 'agendamentos' | 'financeiro';
type Periodo = 'proximos' | '3meses' | 'mes' | 'semana' | 'personalizado';

interface Numero { rotulo: string; valor: string; }
interface Acao { rotulo: string; principal?: boolean; fazer: () => void; }
interface Linha { celulas: string[]; abrir?: () => void; }
interface Secao { titulo: string; contagem: string; colunas: string[]; linhas: Linha[]; vazio: string; }

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const ROTULO_FORMA: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito' };
const ROTULO_ORIGEM: Record<string, string> = { sistema: 'Sistema', whatsapp: 'WhatsApp', link: 'Link', lista_espera: 'Lista de espera' };

@Component({
  selector: 'app-busca',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './busca.html',
  styleUrl: './busca.css',
})
export class Busca implements OnInit, OnDestroy {
  carregando = true;
  erro: string | null = null;

  clientes: Cliente[] = [];
  servicos: ServicoCRM[] = [];
  agendamentos: AgendamentoCRM[] = [];
  despesas: Despesa[] = [];
  horario: HorarioTrabalho = horarioPadrao();

  veValores = true;
  podeEditarServicos = true;

  // ----- o que veio no endereço (/busca?q=...&tipo=...&id=...) -----
  q = '';
  private tipo = '';
  private idEscolhido = 0;

  // ----- filtros -----
  procurar: Procurar = 'tudo';
  periodo: Periodo = '3meses';
  de = '';
  ate = '';
  status: 'todos' | AgendamentoCRM['status'] = 'todos';
  pagamento: 'todos' | 'pago' | 'pendente' = 'todos';
  turno: 'qualquer' | 'manha' | 'tarde' | 'noite' = 'qualquer';

  // ----- resultado -----
  modo: Modo = 'vazio';
  subtitulo = '';
  numeros: Numero[] = [];
  acoes: Acao[] = [];
  secoes: Secao[] = [];
  fila: EntradaFila[] = []; // lista de espera (aguardando + histórico)
  exemplos: { rotulo: string; q: string }[] = [];

  private inscricao?: Subscription;

  constructor(
    private rota: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    if (!localStorage.getItem('meufluxo_token')) {
      this.router.navigate(['/login']);
      return;
    }
    try {
      const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
      const permissoes: string[] = Array.isArray(usuario.permissoes) ? usuario.permissoes : [];
      const ehAtendente = usuario.papel === 'atendente';
      this.veValores = !ehAtendente || permissoes.includes('financeiro');
      this.podeEditarServicos = !ehAtendente || permissoes.includes('servicos');
    } catch {}

    const headers = new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('meufluxo_token')}` });
    forkJoin({
      clientes: this.http.get<{ clientes: Cliente[] }>(`${API_URL}/clientes`, { headers }),
      servicos: this.http.get<{ servicos: { id: number; nome: string; valor: number; duracaoMin: number }[] }>(`${API_URL}/servicos`, { headers }),
      agendamentos: this.http.get<{ agendamentos: AgendamentoCRM[] }>(`${API_URL}/agendamentos`, { headers }),
      horario: this.http.get<unknown>(`${API_URL}/horario-trabalho`, { headers }),
      fila: this.http.get<RespostaFila>(`${API_URL}/lista-espera`, { headers }).pipe(catchError(() => of(null))),
      // despesas: só para quem vê o Financeiro (senão a API responde 403)
      despesas: this.veValores
        ? this.http.get<{ despesas: Despesa[] }>(`${API_URL}/despesas`, { headers })
        : of({ despesas: [] as Despesa[] }),
    }).subscribe({
      next: (r) => {
        this.clientes = r.clientes.clientes;
        this.servicos = r.servicos.servicos.map(s => ({ id: s.id, nome: s.nome, valor: s.valor, duracao: s.duracaoMin }));
        this.agendamentos = r.agendamentos.agendamentos;
        this.despesas = r.despesas.despesas;
        this.fila = r.fila ? [...r.fila.aguardando, ...r.fila.historico] : [];
        this.horario = normalizarHorarioTrabalho(r.horario); // com pausa e folgas
        this.montarExemplos();
        this.carregando = false;

        // a busca do cabeçalho troca só o endereço: a tela acompanha
        this.inscricao = this.rota.queryParamMap.subscribe(params => {
          this.q = (params.get('q') || '').trim();
          this.tipo = params.get('tipo') || '';
          this.idEscolhido = Number(params.get('id')) || 0;
          const procurar = params.get('procurar') as Procurar | null;
          this.procurar = procurar && ['tudo', 'clientes', 'servicos', 'agendamentos', 'financeiro'].includes(procurar) ? procurar : 'tudo';
          if (this.procurar === 'financeiro' && !this.veValores) this.procurar = 'tudo';
          this.limparFiltros(false);
          this.calcular();
          this.cdr.markForCheck();
        });
      },
      error: (erro) => {
        console.error(erro);
        this.carregando = false;
        this.erro = 'Não foi possível carregar os dados da busca.';
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy() {
    this.inscricao?.unsubscribe();
  }

  // =====================================================================
  //  FILTROS
  // =====================================================================

  /** Período padrão: "próximos 14 dias" para horário; "últimos 3 meses" para o resto. */
  limparFiltros(recalcular = true) {
    this.periodo = interpretarHora(this.q) ? 'proximos' : '3meses';
    this.de = '';
    this.ate = '';
    this.status = 'todos';
    this.pagamento = 'todos';
    this.turno = 'qualquer';
    if (recalcular) this.calcular();
  }

  /** Clicar num exemplo ou trocar o texto: atualiza o endereço (a tela recalcula sozinha). */
  buscarExemplo(q: string) {
    this.router.navigate(['/busca'], { queryParams: { q } });
  }

  /** Limites do período escolhido ('YYYY-MM-DD'). Sem "fim" = sem limite para frente. */
  private limitesPeriodo(): { inicio: string; fim: string | null } {
    const hoje = hojeISO();
    const [ano, mes, dia] = hoje.split('-').map(Number);
    switch (this.periodo) {
      case 'proximos':
        return { inicio: hoje, fim: somarDias(hoje, 13) };
      case 'mes':
        return { inicio: `${hoje.slice(0, 7)}-01`, fim: this.formatarData(new Date(ano, mes, 0)) };
      case 'semana': {
        const desloc = (new Date(ano, mes - 1, dia).getDay() + 6) % 7;
        const segunda = somarDias(hoje, -desloc);
        return { inicio: segunda, fim: somarDias(segunda, 6) };
      }
      case 'personalizado':
        return { inicio: this.de || '0000-01-01', fim: this.ate || null };
      default: // últimos 3 meses (e o que já está marcado para frente)
        return { inicio: somarDias(hoje, -91), fim: null };
    }
  }

  private noPeriodo(data: string): boolean {
    const { inicio, fim } = this.limitesPeriodo();
    return data >= inicio && (!fim || data <= fim);
  }

  /** Aplica Status, Pagamento e Horário (e o Período, se pedido). */
  private filtrarAgendamentos(lista: AgendamentoCRM[], usarPeriodo = true): AgendamentoCRM[] {
    return lista.filter(a => {
      if (usarPeriodo && !this.noPeriodo(a.data)) return false;
      if (this.status !== 'todos' && a.status !== this.status) return false;
      if (this.pagamento === 'pago' && !(a.status === 'realizado' && a.statusPagamento === 'pago')) return false;
      if (this.pagamento === 'pendente' && !(a.status === 'realizado' && a.statusPagamento === 'pendente')) return false;
      const hora = Number(a.horario.slice(0, 2));
      if (this.turno === 'manha' && hora >= 12) return false;
      if (this.turno === 'tarde' && (hora < 12 || hora >= 18)) return false;
      if (this.turno === 'noite' && hora < 18) return false;
      return true;
    });
  }

  // =====================================================================
  //  DECIDE O QUE MOSTRAR
  // =====================================================================

  calcular() {
    this.numeros = [];
    this.acoes = [];
    this.secoes = [];

    if (!this.q) {
      this.modo = 'vazio';
      this.subtitulo = 'Digite no campo de busca lá em cima, ou clique num exemplo.';
      return;
    }

    if (this.procurar === 'agendamentos') return this.mostrarAgendamentos();
    if (this.procurar === 'financeiro') return this.mostrarFinanceiro();

    const data = interpretarData(this.q);
    const hora = interpretarHora(this.q);
    if (this.procurar === 'tudo' && data) return this.mostrarDia(data);
    if (this.procurar === 'tudo' && hora) return this.mostrarHorario(hora);

    const termo = this.q.toLowerCase();
    const digitos = this.q.replace(/\D/g, '');
    let clientes = this.clientes.filter(c =>
      c.nome.toLowerCase().includes(termo) ||
      (digitos.length >= 3 && String(c.telefone || '').replace(/\D/g, '').includes(digitos))
    );
    let servicos = this.servicos.filter(s => s.nome.toLowerCase().includes(termo));

    // veio de uma sugestão: já sabemos qual é
    if (this.tipo === 'cliente' && this.idEscolhido) {
      const c = this.clientes.find(x => x.id === this.idEscolhido);
      if (c && this.procurar !== 'servicos') return this.mostrarCliente(c);
    }
    if (this.tipo === 'servico' && this.idEscolhido) {
      const s = this.servicos.find(x => x.id === this.idEscolhido);
      if (s && this.procurar !== 'clientes') return this.mostrarServico(s);
    }

    if (this.procurar === 'clientes') servicos = [];
    if (this.procurar === 'servicos') clientes = [];

    // nome exato vale mais que "contém" (ex.: "Ana" não confunde com "Ana Paula")
    const clienteExato = clientes.find(c => c.nome.toLowerCase() === termo);
    const servicoExato = servicos.find(s => s.nome.toLowerCase() === termo);
    if (clienteExato && !servicoExato) return this.mostrarCliente(clienteExato);
    if (servicoExato && !clienteExato) return this.mostrarServico(servicoExato);
    if (clientes.length === 1 && servicos.length === 0 && !this.temObservacao(termo)) return this.mostrarCliente(clientes[0]);
    if (servicos.length === 1 && clientes.length === 0 && !this.temObservacao(termo)) return this.mostrarServico(servicos[0]);

    this.mostrarLista(clientes, servicos);
  }

  private temObservacao(termo: string): boolean {
    return this.procurar === 'tudo' && this.agendamentos.some(a => (a.observacao || '').toLowerCase().includes(termo));
  }

  // =====================================================================
  //  CLIENTE
  // =====================================================================

  private mostrarCliente(c: Cliente) {
    this.modo = 'cliente';
    this.subtitulo = 'Cliente · tudo sobre ele: agendamentos e pagamentos';
    const r = resumoDoCliente(c.id, this.agendamentos, this.servicos);

    this.numeros = [
      { rotulo: 'Visitas', valor: String(r.visitas) },
      ...(this.veValores ? [{ rotulo: 'Total gasto', valor: dinheiro(r.totalGasto) }] : []),
      {
        rotulo: 'Próxima visita',
        valor: r.proximaVisita ? this.dataComDia(r.proximaVisita) : r.prevista ? `${r.atrasada ? 'atrasada' : 'prevista'} ${dataCurta(r.prevista)}` : '—',
      },
      { rotulo: 'Volta a cada', valor: r.ritmo ? `${r.ritmo} dias` : '—' },
      { rotulo: 'Situação', valor: ROTULO_SITUACAO[r.situacao] },
    ];

    const link = linkWhatsapp(c.telefone, mensagemSaudade(c.nome, r.servicoFavorito?.nome ?? null));
    this.acoes = [
      { rotulo: 'Abrir ficha completa', principal: true, fazer: () => this.router.navigate(['/clientes'], { queryParams: { ficha: c.id } }) },
      ...(link ? [{ rotulo: 'Chamar no WhatsApp', fazer: () => window.open(link, '_blank') }] : []),
      { rotulo: 'Novo agendamento', fazer: () => this.router.navigate(['/agenda'], { queryParams: { novo: hojeISO(), cliente: c.id } }) },
    ];

    const ags = this.filtrarAgendamentos(this.agendamentos.filter(a => a.clienteId === c.id))
      .sort((a, b) => b.data.localeCompare(a.data) || b.horario.localeCompare(a.horario));
    this.secoes = [{
      titulo: 'Agendamentos',
      contagem: `${ags.length} no período`,
      colunas: ['Data', 'Hora', 'Serviço', 'Status', 'Pagamento'],
      linhas: ags.map(a => ({
        celulas: [this.dataComDia(a.data), a.horario, this.nomeServico(a.servicoId), this.rotuloStatus(a), this.textoPagamento(a)],
      })),
      vazio: 'Nenhum agendamento no período.',
    }];

    // lista de espera deste cliente (pedidos de vaga e como terminaram)
    const naFila = this.fila.filter(e => e.clienteId === c.id)
      .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
    this.secoes.push({
      titulo: 'Lista de espera',
      contagem: `${naFila.length}`,
      colunas: ['Pediu em', 'Serviço', 'Dia desejado', 'Período', 'Situação'],
      linhas: naFila.map(e => ({
        celulas: [
          e.criadoEm ? dataCurta(e.criadoEm.slice(0, 10)) : '—',
          e.servicoNome,
          textoQuer(e).dia,
          textoQuer(e).quando,
          { aguardando: 'Aguardando', avisado: 'Avisado', encaixado: 'Encaixado', desistiu: 'Desistiu', expirado: 'Expirou' }[e.situacao],
        ],
        abrir: () => this.router.navigate(['/lista-espera']),
      })),
      vazio: 'Não está nem esteve na lista de espera.',
    });
  }

  // =====================================================================
  //  SERVIÇO
  // =====================================================================

  private mostrarServico(s: ServicoCRM) {
    this.modo = 'servico';
    this.subtitulo = 'Serviço · quem faz, quanto rende e os próximos horários';
    const doServico = this.agendamentos.filter(a => a.servicoId === s.id);
    const realizados = this.filtrarAgendamentos(doServico.filter(a => a.status === 'realizado'));
    const faturamento = realizados.filter(a => a.statusPagamento === 'pago').reduce((t, a) => t + valorRecebido(a), 0);
    const clientesDiferentes = new Set(realizados.map(a => a.clienteId)).size;

    this.numeros = [
      { rotulo: 'Feitas no período', valor: String(realizados.length) },
      ...(this.veValores ? [{ rotulo: 'Faturamento', valor: dinheiro(faturamento) }, { rotulo: 'Preço atual', valor: dinheiro(s.valor) }] : []),
      { rotulo: 'Duração', valor: `${s.duracao} min` },
      { rotulo: 'Clientes diferentes', valor: String(clientesDiferentes) },
    ];

    this.acoes = [
      ...(this.podeEditarServicos
        ? [{ rotulo: 'Editar serviço', principal: true, fazer: () => this.router.navigate(['/servicos'], { queryParams: { editar: s.id } }) }]
        : []),
      { rotulo: 'Ver na Agenda', fazer: () => this.router.navigate(['/agenda']) },
    ];

    const hoje = hojeISO();
    const proximos = this.filtrarAgendamentos(doServico.filter(a => a.status === 'agendado' && a.data >= hoje), false)
      .sort((a, b) => a.data.localeCompare(b.data) || a.horario.localeCompare(b.horario));

    // quem mais faz este serviço (no período)
    const porCliente = new Map<number, { vezes: number; ultima: string; total: number }>();
    for (const a of realizados) {
      const atual = porCliente.get(a.clienteId) || { vezes: 0, ultima: '', total: 0 };
      atual.vezes++;
      if (a.data > atual.ultima) atual.ultima = a.data;
      if (a.statusPagamento === 'pago') atual.total += valorRecebido(a);
      porCliente.set(a.clienteId, atual);
    }
    const ranking = [...porCliente.entries()].sort((a, b) => b[1].vezes - a[1].vezes).slice(0, 10);

    this.secoes = [
      {
        titulo: 'Próximos agendamentos',
        contagem: `${proximos.length} ${proximos.length === 1 ? 'marcado' : 'marcados'}`,
        colunas: ['Data', 'Hora', 'Cliente', 'Status', 'Origem'],
        linhas: proximos.map(a => ({
          celulas: [this.dataComDia(a.data), a.horario, this.nomeCliente(a.clienteId), this.rotuloStatus(a), ROTULO_ORIGEM[a.origem] || 'Sistema'],
        })),
        vazio: 'Nenhum agendamento marcado com este serviço.',
      },
      {
        titulo: 'Quem mais faz',
        contagem: `${ranking.length} ${ranking.length === 1 ? 'cliente' : 'clientes'}`,
        colunas: this.veValores ? ['Cliente', 'Vezes', 'Última vez', 'Total gasto', 'Situação'] : ['Cliente', 'Vezes', 'Última vez', 'Situação'],
        linhas: ranking.map(([clienteId, info]) => {
          const situacao = ROTULO_SITUACAO[resumoDoCliente(clienteId, this.agendamentos, this.servicos).situacao];
          const celulas = [this.nomeCliente(clienteId), String(info.vezes), dataCurta(info.ultima)];
          if (this.veValores) celulas.push(dinheiro(info.total));
          celulas.push(situacao);
          return { celulas, abrir: () => this.abrirCliente(clienteId) };
        }),
        vazio: 'Ninguém fez este serviço no período.',
      },
    ];
  }

  // =====================================================================
  //  DIA
  // =====================================================================

  private mostrarDia(data: string) {
    this.modo = 'dia';
    this.subtitulo = `Dia · ${this.dataPorExtenso(data)}: agenda, horários livres${this.veValores ? ' e dinheiro do dia' : ''}`;
    const doDia = this.filtrarAgendamentos(this.agendamentos.filter(a => a.data === data), false)
      .sort((a, b) => a.horario.localeCompare(b.horario));
    const ocupando = doDia.filter(a => a.status === 'agendado' || a.status === 'realizado');
    const previsto = ocupando.reduce((t, a) => t + (a.valorCobrado ?? this.precoServico(a.servicoId)), 0);
    const recebido = this.agendamentos
      .filter(a => a.statusPagamento === 'pago' && (a.pagoEm || '').startsWith(data))
      .reduce((t, a) => t + valorRecebido(a), 0);
    const livres = this.livresDoDia(data);

    this.numeros = [
      { rotulo: 'Atendimentos', valor: String(ocupando.length) },
      ...(this.veValores ? [{ rotulo: 'Previsto', valor: dinheiro(previsto) }, { rotulo: 'Recebido', valor: dinheiro(recebido) }] : []),
      { rotulo: 'Ocupação', valor: `${this.ocupacaoDoDia(data)}%` },
      { rotulo: 'Horários livres', valor: String(livres.length) },
    ];

    this.acoes = [
      { rotulo: 'Abrir o dia na Agenda', principal: true, fazer: () => this.router.navigate(['/agenda'], { queryParams: { data } }) },
      { rotulo: 'Novo agendamento neste dia', fazer: () => this.router.navigate(['/agenda'], { queryParams: { novo: data } }) },
    ];

    const aReceber = doDia.filter(a => a.status === 'realizado' && a.statusPagamento === 'pendente');
    this.secoes = [
      {
        titulo: 'Agendamentos do dia',
        contagem: `${doDia.length}`,
        colunas: this.veValores ? ['Hora', 'Cliente', 'Serviço', 'Status', 'Valor'] : ['Hora', 'Cliente', 'Serviço', 'Status'],
        linhas: doDia.map(a => {
          const celulas = [a.horario, this.nomeCliente(a.clienteId), this.nomeServico(a.servicoId), this.rotuloStatus(a)];
          if (this.veValores) celulas.push(dinheiro(a.valorCobrado ?? this.precoServico(a.servicoId)));
          return { celulas };
        }),
        vazio: 'Nenhum agendamento neste dia.',
      },
      {
        titulo: 'Horários livres',
        contagem: `${livres.length}`,
        colunas: ['De', 'Até'],
        linhas: livres.map(l => ({
          celulas: [l.inicio, l.fim],
          abrir: () => this.router.navigate(['/agenda'], { queryParams: { novo: data, hora: l.inicio } }),
        })),
        vazio: this.configDoDia(data) ? 'Nenhum horário livre.' : 'Você não trabalha neste dia.',
      },
      {
        // quem está esperando vaga para este dia (ou para qualquer dia)
        titulo: 'Lista de espera para este dia',
        contagem: '',
        colunas: ['Cliente', 'Serviço', 'Quer', 'Vaga compatível'],
        linhas: this.fila
          .filter(e => (e.situacao === 'aguardando' || e.situacao === 'avisado') && (!e.dataPreferida || e.dataPreferida === data))
          .map(e => ({
            celulas: [
              e.clienteNome,
              e.servicoNome,
              `${textoQuer(e).dia} · ${textoQuer(e).quando}`,
              e.vaga && e.vaga.data === data ? `às ${e.vaga.horario}` : '—',
            ],
            abrir: () => this.router.navigate(['/lista-espera']),
          })),
        vazio: 'Ninguém na lista de espera para este dia.',
      },
    ];
    this.secoes[2].contagem = `${this.secoes[2].linhas.length}`;
    if (this.veValores) {
      this.secoes.push({
        titulo: 'Financeiro do dia · a receber',
        contagem: dinheiro(aReceber.reduce((t, a) => t + valorRecebido(a), 0)),
        colunas: ['Cliente', 'Serviço', 'Valor'],
        linhas: aReceber.map(a => ({ celulas: [this.nomeCliente(a.clienteId), this.nomeServico(a.servicoId), dinheiro(valorRecebido(a))] })),
        vazio: 'Nada a receber deste dia.',
      });
    }
  }

  // =====================================================================
  //  HORÁRIO (ex.: "14:00" nos próximos dias)
  // =====================================================================

  private mostrarHorario(hora: string) {
    this.modo = 'horario';
    this.subtitulo = `Horário · como fica ${hora} em cada dia do período`;
    const minuto = this.paraMinutos(hora);
    const { inicio, fim } = this.limitesPeriodo();
    const ultimo = fim || somarDias(hojeISO(), 13);
    const agora = new Date();
    const agoraMin = agora.getHours() * 60 + agora.getMinutes();

    const ocupados: { data: string; ag: AgendamentoCRM }[] = [];
    const livres: { data: string; ate: string }[] = [];
    let diasConsiderados = 0;

    for (let data = inicio < '2000-01-01' ? hojeISO() : inicio; data <= ultimo; data = somarDias(data, 1)) {
      const config = this.configDoDia(data);
      const ags = this.filtrarAgendamentos(this.agendamentos.filter(a => a.data === data && (a.status === 'agendado' || a.status === 'realizado')), false);
      const ocupando = ags.find(a => {
        const ini = this.paraMinutos(a.horario);
        return minuto >= ini && minuto < ini + this.duracaoServico(a.servicoId);
      });
      if (!config && !ocupando) continue;
      diasConsiderados++;
      if (ocupando) {
        ocupados.push({ data, ag: ocupando });
        continue;
      }
      // livre: dentro do expediente e (se for hoje) ainda não passou
      const naPausa = !!config && config.pausas.some(p => minuto >= p.ini && minuto < p.fim);
      const dentro = !!config && minuto >= config.inicio && minuto < config.fim && !naPausa;
      const passou = data === hojeISO() && minuto <= agoraMin;
      if (dentro && !passou && data >= hojeISO()) {
        // livre até o próximo agendamento, a próxima pausa ou o fim do expediente
        const proximo = ags.map(a => this.paraMinutos(a.horario))
          .concat(config!.pausas.map(p => p.ini))
          .filter(m => m > minuto).sort((a, b) => a - b)[0];
        const ate = Math.min(proximo ?? Infinity, config!.fim);
        livres.push({ data, ate: this.paraHora(ate) });
      }
    }

    const servicoComum = this.maisComum(ocupados.map(o => this.nomeServico(o.ag.servicoId)));
    const porDiaSemana = this.maisComum(
      this.filtrarAgendamentos(this.agendamentos.filter(a => a.status === 'agendado' || a.status === 'realizado'))
        .map(a => DIAS_SEMANA[this.diaSemanaDe(a.data)])
    );

    this.numeros = [
      { rotulo: `Ocupado às ${hora}`, valor: `${ocupados.length} de ${diasConsiderados} dias` },
      { rotulo: 'Livre', valor: `${livres.length} ${livres.length === 1 ? 'dia' : 'dias'}` },
      { rotulo: 'Serviço mais comum', valor: servicoComum || '—' },
      { rotulo: 'Dia mais cheio', valor: porDiaSemana || '—' },
    ];

    const primeiroLivre = livres[0];
    this.acoes = primeiroLivre
      ? [{
          rotulo: `Agendar às ${hora}`,
          principal: true,
          fazer: () => this.router.navigate(['/agenda'], { queryParams: { novo: primeiroLivre.data, hora } }),
        }]
      : [];

    this.secoes = [
      {
        titulo: 'Ocupado',
        contagem: `${ocupados.length}`,
        colunas: ['Data', 'Cliente', 'Serviço', 'Status', 'Termina'],
        linhas: ocupados.map(o => ({
          celulas: [
            this.dataComDia(o.data),
            this.nomeCliente(o.ag.clienteId),
            this.nomeServico(o.ag.servicoId),
            this.rotuloStatus(o.ag),
            this.paraHora(this.paraMinutos(o.ag.horario) + this.duracaoServico(o.ag.servicoId)),
          ],
        })),
        vazio: `Ninguém marcado às ${hora} no período.`,
      },
      {
        titulo: 'Livre',
        contagem: `${livres.length}`,
        colunas: ['Data', 'Dia da semana', 'Livre até'],
        linhas: livres.map(l => ({
          celulas: [dataCurta(l.data), DIAS_SEMANA[this.diaSemanaDe(l.data)], l.ate],
          abrir: () => this.router.navigate(['/agenda'], { queryParams: { novo: l.data, hora } }),
        })),
        vazio: `Nenhum dia com ${hora} livre no período.`,
      },
    ];
  }

  // =====================================================================
  //  LISTA (vários resultados), AGENDAMENTOS e FINANCEIRO
  // =====================================================================

  private mostrarLista(clientes: Cliente[], servicos: ServicoCRM[]) {
    const termo = this.q.toLowerCase();
    const comObservacao = this.procurar === 'tudo'
      ? this.filtrarAgendamentos(this.agendamentos.filter(a => (a.observacao || '').toLowerCase().includes(termo)), false)
      : []; // observações: procura em todas as datas (igual à contagem da sugestão)
    const total = clientes.length + servicos.length + comObservacao.length;

    if (total === 0) {
      this.modo = 'nada';
      this.subtitulo = 'Nada encontrado. Tente o nome de um cliente, um serviço, uma data (14/10) ou um horário (14:00).';
      return;
    }

    this.modo = 'lista';
    this.subtitulo = `${total} ${total === 1 ? 'resultado' : 'resultados'} · clique numa linha para ver tudo sobre ela`;

    if (clientes.length) {
      this.secoes.push({
        titulo: 'Clientes',
        contagem: `${clientes.length}`,
        colunas: ['Cliente', 'Telefone', 'Visitas', 'Situação'],
        linhas: clientes.map(c => {
          const r = resumoDoCliente(c.id, this.agendamentos, this.servicos);
          return { celulas: [c.nome, c.telefone || '—', String(r.visitas), ROTULO_SITUACAO[r.situacao]], abrir: () => this.abrirCliente(c.id) };
        }),
        vazio: '',
      });
    }
    if (servicos.length) {
      this.secoes.push({
        titulo: 'Serviços',
        contagem: `${servicos.length}`,
        colunas: this.veValores ? ['Serviço', 'Preço', 'Duração'] : ['Serviço', 'Duração'],
        linhas: servicos.map(s => ({
          celulas: this.veValores ? [s.nome, dinheiro(s.valor), `${s.duracao} min`] : [s.nome, `${s.duracao} min`],
          abrir: () => this.router.navigate(['/busca'], { queryParams: { q: s.nome, tipo: 'servico', id: s.id } }),
        })),
        vazio: '',
      });
    }
    if (comObservacao.length) {
      const secao = this.secaoAgendamentos(`“${this.q}” nas observações`, comObservacao, true);
      secao.contagem = `${comObservacao.length}`;
      this.secoes.push(secao);
    }
  }

  private mostrarAgendamentos() {
    this.modo = 'agendamentos';
    this.subtitulo = 'Agendamentos · pelo nome do cliente, do serviço ou pelas observações';
    const termo = this.q.toLowerCase();
    const lista = this.filtrarAgendamentos(this.agendamentos.filter(a =>
      this.nomeCliente(a.clienteId).toLowerCase().includes(termo) ||
      this.nomeServico(a.servicoId).toLowerCase().includes(termo) ||
      (a.observacao || '').toLowerCase().includes(termo)
    )).sort((a, b) => b.data.localeCompare(a.data) || b.horario.localeCompare(a.horario));

    this.numeros = [
      { rotulo: 'Encontrados', valor: String(lista.length) },
      { rotulo: 'Realizados', valor: String(lista.filter(a => a.status === 'realizado').length) },
      { rotulo: 'Cancelados', valor: String(lista.filter(a => a.status === 'cancelado').length) },
      { rotulo: 'Faltas', valor: String(lista.filter(a => a.status === 'nao_compareceu').length) },
    ];
    this.secoes = [this.secaoAgendamentos('Agendamentos', lista, true)];
  }

  private mostrarFinanceiro() {
    this.modo = 'financeiro';
    this.subtitulo = 'Financeiro · pagamentos e despesas que combinam com a busca';
    const termo = this.q.toLowerCase();
    const casa = (a: AgendamentoCRM) =>
      this.nomeCliente(a.clienteId).toLowerCase().includes(termo) || this.nomeServico(a.servicoId).toLowerCase().includes(termo);

    const pagos = this.agendamentos
      .filter(a => a.statusPagamento === 'pago' && a.pagoEm && this.noPeriodo(a.pagoEm.slice(0, 10)) && casa(a))
      .sort((a, b) => (b.pagoEm || '').localeCompare(a.pagoEm || ''));
    const aReceber = this.agendamentos.filter(a => a.status === 'realizado' && a.statusPagamento === 'pendente' && casa(a));
    const despesas = this.despesas.filter(d => d.descricao.toLowerCase().includes(termo));

    this.numeros = [
      { rotulo: 'Recebido no período', valor: dinheiro(pagos.reduce((t, a) => t + valorRecebido(a), 0)) },
      { rotulo: 'A receber', valor: dinheiro(aReceber.reduce((t, a) => t + valorRecebido(a), 0)) },
      { rotulo: 'Despesas encontradas', valor: String(despesas.length) },
    ];
    this.secoes = [
      {
        titulo: 'Pagamentos',
        contagem: `${pagos.length} no período`,
        colunas: ['Pago em', 'Cliente', 'Serviço', 'Valor', 'Forma'],
        linhas: pagos.map(a => ({
          celulas: [dataCurta(a.pagoEm!.slice(0, 10)), this.nomeCliente(a.clienteId), this.nomeServico(a.servicoId), dinheiro(valorRecebido(a)), a.formaPagamento ? ROTULO_FORMA[a.formaPagamento] : '—'],
        })),
        vazio: 'Nenhum pagamento no período.',
      },
      {
        titulo: 'Despesas',
        contagem: `${despesas.length}`,
        colunas: ['Mês', 'Descrição', 'Tipo', 'Valor'],
        linhas: despesas.map(d => ({ celulas: [this.mesAno(d.mes), d.descricao, d.tipo === 'fixa' ? 'Fixa' : 'Emergencial', dinheiro(d.valor)] })),
        vazio: 'Nenhuma despesa com esse nome.',
      },
    ];
  }

  private secaoAgendamentos(titulo: string, lista: AgendamentoCRM[], comObs: boolean): Secao {
    return {
      titulo,
      contagem: `${lista.length} no período`,
      colunas: comObs ? ['Data', 'Hora', 'Cliente', 'Serviço', 'Status', 'Observação'] : ['Data', 'Hora', 'Cliente', 'Serviço', 'Status'],
      linhas: lista.map(a => {
        const celulas = [this.dataComDia(a.data), a.horario, this.nomeCliente(a.clienteId), this.nomeServico(a.servicoId), this.rotuloStatus(a)];
        if (comObs) celulas.push(a.observacao || '—');
        return { celulas, abrir: () => this.router.navigate(['/agenda'], { queryParams: { ag: a.id } }) };
      }),
      vazio: 'Nenhum agendamento encontrado.',
    };
  }

  private abrirCliente(id: number) {
    const c = this.clientes.find(x => x.id === id);
    if (c) this.router.navigate(['/busca'], { queryParams: { q: c.nome, tipo: 'cliente', id } });
  }

  // =====================================================================
  //  EXEMPLOS (clique) — montados com os dados do próprio negócio
  // =====================================================================

  private montarExemplos() {
    const exemplos: { rotulo: string; q: string }[] = [];
    const cliente = [...this.clientes].sort((a, b) =>
      this.agendamentos.filter(x => x.clienteId === b.id).length - this.agendamentos.filter(x => x.clienteId === a.id).length
    )[0];
    if (cliente) exemplos.push({ rotulo: `${cliente.nome} (cliente)`, q: cliente.nome });
    const servico = this.servicos[0];
    if (servico) exemplos.push({ rotulo: `${servico.nome} (serviço)`, q: servico.nome });
    const hoje = dataCurta(hojeISO());
    exemplos.push({ rotulo: `${hoje} (dia)`, q: hoje });
    exemplos.push({ rotulo: '14:00 (horário)', q: '14:00' });
    this.exemplos = exemplos;
  }

  // =====================================================================
  //  AUXILIARES
  // =====================================================================

  /** Expediente do dia (com pausa e folgas), ou null se não trabalha. */
  private configDoDia(data: string): Expediente | null {
    return expedienteDoDia(this.horario, data);
  }

  private ocupacaoDoDia(data: string): number {
    const disponivel = minutosDeTrabalho(this.configDoDia(data));
    const ocupado = this.agendamentos
      .filter(a => a.data === data && (a.status === 'agendado' || a.status === 'realizado'))
      .reduce((t, a) => t + this.duracaoServico(a.servicoId), 0);
    return disponivel > 0 ? Math.min(100, Math.round((ocupado / disponivel) * 100)) : 0;
  }

  /** Intervalos livres do dia (a partir de agora, se for hoje), igual ao calendário. */
  private livresDoDia(data: string): { inicio: string; fim: string }[] {
    const config = this.configDoDia(data);
    const hoje = hojeISO();
    if (!config || data < hoje) return [];
    const bloco = this.horario.blocoMin || 30;
    let cursor = config.inicio;
    if (data === hoje) {
      const agora = new Date();
      cursor = Math.max(cursor, Math.ceil((agora.getHours() * 60 + agora.getMinutes()) / bloco) * bloco);
    }
    const fimDia = config.fim;
    const ocupados = this.agendamentos
      .filter(a => a.data === data && (a.status === 'agendado' || a.status === 'realizado'))
      .map(a => ({ ini: this.paraMinutos(a.horario), fim: this.paraMinutos(a.horario) + this.duracaoServico(a.servicoId) }))
      .concat(config.pausas.map(p => ({ ini: p.ini, fim: p.fim })))
      .sort((a, b) => a.ini - b.ini);
    const livres: { inicio: string; fim: string }[] = [];
    for (const o of ocupados) {
      if (o.ini - cursor >= bloco) livres.push({ inicio: this.paraHora(cursor), fim: this.paraHora(o.ini) });
      cursor = Math.max(cursor, o.fim);
    }
    if (fimDia - cursor >= bloco) livres.push({ inicio: this.paraHora(cursor), fim: this.paraHora(fimDia) });
    return livres;
  }

  private maisComum(lista: string[]): string | null {
    const contagem = new Map<string, number>();
    for (const x of lista) contagem.set(x, (contagem.get(x) || 0) + 1);
    let melhor: string | null = null;
    let vezes = 0;
    for (const [valor, n] of contagem) if (n > vezes) { melhor = valor; vezes = n; }
    return melhor;
  }

  rotuloStatus(a: AgendamentoCRM): string {
    switch (a.status) {
      case 'agendado': return 'Agendado';
      case 'realizado': return 'Realizado';
      case 'cancelado': return a.canceladoPor === 'profissional' ? 'Cancelado (você)' : 'Cancelado (cliente)';
      case 'nao_compareceu': return 'Não compareceu';
    }
  }

  private textoPagamento(a: AgendamentoCRM): string {
    if (a.status !== 'realizado') return '—';
    if (a.statusPagamento !== 'pago') return 'A receber';
    const valor = this.veValores ? dinheiro(valorRecebido(a)) : 'Pago';
    return a.formaPagamento ? `${valor} · ${ROTULO_FORMA[a.formaPagamento]}` : valor;
  }

  private nomeCliente(id: number): string {
    return this.clientes.find(c => c.id === id)?.nome ?? 'Cliente removido';
  }

  private nomeServico(id: number): string {
    return this.servicos.find(s => s.id === id)?.nome ?? 'Serviço removido';
  }

  private precoServico(id: number): number {
    return this.servicos.find(s => s.id === id)?.valor ?? 0;
  }

  private duracaoServico(id: number): number {
    return this.servicos.find(s => s.id === id)?.duracao || 30;
  }

  /** "sex 16/10" */
  private dataComDia(data: string): string {
    return `${DIAS_SEMANA[this.diaSemanaDe(data)].slice(0, 3)} ${dataCurta(data)}`;
  }

  /** "quarta, 14/10/2026" */
  private dataPorExtenso(data: string): string {
    const [ano, mes, dia] = data.split('-');
    return `${DIAS_SEMANA[this.diaSemanaDe(data)]}, ${dia}/${mes}/${ano}`;
  }

  private mesAno(mes: string): string {
    const [ano, m] = mes.split('-');
    return `${m}/${ano}`;
  }

  private diaSemanaDe(data: string): number {
    const [ano, mes, dia] = data.split('-').map(Number);
    return new Date(ano, mes - 1, dia).getDay();
  }

  private paraMinutos(hhmm: string): number {
    const [h, m] = String(hhmm).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  }

  private paraHora(minutos: number): string {
    return `${String(Math.floor(minutos / 60) % 24).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
  }

  private formatarData(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
