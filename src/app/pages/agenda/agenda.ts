import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Calendario, EventoResumo } from '../../components/calendario/calendario';

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

@Component({
  selector: 'app-agenda',
  standalone: true,
  imports: [CommonModule, FormsModule, Calendario],
  templateUrl: './agenda.html',
  styleUrl: './agenda.css',
})
export class Agenda implements OnInit {
  private readonly STORAGE_KEY = 'meufluxo_agendamentos';

  agendamentos: Agendamento[] = [];
  clientes: Cliente[] = [];
  servicos: Servico[] = [];

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

  ngOnInit() {
    this.agendamentos = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
    this.clientes = JSON.parse(localStorage.getItem('meufluxo_clientes') || '[]');
    this.servicos = JSON.parse(localStorage.getItem('meufluxo_servicos') || '[]');
    this.atualizarDerivados();
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
      alert('Cadastre ao menos um cliente e um serviço antes de criar um agendamento.');
      return;
    }
    this.novoAgendamento = {
      data: this.diaSelecionado,
      clienteId: this.clientes[0].id,
      servicoId: this.servicos[0].id,
      horario: '',
      status: 'agendado',
    };
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
  }

  salvarAgendamento(event: Event) {
    event.preventDefault();

    if (!this.novoAgendamento.data || !this.novoAgendamento.horario) {
      alert('Escolha uma data e um horário para o agendamento!');
      return;
    }

    const novoId = this.agendamentos.length > 0
      ? Math.max(...this.agendamentos.map(a => a.id)) + 1
      : 1;

    this.agendamentos.push({
      id: novoId,
      clienteId: Number(this.novoAgendamento.clienteId),
      servicoId: Number(this.novoAgendamento.servicoId),
      data: this.novoAgendamento.data,
      horario: this.novoAgendamento.horario,
      status: this.novoAgendamento.status,
    });

    this.salvarNoStorage();
    this.navegarParaData(this.novoAgendamento.data);
    this.fecharModal();
  }

  alterarStatus(id: number, status: Agendamento['status']) {
    const agendamento = this.agendamentos.find(a => a.id === id);
    if (agendamento) {
      agendamento.status = status;
      this.salvarNoStorage();
    }
  }

  removerAgendamento(id: number) {
    this.agendamentos = this.agendamentos.filter(a => a.id !== id);
    this.salvarNoStorage();
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

  private salvarNoStorage() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.agendamentos));
    this.atualizarDerivados();
  }

  private formatarData(d: Date): string {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
}
