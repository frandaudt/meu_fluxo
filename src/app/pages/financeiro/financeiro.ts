import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin } from 'rxjs';

import { API_URL, alternarValoresOcultos, dinheiro, valoresOcultos } from '../../app';

interface Cliente { id: number; nome: string; }
interface Servico { id: number; nome: string; valor: number; }

type FormaPagamento = 'dinheiro' | 'pix' | 'debito' | 'credito';

interface Agendamento {
  id: number;
  clienteId: number;
  servicoId: number;
  data: string;    // 'YYYY-MM-DD'
  horario: string;
  status: 'agendado' | 'realizado' | 'cancelado' | 'nao_compareceu';
  valorCobrado: number | null;
  desconto: number;
  formaPagamento: FormaPagamento | null;
  statusPagamento: 'pendente' | 'pago';
  pagoEm: string | null; // 'YYYY-MM-DD HH:mm:ss'
}

interface Despesa {
  id: number;
  descricao: string;
  valor: number;
  tipo: 'fixa' | 'emergencial';
  mes: string; // 'YYYY-MM'
}

/** Um card do topo. */
interface Card {
  rotulo: string;
  valor: string;
  legenda: string;
  variacao: number | null; // % em relação ao mesmo trecho do mês anterior
  tipo?: 'saldo' | 'receber';
}

/** Uma coluna do gráfico dos últimos 6 meses. */
interface MesGrafico {
  rotulo: string;      // 'Out*'
  faturamento: number;
  despesas: number;
  saldo: number;
  alturaFat: number;   // % da altura do gráfico
  alturaDesp: number;
}

interface FatiaForma {
  forma: FormaPagamento;
  rotulo: string;
  valor: number;
  percentual: number;
}



@Component({
  selector: 'app-financeiro',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './financeiro.html',
  styleUrl: './financeiro.css',
})
export class Financeiro implements OnInit {
  carregando = true;
  erro: string | null = null;
   /** "Ocultar valores" é o mesmo no sistema todo (começa oculto a cada login e a cada aba nova). */
  get ocultarValores(): boolean {
    return valoresOcultos();
  }

  clientes: Cliente[] = [];
  servicos: Servico[] = [];
  agendamentos: Agendamento[] = [];
  despesas: Despesa[] = [];

  private hojeData = new Date();
  hoje = this.formatarData(this.hojeData);
  anoAtual = this.hojeData.getFullYear();
  mesAtual = this.hojeData.getMonth(); // 0-11

  // ----- o que a tela mostra -----
  cards: Card[] = [];
  grafico: MesGrafico[] = [];
  formas: FatiaForma[] = [];
  descontosDoMes = 0;
  aReceber: Agendamento[] = [];
  despesasDoMes: Despesa[] = [];
  totalDespesasDoMes = 0;
  fraseComparacao = '';

  // ----- janela "Nova despesa" -----
  modalDespesa = false;
  erroDespesa: string | null = null;
  salvandoDespesa = false;
  novaDespesa: { descricao: string; valor: number | null; tipo: Despesa['tipo'] } = { descricao: '', valor: null, tipo: 'fixa' };

  // ----- janela "Registrar pagamento" -----
  pagamento: Agendamento | null = null;
  erroPagamento: string | null = null;
  salvandoPagamento = false;
  formPagamento = { valorCobrado: 0, desconto: 0, pagoEm: '', formaPagamento: 'pix' as FormaPagamento };

  readonly formasPagamento: { valor: FormaPagamento; rotulo: string }[] = [
    { valor: 'dinheiro', rotulo: 'Dinheiro' },
    { valor: 'pix', rotulo: 'Pix' },
    { valor: 'debito', rotulo: 'Débito' },
    { valor: 'credito', rotulo: 'Crédito' },
  ];
  readonly nomesMesesAbrev = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
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
    return new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('meufluxo_token')}` });
  }

  ngOnInit() {
    if (!localStorage.getItem('meufluxo_token')) {
      this.router.navigate(['/login']);
      return;
    }


    const headers = this.cabecalhoAuth();
    forkJoin({
      clientes: this.http.get<{ clientes: Cliente[] }>(`${API_URL}/clientes`, { headers }),
      servicos: this.http.get<{ servicos: { id: number; nome: string; valor: number }[] }>(`${API_URL}/servicos`, { headers }),
      agendamentos: this.http.get<{ agendamentos: Agendamento[] }>(`${API_URL}/agendamentos`, { headers }),
      despesas: this.http.get<{ despesas: Despesa[] }>(`${API_URL}/despesas`, { headers }),
    }).subscribe({
      next: (r) => {
        this.clientes = r.clientes.clientes;
        this.servicos = r.servicos.servicos.map(s => ({ id: s.id, nome: s.nome, valor: s.valor }));
        this.agendamentos = r.agendamentos.agendamentos;
        this.despesas = r.despesas.despesas;
        this.atualizarDerivados();
        this.carregando = false;

        // vindo da Início ("Ir para A receber"): /financeiro?receber=12 abre a janela direto
        const id = Number(this.rota.snapshot.queryParamMap.get('receber'));
        if (id) {
          const ag = this.aReceber.find(a => a.id === id);
          if (ag) this.abrirPagamento(ag);
          this.router.navigate([], { relativeTo: this.rota, queryParams: {}, replaceUrl: true });
        }
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.carregando = false;
        this.erro = 'Não foi possível carregar os dados financeiros.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  TOPO
  // =====================================================================

  get tituloMes(): string {
    const nome = this.nomesMeses[this.mesAtual];
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${this.anoAtual}`;
  }

  get nomeMes(): string {
    return this.nomesMeses[this.mesAtual];
  }

  mudarMes(delta: number) {
    const d = new Date(this.anoAtual, this.mesAtual + delta, 1);
    this.anoAtual = d.getFullYear();
    this.mesAtual = d.getMonth();
    this.atualizarDerivados();
  }

    alternarValores() {
    alternarValoresOcultos();
    this.atualizarDerivados(); // os textos dos cards e do gráfico são montados já formatados
  }

  // =====================================================================
  //  CÁLCULOS
  //  Faturamento = o que foi pago (valor cobrado − desconto), pela DATA DO PAGAMENTO.
  //  Saldo = faturamento − despesas. A receber = realizado com pagamento pendente.
  // =====================================================================

  private chaveMes(ano: number, mes: number): string {
    return `${ano}-${String(mes + 1).padStart(2, '0')}`;
  }

  /** Pagamentos feitos entre duas datas (inclusive). */
  private pagosEntre(inicio: string, fim: string): Agendamento[] {
    return this.agendamentos.filter(a => {
      if (a.statusPagamento !== 'pago' || !a.pagoEm) return false;
      const dia = a.pagoEm.slice(0, 10);
      return dia >= inicio && dia <= fim;
    });
  }

  private recebido(a: Agendamento): number {
    return Math.max(0, Number(a.valorCobrado ?? 0) - Number(a.desconto ?? 0));
  }

  private somaRecebida(lista: Agendamento[]): number {
    return lista.reduce((soma, a) => soma + this.recebido(a), 0);
  }

  /** Despesas que valem no mês: fixa vale do mês em que foi criada em diante; emergencial, só no mês dela. */
  private despesasAtivasEm(ano: number, mes: number): Despesa[] {
    const chave = this.chaveMes(ano, mes);
    return this.despesas.filter(d => (d.tipo === 'emergencial' ? d.mes === chave : d.mes <= chave));
  }

  private totalDespesas(ano: number, mes: number): number {
    return this.despesasAtivasEm(ano, mes).reduce((soma, d) => soma + Number(d.valor), 0);
  }

  private limitesDoMes(ano: number, mes: number): { inicio: string; fim: string } {
    return {
      inicio: this.formatarData(new Date(ano, mes, 1)),
      fim: this.formatarData(new Date(ano, mes + 1, 0)),
    };
  }

  private variacao(atual: number, anterior: number): number | null {
    if (anterior <= 0) return null;
    return Math.round(((atual - anterior) / anterior) * 100);
  }

  private atualizarDerivados() {
    const ano = this.anoAtual;
    const mes = this.mesAtual;
    const { inicio, fim } = this.limitesDoMes(ano, mes);
    const anterior = new Date(ano, mes - 1, 1);
    const nomeAnterior = this.nomesMeses[anterior.getMonth()];
    const abrevAnterior = this.nomesMesesAbrev[anterior.getMonth()].toLowerCase();

    // ----- comparação: no mês corrente, compara com o MESMO TRECHO do mês anterior (1 a hoje) -----
    const ehMesCorrente = ano === this.hojeData.getFullYear() && mes === this.hojeData.getMonth();
    const ehFuturo = inicio > this.hoje;
    const limAnt = this.limitesDoMes(anterior.getFullYear(), anterior.getMonth());
    let fimAtual = fim;
    let fimAnterior = limAnt.fim;
    if (ehMesCorrente) {
      const dia = this.hojeData.getDate();
      fimAtual = this.hoje;
      const ultimoDiaAnt = Number(limAnt.fim.slice(8, 10));
      fimAnterior = this.formatarData(new Date(anterior.getFullYear(), anterior.getMonth(), Math.min(dia, ultimoDiaAnt)));
      this.fraseComparacao = `Comparação com 1–${Number(fimAnterior.slice(8, 10))} de ${nomeAnterior}.`;
    } else {
      this.fraseComparacao = ehFuturo ? '' : `Comparação com ${nomeAnterior} inteiro.`;
    }

    const pagosMes = this.pagosEntre(inicio, fim);
    const faturamento = this.somaRecebida(pagosMes);
    const despesas = this.totalDespesas(ano, mes);
    const pagosTrecho = this.pagosEntre(inicio, fimAtual);
    const pagosTrechoAnt = this.pagosEntre(limAnt.inicio, fimAnterior);
    const despesasAnt = this.totalDespesas(anterior.getFullYear(), anterior.getMonth());

    // ----- A receber: todos os realizados ainda não pagos (não depende do mês escolhido) -----
    this.aReceber = this.agendamentos
      .filter(a => a.status === 'realizado' && a.statusPagamento === 'pendente')
      .sort((a, b) => b.data.localeCompare(a.data) || b.horario.localeCompare(a.horario));
    const totalReceber = this.somaRecebida(this.aReceber);
    const qtdReceber = this.aReceber.length;

    const comparar = !ehFuturo;
    this.cards = [
      {
        rotulo: 'Faturamento (recebido)',
        valor: this.moeda(faturamento),
        legenda: `vs ${abrevAnterior}.`,
        variacao: comparar ? this.variacao(this.somaRecebida(pagosTrecho), this.somaRecebida(pagosTrechoAnt)) : null,
      },
      {
        rotulo: 'Despesas',
        valor: this.moeda(despesas),
        legenda: `vs ${abrevAnterior}.`,
        variacao: comparar ? this.variacao(despesas, despesasAnt) : null,
      },
      {
        rotulo: 'Saldo',
        valor: this.moeda(faturamento - despesas),
        legenda: 'recebido − despesas',
        variacao: null,
        tipo: 'saldo',
      },
      {
        rotulo: 'Atendimentos pagos',
        valor: String(pagosMes.length),
        legenda: `vs ${abrevAnterior}.`,
        variacao: comparar ? this.variacao(pagosTrecho.length, pagosTrechoAnt.length) : null,
      },
      {
        rotulo: 'A receber',
        valor: this.moeda(totalReceber),
        legenda: `${qtdReceber} ${qtdReceber === 1 ? 'atendimento realizado' : 'atendimentos realizados'}`,
        variacao: null,
        tipo: 'receber',
      },
    ];

    // ----- gráfico: últimos 6 meses terminando no mês escolhido -----
    const meses: Omit<MesGrafico, 'alturaFat' | 'alturaDesp'>[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(ano, mes - i, 1);
      const lim = this.limitesDoMes(d.getFullYear(), d.getMonth());
      const fat = this.somaRecebida(this.pagosEntre(lim.inicio, lim.fim));
      const desp = this.totalDespesas(d.getFullYear(), d.getMonth());
      const parcial = d.getFullYear() === this.hojeData.getFullYear() && d.getMonth() === this.hojeData.getMonth();
      meses.push({ rotulo: this.nomesMesesAbrev[d.getMonth()] + (parcial ? '*' : ''), faturamento: fat, despesas: desp, saldo: fat - desp });
    }
    const maior = Math.max(1, ...meses.map(m => Math.max(m.faturamento, m.despesas)));
    this.grafico = meses.map(m => ({
      ...m,
      alturaFat: (m.faturamento / maior) * 100,
      alturaDesp: (m.despesas / maior) * 100,
    }));

    // ----- como seus clientes pagam (no mês escolhido) -----
    this.formas = this.formasPagamento
      .map(f => {
        const valor = this.somaRecebida(pagosMes.filter(a => a.formaPagamento === f.valor));
        return { forma: f.valor, rotulo: f.rotulo, valor, percentual: faturamento > 0 ? Math.round((valor / faturamento) * 100) : 0 };
      })
      .filter(f => f.valor > 0)
      .sort((a, b) => b.valor - a.valor);
    this.descontosDoMes = pagosMes.reduce((soma, a) => soma + Number(a.desconto ?? 0), 0);

    // ----- despesas do mês -----
    this.despesasDoMes = this.despesasAtivasEm(ano, mes).sort((a, b) => b.valor - a.valor);
    this.totalDespesasDoMes = despesas;
  }

  // =====================================================================
  //  REGISTRAR PAGAMENTO (janela)
  // =====================================================================

  abrirPagamento(ag: Agendamento) {
    this.pagamento = ag;
    this.erroPagamento = null;
    this.formPagamento = {
      valorCobrado: Number(ag.valorCobrado ?? this.servicos.find(s => s.id === ag.servicoId)?.valor ?? 0),
      desconto: 0,
      pagoEm: this.hoje,
      formaPagamento: 'pix',
    };
  }

  fecharPagamento() {
    this.pagamento = null;
    this.erroPagamento = null;
  }

  get totalRecebido(): number {
    return Math.max(0, Number(this.formPagamento.valorCobrado || 0) - Number(this.formPagamento.desconto || 0));
  }

  confirmarPagamento() {
    const ag = this.pagamento;
    if (!ag) return;
    const f = this.formPagamento;
    if (Number(f.valorCobrado) <= 0) {
      this.erroPagamento = 'Informe o valor cobrado.';
      return;
    }
    if (Number(f.desconto) > Number(f.valorCobrado)) {
      this.erroPagamento = 'O desconto não pode ser maior que o valor cobrado.';
      return;
    }
    // RN-PAG1: a data do pagamento vai do dia do atendimento até hoje
    if (!f.pagoEm || f.pagoEm < ag.data || f.pagoEm > this.hoje) {
      this.erroPagamento = `A data do pagamento precisa estar entre ${this.dataCurta(ag.data)} e hoje.`;
      return;
    }

    this.salvandoPagamento = true;
    this.erroPagamento = null;
    this.http.put<{ agendamento: Agendamento }>(
      `${API_URL}/agendamentos/${ag.id}/pagamento`,
      { valorCobrado: f.valorCobrado, desconto: f.desconto, pagoEm: f.pagoEm, formaPagamento: f.formaPagamento },
      { headers: this.cabecalhoAuth() }
    ).subscribe({
      next: ({ agendamento }) => {
        const i = this.agendamentos.findIndex(a => a.id === agendamento.id);
        if (i >= 0) this.agendamentos[i] = agendamento;
        this.salvandoPagamento = false;
        this.fecharPagamento();
        this.atualizarDerivados();
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.salvandoPagamento = false;
        this.erroPagamento = erro?.error?.erro || 'Não foi possível registrar o pagamento.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  DESPESAS (janela que já existia)
  // =====================================================================

  abrirDespesa() {
    this.novaDespesa = { descricao: '', valor: null, tipo: 'fixa' };
    this.erroDespesa = null;
    this.modalDespesa = true;
  }

  fecharDespesa() {
    this.modalDespesa = false;
    this.erroDespesa = null;
  }

  salvarDespesa(event: Event) {
    event.preventDefault();
    this.erroDespesa = null;

    if (!this.novaDespesa.descricao || this.novaDespesa.valor === null || this.novaDespesa.valor <= 0) {
      this.erroDespesa = 'Preencha a descrição e um valor válido!';
      return;
    }

    const corpo = {
      descricao: this.novaDespesa.descricao,
      valor: Number(this.novaDespesa.valor),
      tipo: this.novaDespesa.tipo,
      mes: this.chaveMes(this.anoAtual, this.mesAtual),
    };

    this.salvandoDespesa = true;
    this.http.post<{ despesa: Despesa }>(`${API_URL}/despesas`, corpo, { headers: this.cabecalhoAuth() }).subscribe({
      next: ({ despesa }) => {
        this.despesas.push(despesa);
        this.atualizarDerivados();
        this.salvandoDespesa = false;
        this.fecharDespesa();
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.salvandoDespesa = false;
        this.erroDespesa = erro?.error?.erro || 'Não foi possível salvar a despesa.';
        this.cdr.markForCheck();
      },
    });
  }

  removerDespesa(d: Despesa) {
    const aviso = d.tipo === 'fixa'
      ? `Remover a despesa fixa "${d.descricao}"? Ela sai de todos os meses.`
      : `Remover a despesa "${d.descricao}"?`;
    if (!confirm(aviso)) return;

    this.http.delete(`${API_URL}/despesas/${d.id}`, { headers: this.cabecalhoAuth() }).subscribe({
      next: () => {
        this.despesas = this.despesas.filter(x => x.id !== d.id);
        this.atualizarDerivados();
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.erro = 'Não foi possível remover a despesa.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  AUXILIARES
  // =====================================================================

  /** Valor em R$, ou "R$ ••••" com os valores ocultos. */
  moeda(valor: number): string {
    return dinheiro(valor);
  }

  /** Valor curto para cima das barras: "R$ 3,1k". */
  moedaCurta(valor: number): string {
    if (this.ocultarValores) return '••••';
    const sinal = valor < 0 ? '−' : '';
    const abs = Math.abs(valor);
    if (abs >= 1000) return `${sinal}R$ ${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
    return `${sinal}R$ ${Math.round(abs)}`;
  }

  /** Valor da lista de formas de pagamento: "R$ 2.018". */
  moedaInteira(valor: number): string {
    if (this.ocultarValores) return 'R$ ••••';
    return `R$ ${Math.round(valor).toLocaleString('pt-BR')}`;
  }

  nomeCliente(id: number): string {
    return this.clientes.find(c => c.id === id)?.nome ?? 'Cliente removido';
  }

  nomeServico(id: number): string {
    return this.servicos.find(s => s.id === id)?.nome ?? 'Serviço removido';
  }

  /** "hoje", "ontem" ou "09/10". */
  quando(data: string): string {
    if (data === this.hoje) return 'hoje';
    const [a, m, d] = this.hoje.split('-').map(Number);
    if (data === this.formatarData(new Date(a, m - 1, d - 1))) return 'ontem';
    return this.dataCurta(data);
  }

  dataCurta(data: string): string {
    const [, mes, dia] = data.split('-');
    return `${dia}/${mes}`;
  }

  private formatarData(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
