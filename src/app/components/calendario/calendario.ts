import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

interface DiaCalendario {
  data: string;      // 'YYYY-MM-DD'
  numero: number;
  foraDoMes: boolean;
  hoje: boolean;
}

export interface EventoResumo {
  horario: string;
  texto: string;
  status: 'agendado' | 'realizado' | 'cancelado';
}

@Component({
  selector: 'app-calendario',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './calendario.html',
  styleUrl: './calendario.css',
})
export class Calendario {
  @Input() ano!: number;
  @Input() mes!: number; // 0-11
  @Input() diaSelecionado: string | null = null;
  @Input() eventosPorDia: Map<string, EventoResumo[]> = new Map();

  @Output() selecionarDia = new EventEmitter<string>();
  @Output() mesAnterior = new EventEmitter<void>();
  @Output() mesProximo = new EventEmitter<void>();

  readonly MAX_EVENTOS_VISIVEIS = 2;

  readonly nomesMeses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  readonly diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  get nomeMesAtual(): string {
    return `${this.nomesMeses[this.mes]} de ${this.ano}`;
  }

  get semanas(): DiaCalendario[][] {
    const primeiroDiaMes = new Date(this.ano, this.mes, 1);
    const ultimoDiaMes = new Date(this.ano, this.mes + 1, 0);
    const diaSemanaInicio = primeiroDiaMes.getDay();

    const dias: DiaCalendario[] = [];
    const hojeStr = this.formatarData(new Date());

    for (let i = diaSemanaInicio - 1; i >= 0; i--) {
      const d = new Date(this.ano, this.mes, -i);
      dias.push({ data: this.formatarData(d), numero: d.getDate(), foraDoMes: true, hoje: false });
    }

    for (let n = 1; n <= ultimoDiaMes.getDate(); n++) {
      const d = new Date(this.ano, this.mes, n);
      const dataStr = this.formatarData(d);
      dias.push({ data: dataStr, numero: n, foraDoMes: false, hoje: dataStr === hojeStr });
    }

    let proxNum = 1;
    while (dias.length % 7 !== 0) {
      const d = new Date(this.ano, this.mes + 1, proxNum);
      dias.push({ data: this.formatarData(d), numero: d.getDate(), foraDoMes: true, hoje: false });
      proxNum++;
    }

    const semanas: DiaCalendario[][] = [];
    for (let i = 0; i < dias.length; i += 7) {
      semanas.push(dias.slice(i, i + 7));
    }
    return semanas;
  }

  eventosDoDia(data: string): EventoResumo[] {
    return (this.eventosPorDia.get(data) || []).slice(0, this.MAX_EVENTOS_VISIVEIS);
  }

  eventosExtras(data: string): number {
    const total = this.eventosPorDia.get(data)?.length || 0;
    return Math.max(0, total - this.MAX_EVENTOS_VISIVEIS);
  }
  temEvento(data: string): boolean {
  return this.eventosPorDia.has(data);
}

  private formatarData(d: Date): string {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
}
