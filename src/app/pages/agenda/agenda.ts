import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { AcaoRapida, Calendario, EventoResumo, VisaoCalendario } from '../../components/calendario/calendario';

import {
  API_URL,
  dinheiro,
  HorarioTrabalho,
  horarioPadrao,
  normalizarHorarioTrabalho,
  expedienteDoDia,
  bloqueioDoDiaInteiro,
} from '../../app';

interface Cliente { id: number; nome: string; }
interface Servico { id: number; nome: string; valor: number; duracao: number; }

type StatusAgendamento = 'agendado' | 'realizado' | 'cancelado' | 'nao_compareceu';
type FormaPagamento = 'dinheiro' | 'pix' | 'debito' | 'credito';

interface Agendamento {
  id: number;
  clienteId: number;
  servicoId: number;
  data: string;    // 'YYYY-MM-DD'
  horario: string; // 'HH:mm'
  status: StatusAgendamento;
  observacao: string;
  origem: 'sistema' | 'whatsapp' | 'link' | 'lista_espera';
  criadoEm: string | null;       // 'YYYY-MM-DD HH:mm:ss'
  criadoPorNome: string | null;
  statusEm: string | null;
  reagendamentos: number;
  valorCobrado: number | null;
  desconto: number;
  formaPagamento: FormaPagamento | null;
  statusPagamento: 'pendente' | 'pago';
  pagoEm: string | null;
  recebidoPorNome: string | null;
  canceladoPor: 'cliente' | 'profissional' | null;
  motivoCancelamento: string;
}

/** O que está aberto dentro da janela de detalhes. */
type AcaoDetalhe = '' | 'concluir' | 'falta' | 'reagendar' | 'cancelar' | 'pagamento';


@Component({
  selector: 'app-agenda',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, Calendario],
  templateUrl: './agenda.html',
  styleUrl: './agenda.css',
})
export class Agenda implements OnInit {
  carregando = true;
  erro: string | null = null;
  erroModal: string | null = null;
  salvando = false;

  agendamentos: Agendamento[] = [];
  clientes: Cliente[] = [];
  servicos: Servico[] = [];
  horario: HorarioTrabalho = horarioPadrao();

  eventosPorDia: Map<string, EventoResumo[]> = new Map();

  private hoje = new Date();
  /** Dia | Semana | Mês (começa no Mês, como no desenho). */
  visao: VisaoCalendario = 'mes';
  /** Data de referência do período mostrado (o mês, a semana ou o dia). */
  dataRef = this.formatarData(this.hoje);
  diaSelecionado = this.formatarData(this.hoje);

  // ----- janela "Novo agendamento" -----
  modalAberto = false;
  novoAgendamento = { data: this.diaSelecionado, clienteId: 0, servicoId: 0, horario: '', observacao: '' };
  /** RN02: conflito de horário só avisa; a pessoa pode marcar mesmo assim. */
  avisoConflitoNovo = '';

  // ----- janela de detalhes do agendamento -----
  detalhe: Agendamento | null = null;
  acao: AcaoDetalhe = '';
  erroDetalhe: string | null = null;
  salvandoDetalhe = false;
  observacaoEditada = '';

  readonly formasPagamento: { valor: FormaPagamento; rotulo: string }[] = [
    { valor: 'dinheiro', rotulo: 'Dinheiro' },
    { valor: 'pix', rotulo: 'Pix' },
    { valor: 'debito', rotulo: 'Débito' },
    { valor: 'credito', rotulo: 'Crédito' },
  ];

  formConcluir = { pagouAgora: true, valorCobrado: 0, desconto: 0, formaPagamento: 'pix' as FormaPagamento };
  formCancelar = { canceladoPor: 'cliente' as 'cliente' | 'profissional', motivo: '' };
  formReagendar = { data: '', horario: '', avisoConflito: '' };
  formPagamento = { valorCobrado: 0, desconto: 0, pagoEm: '', formaPagamento: 'pix' as FormaPagamento };

  readonly diasSemanaCurto = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  readonly nomesMeses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  constructor(
    private router: Router,
    private rota: ActivatedRoute,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  private cabecalhoAuth(): HttpHeaders {
    const token = localStorage.getItem('meufluxo_token');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  /** Só o dono pode desfazer um atendimento finalizado (RN03). */
  get ehDono(): boolean {
    try {
      return JSON.parse(localStorage.getItem('usuarioLogado') || '{}').papel !== 'atendente';
    } catch {
      return true;
    }
  }

  ngOnInit() {
    const token = localStorage.getItem('meufluxo_token');
    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    const headers = this.cabecalhoAuth();

    forkJoin({
      clientes: this.http.get<{ clientes: Cliente[] }>(`${API_URL}/clientes`, { headers }),
      servicos: this.http.get<{ servicos: { id: number; nome: string; categoria: string; valor: number; duracaoMin: number }[] }>(
        `${API_URL}/servicos`,
        { headers }
      ),
      agendamentos: this.http.get<{ agendamentos: Agendamento[] }>(`${API_URL}/agendamentos`, { headers }),
      horarioTrabalho: this.http.get<unknown>(`${API_URL}/horario-trabalho`, { headers }),
    }).subscribe({
      next: ({ clientes, servicos, agendamentos, horarioTrabalho }) => {
        this.clientes = clientes.clientes;
        this.servicos = servicos.servicos.map(s => ({ id: s.id, nome: s.nome, valor: s.valor, duracao: s.duracaoMin }));
        this.agendamentos = agendamentos.agendamentos;
        this.horario = normalizarHorarioTrabalho(horarioTrabalho); // com pausa e folgas
        this.atualizarDerivados();
        this.carregando = false;
        this.abrirPeloEndereco();
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.carregando = false;
        this.erro = 'Não foi possível carregar a agenda.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  HORÁRIO DE TRABALHO (expediente) e VALIDAÇÃO de conflito
  // =====================================================================

  private paraMinutos(hhmm: string): number {
    const [h, m] = String(hhmm).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  }

  private paraHora(minutos: number): string {
    return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
  }

  private diaSemanaDe(data: string): number {
    const [ano, mes, dia] = data.split('-').map(Number);
    return new Date(ano, mes - 1, dia).getDay();
  }

  /** Fora do expediente bloqueia (a pessoa não atende nesse horário). Devolve '' se estiver ok. */
  private validarExpediente(data: string, horarioNovo: string, servicoId: number): string {
    const duracao = this.duracaoServico(servicoId);
    const inicioMin = this.paraMinutos(horarioNovo);
    const fimMin = inicioMin + duracao;

    const folga = bloqueioDoDiaInteiro(this.horario, data);
    if (folga) {
      return `Esse dia está bloqueado (${folga.descricao || 'folga'}). Escolha outra data ou remova o bloqueio no Perfil.`;
    }
    const diaConfig = this.horario.dias[this.diaSemanaDe(data)];
    if (!diaConfig.ativo) {
      return 'Você não atende nesse dia da semana. Ajuste o horário de trabalho no Perfil ou escolha outra data.';
    }
    if (inicioMin < this.paraMinutos(diaConfig.inicio) || fimMin > this.paraMinutos(diaConfig.fim)) {
      return `Esse horário fica fora do seu expediente (${diaConfig.inicio} às ${diaConfig.fim}).`;
    }
    // pausa do almoço e bloqueios de parte do dia
    const expediente = expedienteDoDia(this.horario, data);
    const pausa = expediente?.pausas.find(p => inicioMin < p.fim && p.ini < fimMin);
    if (pausa) {
      const de = this.paraHora(pausa.ini);
      const ate = this.paraHora(pausa.fim);
      return pausa.motivo === 'Pausa'
        ? `Esse horário cai na sua pausa (${de} às ${ate}).`
        : `Esse horário está bloqueado (${pausa.motivo}, das ${de} às ${ate}).`;
    }
    return '';
  }

  /**
   * RN02: conflito de horário (períodos que se sobrepõem) só AVISA.
   * Devolve a mensagem do aviso, ou '' se não houver conflito.
   * idIgnorado: ao reagendar, o próprio agendamento não conta.
   */
  private verificarConflito(data: string, horarioNovo: string, servicoId: number, idIgnorado = 0): string {
    const inicioMin = this.paraMinutos(horarioNovo);
    const fimMin = inicioMin + this.duracaoServico(servicoId);

    const conflito = this.agendamentos.find(a => {
      if (a.id === idIgnorado || a.data !== data) return false;
      if (a.status === 'cancelado' || a.status === 'nao_compareceu') return false; // não ocupam mais o horário
      const outroInicio = this.paraMinutos(a.horario);
      const outroFim = outroInicio + this.duracaoServico(a.servicoId);
      return inicioMin < outroFim && outroInicio < fimMin;
    });

    return conflito
      ? `Esse horário conflita com o agendamento de ${this.nomeCliente(conflito.clienteId)} às ${conflito.horario}.`
      : '';
  }

  // =====================================================================
  //  CALENDÁRIO
  // =====================================================================

  private atualizarDerivados() {
    const mapaEventos = new Map<string, EventoResumo[]>();
    for (const ag of this.agendamentos) {
      if (!mapaEventos.has(ag.data)) mapaEventos.set(ag.data, []);
      mapaEventos.get(ag.data)!.push({
        id: ag.id,
        horario: ag.horario,
        texto: this.nomeCurto(this.nomeCliente(ag.clienteId)),
        nomeCompleto: this.nomeCliente(ag.clienteId),
        servico: this.nomeServico(ag.servicoId),
        duracao: this.duracaoServico(ag.servicoId),
        status: ag.status,
        statusPagamento: ag.statusPagamento,
        origem: ag.origem,
      });
    }
    for (const lista of mapaEventos.values()) {
      lista.sort((a, b) => a.horario.localeCompare(b.horario));
    }
    this.eventosPorDia = mapaEventos;
  }

  /** Texto do período no topo: "Outubro de 2026", "12 a 18 de outubro", "Segunda, 12 de outubro". */
  get tituloPeriodo(): string {
    const [ano, mes, dia] = this.dataRef.split('-').map(Number);
    if (this.visao === 'mes') {
      const nome = this.nomesMeses[mes - 1];
      return `${nome.charAt(0).toUpperCase() + nome.slice(1)} de ${ano}`;
    }
    if (this.visao === 'dia') {
      const d = new Date(ano, mes - 1, dia);
      return `${this.diasSemanaCurto[d.getDay()]}, ${dia} de ${this.nomesMeses[mes - 1]}`;
    }
    // semana: de segunda a domingo
    const ref = new Date(ano, mes - 1, dia);
    const seg = new Date(ano, mes - 1, dia - ((ref.getDay() + 6) % 7));
    const dom = new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + 6);
    return seg.getMonth() === dom.getMonth()
      ? `${seg.getDate()} a ${dom.getDate()} de ${this.nomesMeses[dom.getMonth()]}`
      : `${seg.getDate()} de ${this.nomesMeses[seg.getMonth()]} a ${dom.getDate()} de ${this.nomesMeses[dom.getMonth()]}`;
  }

  /** ‹ › : anda um mês, uma semana ou um dia, conforme a visão. */
  navegar(delta: number) {
    const [ano, mes, dia] = this.dataRef.split('-').map(Number);
    let nova: Date;
    if (this.visao === 'mes') nova = new Date(ano, mes - 1 + delta, 1);
    else if (this.visao === 'semana') nova = new Date(ano, mes - 1, dia + 7 * delta);
    else nova = new Date(ano, mes - 1, dia + delta);
    this.dataRef = this.formatarData(nova);
  }

  mudarVisao(visao: VisaoCalendario) {
    this.visao = visao;
    // ao trocar de visão, mantém o dia selecionado como referência
    this.dataRef = this.diaSelecionado;
  }

  irParaHoje() {
    this.dataRef = this.formatarData(this.hoje);
    this.diaSelecionado = this.dataRef;
  }

  /** Clique num dia (Mês) ou no topo de uma coluna (Semana): abre a visão Dia daquele dia. */
  selecionarDia(data: string) {
    this.diaSelecionado = data;
    this.dataRef = data;
    this.visao = 'dia';
  }

  /** Clique num horário livre (Dia/Semana): abre "Novo agendamento" já com data e hora. */
  agendarEm(slot: { data: string; horario: string }) {
    this.diaSelecionado = slot.data;
    this.abrirModal();
    if (this.modalAberto) this.novoAgendamento.horario = slot.horario;
  }

  /** Botões "Concluir" / "Não compareceu" / "Registrar pagamento" da visão Dia: abre os detalhes já no bloco certo. */
  acaoRapida(evento: { id: number; acao: AcaoRapida }) {
    this.abrirDetalhe(evento.id);
    this.escolherAcao(evento.acao);
  }

  /**
   * Outras telas (Início, sininho, Financeiro) abrem a Agenda já no lugar certo pelo endereço:
   *   /agenda?ag=12&acao=concluir   → abre os detalhes do agendamento 12 (e o bloco "Concluir")
   *   /agenda?data=2026-10-16       → mostra a visão Dia desse dia
   *   /agenda?novo=2026-10-20&hora=14:00 → abre "Novo agendamento" já preenchido
   *   (&cliente=5 → já com o cliente escolhido; vem da ficha do cliente e da Busca)
   */
  private abrirPeloEndereco() {
    const params = this.rota.snapshot.queryParamMap;
    const id = Number(params.get('ag'));
    const acao = params.get('acao') as AcaoRapida | null;
    const data = params.get('data');
    const novo = params.get('novo');

    if (id) {
      const ag = this.agendamentos.find(a => a.id === id);
      if (ag) {
        this.selecionarDia(ag.data);
        this.abrirDetalhe(ag.id);
        if (acao && ['concluir', 'falta', 'pagamento'].includes(acao)) this.escolherAcao(acao);
      }
    } else if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
      this.selecionarDia(data);
    } else if (novo && /^\d{4}-\d{2}-\d{2}$/.test(novo)) {
      this.selecionarDia(novo);
      this.agendarEm({ data: novo, horario: params.get('hora') || '' });
      const clienteId = Number(params.get('cliente'));
      if (this.modalAberto && clienteId) this.novoAgendamento.clienteId = clienteId;
    }

    // limpa o endereço, para não reabrir a janela ao atualizar a página
    if (id || data || novo) {
      this.router.navigate([], { relativeTo: this.rota, queryParams: {}, replaceUrl: true });
    }
  }

  private navegarParaData(data: string) {
    this.diaSelecionado = data;
    this.dataRef = data;
  }

  // =====================================================================
  //  NOVO AGENDAMENTO
  // =====================================================================

  abrirModal() {
    if (this.clientes.length === 0 || this.servicos.length === 0) {
      this.erro = 'Cadastre ao menos um cliente e um serviço antes de criar um agendamento.';
      this.cdr.markForCheck();
      return;
    }
    this.erroModal = null;
    this.avisoConflitoNovo = '';
    this.novoAgendamento = { data: this.diaSelecionado, clienteId: 0, servicoId: 0, horario: '', observacao: '' };
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
    this.erroModal = null;
    this.avisoConflitoNovo = '';
  }

  /** Mudou data, horário ou serviço: o aviso de conflito anterior não vale mais. */
  limparAvisoNovo() {
    this.avisoConflitoNovo = '';
  }

  /** marcarMesmoAssim = true quando a pessoa já viu o aviso de conflito e quer marcar. */
  salvarAgendamento(event: Event | null, marcarMesmoAssim = false) {
    event?.preventDefault();
    this.erroModal = null;

    const novo = this.novoAgendamento;
    if (!novo.data || !novo.horario) {
      this.erroModal = 'Escolha uma data e um horário para o agendamento!';
      return;
    }
    if (!novo.clienteId || !novo.servicoId) {
      this.erroModal = 'Selecione o cliente e o serviço.';
      return;
    }

    const foraDoExpediente = this.validarExpediente(novo.data, novo.horario, Number(novo.servicoId));
    if (foraDoExpediente) {
      this.erroModal = foraDoExpediente;
      return;
    }

    if (!marcarMesmoAssim) {
      const conflito = this.verificarConflito(novo.data, novo.horario, Number(novo.servicoId));
      if (conflito) {
        this.avisoConflitoNovo = conflito;
        return;
      }
    }

    const corpo = {
      clienteId: Number(novo.clienteId),
      servicoId: Number(novo.servicoId),
      data: novo.data,
      horario: novo.horario,
      observacao: novo.observacao,
    };

    this.salvando = true;

    this.http.post<{ agendamento: Agendamento }>(`${API_URL}/agendamentos`, corpo, { headers: this.cabecalhoAuth() })
      .subscribe({
        next: ({ agendamento }) => {
          this.agendamentos.push(agendamento);
          this.atualizarDerivados();
          this.salvando = false;
          this.navegarParaData(agendamento.data);
          this.fecharModal();
          this.cdr.markForCheck();
        },
        error: (erro) => {
          console.error(erro);
          this.salvando = false;
          this.erroModal = erro?.error?.erro || 'Não foi possível criar o agendamento.';
          this.cdr.markForCheck();
        },
      });
  }

  // =====================================================================
  //  DETALHES DO AGENDAMENTO (janela aberta ao clicar num agendamento)
  // =====================================================================

  abrirDetalhe(id: number) {
    const ag = this.agendamentos.find(a => a.id === id);
    if (!ag) return;
    this.detalhe = ag;
    this.observacaoEditada = ag.observacao || '';
    this.erroDetalhe = null;
    this.acao = '';
  }

  fecharDetalhe() {
    this.detalhe = null;
    this.acao = '';
    this.erroDetalhe = null;
  }

  /** Abre (ou fecha, se clicar de novo) um dos blocos: Concluir, Não compareceu, Reagendar, Cancelar, Pagamento. */
  escolherAcao(acao: AcaoDetalhe) {
    if (!this.detalhe) return;
    this.erroDetalhe = null;
    if (this.acao === acao) {
      this.acao = '';
      return;
    }
    this.acao = acao;

    const preco = this.valorServico(this.detalhe.servicoId);
    if (acao === 'concluir') {
      this.formConcluir = { pagouAgora: true, valorCobrado: preco, desconto: 0, formaPagamento: 'pix' };
    }
    if (acao === 'cancelar') {
      this.formCancelar = { canceladoPor: 'cliente', motivo: '' };
    }
    if (acao === 'reagendar') {
      this.formReagendar = { data: this.detalhe.data, horario: this.detalhe.horario, avisoConflito: '' };
    }
    if (acao === 'pagamento') {
      this.formPagamento = {
        valorCobrado: this.detalhe.valorCobrado ?? preco,
        desconto: 0,
        pagoEm: this.formatarData(new Date()),
        formaPagamento: 'pix',
      };
    }
  }

  /** RN04: concluir e "não compareceu" só a partir do horário do atendimento. */
  jaComecou(ag: Agendamento): boolean {
    const agora = new Date();
    const [ano, mes, dia] = ag.data.split('-').map(Number);
    const [h, m] = ag.horario.split(':').map(Number);
    return new Date(ano, mes - 1, dia, h, m) <= agora;
  }

  totalComDesconto(valor: number, desconto: number): number {
    return Math.max(0, (Number(valor) || 0) - (Number(desconto) || 0));
  }

  /** Troca o agendamento na lista (e na janela aberta) pela versão que voltou da API. */
  private aplicarAtualizacao(ag: Agendamento) {
    const i = this.agendamentos.findIndex(a => a.id === ag.id);
    if (i >= 0) this.agendamentos[i] = ag;
    if (this.detalhe?.id === ag.id) {
      this.detalhe = ag;
      this.observacaoEditada = ag.observacao || '';
    }
    this.atualizarDerivados();
  }

  private enviar(url: string, corpo: object, aoTerminar?: (ag: Agendamento) => void) {
    this.salvandoDetalhe = true;
    this.erroDetalhe = null;
    this.http.put<{ agendamento: Agendamento }>(url, corpo, { headers: this.cabecalhoAuth() }).subscribe({
      next: ({ agendamento }) => {
        this.salvandoDetalhe = false;
        this.acao = '';
        this.aplicarAtualizacao(agendamento);
        aoTerminar?.(agendamento);
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.salvandoDetalhe = false;
        this.erroDetalhe = erro?.error?.erro || 'Não foi possível salvar. Tente novamente.';
        this.cdr.markForCheck();
      },
    });
  }

  confirmarConcluir() {
    if (!this.detalhe) return;
    const f = this.formConcluir;
    if (f.pagouAgora && Number(f.desconto) > Number(f.valorCobrado)) {
      this.erroDetalhe = 'O desconto não pode ser maior que o valor cobrado.';
      return;
    }
    this.enviar(`${API_URL}/agendamentos/${this.detalhe.id}/status`, {
      status: 'realizado',
      pagouAgora: f.pagouAgora,
      valorCobrado: f.valorCobrado,
      desconto: f.pagouAgora ? f.desconto : 0,
      formaPagamento: f.pagouAgora ? f.formaPagamento : null,
    });
  }

  confirmarFalta() {
    if (!this.detalhe) return;
    this.enviar(`${API_URL}/agendamentos/${this.detalhe.id}/status`, { status: 'nao_compareceu' });
  }

  confirmarCancelar() {
    if (!this.detalhe) return;
    this.enviar(`${API_URL}/agendamentos/${this.detalhe.id}/status`, {
      status: 'cancelado',
      canceladoPor: this.formCancelar.canceladoPor,
      motivo: this.formCancelar.motivo,
    });
  }

  confirmarReagendar(marcarMesmoAssim = false) {
    if (!this.detalhe) return;
    const f = this.formReagendar;
    if (!f.data || !f.horario) {
      this.erroDetalhe = 'Escolha a nova data e o novo horário.';
      return;
    }
    const foraDoExpediente = this.validarExpediente(f.data, f.horario, this.detalhe.servicoId);
    if (foraDoExpediente) {
      this.erroDetalhe = foraDoExpediente;
      return;
    }
    if (!marcarMesmoAssim) {
      const conflito = this.verificarConflito(f.data, f.horario, this.detalhe.servicoId, this.detalhe.id);
      if (conflito) {
        f.avisoConflito = conflito;
        return;
      }
    }
    this.enviar(
      `${API_URL}/agendamentos/${this.detalhe.id}`,
      { data: f.data, horario: f.horario },
      (ag) => this.navegarParaData(ag.data)
    );
  }

  confirmarPagamento() {
    if (!this.detalhe) return;
    const f = this.formPagamento;
    if (Number(f.desconto) > Number(f.valorCobrado)) {
      this.erroDetalhe = 'O desconto não pode ser maior que o valor cobrado.';
      return;
    }
    this.enviar(`${API_URL}/agendamentos/${this.detalhe.id}/pagamento`, {
      valorCobrado: f.valorCobrado,
      desconto: f.desconto,
      pagoEm: f.pagoEm,
      formaPagamento: f.formaPagamento,
    });
  }

  /** Só o dono: volta um atendimento finalizado para "agendado" (para corrigir um erro). */
  desfazer() {
    if (!this.detalhe) return;
    const ok = confirm('Voltar este atendimento para "agendado"? O pagamento ou cancelamento registrado será apagado.');
    if (!ok) return;
    this.enviar(`${API_URL}/agendamentos/${this.detalhe.id}/status`, { status: 'agendado' });
  }

  salvarObservacao() {
    if (!this.detalhe || this.observacaoEditada === (this.detalhe.observacao || '')) return;
    this.enviar(`${API_URL}/agendamentos/${this.detalhe.id}`, { observacao: this.observacaoEditada });
  }

  // =====================================================================
  //  TEXTOS DA JANELA DE DETALHES
  // =====================================================================

  /** "Quinta, 15/10 · 14:00–15:00" */
  tituloDetalhe(ag: Agendamento): string {
    const fim = this.paraMinutos(ag.horario) + this.duracaoServico(ag.servicoId);
    const hhFim = `${String(Math.floor(fim / 60) % 24).padStart(2, '0')}:${String(fim % 60).padStart(2, '0')}`;
    return `${this.diasSemanaCurto[this.diaSemanaDe(ag.data)]}, ${this.dataCurta(ag.data)} · ${ag.horario}–${hhFim}`;
  }

  rotuloStatus(ag: Agendamento): string {
    switch (ag.status) {
      case 'agendado': return 'Agendado';
      case 'realizado': return ag.statusPagamento === 'pago' ? 'Realizado · pago' : 'Realizado · a receber';
      case 'cancelado': return 'Cancelado';
      case 'nao_compareceu': return 'Não compareceu';
    }
  }

  textoOrigem(ag: Agendamento): string {
    const por = ag.criadoPorNome ? ` · por ${ag.criadoPorNome}` : '';
    switch (ag.origem) {
      case 'whatsapp': return 'Agendado pelo WhatsApp';
      case 'link': return 'Agendado pelo link de agendamento';
      case 'lista_espera': return `Encaixado da lista de espera${por}`;
      default: return `Agendado pelo sistema${por}`;
    }
  }

  rotuloForma(forma: FormaPagamento | null): string {
    return this.formasPagamento.find(f => f.valor === forma)?.rotulo ?? '';
  }

  /** Linhas do histórico no rodapé da janela. */
  historico(ag: Agendamento): string[] {
    const linhas: string[] = [];

    if (ag.criadoEm) {
      const quando = this.dataCurta(ag.criadoEm.slice(0, 10));
      if (ag.origem === 'whatsapp') linhas.push(`Criado em ${quando} pelo bot do WhatsApp`);
      else if (ag.origem === 'link') linhas.push(`Criado em ${quando} pelo link de agendamento`);
      else linhas.push(`Criado em ${quando}${ag.criadoPorNome ? ' por ' + ag.criadoPorNome : ''}`);
    }

    if (ag.reagendamentos > 0) {
      linhas.push(`Reagendado ${ag.reagendamentos} ${ag.reagendamentos === 1 ? 'vez' : 'vezes'}`);
    }

    if (ag.statusEm && ag.status !== 'agendado') {
      const quando = `${this.dataCurta(ag.statusEm.slice(0, 10))} às ${ag.statusEm.slice(11, 16)}`;
      if (ag.status === 'realizado') linhas.push(`Marcado como realizado em ${quando}`);
      if (ag.status === 'cancelado') linhas.push(`Cancelado em ${quando}`);
      if (ag.status === 'nao_compareceu') linhas.push(`Marcado como "não compareceu" em ${quando}`);
    }

    // aparece nos "Lembretes de amanhã" da Início na véspera
    if (ag.status === 'agendado' && ag.data > this.formatarData(new Date())) {
      const [ano, mes, dia] = ag.data.split('-').map(Number);
      const vespera = this.formatarData(new Date(ano, mes - 1, dia - 1));
      linhas.push(`Aparece em "Lembretes de amanhã" na Início em ${this.dataCurta(vespera)}`);
    }

    return linhas;
  }

  // =====================================================================
  //  AUXILIARES
  // =====================================================================

  /** Valor em reais respeitando o "Ocultar valores" (Início/Financeiro): "R$ 80,00" ou "R$ ••••". */
  valorEmReais(valor: number | null | undefined): string {
    return dinheiro(valor);
  }

  nomeCliente(id: number): string {
    return this.clientes.find(c => c.id === id)?.nome ?? 'Cliente removido';
  }

  /** "Ana Souza" → "Ana S." (para caber no calendário) */
  private nomeCurto(nome: string): string {
    const partes = nome.trim().split(/\s+/);
    return partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1].charAt(0)}.` : partes[0];
  }

  nomeServico(id: number): string {
    return this.servicos.find(s => s.id === id)?.nome ?? 'Serviço removido';
  }

  valorServico(id: number): number {
    return this.servicos.find(s => s.id === id)?.valor ?? 0;
  }

  duracaoServico(id: number): number {
    return this.servicos.find(s => s.id === id)?.duracao || 30;
  }

  /** '2026-10-15' → '15/10' */
  dataCurta(data: string): string {
    const [, mes, dia] = data.split('-');
    return `${dia}/${mes}`;
  }

  private formatarData(d: Date): string {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
}
