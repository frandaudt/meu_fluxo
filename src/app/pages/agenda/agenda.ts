import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { Calendario, EventoResumo } from '../../components/calendario/calendario';

const API_URL = 'http://localhost:3001/api';

interface Cliente { id: number; nome: string; }
interface Servico { id: number; nome: string; valor: number; duracao: number; }

interface Agendamento {
  id: number;
  clienteId: number;
  servicoId: number;
  data: string;    // 'YYYY-MM-DD'
  horario: string; // 'HH:mm'
  status: 'agendado' | 'realizado' | 'cancelado';
}

interface GrupoDia {
  data: string;
  label: string;
  itens: Agendamento[];
}

interface DiaTrabalho { ativo: boolean; inicio: string; fim: string; }
interface HorarioTrabalho {
  blocoMin: number;
  dias: DiaTrabalho[]; // dias[0] = domingo ... dias[6] = sábado
}

@Component({
  selector: 'app-agenda',
  standalone: true,
  imports: [CommonModule, FormsModule, Calendario],
  templateUrl: './agenda.html',
  styleUrl: './agenda.css',
})
export class Agenda implements OnInit {
  private readonly HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

  carregando = true;
  erro: string | null = null;
  erroModal: string | null = null;
  salvando = false;

  agendamentos: Agendamento[] = [];
  clientes: Cliente[] = [];
  servicos: Servico[] = [];
  horario: HorarioTrabalho = this.horarioPadrao();

  eventosPorDia: Map<string, EventoResumo[]> = new Map();
  gruposDoMes: GrupoDia[] = [];

  private hoje = new Date();
  anoAtual = this.hoje.getFullYear();
  mesAtual = this.hoje.getMonth();
  diaSelecionado = this.formatarData(this.hoje);

  modalAberto = false;
  novoAgendamento = {
    data: this.diaSelecionado,
    clienteId: 0,
    servicoId: 0,
    horario: '',
    status: 'agendado' as Agendamento['status'],
  };

  readonly diasSemanaCompleto = [
    'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
    'Quinta-feira', 'Sexta-feira', 'Sábado',
  ];
  readonly nomesMeses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  constructor(private router: Router, private http: HttpClient, private cdr: ChangeDetectorRef) {}

  private cabecalhoAuth(): HttpHeaders {
    const token = localStorage.getItem('meufluxo_token');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
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
      horarioTrabalho: this.http.get<{ horario: HorarioTrabalho | null }>(`${API_URL}/horario-trabalho`, { headers }),
    }).subscribe({
      next: ({ clientes, servicos, agendamentos, horarioTrabalho }) => {
        this.clientes = clientes.clientes;
        this.servicos = servicos.servicos.map(s => ({ id: s.id, nome: s.nome, valor: s.valor, duracao: s.duracaoMin }));
        this.agendamentos = agendamentos.agendamentos;
        this.horario = this.normalizarHorario(horarioTrabalho.horario);
        this.atualizarDerivados();
        this.carregando = false;
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

  get nomeMesAtualExtenso(): string {
    return `${this.nomesMeses[this.mesAtual]} de ${this.anoAtual}`;
  }

  get diaSelecionadoFormatado(): string {
    const [ano, mes, dia] = this.diaSelecionado.split('-').map(Number);
    const d = new Date(ano, mes - 1, dia);
    return `${this.diasSemanaCompleto[d.getDay()]}, ${dia} de ${this.nomesMeses[mes - 1]} de ${ano}`;
  }

  private formatarLabelDia(data: string): string {
    const [ano, mes, dia] = data.split('-').map(Number);
    const d = new Date(ano, mes - 1, dia);
    return `${this.diasSemanaCompleto[d.getDay()]}, ${dia} de ${this.nomesMeses[mes - 1]}`;
  }

  // =====================================================================
  //  HORÁRIO DE TRABALHO (expediente) e VALIDAÇÃO de conflito
  // =====================================================================

  /** Padrão: segunda a sábado, 08:00 às 18:00, domingo fechado. */
  private horarioPadrao(): HorarioTrabalho {
    const util = (): DiaTrabalho => ({ ativo: true, inicio: '08:00', fim: '18:00' });
    return {
      blocoMin: 30,
      dias: [{ ativo: false, inicio: '08:00', fim: '18:00' }, util(), util(), util(), util(), util(), util()],
    };
  }

  /** Garante um horário válido a partir do que estiver salvo (ou devolve o padrão). */
  private normalizarHorario(bruto: unknown): HorarioTrabalho {
    const padrao = this.horarioPadrao();
    if (!bruto || typeof bruto !== 'object') return padrao;

    const b = bruto as { blocoMin?: unknown; dias?: unknown };
    const dias = padrao.dias.map((d, i) => {
      const salvo = Array.isArray(b.dias) ? (b.dias[i] as Record<string, unknown> | undefined) : undefined;
      if (!salvo || typeof salvo !== 'object') return d;
      return {
        ativo: typeof salvo['ativo'] === 'boolean' ? (salvo['ativo'] as boolean) : d.ativo,
        inicio: this.HORA_REGEX.test(String(salvo['inicio'])) ? String(salvo['inicio']) : d.inicio,
        fim: this.HORA_REGEX.test(String(salvo['fim'])) ? String(salvo['fim']) : d.fim,
      };
    });

    return { blocoMin: padrao.blocoMin, dias };
  }

  private paraMinutos(hhmm: string): number {
    const [h, m] = String(hhmm).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  }

  private diaSemanaDe(data: string): number {
    const [ano, mes, dia] = data.split('-').map(Number);
    return new Date(ano, mes - 1, dia).getDay();
  }

  /** Devolve a mensagem do problema (fora do expediente ou conflito), ou '' se puder agendar. */
  private validarExpedienteEConflito(data: string, horarioNovo: string, servicoId: number): string {
    const servico = this.servicos.find(s => s.id === servicoId);
    const duracao = servico?.duracao || 30;
    const inicioMin = this.paraMinutos(horarioNovo);
    const fimMin = inicioMin + duracao;

    const diaConfig = this.horario.dias[this.diaSemanaDe(data)];
    if (!diaConfig.ativo) {
      return 'Você não atende nesse dia da semana. Ajuste o horário de trabalho no Perfil ou escolha outra data.';
    }
    if (inicioMin < this.paraMinutos(diaConfig.inicio) || fimMin > this.paraMinutos(diaConfig.fim)) {
      return `Esse horário fica fora do seu expediente (${diaConfig.inicio} às ${diaConfig.fim}).`;
    }

    const conflito = this.agendamentos.find(a => {
      if (a.status === 'cancelado' || a.data !== data) return false;
      const outroServico = this.servicos.find(s => s.id === a.servicoId);
      const outraDuracao = outroServico?.duracao || 30;
      const outroInicio = this.paraMinutos(a.horario);
      const outroFim = outroInicio + outraDuracao;
      return inicioMin < outroFim && outroInicio < fimMin;
    });
    if (conflito) {
      return `Esse horário conflita com o agendamento de ${this.nomeCliente(conflito.clienteId)} às ${conflito.horario}.`;
    }

    return '';
  }

  private atualizarDerivados() {
    const mapaEventos = new Map<string, EventoResumo[]>();
    for (const ag of this.agendamentos) {
      if (!mapaEventos.has(ag.data)) mapaEventos.set(ag.data, []);
      mapaEventos.get(ag.data)!.push({
        horario: ag.horario,
        texto: this.nomeCliente(ag.clienteId),
        status: ag.status,
      });
    }
    for (const lista of mapaEventos.values()) {
      lista.sort((a, b) => a.horario.localeCompare(b.horario));
    }
    this.eventosPorDia = mapaEventos;

    const prefixo = `${this.anoAtual}-${String(this.mesAtual + 1).padStart(2, '0')}`;
    const doMes = this.agendamentos.filter(a => a.data.startsWith(prefixo));

    const porData = new Map<string, Agendamento[]>();
    for (const ag of doMes) {
      if (!porData.has(ag.data)) porData.set(ag.data, []);
      porData.get(ag.data)!.push(ag);
    }

    this.gruposDoMes = Array.from(porData.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, itens]) => ({
        data,
        label: this.formatarLabelDia(data),
        itens: itens.sort((a, b) => a.horario.localeCompare(b.horario)),
      }));
  }

  mudarMes(delta: number) {
    let novoMes = this.mesAtual + delta;
    let novoAno = this.anoAtual;
    if (novoMes < 0) { novoMes = 11; novoAno--; }
    if (novoMes > 11) { novoMes = 0; novoAno++; }
    this.mesAtual = novoMes;
    this.anoAtual = novoAno;
    this.atualizarDerivados();
  }

  selecionarDia(data: string) {
    this.diaSelecionado = data;
    setTimeout(() => {
      document.getElementById('dia-' + data)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  private navegarParaData(data: string) {
    const [ano, mes] = data.split('-').map(Number);
    this.anoAtual = ano;
    this.mesAtual = mes - 1;
    this.diaSelecionado = data;
    this.atualizarDerivados();
    setTimeout(() => {
      document.getElementById('dia-' + data)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  abrirModal() {
    if (this.clientes.length === 0 || this.servicos.length === 0) {
      this.erro = 'Cadastre ao menos um cliente e um serviço antes de criar um agendamento.';
      this.cdr.markForCheck();
      return;
    }
    this.erroModal = null;
    this.novoAgendamento = {
      data: this.diaSelecionado,
      clienteId: 0,
      servicoId: 0,
      horario: '',
      status: 'agendado',
    };
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
    this.erroModal = null;
  }

  salvarAgendamento(event: Event) {
    event.preventDefault();
    this.erroModal = null;

    if (!this.novoAgendamento.data || !this.novoAgendamento.horario) {
      this.erroModal = 'Escolha uma data e um horário para o agendamento!';
      return;
    }

    if (!this.novoAgendamento.clienteId || !this.novoAgendamento.servicoId) {
      this.erroModal = 'Selecione o cliente e o serviço.';
      return;
    }

    const problema = this.validarExpedienteEConflito(
      this.novoAgendamento.data,
      this.novoAgendamento.horario,
      Number(this.novoAgendamento.servicoId)
    );
    if (problema) {
      this.erroModal = problema;
      return;
    }

    const corpo = {
      clienteId: Number(this.novoAgendamento.clienteId),
      servicoId: Number(this.novoAgendamento.servicoId),
      data: this.novoAgendamento.data,
      horario: this.novoAgendamento.horario,
      status: this.novoAgendamento.status,
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

  alterarStatus(id: number, status: Agendamento['status']) {
    const agendamento = this.agendamentos.find(a => a.id === id);
    if (!agendamento) return;

    const statusAnterior = agendamento.status;
    agendamento.status = status;
    this.atualizarDerivados();
    this.cdr.markForCheck();

    this.http.put(`${API_URL}/agendamentos/${id}/status`, { status }, { headers: this.cabecalhoAuth() })
      .subscribe({
        next: () => {},
        error: (erro) => {
          console.error(erro);
          agendamento.status = statusAnterior;
          this.atualizarDerivados();
          this.erro = 'Não foi possível atualizar o status.';
          this.cdr.markForCheck();
        },
      });
  }

  removerAgendamento(id: number) {
    this.http.delete(`${API_URL}/agendamentos/${id}`, { headers: this.cabecalhoAuth() })
      .subscribe({
        next: () => {
          this.agendamentos = this.agendamentos.filter(a => a.id !== id);
          this.atualizarDerivados();
          this.cdr.markForCheck();
        },
        error: (erro) => {
          console.error(erro);
          this.erro = 'Não foi possível remover o agendamento.';
          this.cdr.markForCheck();
        },
      });
  }

  nomeCliente(id: number): string {
    return this.clientes.find(c => c.id === id)?.nome ?? 'Cliente removido';
  }

  nomeServico(id: number): string {
    return this.servicos.find(s => s.id === id)?.nome ?? 'Serviço removido';
  }

  valorServico(id: number): number {
    return this.servicos.find(s => s.id === id)?.valor ?? 0;
  }

  private formatarData(d: Date): string {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
}