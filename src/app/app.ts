import { Component, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterOutlet, RouterLink, NavigationEnd } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { filter } from 'rxjs/operators';
import { MenuLateral } from './components/menu-lateral/menu-lateral';
import { Cabecalho } from './components/cabecalho/cabecalho';

/**
 * Endereço da API, usado por todas as telas.
 * - Rodando com "ng serve" (porta 4200): a API está em localhost:3001.
 * - No Render: o mesmo servidor entrega o site e a API, então basta "/api".
 */
export const API_URL = window.location.port === '4200' ? 'http://localhost:3001/api' : '/api';

// dados usados nas sugestões da busca do cabeçalho
interface Cliente { id: number; nome: string; telefone: string | null; }
interface Servico { id: number; nome: string; valor: number; duracaoMin: number; }
interface Agendamento { id: number; observacao: string; }

const DIAS_SEMANA_BUSCA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/**
 * "14/10" ou "14/10/2026" → '2026-10-14' (sem ano = ano atual). null se não for uma data válida.
 * Usado na busca do cabeçalho e na tela de resultados.
 */
export function interpretarData(texto: string): string | null {
  const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  let ano = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (ano < 100) ano += 2000;
  const d = new Date(ano, mes - 1, dia);
  if (d.getMonth() !== mes - 1 || d.getDate() !== dia) return null; // ex.: 31/02
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** "14:00", "9:30" ou "14h" → '14:00'. null se não for um horário. */
export function interpretarHora(texto: string): string | null {
  const m = texto.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2})|h(\d{2})?)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// =====================================================================
//  HORÁRIO DE TRABALHO (Perfil › Horário de trabalho)
//  O mesmo cálculo serve para a Início, a Agenda, o calendário e a busca:
//  expediente do dia − pausa do almoço − folgas/feriados (tabela bloqueios).
// =====================================================================
export interface DiaTrabalho {
  ativo: boolean;
  inicio: string;       // 'HH:mm' (abre)
  fim: string;          // 'HH:mm' (fecha)
  pausaInicio: string;  // '' = sem pausa
  pausaFim: string;
}

/** Folga ou feriado. Sem horas = o dia inteiro fica fechado. */
export interface Bloqueio {
  id: number;
  data: string;               // 'YYYY-MM-DD'
  horaInicio: string | null;
  horaFim: string | null;
  descricao: string;          // "Finados", "Véspera de Natal"...
}

export interface HorarioTrabalho {
  blocoMin: number;       // tamanho de cada horário (15, 30 ou 60 min)
  dias: DiaTrabalho[];    // dias[0] = domingo ... dias[6] = sábado
  bloqueios: Bloqueio[];  // de hoje em diante
}

/** Um pedaço do dia em que não dá para agendar (pausa ou bloqueio), em minutos. */
export interface Intervalo { ini: number; fim: number; motivo: string; }

/** O dia de trabalho já calculado, em minutos desde 00:00. */
export interface Expediente { inicio: number; fim: number; pausas: Intervalo[]; }

const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function paraMinutosHora(hhmm: string): number {
  const [h, m] = String(hhmm).split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/** Padrão: segunda a sábado, 08:00 às 18:00, domingo fechado, horários de 30 min. */
export function horarioPadrao(): HorarioTrabalho {
  const dia = (ativo: boolean): DiaTrabalho => ({ ativo, inicio: '08:00', fim: '18:00', pausaInicio: '', pausaFim: '' });
  return { blocoMin: 30, dias: [dia(false), dia(true), dia(true), dia(true), dia(true), dia(true), dia(true)], bloqueios: [] };
}

/**
 * Aceita a resposta inteira de GET /api/horario-trabalho ({ horario, bloqueios })
 * e devolve sempre um horário válido (o que faltar vem do padrão).
 */
export function normalizarHorarioTrabalho(resposta: unknown): HorarioTrabalho {
  const padrao = horarioPadrao();
  const r = (resposta && typeof resposta === 'object' ? resposta : {}) as { horario?: unknown; bloqueios?: unknown };
  const b = (r.horario && typeof r.horario === 'object' ? r.horario : {}) as { blocoMin?: unknown; dias?: unknown };

  const dias = padrao.dias.map((d, i) => {
    const salvo = Array.isArray(b.dias) ? (b.dias[i] as Record<string, unknown> | undefined) : undefined;
    if (!salvo || typeof salvo !== 'object') return d;
    const hora = (campo: string, reserva: string) => (HORA_VALIDA.test(String(salvo[campo])) ? String(salvo[campo]) : reserva);
    const pausaInicio = hora('pausaInicio', '');
    const pausaFim = hora('pausaFim', '');
    return {
      ativo: typeof salvo['ativo'] === 'boolean' ? (salvo['ativo'] as boolean) : d.ativo,
      inicio: hora('inicio', d.inicio),
      fim: hora('fim', d.fim),
      // pausa só vale com as duas horas
      pausaInicio: pausaInicio && pausaFim ? pausaInicio : '',
      pausaFim: pausaInicio && pausaFim ? pausaFim : '',
    };
  });

  const bloqueios = Array.isArray(r.bloqueios)
    ? (r.bloqueios as Bloqueio[]).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.data)))
    : [];

  const bloco = [15, 30, 45, 60].includes(Number(b.blocoMin)) ? Number(b.blocoMin) : padrao.blocoMin;
  return { blocoMin: bloco, dias, bloqueios };
}

/** Folga/feriado que fecha o dia inteiro (ou null). */
export function bloqueioDoDiaInteiro(horario: HorarioTrabalho | null, data: string): Bloqueio | null {
  return horario?.bloqueios.find(b => b.data === data && !b.horaInicio) || null;
}

/**
 * Expediente do dia, ou null se não trabalha (dia da semana desmarcado
 * ou folga do dia inteiro). As pausas já vêm em ordem.
 */
export function expedienteDoDia(horario: HorarioTrabalho | null, data: string): Expediente | null {
  if (!horario) return null;
  const [ano, mes, dia] = data.split('-').map(Number);
  const config = horario.dias[new Date(ano, mes - 1, dia).getDay()];
  if (!config || !config.ativo || bloqueioDoDiaInteiro(horario, data)) return null;

  const pausas: Intervalo[] = [];
  if (config.pausaInicio && config.pausaFim) {
    pausas.push({ ini: paraMinutosHora(config.pausaInicio), fim: paraMinutosHora(config.pausaFim), motivo: 'Pausa' });
  }
  for (const b of horario.bloqueios) {
    if (b.data === data && b.horaInicio && b.horaFim) {
      pausas.push({ ini: paraMinutosHora(b.horaInicio), fim: paraMinutosHora(b.horaFim), motivo: b.descricao || 'Bloqueado' });
    }
  }
  pausas.sort((x, y) => x.ini - y.ini);
  return { inicio: paraMinutosHora(config.inicio), fim: paraMinutosHora(config.fim), pausas };
}

/** Minutos de trabalho de verdade no dia (sem as pausas e bloqueios). Usado na Ocupação. */
export function minutosDeTrabalho(exp: Expediente | null): number {
  if (!exp) return 0;
  let total = exp.fim - exp.inicio;
  let cursor = exp.inicio;
  for (const p of exp.pausas) {
    const ini = Math.max(p.ini, cursor);
    const fim = Math.min(p.fim, exp.fim);
    if (fim > ini) total -= fim - ini;
    cursor = Math.max(cursor, fim);
  }
  return Math.max(0, total);
}

// =====================================================================
//  TEMA DE CORES (personalização feita pelo usuário no Perfil)
//  O usuário escolhe só a COR BASE (matiz H + saturação S). O resto da
//  paleta é calculado no styles.css pela harmonia complementar dividida:
//  acento = H + 150°, destaque = H + 210°.
// =====================================================================
export interface TemaCores {
  id: string;   // o que vai para o banco (usuarios.paleta): 'salvia', 'oceano'... ou 'personalizada'
  nome: string;
  h: number; // matiz, 0–359 (posição no círculo cromático)
  s: number; // saturação da cor base, em %
}

export const TEMA_PADRAO: TemaCores = { id: 'salvia', nome: 'Sálvia', h: 100, s: 12 };

export const TEMAS_PRONTOS: TemaCores[] = [
  TEMA_PADRAO,
  { id: 'oceano', nome: 'Oceano', h: 200, s: 22 },
  { id: 'lavanda', nome: 'Lavanda', h: 265, s: 18 },
  { id: 'rose', nome: 'Rosé', h: 340, s: 20 },
  { id: 'terracota', nome: 'Terracota', h: 15, s: 28 },
  { id: 'grafite', nome: 'Grafite', h: 220, s: 8 },
];

/**
 * Aparência do negócio, salva no banco (Perfil › Aparência, só o dono).
 * Vem junto com o usuário no login e fica no localStorage ("usuarioLogado").
 * O atendente recebe a do dono: a cor vale para a equipe toda.
 */
export interface Aparencia {
  paleta: string;               // id do tema
  corPrimaria: string | null;   // '#rrggbb' quando paleta = 'personalizada'
  tamanhoTexto: 'normal' | 'grande';
}

export const APARENCIA_PADRAO: Aparencia = { paleta: 'salvia', corPrimaria: null, tamanhoTexto: 'normal' };

/** Aparência guardada junto com o usuário logado (ou a padrão). */
export function aparenciaSalva(): Aparencia {
  try {
    const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || 'null');
    const a = usuario?.aparencia;
    if (a && typeof a.paleta === 'string') {
      return { paleta: a.paleta, corPrimaria: a.corPrimaria || null, tamanhoTexto: a.tamanhoTexto === 'grande' ? 'grande' : 'normal' };
    }
  } catch {}
  return APARENCIA_PADRAO;
}

/** Guarda a aparência no usuário logado (depois de salvar no Perfil ou de buscar na API). */
export function guardarAparencia(aparencia: Aparencia) {
  try {
    const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || 'null');
    if (!usuario) return;
    usuario.aparencia = aparencia;
    localStorage.setItem('usuarioLogado', JSON.stringify(usuario));
  } catch {}
}

/** Aparência → tema de cores (paleta pronta ou cor personalizada). */
export function temaDaAparencia(aparencia: Aparencia | null | undefined): TemaCores {
  if (!aparencia) return TEMA_PADRAO;
  if (aparencia.paleta === 'personalizada' && aparencia.corPrimaria && /^#[0-9a-f]{6}$/i.test(aparencia.corPrimaria)) {
    return temaDeHex(aparencia.corPrimaria);
  }
  return TEMAS_PRONTOS.find(t => t.id === aparencia.paleta) || TEMA_PADRAO;
}

/** Cores + tamanho do texto no sistema todo. */
export function aplicarAparencia(aparencia: Aparencia | null | undefined) {
  aplicarTema(temaDaAparencia(aparencia));
  aplicarTamanhoTexto(aparencia?.tamanhoTexto === 'grande' ? 'grande' : 'normal');
}

/** "Grande" aumenta a fonte base (html), e tudo que usa rem cresce junto. */
export function aplicarTamanhoTexto(tamanho: 'normal' | 'grande') {
  document.documentElement.classList.toggle('texto-grande', tamanho === 'grande');
}

/** Tema atual do usuário logado (usado pelo Perfil ao abrir). */
export function carregarTemaSalvo(): TemaCores {
  return temaDaAparencia(aparenciaSalva());
}

/** Troca as variáveis do styles.css; todas as cores derivadas se recalculam sozinhas. */
export function aplicarTema(tema: TemaCores) {
  const raiz = document.documentElement.style;
  raiz.setProperty('--tema-h', String(Math.round(tema.h)));
  raiz.setProperty('--tema-s', `${Math.round(tema.s)}%`);
}

/**
 * Converte uma cor escolhida no seletor (#rrggbb) em matiz + saturação.
 * A saturação é limitada entre 6% e 30% para o sistema continuar com tom
 * suave e com contraste bom (a luminosidade é sempre controlada pelo CSS).
 */
export function temaDeHex(hex: string): TemaCores {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const s = d === 0 ? 0 : (d / (1 - Math.abs(2 * l - 1))) * 100;

  return { id: 'personalizada', nome: 'Personalizada', h: Math.round(h), s: Math.round(Math.min(30, Math.max(6, s))) };
}

/** Caminho inverso (para mostrar a cor base atual no seletor de cor). */
export function hexDoTema(tema: TemaCores, luminosidade = 35): string {
  const s = tema.s / 100;
  const l = luminosidade / 100;
  const k = (n: number) => (n + tema.h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const paraHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${paraHex(f(0))}${paraHex(f(8))}${paraHex(f(4))}`;
}

/** Contraste entre uma cor e o branco (regra WCAG: texto normal precisa de 4,5:1). */
export function contrasteComBranco(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminancia = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  return 1.05 / (luminancia + 0.05);
}

// =====================================================================
//  OCULTAR VALORES (vale para o sistema todo: Início, Financeiro, Agenda,
//  Metas e sininho). Começa SEMPRE oculto: a cada login e a cada aba nova.
//  O estado fica no sessionStorage, que é separado por aba e some quando
//  a aba é fechada; ao passar pela tela de login ele volta para "oculto".
// =====================================================================
const CHAVE_OCULTAR = 'meufluxo_ocultar_valores';

function lerValoresOcultos(): boolean {
  try {
    return sessionStorage.getItem(CHAVE_OCULTAR) !== 'nao';
  } catch {
    return true;
  }
}

/** true = valores em R$ aparecem como "R$ ••••". As telas leem com valoresOcultos(). */
export const valoresOcultos = signal<boolean>(lerValoresOcultos());

/** Botão "Ocultar valores" / "Mostrar valores" (Início e Financeiro usam o mesmo estado). */
export function alternarValoresOcultos() {
  const ocultar = !valoresOcultos();
  valoresOcultos.set(ocultar);
  try {
    sessionStorage.setItem(CHAVE_OCULTAR, ocultar ? 'sim' : 'nao');
  } catch {}
}

/** Volta para o padrão (oculto). Chamado ao entrar na tela de login. */
export function reiniciarValoresOcultos() {
  try {
    sessionStorage.removeItem(CHAVE_OCULTAR);
  } catch {}
  valoresOcultos.set(true);
}

/** Valor em reais respeitando o "Ocultar valores": "R$ 80,00" ou "R$ ••••". */
export function dinheiro(valor: number | null | undefined): string {
  if (valoresOcultos()) return 'R$ ••••';
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Esconde os valores que vêm prontos num texto (ex.: avisos "R$ 180,00 a receber..."). */
export function esconderValoresNoTexto(texto: string): string {
  return valoresOcultos() ? texto.replace(/R\$\s?[\d.,]+/g, 'R$ ••••') : texto;
}

/** Um aviso do sininho e do card "Precisa da sua atenção" (vem de GET /api/alertas). */
export interface Alerta {
  id: string;
  tipo: string;
  cor: 'aviso' | 'perigo' | 'agendado' | 'sucesso';
  texto: string;
  acao: { rotulo: string; link?: string; whatsapp?: string | null } | null;
  notificacaoId?: number;
}

/** O que fazer ao clicar na ação de um aviso (usado no sininho e na Início). */
export function abrirAcaoDoAlerta(alerta: Alerta, router: Router, http: HttpClient) {
  // notificação gravada (novo agendamento, novo cliente...): ao abrir, conta como lida
  if (alerta.notificacaoId) {
    const headers = new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('meufluxo_token')}` });
    http.put(`${API_URL}/alertas/notificacoes/${alerta.notificacaoId}/lida`, {}, { headers }).subscribe({ error: () => {} });
  }
  if (alerta.acao?.whatsapp) {
    window.open(alerta.acao.whatsapp, '_blank');
  } else if (alerta.acao?.link) {
    router.navigateByUrl(alerta.acao.link);
  }
}

/** Uma sugestão da busca do cabeçalho (clicar abre a tela /busca). */
interface SugestaoBusca {
  tipo: 'Cliente' | 'Serviço' | 'Agendamento' | 'Dia' | 'Horário';
  titulo: string;
  queryParams: Record<string, string>;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, MenuLateral, Cabecalho],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  mostrarLayout = true;
  menuUsuarioAberto = false;
  sininhoAberto = false;
  alertas: Alerta[] = [];
  papel: 'dono' | 'atendente' = 'dono';
  termoBusca = '';
  nomeUsuario = 'Usuário';
  fotoUsuario: string | null = null; // foto do Perfil (no lugar da inicial)
  private aparenciaAtualizada = false;

  sugestoes: SugestaoBusca[] = [];
  buscaAberta = false;

  private clientesCache: Cliente[] = [];
  private servicosCache: Servico[] = [];
  private agendamentosCache: Agendamento[] = [];
  private dadosBuscaCarregados = false;

  private rotasSemLayout = ['/', '/login', '/cadastro'];

  constructor(private router: Router, private http: HttpClient) {
    this.carregarUsuario();
    this.atualizarMostrarLayout(this.router.url);
    this.carregarDadosBusca();
    this.atualizarAparencia();

    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = (event as NavigationEnd).urlAfterRedirects;
        this.atualizarMostrarLayout(url);
        this.carregarUsuario();
        this.carregarDadosBusca();
        this.carregarAlertas();
        this.atualizarAparencia();
      });
  }

  /** O Perfil avisa quando troca o nome ou a foto: o cabeçalho atualiza na hora. */
  @HostListener('window:meufluxo-usuario')
  aoMudarUsuario() {
    this.carregarUsuario();
  }

  /**
   * Busca a aparência do negócio uma vez por abertura do sistema.
   * Assim o atendente recebe na hora a cor que o dono escolheu.
   */
  private atualizarAparencia() {
    const token = localStorage.getItem('meufluxo_token');
    if (this.aparenciaAtualizada || !token || !this.mostrarLayout) return;
    this.aparenciaAtualizada = true;
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    this.http.get<{ aparencia: Aparencia }>(`${API_URL}/usuarios/aparencia`, { headers }).subscribe({
      next: (resposta) => {
        const aparencia = resposta?.aparencia;
        if (!aparencia || typeof aparencia.paleta !== 'string') return; // resposta inesperada: fica a atual
        guardarAparencia(aparencia);
        if (this.mostrarLayout) aplicarAparencia(aparencia);
      },
      error: () => (this.aparenciaAtualizada = false),
    });
  }

  private atualizarMostrarLayout(url: string) {
    const caminhoLimpo = url.split('#')[0].split('?')[0];
    this.mostrarLayout = !this.rotasSemLayout.includes(caminhoLimpo);

    // tela de login/cadastro/anúncio: o próximo login começa com os valores ocultos
    if (!this.mostrarLayout) reiniciarValoresOcultos();

    // telas públicas (anúncio, login, cadastro) usam sempre as cores padrão da marca;
    // dentro do sistema, vale a aparência do negócio (Perfil › Aparência)
    aplicarAparencia(this.mostrarLayout ? aparenciaSalva() : APARENCIA_PADRAO);
  }

  get primeiroNomeUsuario(): string {
    return this.nomeUsuario.trim().split(' ')[0] || 'Usuário';
  }

  /** "Dono" ou "Atendente", embaixo do nome no cabeçalho. */
  get papelUsuario(): string {
    return this.papel === 'atendente' ? 'Atendente' : 'Dono';
  }

  get inicialUsuario(): string {
    return this.nomeUsuario ? this.nomeUsuario.charAt(0).toUpperCase() : 'U';
  }

  private carregarUsuario() {
    const salvo = localStorage.getItem('usuarioLogado');
    if (salvo) {
      const usuario = JSON.parse(salvo);
      this.nomeUsuario = usuario.nome || 'Usuário';
      this.papel = usuario.papel === 'atendente' ? 'atendente' : 'dono';
      this.fotoUsuario = usuario.foto || null;
    }
  }

  toggleMenuUsuario(event: Event) {
    event.stopPropagation();
    this.menuUsuarioAberto = !this.menuUsuarioAberto;
    this.sininhoAberto = false;
  }

  @HostListener('document:click')
  fecharMenuUsuario() {
    this.menuUsuarioAberto = false;
    this.buscaAberta = false;
    this.sininhoAberto = false;
  }

  // =====================================================================
  //  SININHO (avisos)
  // =====================================================================

  /** Recarrega os avisos a cada troca de tela (é uma consulta leve). */
  private carregarAlertas() {
    const token = localStorage.getItem('meufluxo_token');
    if (!token || !this.mostrarLayout) {
      this.alertas = [];
      return;
    }
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    this.http.get<{ alertas: Alerta[] }>(`${API_URL}/alertas`, { headers }).subscribe({
      next: ({ alertas }) => (this.alertas = alertas || []),
      error: () => (this.alertas = []),
    });
  }

  /** Texto do aviso, escondendo os R$ quando "Ocultar valores" está ligado. */
  textoAlerta(texto: string): string {
    return esconderValoresNoTexto(texto);
  }

  alternarSininho() {
    this.sininhoAberto = !this.sininhoAberto;
    this.menuUsuarioAberto = false;
    if (this.sininhoAberto) this.carregarAlertas();
  }

  abrirAlerta(alerta: Alerta) {
    this.sininhoAberto = false;
    if (alerta.notificacaoId) this.alertas = this.alertas.filter(a => a.id !== alerta.id);
    abrirAcaoDoAlerta(alerta, this.router, this.http);
  }

  // =====================================================================
  //  BUSCA DO CABEÇALHO (sugestões enquanto digita → tela /busca)
  // =====================================================================

  private carregarDadosBusca() {
    if (this.dadosBuscaCarregados) return;
    const token = localStorage.getItem('meufluxo_token');
    if (!token || !this.mostrarLayout) return;

    this.dadosBuscaCarregados = true;
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    forkJoin({
      clientes: this.http.get<{ clientes: Cliente[] }>(`${API_URL}/clientes`, { headers }),
      servicos: this.http.get<{ servicos: Servico[] }>(`${API_URL}/servicos`, { headers }),
      agendamentos: this.http.get<{ agendamentos: Agendamento[] }>(`${API_URL}/agendamentos`, { headers }),
    }).subscribe({
      next: ({ clientes, servicos, agendamentos }) => {
        this.clientesCache = clientes.clientes;
        this.servicosCache = servicos.servicos;
        this.agendamentosCache = agendamentos.agendamentos;
        if (this.termoBusca.trim()) this.aoDigitarBusca();
      },
      error: (erro) => {
        console.error('Não foi possível carregar os dados da busca.', erro);
        this.dadosBuscaCarregados = false;
      },
    });
  }

  /** O atendente sem acesso ao Financeiro não vê preços nas sugestões. */
  private get veValores(): boolean {
    try {
      const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
      return usuario.papel !== 'atendente' || (usuario.permissoes || []).includes('financeiro');
    } catch {
      return false;
    }
  }

  /**
   * Monta até 5 sugestões, cada uma com o tipo:
   *  "14/10" → Dia · "14:00" → Horário · nome/telefone → Cliente ·
   *  nome de serviço → Serviço · texto nas observações → Agendamento
   */
  aoDigitarBusca() {
    const termo = this.termoBusca.trim();
    if (!termo) {
      this.sugestoes = [];
      this.buscaAberta = false;
      return;
    }
    const minusculo = termo.toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    const sugestoes: SugestaoBusca[] = [];

    const data = interpretarData(termo);
    if (data) {
      const [ano, mes, dia] = data.split('-').map(Number);
      const nomeDia = DIAS_SEMANA_BUSCA[new Date(ano, mes - 1, dia).getDay()];
      sugestoes.push({ tipo: 'Dia', titulo: `${nomeDia}, ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`, queryParams: { q: termo, tipo: 'dia' } });
    }

    const hora = interpretarHora(termo);
    if (hora) {
      sugestoes.push({ tipo: 'Horário', titulo: `${hora} nos próximos dias`, queryParams: { q: hora, tipo: 'horario' } });
    }

    if (!data && !hora) {
      for (const c of this.clientesCache) {
        const porNome = c.nome.toLowerCase().includes(minusculo);
        const porTelefone = digitos.length >= 3 && String(c.telefone || '').replace(/\D/g, '').includes(digitos);
        if (porNome || porTelefone) {
          sugestoes.push({
            tipo: 'Cliente',
            titulo: c.telefone ? `${c.nome} · ${c.telefone}` : c.nome,
            queryParams: { q: c.nome, tipo: 'cliente', id: String(c.id) },
          });
        }
      }

      for (const s of this.servicosCache) {
        if (s.nome.toLowerCase().includes(minusculo)) {
          const preco = this.veValores ? `${dinheiro(s.valor)} · ` : '';
          sugestoes.push({
            tipo: 'Serviço',
            titulo: `${s.nome} · ${preco}${s.duracaoMin} min`,
            queryParams: { q: s.nome, tipo: 'servico', id: String(s.id) },
          });
        }
      }

      const nasObservacoes = this.agendamentosCache.filter(a => (a.observacao || '').toLowerCase().includes(minusculo)).length;
      if (nasObservacoes > 0) {
        sugestoes.push({
          tipo: 'Agendamento',
          titulo: `"${termo}" em observações (${nasObservacoes})`,
          queryParams: { q: termo, procurar: 'agendamentos' },
        });
      }
    }

    this.sugestoes = sugestoes.slice(0, 5);
    this.buscaAberta = true;
  }

  onFocusBusca() {
    // recarrega os dados em segundo plano (pode ter cliente ou serviço novo)
    this.dadosBuscaCarregados = false;
    this.carregarDadosBusca();
    if (this.termoBusca.trim()) this.buscaAberta = true;
  }

  /** Enter: abre a tela de resultados com o que foi digitado. */
  buscarTudo() {
    const termo = this.termoBusca.trim();
    if (!termo) return;
    this.abrirBusca({ q: termo });
  }

  irParaSugestao(sugestao: SugestaoBusca) {
    this.abrirBusca(sugestao.queryParams);
  }

  private abrirBusca(queryParams: Record<string, string>) {
    this.buscaAberta = false;
    this.termoBusca = '';
    this.sugestoes = [];
    this.router.navigate(['/busca'], { queryParams });
  }

  sair() {
    localStorage.removeItem('usuarioLogado');
    localStorage.removeItem('meufluxo_token');
    this.dadosBuscaCarregados = false;
    this.clientesCache = [];
    this.servicosCache = [];
    this.agendamentosCache = [];
    this.alertas = [];
    this.fotoUsuario = null;
    this.aparenciaAtualizada = false;
    this.router.navigate(['/login']);
  }
}
