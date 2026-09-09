import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Calendario, EventoResumo } from '../../components/calendario/calendario';

interface Cliente { id: number; nome: string; }
interface Servico { id: number; nome: string; valor: number; }
interface Agendamento {
  id: number;
  clienteId: number;
  servicoId: number;
  data: string;    // 'YYYY-MM-DD'
  horario: string; // 'HH:mm'
  status: 'agendado' | 'realizado' | 'cancelado';
}
interface Despesa {
  id: number;
  descricao: string;
  valor: number;
  tipo: 'fixa' | 'emergencial';
  mes: string; // 'YYYY-MM'
}
interface MetaMensal {
  id: number;
  mes: string;
  tipo: 'faturamento' | 'clientes';
  valorAlvo: number;
}

interface ProximoAgendamento {
  data: string;
  horario: string;
  clienteNome: string;
  servicoNome: string;
  ehHoje: boolean;
  label: string;
}

interface MetaMensalResumo {
  tipo: 'faturamento' | 'clientes';
  valorAlvo: number;
  progresso: number;
  percentual: number;
}

@Component({
  selector: 'app-tela-inicial',
  standalone: true,
  imports: [CommonModule, Calendario],
  templateUrl: './tela-inicial.html',
  styleUrl: './tela-inicial.css',
})
export class TelaInicial implements OnInit {
  clientes: Cliente[] = [];
  servicos: Servico[] = [];
  agendamentos: Agendamento[] = [];
  despesas: Despesa[] = [];
  metasMensais: MetaMensal[] = [];

  private hoje = new Date();
  anoAtual = this.hoje.getFullYear();
  mesAtual = this.hoje.getMonth();
  diaSelecionado = this.formatarData(this.hoje);

  lucroDoMes = 0;
  despesasDoMes = 0;
  agendamentosHoje = 0;
  totalMetas = 0;

  eventosPorDia: Map<string, EventoResumo[]> = new Map();
  proximosAgendamentos: ProximoAgendamento[] = [];
  metasDoMesResumo: MetaMensalResumo[] = [];

  readonly nomesMesesExtenso = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  readonly diasSemanaCompleto = [
    'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
    'Quinta-feira', 'Sexta-feira', 'Sábado',
  ];

  ngOnInit() {
    this.clientes = JSON.parse(localStorage.getItem('meufluxo_clientes') || '[]');
    this.servicos = JSON.parse(localStorage.getItem('meufluxo_servicos') || '[]');
    this.agendamentos = JSON.parse(localStorage.getItem('meufluxo_agendamentos') || '[]');
    this.despesas = JSON.parse(localStorage.getItem('meufluxo_despesas') || '[]');
    this.metasMensais = JSON.parse(localStorage.getItem('meufluxo_metas_mensais') || '[]');
    this.atualizarDerivados();
  }

  get nomeMesRealExtenso(): string {
    return `${this.nomesMesesExtenso[this.hoje.getMonth()]} de ${this.hoje.getFullYear()}`;
  }

  private chaveMes(ano: number, mes: number): string {
    return `${ano}-${String(mes + 1).padStart(2, '0')}`;
  }

  private valorServico(id: number): number {
    return this.servicos.find(s => s.id === id)?.valor ?? 0;
  }

  private nomeCliente(id: number): string {
    return this.clientes.find(c => c.id === id)?.nome ?? 'Cliente removido';
  }

  private nomeServico(id: number): string {
    return this.servicos.find(s => s.id === id)?.nome ?? 'Serviço removido';
  }

  private ganhosDe(ano: number, mes: number): number {
    const prefixo = this.chaveMes(ano, mes);
    return this.agendamentos
      .filter(a => a.status === 'realizado' && a.data.startsWith(prefixo))
      .reduce((soma, a) => soma + this.valorServico(a.servicoId), 0);
  }

  private gastosDe(ano: number, mes: number): number {
    const chave = this.chaveMes(ano, mes);
    return this.despesas
      .filter(d => d.tipo === 'emergencial' ? d.mes === chave : d.mes <= chave)
      .reduce((soma, d) => soma + d.valor, 0);
  }

  private formatarData(d: Date): string {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  private formatarLabelData(data: string): string {
    const [ano, mes, dia] = data.split('-').map(Number);
    const d = new Date(ano, mes - 1, dia);
    return `${this.diasSemanaCompleto[d.getDay()]}, ${dia} de ${this.nomesMesesExtenso[mes - 1]}`;
  }

  private atualizarDerivados() {
    const anoReal = this.hoje.getFullYear();
    const mesReal = this.hoje.getMonth();

    const ganhosDoMes = this.ganhosDe(anoReal, mesReal);
    const gastosDoMes = this.gastosDe(anoReal, mesReal);
    this.lucroDoMes = ganhosDoMes - gastosDoMes;
    this.despesasDoMes = gastosDoMes;

    const hojeStr = this.formatarData(this.hoje);
    this.agendamentosHoje = this.agendamentos.filter(a => a.data === hojeStr && a.status !== 'cancelado').length;

    this.totalMetas = this.metasMensais.length;

    const mapaEventos = new Map<string, EventoResumo[]>();
    for (const ag of this.agendamentos) {
      if (!mapaEventos.has(ag.data)) mapaEventos.set(ag.data, []);
      mapaEventos.get(ag.data)!.push({
        horario: ag.horario,
        texto: this.nomeCliente(ag.clienteId),
        status: ag.status,
      });
    }
    for (const lista of mapaEventos.values()) lista.sort((a, b) => a.horario.localeCompare(b.horario));
    this.eventosPorDia = mapaEventos;

    this.proximosAgendamentos = this.agendamentos
      .filter(a => a.status === 'agendado' && a.data >= hojeStr)
      .sort((a, b) => a.data === b.data ? a.horario.localeCompare(b.horario) : a.data.localeCompare(b.data))
      .slice(0, 5)
      .map(a => ({
        data: a.data,
        horario: a.horario,
        clienteNome: this.nomeCliente(a.clienteId),
        servicoNome: this.nomeServico(a.servicoId),
        ehHoje: a.data === hojeStr,
        label: a.data === hojeStr ? `Hoje, ${this.formatarLabelData(a.data)}` : this.formatarLabelData(a.data),
      }));

    const chaveAtual = this.chaveMes(anoReal, mesReal);
    this.metasDoMesResumo = this.metasMensais
      .filter(m => m.mes === chaveAtual)
      .map(m => {
        const [ano, mes] = m.mes.split('-').map(Number);
        const progresso = m.tipo === 'faturamento'
          ? this.ganhosDe(ano, mes - 1)
          : this.agendamentos.filter(a => a.status === 'realizado' && a.data.startsWith(m.mes)).length;
        return {
          tipo: m.tipo,
          valorAlvo: m.valorAlvo,
          progresso,
          percentual: m.valorAlvo > 0 ? Math.round((progresso / m.valorAlvo) * 100) : 0,
        };
      });
  }

  mudarMes(delta: number) {
    let novoMes = this.mesAtual + delta;
    let novoAno = this.anoAtual;
    if (novoMes < 0) { novoMes = 11; novoAno--; }
    if (novoMes > 11) { novoMes = 0; novoAno++; }
    this.mesAtual = novoMes;
    this.anoAtual = novoAno;
  }

  selecionarDia(data: string) {
    this.diaSelecionado = data;
  }
}
