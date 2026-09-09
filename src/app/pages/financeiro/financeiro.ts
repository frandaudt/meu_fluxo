import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Servico { id: number; nome: string; valor: number; }
interface Agendamento {
  id: number;
  servicoId: number;
  data: string;    // 'YYYY-MM-DD'
  status: 'agendado' | 'realizado' | 'cancelado';
}
interface Despesa {
  id: number;
  descricao: string;
  valor: number;
  tipo: 'fixa' | 'emergencial';
  mes: string; // 'YYYY-MM'
}

interface PontoHistorico {
  mes: string;
  label: string;
  lucro: number;
}

interface DiaGanho {
  dia: number;
  valor: number;
  alturaPercentual: number;
}

@Component({
  selector: 'app-financeiro',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './financeiro.html',
  styleUrl: './financeiro.css',
})
export class Financeiro implements OnInit {
  private readonly STORAGE_KEY = 'meufluxo_despesas';
  private readonly MESES_HISTORICO = 6;

  agendamentos: Agendamento[] = [];
  servicos: Servico[] = [];
  despesas: Despesa[] = [];

  private hoje = new Date();
  anoAtual = this.hoje.getFullYear();
  mesAtual = this.hoje.getMonth(); // 0-11

  ganhosDoMes = 0;
  gastosDoMes = 0;
  lucroDoMes = 0;
  despesasDoMesAtual: Despesa[] = [];
  historico: PontoHistorico[] = [];
  ganhosPorDia: DiaGanho[] = [];

  modalAberto = false;
  novaDespesa = { descricao: '', valor: 0, tipo: 'fixa' as Despesa['tipo'] };

  readonly nomesMesesAbrev = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  readonly nomesMesesExtenso = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  ngOnInit() {
    this.agendamentos = JSON.parse(localStorage.getItem('meufluxo_agendamentos') || '[]');
    this.servicos = JSON.parse(localStorage.getItem('meufluxo_servicos') || '[]');
    this.despesas = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
    this.atualizarDerivados();
  }

  get nomeMesAtualExtenso(): string {
    return `${this.nomesMesesExtenso[this.mesAtual]} de ${this.anoAtual}`;
  }

  private chaveMes(ano: number, mes: number): string {
    return `${ano}-${String(mes + 1).padStart(2, '0')}`;
  }

  private valorServico(id: number): number {
    return this.servicos.find(s => s.id === id)?.valor ?? 0;
  }

  private ganhosDe(ano: number, mes: number): number {
    const prefixo = this.chaveMes(ano, mes);
    return this.agendamentos
      .filter(a => a.status === 'realizado' && a.data.startsWith(prefixo))
      .reduce((soma, a) => soma + this.valorServico(a.servicoId), 0);
  }

  private despesasAtivasEm(ano: number, mes: number): Despesa[] {
    const chave = this.chaveMes(ano, mes);
    return this.despesas.filter(d => {
      if (d.tipo === 'emergencial') return d.mes === chave;
      return d.mes <= chave; // fixa: começou nesse mês ou antes
    });
  }

  private gastosDe(ano: number, mes: number): number {
    return this.despesasAtivasEm(ano, mes).reduce((soma, d) => soma + d.valor, 0);
  }

  private calcularGanhosPorDia(ano: number, mes: number): DiaGanho[] {
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const valores: number[] = new Array(diasNoMes).fill(0);

    for (const ag of this.agendamentos) {
      if (ag.status !== 'realizado') continue;
      const [agAno, agMes, agDia] = ag.data.split('-').map(Number);
      if (agAno === ano && agMes - 1 === mes) {
        valores[agDia - 1] += this.valorServico(ag.servicoId);
      }
    }

    const max = Math.max(...valores, 0);

    return valores.map((valor, i) => ({
      dia: i + 1,
      valor,
      alturaPercentual: max > 0 ? (valor / max) * 100 : 0,
    }));
  }

  private atualizarDerivados() {
    this.ganhosDoMes = this.ganhosDe(this.anoAtual, this.mesAtual);
    this.gastosDoMes = this.gastosDe(this.anoAtual, this.mesAtual);
    this.lucroDoMes = this.ganhosDoMes - this.gastosDoMes;
    this.despesasDoMesAtual = this.despesasAtivasEm(this.anoAtual, this.mesAtual)
      .sort((a, b) => b.valor - a.valor);
    this.ganhosPorDia = this.calcularGanhosPorDia(this.anoAtual, this.mesAtual);

    const pontos: PontoHistorico[] = [];
    for (let i = this.MESES_HISTORICO - 1; i >= 0; i--) {
      let mes = this.mesAtual - i;
      let ano = this.anoAtual;
      while (mes < 0) { mes += 12; ano--; }
      pontos.push({
        mes: this.chaveMes(ano, mes),
        label: this.nomesMesesAbrev[mes],
        lucro: this.ganhosDe(ano, mes) - this.gastosDe(ano, mes),
      });
    }
    this.historico = pontos;
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

  abrirModal() {
    this.novaDespesa = { descricao: '', valor: 0, tipo: 'fixa' };
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
  }

  salvarDespesa(event: Event) {
    event.preventDefault();

    if (!this.novaDespesa.descricao || this.novaDespesa.valor <= 0) {
      alert('Preencha a descrição e um valor válido!');
      return;
    }

    const novoId = this.despesas.length > 0
      ? Math.max(...this.despesas.map(d => d.id)) + 1
      : 1;

    this.despesas.push({
      id: novoId,
      descricao: this.novaDespesa.descricao,
      valor: Number(this.novaDespesa.valor),
      tipo: this.novaDespesa.tipo,
      mes: this.chaveMes(this.anoAtual, this.mesAtual),
    });

    this.salvarNoStorage();
    this.fecharModal();
  }

  removerDespesa(id: number) {
    this.despesas = this.despesas.filter(d => d.id !== id);
    this.salvarNoStorage();
  }

  private salvarNoStorage() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.despesas));
    this.atualizarDerivados();
  }

  // --- gráfico de linha simples em SVG, sem lib externa ---

  get pontosSvg(): string {
    if (this.historico.length === 0) return '';
    const largura = 600;
    const altura = 140;
    const margem = 10;

    const valores = this.historico.map(p => p.lucro);
    const min = Math.min(...valores, 0);
    const max = Math.max(...valores, 0);
    const amplitude = max - min || 1;

    const passoX = (largura - margem * 2) / (this.historico.length - 1 || 1);

    return this.historico
      .map((p, i) => {
        const x = margem + i * passoX;
        const y = altura - margem - ((p.lucro - min) / amplitude) * (altura - margem * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  posicaoX(i: number): number {
    const largura = 600;
    const margem = 10;
    const passoX = (largura - margem * 2) / (this.historico.length - 1 || 1);
    return margem + i * passoX;
  }

  posicaoY(lucro: number): number {
    const altura = 140;
    const margem = 10;
    const valores = this.historico.map(p => p.lucro);
    const min = Math.min(...valores, 0);
    const max = Math.max(...valores, 0);
    const amplitude = max - min || 1;
    return altura - margem - ((lucro - min) / amplitude) * (altura - margem * 2);
  }
}
