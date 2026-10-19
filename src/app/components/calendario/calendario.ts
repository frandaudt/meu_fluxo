import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HorarioTrabalho, Expediente, expedienteDoDia, bloqueioDoDiaInteiro, minutosDeTrabalho } from '../../app';

export type VisaoCalendario = 'dia' | 'semana' | 'mes';
/** Botões direto na linha do tempo (visão Dia). */
export type AcaoRapida = 'concluir' | 'falta' | 'pagamento';

export interface EventoResumo {
  id: number;
  horario: string;          // 'HH:mm'
  texto: string;            // nome curto do cliente ("Ana S.")
  nomeCompleto?: string;    // "Ana Souza"
  servico?: string;         // "Manicure"
  duracao?: number;         // minutos
  status: 'agendado' | 'realizado' | 'cancelado' | 'nao_compareceu';
  statusPagamento?: 'pendente' | 'pago';
  origem?: string;          // 'sistema' | 'whatsapp' | 'link' | 'lista_espera'
}

/** Mesmo formato do Perfil (com pausa e folgas); o nome antigo continua valendo. */
export type HorarioTrabalhoCalendario = HorarioTrabalho;

interface DiaCalendario {
  data: string;      // 'YYYY-MM-DD'
  numero: number;
  foraDoMes: boolean;
  hoje: boolean;
}

/** Item da linha do tempo (visão Dia) e da coluna (visão Semana): agendamento, horário livre ou pausa/bloqueio. */
export interface ItemDoDia {
  tipo: 'agendamento' | 'livre' | 'pausa';
  inicio: string;            // 'HH:mm'
  fim: string;               // 'HH:mm'
  evento?: EventoResumo;     // quando tipo = 'agendamento'
  motivo?: string;           // quando tipo = 'pausa' ("Pausa", "Véspera de Natal"...)
}

/** Cabeçalho de cada coluna da visão Semana. */
export interface ColunaSemana {
  data: string;
  nomeSemana: string;   // 'SEG'
  numero: number;
  hoje: boolean;
  fechado: boolean;     // não trabalha nesse dia
  ocupacao: number;     // 0 a 100
  itens: ItemDoDia[];
}

@Component({
  selector: 'app-calendario',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './calendario.html',
  styleUrl: './calendario.css',
})
export class Calendario {
  /** Qual visão mostrar. A navegação (‹ ›, Hoje) fica na tela que usa o calendário. */
  @Input() visao: VisaoCalendario = 'mes';
  /** Data de referência: o mês, a semana ou o dia que está sendo mostrado. */
  @Input() dataRef: string = this.formatarData(new Date());
  @Input() diaSelecionado: string | null = null;
  @Input() eventosPorDia: Map<string, EventoResumo[]> = new Map();
  /** Horário de trabalho: usado para "livre", "fechado" e a % de ocupação. */
  @Input() horario: HorarioTrabalhoCalendario | null = null;
  /** Título dentro do card (Início: "Semana de 12 a 18 de outubro"). Com título, a legenda vai para o topo. */
  @Input() titulo: string | null = null;
  /** Mês "resumido" (Início): cada dia mostra quantos atendimentos e a % de ocupação, sem os nomes. */
  @Input() resumoMes = false;

  @Output() selecionarDia = new EventEmitter<string>();            // clique num dia (visão Mês)
  @Output() abrirEvento = new EventEmitter<number>();              // clique num agendamento → detalhes
  @Output() acaoEvento = new EventEmitter<{ id: number; acao: AcaoRapida }>();           // botões da visão Dia
  @Output() agendarEm = new EventEmitter<{ data: string; horario: string }>();          // clique num horário livre

  readonly MAX_EVENTOS_VISIVEIS = 3;
  readonly diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  private readonly siglasSemana = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

  // =====================================================================
  //  VISÃO MÊS
  // =====================================================================

  get semanas(): DiaCalendario[][] {
    const [ano, mes] = this.dataRef.split('-').map(Number);
    const primeiroDiaMes = new Date(ano, mes - 1, 1);
    const ultimoDiaMes = new Date(ano, mes, 0);
    const diaSemanaInicio = primeiroDiaMes.getDay();

    const dias: DiaCalendario[] = [];
    const hojeStr = this.formatarData(new Date());

    for (let i = diaSemanaInicio - 1; i >= 0; i--) {
      const d = new Date(ano, mes - 1, -i);
      dias.push({ data: this.formatarData(d), numero: d.getDate(), foraDoMes: true, hoje: false });
    }

    for (let n = 1; n <= ultimoDiaMes.getDate(); n++) {
      const dataStr = this.formatarData(new Date(ano, mes - 1, n));
      dias.push({ data: dataStr, numero: n, foraDoMes: false, hoje: dataStr === hojeStr });
    }

    let proxNum = 1;
    while (dias.length % 7 !== 0) {
      const d = new Date(ano, mes, proxNum);
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

  // ---------- mês resumido (Início) ----------

  /** Atendimentos que contam no dia (cancelado e falta não contam). */
  qtdAtendimentos(data: string): number {
    return this.ocupando(data).length;
  }

  /** O dia não é de trabalho (e não tem nada marcado). */
  diaFechadoEm(data: string): boolean {
    return !this.configDoDia(data) && this.qtdAtendimentos(data) === 0;
  }

  /** Barrinha: ≥80% verde bem escuro, ≥50% verde, abaixo disso verde claro. */
  nivelOcupacao(data: string): 'alta' | 'media' | 'baixa' {
    const ocupacao = this.ocupacaoDoDia(data);
    if (ocupacao >= 80) return 'alta';
    if (ocupacao >= 50) return 'media';
    return 'baixa';
  }

  // =====================================================================
  //  VISÃO SEMANA (segunda a domingo)
  // =====================================================================

  get colunasSemana(): ColunaSemana[] {
    const segunda = this.segundaDaSemana(this.dataRef);
    const hojeStr = this.formatarData(new Date());
    const colunas: ColunaSemana[] = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + i);
      const data = this.formatarData(d);
      const config = this.configDoDia(data);
      colunas.push({
        data,
        nomeSemana: this.siglasSemana[d.getDay()],
        numero: d.getDate(),
        hoje: data === hojeStr,
        fechado: !config,
        ocupacao: this.ocupacaoDoDia(data),
        itens: this.itensDoDia(data),
      });
    }
    return colunas;
  }

  // =====================================================================
  //  VISÃO DIA (linha do tempo)
  // =====================================================================

  get itensDia(): ItemDoDia[] {
    return this.itensDoDia(this.dataRef);
  }

  get diaFechado(): boolean {
    return !this.configDoDia(this.dataRef);
  }

  /** Texto do dia fechado: o nome da folga ("Finados") ou "Você não trabalha nesse dia." */
  get textoDiaFechado(): string {
    const folga = bloqueioDoDiaInteiro(this.horario, this.dataRef);
    return folga ? `Dia bloqueado: ${folga.descricao || 'folga'}.` : 'Você não trabalha nesse dia.';
  }

  /** Mês resumido e topo da semana: "Finados" (folga) ou "fechado". */
  rotuloFechado(data: string): string {
    return bloqueioDoDiaInteiro(this.horario, data)?.descricao || 'fechado';
  }

  // =====================================================================
  //  CÁLCULOS (livre, ocupação)
  // =====================================================================

  /** Expediente do dia (com pausas e bloqueios) ou null se não trabalha nesse dia / folga. */
  private configDoDia(data: string): Expediente | null {
    return expedienteDoDia(this.horario, data);
  }

  /** Agendamentos que ainda ocupam horário (cancelado e falta liberam o horário). */
  private ocupando(data: string): EventoResumo[] {
    return (this.eventosPorDia.get(data) || [])
      .filter(e => e.status === 'agendado' || e.status === 'realizado');
  }

  /**
   * Agendamentos do dia + os horários livres entre eles, em ordem.
   * Livre = horário de trabalho sem agendamento, com pelo menos um "bloco" (ex.: 30 min),
   * e só a partir de agora (não mostra livre no passado).
   */
  itensDoDia(data: string): ItemDoDia[] {
    const eventos = this.eventosPorDia.get(data) || [];
    const itens: ItemDoDia[] = eventos.map(ev => ({
      tipo: 'agendamento' as const,
      inicio: ev.horario,
      fim: this.somarMinutos(ev.horario, ev.duracao || 30),
      evento: ev,
    }));

    const config = this.configDoDia(data);
    if (config) {
      const bloco = this.horario?.blocoMin || 30;
      const agora = new Date();
      const hojeStr = this.formatarData(agora);
      if (data >= hojeStr) {
        // pausa do almoço e bloqueios de parte do dia aparecem na linha do tempo (de hoje em diante)
        for (const p of config.pausas) {
          itens.push({ tipo: 'pausa', inicio: this.paraHora(p.ini), fim: this.paraHora(p.fim), motivo: p.motivo });
        }

        // começa no início do expediente (ou agora, se for hoje)
        let cursor = config.inicio;
        if (data === hojeStr) {
          // arredonda "agora" para o próximo bloco (ex.: 14:53 → 15:00 com blocos de 30 min)
          const agoraMin = agora.getHours() * 60 + agora.getMinutes();
          cursor = Math.max(cursor, Math.ceil(agoraMin / bloco) * bloco);
        }
        const fimExpediente = config.fim;

        // agendamentos + pausas: tudo o que não está livre
        const ocupados = this.ocupando(data)
          .map(e => ({ ini: this.paraMinutos(e.horario), fim: this.paraMinutos(e.horario) + (e.duracao || 30) }))
          .concat(config.pausas.map(p => ({ ini: p.ini, fim: p.fim })))
          .sort((a, b) => a.ini - b.ini);

        for (const o of ocupados) {
          if (o.ini - cursor >= bloco) {
            itens.push({ tipo: 'livre', inicio: this.paraHora(cursor), fim: this.paraHora(o.ini) });
          }
          cursor = Math.max(cursor, o.fim);
        }
        if (fimExpediente - cursor >= bloco) {
          itens.push({ tipo: 'livre', inicio: this.paraHora(cursor), fim: this.paraHora(fimExpediente) });
        }
      }
    }

    const ordem = { agendamento: 0, pausa: 1, livre: 2 };
    return itens.sort((a, b) => a.inicio.localeCompare(b.inicio) || ordem[a.tipo] - ordem[b.tipo]);
  }

  /** Minutos agendados ÷ minutos de trabalho do dia (glossário: "Ocupação"). */
  ocupacaoDoDia(data: string): number {
    // minutos de trabalho = expediente − pausa − bloqueios
    const disponivel = minutosDeTrabalho(this.configDoDia(data));
    if (disponivel <= 0) return 0;
    const ocupado = this.ocupando(data).reduce((soma, e) => soma + (e.duracao || 30), 0);
    return Math.min(100, Math.round((ocupado / disponivel) * 100));
  }

  rotuloStatus(ev: EventoResumo): string {
    switch (ev.status) {
      case 'agendado': return 'Agendado';
      case 'realizado': return ev.statusPagamento === 'pago' ? 'Realizado · pago' : 'Realizado · a receber';
      case 'cancelado': return 'Cancelado';
      case 'nao_compareceu': return 'Não compareceu';
    }
  }

  /** Concluir / Não compareceu só depois do horário (RN04). */
  jaComecou(data: string, horario: string): boolean {
    const [ano, mes, dia] = data.split('-').map(Number);
    const [h, m] = horario.split(':').map(Number);
    return new Date(ano, mes - 1, dia, h, m) <= new Date();
  }

  // =====================================================================
  //  AUXILIARES
  // =====================================================================

  private segundaDaSemana(data: string): Date {
    const [ano, mes, dia] = data.split('-').map(Number);
    const d = new Date(ano, mes - 1, dia);
    const deslocamento = (d.getDay() + 6) % 7; // segunda = 0 ... domingo = 6
    return new Date(ano, mes - 1, dia - deslocamento);
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

  private somarMinutos(hhmm: string, minutos: number): string {
    return this.paraHora(this.paraMinutos(hhmm) + minutos);
  }

  private formatarData(d: Date): string {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
}
