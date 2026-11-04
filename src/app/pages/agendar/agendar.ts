import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';

import { API_URL, Aparencia, aplicarAparencia, linkWhatsappPronto } from '../../app';

/**
 * Página pública de agendamento: /agendar/:slug (sem login, feita para celular).
 * 4 etapas: Serviço · Horário · Seus dados · Pronto.
 * Os dados vêm de /api/publico/:slug (o back-end confere tudo de novo ao gravar).
 *
 * A mesma página abre o link "Confirmar presença" do lembrete: /confirmar/:token.
 * Nesse modo o cliente vê o próprio horário e pode confirmar, cancelar ou remarcar
 * (a remarcação reaproveita a etapa Horário). Dados em /api/publico/horario/:token.
 */
interface Negocio { nome: string; descricao: string; endereco: string; foto: string | null; telefone?: string; aparencia: Aparencia; }
/** O horário do cliente no link de confirmação. */
interface MeuHorario {
  cliente: string;
  servico: string;
  valor: number;
  duracao: number;
  data: string;
  horario: string;
  status: 'agendado' | 'realizado' | 'cancelado' | 'nao_compareceu';
  confirmado: boolean;
  passou: boolean;
  podeMudar: boolean; // RN16: só com 2h ou mais de antecedência
}
interface ServicoPublico { id: number; nome: string; valor: number; duracao: number; }
interface DiaPublico { data: string; sigla: string; livres: number; }
type Etapa = 'servico' | 'horario' | 'dados' | 'pronto' | 'meu';

const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

@Component({
  selector: 'app-agendar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './agendar.html',
  styleUrl: './agendar.css',
})
export class Agendar implements OnInit {
  slug = '';
  carregando = true;
  erroPagina = '';
  erro = '';
  enviando = false;

  negocio: Negocio | null = null;
  servicos: ServicoPublico[] = [];

  readonly etapas: { id: Etapa; rotulo: string }[] = [
    { id: 'servico', rotulo: 'Serviço' },
    { id: 'horario', rotulo: 'Horário' },
    { id: 'dados', rotulo: 'Seus dados' },
    { id: 'pronto', rotulo: 'Pronto' },
  ];
  etapa: Etapa = 'servico';

  servico: ServicoPublico | null = null;
  dias: DiaPublico[] = [];
  carregandoDias = false;
  dia: DiaPublico | null = null;
  horarios: string[] = [];
  carregandoHorarios = false;
  horario = '';

  nome = '';
  telefone = '';
  aceite = false;
  site = ''; // armadilha para robôs (fica escondida)
  mostrarPrivacidade = false;

  /** Dia lotado → "Entrar na lista de espera" (vira a etapa "Seus dados" com outro botão). */
  modoEspera = false;
  mensagemEspera = '';

  /** Link "Confirmar presença" (/confirmar/:token). */
  token = '';
  meuHorario: MeuHorario | null = null;
  remarcando = false;
  perguntandoCancelar = false;
  aviso = '';

  constructor(private route: ActivatedRoute, private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (this.token) {
      this.carregarMeuHorario();
      return;
    }
    this.slug = this.route.snapshot.paramMap.get('slug') || '';
    this.http.get<{ negocio: Negocio; servicos: ServicoPublico[] }>(`${API_URL}/publico/${encodeURIComponent(this.slug)}`).subscribe({
      next: ({ negocio, servicos }) => {
        this.negocio = negocio;
        this.servicos = servicos;
        this.carregando = false;
        aplicarAparencia(negocio.aparencia); // a página usa as cores do negócio
        document.title = `Agendar · ${negocio.nome}`;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.carregando = false;
        this.erroPagina = erro?.error?.erro || 'Não foi possível abrir a página de agendamento.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  TEXTOS
  // =====================================================================
  get iniciais(): string {
    const partes = (this.negocio?.nome || '').trim().split(/\s+/);
    return ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
  }

  get subtituloNegocio(): string {
    return [this.negocio?.descricao, this.negocio?.endereco].filter(Boolean).join(' · ');
  }

  /** Botão "Falar no WhatsApp" do topo: abre o WhatsApp do salão (telefone do Meu perfil). */
  get linkWhatsappNegocio(): string | null {
    const n = this.negocio;
    if (!n?.telefone) return null;
    const h = this.meuHorario;
    const texto = h
      ? `Olá! Sobre o meu horário de ${h.servico} em ${this.diaPorExtenso(h.data)} às ${h.horario}: `
      : `Olá! Vim pelo link de agendamento do ${n.nome}.`;
    return linkWhatsappPronto(n.telefone, texto);
  }

  indiceEtapa(e: Etapa): number {
    return this.etapas.findIndex(x => x.id === e);
  }

  preco(valor: number): string {
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: valor % 1 ? 2 : 0 });
  }

  numeroDoDia(data: string): string {
    return String(Number(data.slice(8, 10)));
  }

  /** "quarta, 14/10" */
  diaPorExtenso(data: string): string {
    const [ano, mes, dia] = data.split('-').map(Number);
    return `${DIAS_LONGOS[new Date(ano, mes - 1, dia).getDay()]}, ${data.slice(8, 10)}/${data.slice(5, 7)}`;
  }

  /** "Sexta" (para "Sexta está lotada") */
  nomeDoDia(data: string): string {
    const [ano, mes, dia] = data.split('-').map(Number);
    const nome = DIAS_LONGOS[new Date(ano, mes - 1, dia).getDay()];
    return nome.charAt(0).toUpperCase() + nome.slice(1);
  }

  get diasLotados(): DiaPublico[] {
    return this.dias.filter(d => d.livres === 0);
  }

  // =====================================================================
  //  LINK "CONFIRMAR PRESENÇA" (/confirmar/:token)
  // =====================================================================
  private get urlDoHorario(): string {
    return `${API_URL}/publico/horario/${encodeURIComponent(this.token)}`;
  }

  private carregarMeuHorario() {
    this.http.get<{ negocio: Negocio; horario: MeuHorario }>(this.urlDoHorario).subscribe({
      next: (resposta) => {
        this.negocio = resposta.negocio;
        this.mostrarMeuHorario(resposta.horario);
        this.carregando = false;
        aplicarAparencia(resposta.negocio.aparencia);
        document.title = `Seu horário · ${resposta.negocio.nome}`;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.carregando = false;
        this.erroPagina = erro?.error?.erro || 'Não foi possível abrir o seu horário.';
        this.cdr.markForCheck();
      },
    });
  }

  /** Guarda o horário e deixa serviço, dia e hora prontos (usados no resumo e no "Adicionar à agenda"). */
  private mostrarMeuHorario(h: MeuHorario) {
    this.meuHorario = h;
    this.servico = { id: 0, nome: h.servico, valor: h.valor, duracao: h.duracao };
    this.dia = { data: h.data, sigla: '', livres: 1 };
    this.horario = h.horario;
    this.remarcando = false;
    this.perguntandoCancelar = false;
    this.etapa = 'meu';
  }

  /** Texto e cor do selo do horário. */
  get seloMeuHorario(): { texto: string; cor: 'ok' | 'espera' | 'cancelado' } {
    const h = this.meuHorario;
    if (!h) return { texto: '', cor: 'espera' };
    if (h.status === 'cancelado') return { texto: 'Cancelado', cor: 'cancelado' };
    if (h.status === 'realizado') return { texto: 'Atendimento realizado', cor: 'ok' };
    if (h.status === 'nao_compareceu' || h.passou) return { texto: 'Esse horário já passou', cor: 'cancelado' };
    return h.confirmado ? { texto: 'Presença confirmada ✓', cor: 'ok' } : { texto: 'Aguardando sua confirmação', cor: 'espera' };
  }

  /** Ações do link: confirmar, cancelar ou remarcar. Todas devolvem o horário atualizado. */
  private enviarAcao(acao: 'confirmar' | 'cancelar' | 'remarcar', corpo: object, aviso: string) {
    this.enviando = true;
    this.erro = '';
    this.http.post<{ horario: MeuHorario }>(`${this.urlDoHorario}/${acao}`, corpo).subscribe({
      next: ({ horario }) => {
        this.enviando = false;
        this.mostrarMeuHorario(horario);
        this.aviso = aviso;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.enviando = false;
        this.erro = erro?.error?.erro || 'Não foi possível concluir. Tente de novo.';
        // remarcando e o horário foi ocupado: recarrega os horários do dia
        if (acao === 'remarcar' && erro?.status === 409 && this.dia) this.escolherDia(this.dia);
        this.cdr.markForCheck();
      },
    });
  }

  confirmarPresenca() {
    this.enviarAcao('confirmar', {}, 'Obrigado! O salão já sabe que você vem 😊');
  }

  cancelarHorario() {
    this.enviarAcao('cancelar', {}, 'Horário cancelado. Obrigado por avisar!');
  }

  /** Abre a etapa Horário (mesmo serviço) para escolher o novo dia e hora. */
  remarcarHorario() {
    if (!this.servico) return;
    this.remarcando = true;
    this.aviso = '';
    this.escolherServico(this.servico);
  }

  // =====================================================================
  //  ETAPAS
  // =====================================================================

  /** Endereço de dias e horários: o do salão (slug) ou o do horário (remarcar pelo link). */
  private urlDaAgenda(caminho: 'dias' | 'horarios'): string {
    return this.remarcando ? `${this.urlDoHorario}/${caminho}` : `${API_URL}/publico/${encodeURIComponent(this.slug)}/${caminho}`;
  }

  escolherServico(s: ServicoPublico) {
    this.servico = s;
    this.dia = null;
    this.horario = '';
    this.horarios = [];
    this.erro = '';
    this.etapa = 'horario';
    this.carregandoDias = true;
    this.http.get<{ dias: DiaPublico[] }>(this.urlDaAgenda('dias'), { params: { servicoId: s.id } }).subscribe({
      next: ({ dias }) => {
        this.dias = dias;
        this.carregandoDias = false;
        // já abre no primeiro dia com horário livre
        const primeiro = dias.find(d => d.livres > 0);
        if (primeiro) this.escolherDia(primeiro);
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.carregandoDias = false;
        this.erro = erro?.error?.erro || 'Não foi possível carregar os dias.';
        this.cdr.markForCheck();
      },
    });
  }

  escolherDia(d: DiaPublico) {
    if (d.livres === 0 || !this.servico) return;
    this.dia = d;
    this.horario = '';
    this.carregandoHorarios = true;
    this.http.get<{ horarios: string[] }>(this.urlDaAgenda('horarios'), {
      params: { servicoId: this.servico.id, data: d.data },
    }).subscribe({
      next: ({ horarios }) => {
        this.horarios = horarios;
        this.carregandoHorarios = false;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.carregandoHorarios = false;
        this.erro = erro?.error?.erro || 'Não foi possível carregar os horários.';
        this.cdr.markForCheck();
      },
    });
  }

  continuar() {
    if (!this.dia || !this.horario) return;
    if (this.remarcando) {
      this.enviarAcao('remarcar', { data: this.dia.data, horario: this.horario }, 'Remarcado! Seu novo horário já está confirmado.');
      return;
    }
    this.modoEspera = false;
    this.erro = '';
    this.etapa = 'dados';
  }

  /** Dia lotado: pede nome e WhatsApp para entrar na lista de espera desse dia. */
  entrarNaEspera(d: DiaPublico) {
    this.dia = d;
    this.horario = '';
    this.modoEspera = true;
    this.erro = '';
    this.etapa = 'dados';
  }

  voltar() {
    this.erro = '';
    if (this.remarcando && this.meuHorario) this.mostrarMeuHorario(this.meuHorario);
    else if (this.etapa === 'dados') this.etapa = 'horario';
    else if (this.etapa === 'horario') this.etapa = 'servico';
  }

  confirmar() {
    if (!this.servico || !this.dia) return;
    this.erro = '';
    const digitos = this.telefone.replace(/\D/g, '');
    if (this.nome.trim().length < 2) { this.erro = 'Digite o seu nome.'; return; }
    if (digitos.length < 10) { this.erro = 'Digite o seu WhatsApp com DDD.'; return; }
    if (!this.aceite) { this.erro = 'Marque a caixa para aceitar receber as mensagens sobre o agendamento.'; return; }

    const corpo = {
      nome: this.nome.trim(),
      telefone: this.telefone,
      servicoId: this.servico.id,
      data: this.dia.data,
      horario: this.horario,
      aceite: this.aceite,
      site: this.site,
    };
    this.enviando = true;
    const url = `${API_URL}/publico/${encodeURIComponent(this.slug)}/${this.modoEspera ? 'espera' : 'agendar'}`;
    this.http.post<{ mensagem?: string }>(url, corpo).subscribe({
      next: (resposta) => {
        this.enviando = false;
        this.mensagemEspera = this.modoEspera ? (resposta.mensagem || '') : '';
        this.etapa = 'pronto';
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.enviando = false;
        this.erro = erro?.error?.erro || 'Não foi possível concluir. Tente de novo.';
        // o horário foi ocupado: volta para escolher outro
        if (erro?.status === 409 && this.dia) {
          this.etapa = 'horario';
          this.escolherDia(this.dia);
        }
        this.cdr.markForCheck();
      },
    });
  }

  /** "Adicionar à agenda do celular": baixa um arquivo .ics (abre no Google Agenda / Calendário). */
  adicionarAoCalendario() {
    if (!this.servico || !this.dia || !this.horario) return;
    const [ano, mes, dia] = this.dia.data.split('-').map(Number);
    const [h, m] = this.horario.split(':').map(Number);
    const inicio = new Date(ano, mes - 1, dia, h, m);
    const fim = new Date(inicio.getTime() + this.servico.duracao * 60000);
    const formato = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const texto = (t: string) => t.replace(/[,;\\]/g, (c) => `\\${c}`);
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MeuFluxo//Agendamento//PT-BR',
      'BEGIN:VEVENT',
      `UID:${Date.now()}@meufluxo`,
      `DTSTAMP:${formato(new Date())}`,
      `DTSTART:${formato(inicio)}`,
      `DTEND:${formato(fim)}`,
      `SUMMARY:${texto(`${this.servico.nome} · ${this.negocio?.nome || ''}`)}`,
      `LOCATION:${texto(this.negocio?.endereco || '')}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agendamento.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  novoAgendamento() {
    this.servico = null;
    this.dia = null;
    this.horario = '';
    this.modoEspera = false;
    this.erro = '';
    this.etapa = 'servico';
  }
}