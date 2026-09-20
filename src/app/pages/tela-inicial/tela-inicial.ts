import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

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

// horário de trabalho (definido no Perfil)
interface DiaTrabalho { ativo: boolean; inicio: string; fim: string; }
interface HorarioTrabalho {
  blocoMin: number;     // tamanho de cada horário da grade, em minutos
  dias: DiaTrabalho[];  // dias[0] = domingo ... dias[6] = sábado
}

// grade de disponibilidade
interface CelulaGrade {
  horario: string; // início do bloco, 'HH:mm'
  estado: 'livre' | 'ocupado' | 'fora';
  agendamentos: Agendamento[];
}
interface DiaGrade {
  data: string;
  numero: number;
  nomeSemana: string;
  ehHoje: boolean;
  passado: boolean;
  fechado: boolean;
  celulas: CelulaGrade[]; // uma por linha da grade, na mesma ordem
}

@Component({
  selector: 'app-tela-inicial',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './tela-inicial.html',
  styleUrl: './tela-inicial.css',
})
export class TelaInicial implements OnInit, AfterViewInit {
  @ViewChild('rolagem') rolagem?: ElementRef<HTMLElement>;

  clientes: Cliente[] = [];
  servicos: Servico[] = [];
  agendamentos: Agendamento[] = [];
  despesas: Despesa[] = [];
  metasMensais: MetaMensal[] = [];

  private hoje = new Date();
  anoAtual = this.hoje.getFullYear();
  mesAtual = this.hoje.getMonth();

  lucroDoMes = 0;
  despesasDoMes = 0;
  agendamentosHoje = 0;
  totalMetas = 0;

  proximosAgendamentos: ProximoAgendamento[] = [];
  metasDoMesResumo: MetaMensalResumo[] = [];

  // ---- grade de disponibilidade ----
  horario: HorarioTrabalho = this.horarioPadrao();
  usandoHorarioPadrao = true;
  dias: DiaGrade[] = [];
  linhas: string[] = [];
  colunasCss = '';
  linhasCss = '';

  // modal: novo agendamento (clicou em um horário livre)
  novo: { data: string; horario: string } | null = null;
  formNovo = { clienteId: 0, servicoId: 0 };

  // modal: detalhes (clicou em um horário ocupado)
  detalhe: { data: string; horario: string } | null = null;
  private readonly semAgendamentos: Agendamento[] = [];

  private readonly HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

  readonly nomesMesesExtenso = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  readonly diasSemanaCompleto = [
    'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
    'Quinta-feira', 'Sexta-feira', 'Sábado',
  ];
  readonly diasSemanaCurto = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  ngOnInit() {
    this.clientes = JSON.parse(localStorage.getItem('meufluxo_clientes') || '[]');
    this.servicos = JSON.parse(localStorage.getItem('meufluxo_servicos') || '[]');
    this.agendamentos = JSON.parse(localStorage.getItem('meufluxo_agendamentos') || '[]');
    this.despesas = JSON.parse(localStorage.getItem('meufluxo_despesas') || '[]');
    this.metasMensais = JSON.parse(localStorage.getItem('meufluxo_metas_mensais') || '[]');
    this.carregarHorario();
    this.atualizarDerivados();
    this.montarGrade();
  }

  ngAfterViewInit() {
    this.posicionarRolagem();
  }

  get nomeMesRealExtenso(): string {
    return `${this.nomesMesesExtenso[this.hoje.getMonth()]} de ${this.hoje.getFullYear()}`;
  }

  get nomeMesGrade(): string {
    const nome = this.nomesMesesExtenso[this.mesAtual];
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${this.anoAtual}`;
  }

  private chaveMes(ano: number, mes: number): string {
    return `${ano}-${String(mes + 1).padStart(2, '0')}`;
  }

  private valorServico(id: number): number {
    return this.servicos.find(s => s.id === id)?.valor ?? 0;
  }

  nomeCliente(id: number): string {
    return this.clientes.find(c => c.id === id)?.nome ?? 'Cliente removido';
  }

  nomeServico(id: number): string {
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

  // =====================================================================
  //  HORÁRIO DE TRABALHO (salvo no Perfil)
  // =====================================================================

  /** Padrão: segunda a sábado, 08:00 às 18:00, domingo fechado, blocos de 30 min. */
  private horarioPadrao(): HorarioTrabalho {
    const util = (): DiaTrabalho => ({ ativo: true, inicio: '08:00', fim: '18:00' });
    return {
      blocoMin: 30,
      dias: [{ ativo: false, inicio: '08:00', fim: '18:00' }, util(), util(), util(), util(), util(), util()],
    };
  }

  private carregarHorario() {
    let salvo: unknown = null;
    try {
      salvo = JSON.parse(localStorage.getItem('meufluxo_horario_trabalho') || 'null');
    } catch { /* usa o horário padrão */ }

    this.usandoHorarioPadrao = !salvo;
    this.horario = this.normalizarHorario(salvo);
  }

  /** Garante um horário válido a partir do que estiver salvo (ou devolve o padrão). */
  private normalizarHorario(bruto: unknown): HorarioTrabalho {
    const padrao = this.horarioPadrao();
    if (!bruto || typeof bruto !== 'object') return padrao;

    const b = bruto as { blocoMin?: unknown; dias?: unknown };
    const bloco = [15, 30, 45, 60].includes(Number(b.blocoMin)) ? Number(b.blocoMin) : padrao.blocoMin;

    const dias = padrao.dias.map((d, i) => {
      const salvo = Array.isArray(b.dias) ? (b.dias[i] as Record<string, unknown> | undefined) : undefined;
      if (!salvo || typeof salvo !== 'object') return d;
      return {
        ativo: typeof salvo['ativo'] === 'boolean' ? (salvo['ativo'] as boolean) : d.ativo,
        inicio: this.HORA_REGEX.test(String(salvo['inicio'])) ? String(salvo['inicio']) : d.inicio,
        fim: this.HORA_REGEX.test(String(salvo['fim'])) ? String(salvo['fim']) : d.fim,
      };
    });

    return { blocoMin: bloco, dias };
  }

  private paraMinutos(hhmm: string): number {
    const [h, m] = String(hhmm).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  }

  private deMinutos(min: number): string {
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }

  /** Início do bloco em que um horário cai (ex.: 09:10 com blocos de 30 → 09:00), em minutos. */
  private inicioDoBloco(hhmm: string): number {
    const bloco = this.horario.blocoMin;
    return Math.floor(this.paraMinutos(hhmm) / bloco) * bloco;
  }

  /** Primeiro e último bloco (início, em minutos) em que o dia atende. null se fechado. */
  private faixaDoDia(dia: DiaTrabalho): { primeira: number; ultima: number } | null {
    if (!dia.ativo) return null;
    const bloco = this.horario.blocoMin;
    const primeira = Math.ceil(this.paraMinutos(dia.inicio) / bloco) * bloco;
    const ultima = Math.floor(this.paraMinutos(dia.fim) / bloco) * bloco - bloco;
    return ultima >= primeira ? { primeira, ultima } : null;
  }

  // =====================================================================
  //  GRADE DE DISPONIBILIDADE
  // =====================================================================

  /** Monta a grade do mês exibido: uma coluna por dia, uma linha por bloco de horário. */
  private montarGrade() {
    const bloco = this.horario.blocoMin;
    const prefixo = this.chaveMes(this.anoAtual, this.mesAtual);

    // cancelado libera o horário, então não aparece na grade
    const ativos = this.agendamentos.filter(a => a.status !== 'cancelado' && a.data.startsWith(prefixo));

    // linhas: do começo mais cedo ao fim mais tarde entre os dias de trabalho
    let primeira = Infinity;
    let ultima = -Infinity;
    for (const d of this.horario.dias) {
      const faixa = this.faixaDoDia(d);
      if (faixa) {
        primeira = Math.min(primeira, faixa.primeira);
        ultima = Math.max(ultima, faixa.ultima);
      }
    }
    // agendamento fora do expediente estende a grade, para nunca ficar escondido
    for (const a of ativos) {
      const t = this.inicioDoBloco(a.horario);
      primeira = Math.min(primeira, t);
      ultima = Math.max(ultima, t);
    }

    const linhasMin: number[] = [];
    if (primeira !== Infinity) {
      for (let t = primeira; t <= ultima; t += bloco) linhasMin.push(t);
    }

    const diasNoMes = new Date(this.anoAtual, this.mesAtual + 1, 0).getDate();
    const hojeStr = this.formatarData(this.hoje);
    const dias: DiaGrade[] = [];

    for (let n = 1; n <= diasNoMes; n++) {
      const data = `${prefixo}-${String(n).padStart(2, '0')}`;
      const diaSemana = new Date(this.anoAtual, this.mesAtual, n).getDay();
      const config = this.horario.dias[diaSemana];
      const faixa = this.faixaDoDia(config);
      const doDia = ativos.filter(a => a.data === data);

      const celulas: CelulaGrade[] = linhasMin.map(t => {
        const ags = doDia
          .filter(a => this.inicioDoBloco(a.horario) === t)
          .sort((a, b) => a.horario.localeCompare(b.horario) || a.id - b.id);

        let estado: CelulaGrade['estado'] = 'fora';
        if (ags.length > 0) estado = 'ocupado';
        else if (faixa && t >= faixa.primeira && t <= faixa.ultima) estado = 'livre';

        return { horario: this.deMinutos(t), estado, agendamentos: ags };
      });

      dias.push({
        data,
        numero: n,
        nomeSemana: this.diasSemanaCurto[diaSemana],
        ehHoje: data === hojeStr,
        passado: data < hojeStr,
        fechado: !config.ativo,
        celulas,
      });
    }

    this.dias = dias;
    this.linhas = linhasMin.map(t => this.deMinutos(t));
    this.colunasCss = `64px repeat(${dias.length}, 170px)`;
    this.linhasCss = `56px repeat(${this.linhas.length}, 46px)`;
  }

  // ---------- navegação ----------

  mudarMes(delta: number) {
    let novoMes = this.mesAtual + delta;
    let novoAno = this.anoAtual;
    if (novoMes < 0) { novoMes = 11; novoAno--; }
    if (novoMes > 11) { novoMes = 0; novoAno++; }
    this.mesAtual = novoMes;
    this.anoAtual = novoAno;
    this.montarGrade();
    this.posicionarRolagem();
  }

  irParaHoje() {
    this.anoAtual = this.hoje.getFullYear();
    this.mesAtual = this.hoje.getMonth();
    this.montarGrade();
    this.posicionarRolagem();
  }

  /** Rola a grade para os lados (botões ‹ ›, úteis para quem usa mouse). */
  rolar(direcao: 1 | -1) {
    const el = this.rolagem?.nativeElement;
    if (!el) return;
    el.scrollBy({ left: direcao * el.clientWidth * 0.6, behavior: 'smooth' });
  }

  /** No mês atual, abre já rolado até hoje; nos outros meses, começa no dia 1. */
  private posicionarRolagem() {
    setTimeout(() => {
      const el = this.rolagem?.nativeElement;
      if (!el) return;

      const alvo = el.querySelector('[data-hoje="true"]') as HTMLElement | null;
      if (alvo) {
        el.scrollTo({ left: Math.max(0, alvo.offsetLeft - 64), behavior: 'smooth' }); // 64 = largura da coluna de horários
      } else {
        el.scrollTo({ left: 0 });
      }
    });
  }

  // ---------- novo agendamento (clique em horário livre) ----------

  abrirNovo(dia: DiaGrade, celula: CelulaGrade) {
    if (this.clientes.length === 0 || this.servicos.length === 0) {
      alert('Cadastre ao menos um cliente e um serviço antes de criar um agendamento.');
      return;
    }
    this.novo = { data: dia.data, horario: celula.horario };
    this.formNovo = { clienteId: this.clientes[0].id, servicoId: this.servicos[0].id };
  }

  fecharNovo() {
    this.novo = null;
  }

  get rotuloNovo(): string {
    return this.novo ? `${this.formatarLabelData(this.novo.data)} · ${this.novo.horario}` : '';
  }

  salvarNovo(event: Event) {
    event.preventDefault();
    const novo = this.novo;
    if (!novo) return;

    const conflito = this.agendamentos.find(a =>
      a.status !== 'cancelado' &&
      a.data === novo.data &&
      this.inicioDoBloco(a.horario) === this.inicioDoBloco(novo.horario));

    if (conflito) {
      alert(`Esse horário já está ocupado por ${this.nomeCliente(conflito.clienteId)}.`);
      return;
    }

    const novoId = this.agendamentos.length > 0
      ? Math.max(...this.agendamentos.map(a => a.id)) + 1
      : 1;

    this.agendamentos.push({
      id: novoId,
      clienteId: Number(this.formNovo.clienteId),
      servicoId: Number(this.formNovo.servicoId),
      data: novo.data,
      horario: novo.horario,
      status: 'agendado',
    });

    this.salvarAgendamentos();
    this.fecharNovo();
  }

  // ---------- detalhes (clique em horário ocupado) ----------

  abrirDetalhe(dia: DiaGrade, celula: CelulaGrade) {
    this.detalhe = { data: dia.data, horario: celula.horario };
  }

  fecharDetalhe() {
    this.detalhe = null;
  }

  get rotuloDetalhe(): string {
    return this.detalhe ? `${this.formatarLabelData(this.detalhe.data)} · ${this.detalhe.horario}` : '';
  }

  /** Agendamentos do horário aberto no modal (busca na grade, então sempre está atualizado). */
  get detalheAgendamentos(): Agendamento[] {
    const detalhe = this.detalhe;
    if (!detalhe) return this.semAgendamentos;
    const dia = this.dias.find(d => d.data === detalhe.data);
    const celula = dia?.celulas.find(c => c.horario === detalhe.horario);
    return celula?.agendamentos ?? this.semAgendamentos;
  }

  mudarStatus(agendamento: Agendamento, status: Agendamento['status']) {
    agendamento.status = status;
    this.salvarAgendamentos();
    // cancelado libera o horário: some da grade, então não há mais o que mostrar
    if (this.detalheAgendamentos.length === 0) this.fecharDetalhe();
  }

  removerAgendamento(agendamento: Agendamento) {
    if (!confirm('Remover este agendamento?')) return;
    this.agendamentos = this.agendamentos.filter(a => a.id !== agendamento.id);
    this.salvarAgendamentos();
    if (this.detalheAgendamentos.length === 0) this.fecharDetalhe();
  }

  private salvarAgendamentos() {
    localStorage.setItem('meufluxo_agendamentos', JSON.stringify(this.agendamentos));
    this.atualizarDerivados(); // cards e listas da tela acompanham a mudança
    this.montarGrade();
  }
}
