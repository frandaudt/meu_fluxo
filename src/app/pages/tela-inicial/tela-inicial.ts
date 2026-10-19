import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import {
  API_URL,
  Alerta,
  abrirAcaoDoAlerta,
  alternarValoresOcultos,
  dinheiro,
  esconderValoresNoTexto,
  valoresOcultos,
  horarioPadrao,
  normalizarHorarioTrabalho,
  expedienteDoDia,
  minutosDeTrabalho,
} from '../../app';
import {
  AcaoRapida,
  Calendario,
  EventoResumo,
  HorarioTrabalhoCalendario,
  VisaoCalendario,
} from '../../components/calendario/calendario';

interface Cliente { id: number; nome: string; telefone?: string | null; }
interface Servico { id: number; nome: string; valor: number; duracao: number; }

interface Agendamento {
  id: number;
  clienteId: number;
  servicoId: number;
  data: string;    // 'YYYY-MM-DD'
  horario: string; // 'HH:mm'
  status: 'agendado' | 'realizado' | 'cancelado' | 'nao_compareceu';
  origem: 'sistema' | 'whatsapp' | 'link' | 'lista_espera';
  valorCobrado: number | null;
  desconto: number;
  statusPagamento: 'pendente' | 'pago';
  pagoEm: string | null;              // 'YYYY-MM-DD HH:mm:ss'
  lembreteEnviadoEm?: string | null;  // "Enviado ✓"
}

interface MetaMensal { id: number; mes: string; tipo: 'faturamento' | 'clientes'; valorAlvo: number; }

/** Um dos 6 números do topo. */
interface Numero {
  rotulo: string;
  valor: string;
  detalhe?: string;   // texto pequeno embaixo ("2 feitos")
  dinheiro?: boolean; // some com "Ocultar valores"
}

interface Lembrete {
  ag: Agendamento;
  cliente: string;
  servico: string;
  link: string | null; // wa.me com a mensagem pronta
}

interface MetaResumo {
  tipo: 'faturamento' | 'clientes';
  progresso: number;
  valorAlvo: number;
  percentual: number;
}

@Component({
  selector: 'app-tela-inicial',
  standalone: true,
  imports: [CommonModule, RouterLink, Calendario],
  templateUrl: './tela-inicial.html',
  styleUrl: './tela-inicial.css',
})
export class TelaInicial implements OnInit {
  carregando = true;
  erro: string | null = null;

  clientes: Cliente[] = [];
  servicos: Servico[] = [];
  agendamentos: Agendamento[] = [];
  metasMensais: MetaMensal[] = [];
  alertas: Alerta[] = [];
  horario: HorarioTrabalhoCalendario = horarioPadrao();

  eventosPorDia: Map<string, EventoResumo[]> = new Map();

  // ----- quem está usando -----
  nomeUsuario = '';
  /** Dono, ou atendente com acesso ao Financeiro: vê valores em R$. */
  veValores = true;
  veMetas = true;

  /** "Ocultar valores" é o mesmo no sistema todo (começa oculto a cada login e a cada aba nova). */
  get ocultarValores(): boolean {
    return valoresOcultos();
  }

  // ----- visão -----
  hoje = this.formatarData(new Date());
  /** Padrão: Semana para o dono e Dia para o atendente. */
  visao: VisaoCalendario = 'semana';
  dataRef = this.hoje;

  numeros: Numero[] = [];
  lembretes: Lembrete[] = [];
  metasDoMes: MetaResumo[] = [];

  readonly nomesMeses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  readonly diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  constructor(private router: Router, private http: HttpClient, private cdr: ChangeDetectorRef) {}

  private cabecalhoAuth(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('meufluxo_token')}` });
  }

  ngOnInit() {
    if (!localStorage.getItem('meufluxo_token')) {
      this.router.navigate(['/login']);
      return;
    }

    // quem está logado e o que pode ver
    let usuario: { nome?: string; papel?: string; permissoes?: string[] } = {};
    try {
      usuario = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
    } catch {}
    const ehAtendente = usuario.papel === 'atendente';
    const permissoes = Array.isArray(usuario.permissoes) ? usuario.permissoes : [];
    this.nomeUsuario = String(usuario.nome || '').trim().split(/\s+/)[0];
    this.veValores = !ehAtendente || permissoes.includes('financeiro');
    this.veMetas = !ehAtendente || permissoes.includes('metas');
    this.visao = ehAtendente ? 'dia' : 'semana';

    const headers = this.cabecalhoAuth();

    forkJoin({
      clientes: this.http.get<{ clientes: Cliente[] }>(`${API_URL}/clientes`, { headers }),
      servicos: this.http.get<{ servicos: { id: number; nome: string; valor: number; duracaoMin: number }[] }>(
        `${API_URL}/servicos`, { headers }
      ),
      agendamentos: this.http.get<{ agendamentos: Agendamento[] }>(`${API_URL}/agendamentos`, { headers }),
      horario: this.http.get<unknown>(`${API_URL}/horario-trabalho`, { headers }),
      // metas: só pede se a pessoa pode ver (senão a API responde 403)
      metas: this.veMetas
        ? this.http.get<{ metas: MetaMensal[] }>(`${API_URL}/metas/mensais`, { headers })
        : of({ metas: [] as MetaMensal[] }),
      // avisos: se falharem, a Início abre do mesmo jeito
      alertas: this.http.get<{ alertas: Alerta[] }>(`${API_URL}/alertas`, { headers })
        .pipe(catchError(() => of({ alertas: [] as Alerta[] }))),
    }).subscribe({
      next: (r) => {
        this.clientes = r.clientes.clientes;
        this.servicos = r.servicos.servicos.map(s => ({ id: s.id, nome: s.nome, valor: s.valor, duracao: s.duracaoMin }));
        this.agendamentos = r.agendamentos.agendamentos;
        this.horario = normalizarHorarioTrabalho(r.horario); // com pausa e folgas
        this.metasMensais = r.metas.metas;
        this.alertas = r.alertas.alertas;
        this.atualizarTudo();
        this.carregando = false;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.carregando = false;
        this.erro = 'Não foi possível carregar a tela inicial.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  TOPO
  // =====================================================================

  get saudacao(): string {
    const hora = new Date().getHours();
    const parte = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    return this.nomeUsuario ? `${parte}, ${this.nomeUsuario}` : parte;
  }

  /** "Semana de 12 a 18 de outubro · 21 atendimentos marcados" */
  get subtitulo(): string {
    const qtd = this.agendamentosNoPeriodo().filter(a => a.status === 'agendado' || a.status === 'realizado').length;
    return `${this.tituloPeriodo} · ${qtd} ${qtd === 1 ? 'atendimento marcado' : 'atendimentos marcados'}`;
  }

  /** Título do período (também é o título do card do calendário). */
  get tituloPeriodo(): string {
    const [ano, mes, dia] = this.dataRef.split('-').map(Number);
    if (this.visao === 'mes') return `${this.nomesMeses[mes - 1]} de ${ano}`;
    if (this.visao === 'dia') {
      const nomeDia = this.diasSemana[new Date(ano, mes - 1, dia).getDay()];
      const texto = `${nomeDia}, ${dia} de ${this.nomesMeses[mes - 1]}`;
      return this.dataRef === this.hoje ? `Hoje, ${texto}` : texto;
    }
    const { inicio, fim } = this.periodo();
    const [, m1, d1] = inicio.split('-').map(Number);
    const [, m2, d2] = fim.split('-').map(Number);
    return m1 === m2
      ? `Semana de ${d1} a ${d2} de ${this.nomesMeses[m2 - 1]}`
      : `Semana de ${d1} de ${this.nomesMeses[m1 - 1]} a ${d2} de ${this.nomesMeses[m2 - 1]}`;
  }

  mudarVisao(visao: VisaoCalendario) {
    this.visao = visao;
    this.atualizarTudo();
  }

  alternarValores() {
    alternarValoresOcultos();
    this.atualizarTudo(); // os 6 números são montados já formatados, então precisam ser refeitos
  }

  /** Texto do aviso, escondendo os R$ quando "Ocultar valores" está ligado. */
  textoAlerta(texto: string): string {
    return esconderValoresNoTexto(texto);
  }

  /** Clique num dia do Mês ou no topo de uma coluna da Semana: abre a visão Dia daquele dia. */
  selecionarDia(data: string) {
    this.dataRef = data;
    this.visao = 'dia';
    this.atualizarTudo();
  }

  voltarParaHoje() {
    this.dataRef = this.hoje;
    this.atualizarTudo();
  }

  // =====================================================================
  //  CALENDÁRIO → AGENDA / FINANCEIRO
  //  As janelas de concluir, cancelar e pagar ficam na Agenda: a Início só
  //  leva a pessoa até lá, com a janela certa já aberta.
  // =====================================================================

  abrirEvento(id: number) {
    this.router.navigate(['/agenda'], { queryParams: { ag: id } });
  }

  acaoRapida(evento: { id: number; acao: AcaoRapida }) {
    if (evento.acao === 'pagamento' && this.veValores) {
      // dono: "Ir para A receber" (abre a janela de registrar pagamento no Financeiro)
      this.router.navigate(['/financeiro'], { queryParams: { receber: evento.id } });
      return;
    }
    // atendente: "Receber agora" sem passar pelo Financeiro
    this.router.navigate(['/agenda'], { queryParams: { ag: evento.id, acao: evento.acao } });
  }

  agendarEm(slot: { data: string; horario: string }) {
    this.router.navigate(['/agenda'], { queryParams: { novo: slot.data, hora: slot.horario } });
  }

  // =====================================================================
  //  PRECISA DA SUA ATENÇÃO
  // =====================================================================

  abrirAlerta(alerta: Alerta) {
    if (alerta.notificacaoId) this.alertas = this.alertas.filter(a => a.id !== alerta.id);
    abrirAcaoDoAlerta(alerta, this.router, this.http);
  }

  // =====================================================================
  //  LEMBRETES DE AMANHÃ
  // =====================================================================

  enviarLembrete(lembrete: Lembrete) {
    if (!lembrete.link) return;
    window.open(lembrete.link, '_blank');

    // marca como enviado na hora (o botão vira "Enviado ✓") e grava no banco
    lembrete.ag.lembreteEnviadoEm = this.hoje;
    this.http.put(`${API_URL}/agendamentos/${lembrete.ag.id}/lembrete`, {}, { headers: this.cabecalhoAuth() })
      .subscribe({ error: (erro) => console.error('Não foi possível marcar o lembrete como enviado.', erro) });
  }

  // =====================================================================
  //  CÁLCULOS
  // =====================================================================

  private atualizarTudo() {
    this.montarEventos();
    this.numeros = this.veValores ? this.numerosDono() : this.numerosAtendente();
    this.lembretes = this.montarLembretes();
    this.metasDoMes = this.montarMetas();
  }

  private montarEventos() {
    const mapa = new Map<string, EventoResumo[]>();
    for (const ag of this.agendamentos) {
      if (!mapa.has(ag.data)) mapa.set(ag.data, []);
      const nome = this.nomeCliente(ag.clienteId);
      mapa.get(ag.data)!.push({
        id: ag.id,
        horario: ag.horario,
        texto: this.nomeCurto(nome),
        nomeCompleto: nome,
        servico: this.servico(ag.servicoId)?.nome ?? 'Serviço removido',
        duracao: this.duracao(ag.servicoId),
        status: ag.status,
        statusPagamento: ag.statusPagamento,
        origem: ag.origem,
      });
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.horario.localeCompare(b.horario));
    this.eventosPorDia = mapa;
  }

  /** Primeiro e último dia do período mostrado (dia, semana de segunda a domingo, ou mês). */
  private periodo(): { inicio: string; fim: string } {
    const [ano, mes, dia] = this.dataRef.split('-').map(Number);
    if (this.visao === 'dia') return { inicio: this.dataRef, fim: this.dataRef };
    if (this.visao === 'mes') {
      return {
        inicio: this.formatarData(new Date(ano, mes - 1, 1)),
        fim: this.formatarData(new Date(ano, mes, 0)),
      };
    }
    const ref = new Date(ano, mes - 1, dia);
    const segunda = new Date(ano, mes - 1, dia - ((ref.getDay() + 6) % 7));
    return {
      inicio: this.formatarData(segunda),
      fim: this.formatarData(new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 6)),
    };
  }

  private agendamentosNoPeriodo(): Agendamento[] {
    const { inicio, fim } = this.periodo();
    return this.agendamentos.filter(a => a.data >= inicio && a.data <= fim);
  }

  private diasDoPeriodo(): string[] {
    const { inicio, fim } = this.periodo();
    const dias: string[] = [];
    const [ano, mes, dia] = inicio.split('-').map(Number);
    for (let i = 0; ; i++) {
      const data = this.formatarData(new Date(ano, mes - 1, dia + i));
      if (data > fim) break;
      dias.push(data);
    }
    return dias;
  }

  /** "hoje", "do dia", "da semana" ou "do mês", para os rótulos dos números. */
  private sufixo(): string {
    if (this.visao === 'dia') return this.dataRef === this.hoje ? 'hoje' : 'do dia';
    return this.visao === 'semana' ? 'da semana' : 'do mês';
  }

  /** Taxa = quantidade ÷ (realizados + cancelados + faltas), em %. */
  private taxa(ags: Agendamento[], status: Agendamento['status']): string {
    const base = ags.filter(a => a.status !== 'agendado').length;
    if (base === 0) return '0%';
    const pct = (ags.filter(a => a.status === status).length / base) * 100;
    return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  }

  /** Ocupação do período = minutos agendados ÷ minutos de trabalho (glossário). */
  private ocupacao(): string {
    let disponivel = 0;
    let ocupado = 0;
    for (const data of this.diasDoPeriodo()) {
      // expediente − pausa − folgas (mesmo cálculo do calendário)
      disponivel += minutosDeTrabalho(expedienteDoDia(this.horario, data));
    }
    for (const a of this.agendamentosNoPeriodo()) {
      if (a.status === 'agendado' || a.status === 'realizado') ocupado += this.duracao(a.servicoId);
    }
    return disponivel > 0 ? `${Math.min(100, Math.round((ocupado / disponivel) * 100))}%` : '0%';
  }

  /** Horários livres (a partir de agora) nos dias do período: os mesmos "livre" que aparecem no calendário. */
  private horariosLivres(): number {
    const bloco = this.horario.blocoMin || 30;
    const agora = new Date();
    const agoraMin = agora.getHours() * 60 + agora.getMinutes();
    let total = 0;

    for (const data of this.diasDoPeriodo()) {
      if (data < this.hoje) continue;
      const config = expedienteDoDia(this.horario, data); // null = não trabalha ou folga
      if (!config) continue;

      let cursor = config.inicio;
      if (data === this.hoje) cursor = Math.max(cursor, Math.ceil(agoraMin / bloco) * bloco);
      const fimExpediente = config.fim;

      // agendamentos + pausa do almoço + bloqueios de parte do dia
      const ocupados = this.agendamentos
        .filter(a => a.data === data && (a.status === 'agendado' || a.status === 'realizado'))
        .map(a => ({ ini: this.paraMinutos(a.horario), fim: this.paraMinutos(a.horario) + this.duracao(a.servicoId) }))
        .concat(config.pausas.map(p => ({ ini: p.ini, fim: p.fim })))
        .sort((a, b) => a.ini - b.ini);

      for (const o of ocupados) {
        if (o.ini - cursor >= bloco) total++;
        cursor = Math.max(cursor, o.fim);
      }
      if (fimExpediente - cursor >= bloco) total++;
    }
    return total;
  }

  private faturamentoNoPeriodo(): number {
    const { inicio, fim } = this.periodo();
    return this.agendamentos
      .filter(a => a.statusPagamento === 'pago' && a.pagoEm && a.pagoEm.slice(0, 10) >= inicio && a.pagoEm.slice(0, 10) <= fim)
      .reduce((soma, a) => soma + Number(a.valorCobrado ?? 0) - Number(a.desconto ?? 0), 0);
  }

  private numerosDono(): Numero[] {
    const ags = this.agendamentosNoPeriodo();
    const marcados = ags.filter(a => a.status === 'agendado' || a.status === 'realizado');
    const feitos = ags.filter(a => a.status === 'realizado').length;
    const pendentes = ags.filter(a => a.status === 'realizado' && a.statusPagamento === 'pendente');
    const aReceber = pendentes.reduce((soma, a) => soma + Number(a.valorCobrado ?? 0) - Number(a.desconto ?? 0), 0);
    const suf = this.sufixo();
    const ehDia = this.visao === 'dia';

    return [
      { rotulo: `Faturamento ${suf}`, valor: this.moeda(this.faturamentoNoPeriodo()), dinheiro: true },
      { rotulo: `Atendimentos ${suf}`, valor: String(marcados.length), detalhe: `${feitos} ${feitos === 1 ? 'feito' : 'feitos'}` },
      { rotulo: ehDia ? `A receber ${suf}` : 'A receber', valor: this.moeda(aReceber), dinheiro: true },
      ehDia
        ? { rotulo: `Cancelamentos ${suf}`, valor: String(ags.filter(a => a.status === 'cancelado').length) }
        : { rotulo: 'Cancelamentos', valor: this.taxa(ags, 'cancelado') },
      ehDia
        ? { rotulo: `Faltas ${suf}`, valor: String(ags.filter(a => a.status === 'nao_compareceu').length) }
        : { rotulo: 'Faltas', valor: this.taxa(ags, 'nao_compareceu') },
      { rotulo: `Ocupação ${suf}`, valor: this.ocupacao() },
    ];
  }

  private numerosAtendente(): Numero[] {
    const ags = this.agendamentosNoPeriodo();
    const marcados = ags.filter(a => a.status === 'agendado' || a.status === 'realizado').length;
    const feitos = ags.filter(a => a.status === 'realizado').length;
    const cancelados = ags.filter(a => a.status === 'cancelado').length;
    const faltas = ags.filter(a => a.status === 'nao_compareceu').length;
    const suf = this.sufixo();
    // ligado no pacote da Lista de espera (por enquanto mostra "—")
    const naLista: Numero = { rotulo: 'Na lista de espera', valor: '—' };

    if (this.visao === 'dia') {
      return [
        { rotulo: `Atendimentos ${suf}`, valor: String(marcados) },
        { rotulo: 'Já realizados', valor: String(feitos) },
        { rotulo: `Faltam ${suf}`, valor: String(ags.filter(a => a.status === 'agendado').length) },
        { rotulo: 'Horários livres', valor: String(this.horariosLivres()) },
        {
          rotulo: 'Pagamentos pendentes',
          valor: String(this.agendamentos.filter(a => a.status === 'realizado' && a.statusPagamento === 'pendente').length),
        },
        naLista,
      ];
    }
    return [
      { rotulo: 'Atendimentos', valor: String(marcados) },
      { rotulo: 'Já realizados', valor: String(feitos) },
      { rotulo: 'Cancelamentos', valor: String(cancelados) },
      { rotulo: 'Faltas', valor: String(faltas) },
      this.visao === 'semana'
        ? { rotulo: 'Horários livres', valor: String(this.horariosLivres()) }
        : { rotulo: 'Ocupação', valor: this.ocupacao() },
      naLista,
    ];
  }

  /** Agendamentos de amanhã, com a mensagem de lembrete pronta para o WhatsApp. */
  private montarLembretes(): Lembrete[] {
    const [ano, mes, dia] = this.hoje.split('-').map(Number);
    const amanha = this.formatarData(new Date(ano, mes - 1, dia + 1));

    return this.agendamentos
      .filter(a => a.data === amanha && a.status === 'agendado')
      .sort((a, b) => a.horario.localeCompare(b.horario))
      .map(ag => {
        const cliente = this.clientes.find(c => c.id === ag.clienteId);
        const servico = this.servico(ag.servicoId)?.nome ?? 'atendimento';
        const primeiroNome = String(cliente?.nome || '').trim().split(/\s+/)[0];
        const texto = `Olá ${primeiroNome}, passando para lembrar: ${servico.toLowerCase()} amanhã (${this.dataCurta(ag.data)}) às ${ag.horario}. Te esperamos!`;
        return {
          ag,
          cliente: cliente?.nome ?? 'Cliente removido',
          servico,
          link: this.linkWhatsapp(cliente?.telefone, texto),
        };
      });
  }

  /** Metas do mês atual: Faturamento (o que foi pago no mês) e Clientes atendidos. */
  private montarMetas(): MetaResumo[] {
    const chave = this.hoje.slice(0, 7);
    return this.metasMensais
      .filter(m => m.mes === chave)
      .map(m => {
        const progresso = m.tipo === 'faturamento'
          ? this.agendamentos
              .filter(a => a.statusPagamento === 'pago' && (a.pagoEm || '').startsWith(chave))
              .reduce((soma, a) => soma + Number(a.valorCobrado ?? 0) - Number(a.desconto ?? 0), 0)
          : this.agendamentos.filter(a => a.status === 'realizado' && a.data.startsWith(chave)).length;
        return {
          tipo: m.tipo,
          progresso,
          valorAlvo: m.valorAlvo,
          percentual: m.valorAlvo > 0 ? Math.round((progresso / m.valorAlvo) * 100) : 0,
        };
      });
  }

  get nomeMesAtual(): string {
    return this.nomesMeses[Number(this.hoje.slice(5, 7)) - 1];
  }

  get diasRestantesNoMes(): number {
    const [ano, mes, dia] = this.hoje.split('-').map(Number);
    return new Date(ano, mes, 0).getDate() - dia;
  }

  // =====================================================================
  //  AUXILIARES
  // =====================================================================

  /** Valor em R$, ou "R$ ••••" com os valores ocultos. */
  moeda(valor: number): string {
    return dinheiro(valor);
  }

  private nomeCliente(id: number): string {
    return this.clientes.find(c => c.id === id)?.nome ?? 'Cliente removido';
  }

  private nomeCurto(nome: string): string {
    const partes = nome.trim().split(/\s+/);
    return partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1].charAt(0)}.` : partes[0];
  }

  private servico(id: number): Servico | undefined {
    return this.servicos.find(s => s.id === id);
  }

  private duracao(id: number): number {
    return this.servico(id)?.duracao || 30;
  }

  private linkWhatsapp(telefone: string | null | undefined, texto: string): string | null {
    let numero = String(telefone || '').replace(/\D/g, '');
    if (!numero) return null;
    if (numero.length <= 11) numero = `55${numero}`;
    return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
  }

  private paraMinutos(hhmm: string): number {
    const [h, m] = String(hhmm).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  }

  private dataCurta(data: string): string {
    const [, mes, dia] = data.split('-');
    return `${dia}/${mes}`;
  }

  private formatarData(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
