import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';

import { API_URL, Aparencia, aplicarAparencia } from '../../app';

/**
 * Página pública de agendamento: /agendar/:slug (sem login, feita para celular).
 * 4 etapas: Serviço · Horário · Seus dados · Pronto.
 * Os dados vêm de /api/publico/:slug (o back-end confere tudo de novo ao gravar).
 */
interface Negocio { nome: string; descricao: string; endereco: string; foto: string | null; aparencia: Aparencia; }
interface ServicoPublico { id: number; nome: string; valor: number; duracao: number; }
interface DiaPublico { data: string; sigla: string; livres: number; }
type Etapa = 'servico' | 'horario' | 'dados' | 'pronto';

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

  constructor(private route: ActivatedRoute, private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
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
  //  ETAPAS
  // =====================================================================
  escolherServico(s: ServicoPublico) {
    this.servico = s;
    this.dia = null;
    this.horario = '';
    this.horarios = [];
    this.erro = '';
    this.etapa = 'horario';
    this.carregandoDias = true;
    this.http.get<{ dias: DiaPublico[] }>(`${API_URL}/publico/${encodeURIComponent(this.slug)}/dias`, { params: { servicoId: s.id } }).subscribe({
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
    this.http.get<{ horarios: string[] }>(`${API_URL}/publico/${encodeURIComponent(this.slug)}/horarios`, {
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
    if (this.etapa === 'dados') this.etapa = 'horario';
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
