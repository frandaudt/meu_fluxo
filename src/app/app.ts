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
  hAcento?: number;   // personalizada: matiz escolhido para o acento (sem ele, H + 150°)
  hDestaque?: number; // personalizada: matiz escolhido para o destaque (sem ele, H + 210°)
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
  corAcento?: string | null;    // personalizada: null = calculada pelo círculo cromático
  corDestaque?: string | null;  // personalizada: null = calculada pelo círculo cromático
  tamanhoTexto: 'normal' | 'grande';
}

export const APARENCIA_PADRAO: Aparencia = { paleta: 'salvia', corPrimaria: null, corAcento: null, corDestaque: null, tamanhoTexto: 'normal' };

const HEX_VALIDO = /^#[0-9a-f]{6}$/i;

/** Aparência guardada junto com o usuário logado (ou a padrão). */
export function aparenciaSalva(): Aparencia {
  try {
    const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || 'null');
    const a = usuario?.aparencia;
    if (a && typeof a.paleta === 'string') {
      return {
        paleta: a.paleta,
        corPrimaria: a.corPrimaria || null,
        corAcento: a.corAcento || null,
        corDestaque: a.corDestaque || null,
        tamanhoTexto: a.tamanhoTexto === 'grande' ? 'grande' : 'normal',
      };
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
  if (aparencia.paleta === 'personalizada' && aparencia.corPrimaria && HEX_VALIDO.test(aparencia.corPrimaria)) {
    const tema = temaDeHex(aparencia.corPrimaria);
    if (aparencia.corAcento && HEX_VALIDO.test(aparencia.corAcento)) tema.hAcento = temaDeHex(aparencia.corAcento).h;
    if (aparencia.corDestaque && HEX_VALIDO.test(aparencia.corDestaque)) tema.hDestaque = temaDeHex(aparencia.corDestaque).h;
    return tema;
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
  // acento e destaque escolhidos à mão (personalizada); sem eles, vale a conta do styles.css (H + 150° / H + 210°)
  if (tema.hAcento !== undefined) raiz.setProperty('--hue-acento', String(Math.round(tema.hAcento)));
  else raiz.removeProperty('--hue-acento');
  if (tema.hDestaque !== undefined) raiz.setProperty('--hue-destaque', String(Math.round(tema.hDestaque)));
  else raiz.removeProperty('--hue-destaque');
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
//  "CONTINUAR COM GOOGLE" (login e cadastro)
//  O Client ID vem do back-end (GET /api/usuarios/config). Sem ele, o botão
//  não aparece. O Google devolve um "crachá" (credential) que o back-end confere.
// =====================================================================
declare global {
  interface Window { google?: any; }
}

let scriptGoogle: Promise<void> | null = null;

/** Carrega o script do Google uma vez só. */
function carregarScriptGoogle(): Promise<void> {
  if (scriptGoogle) return scriptGoogle;
  scriptGoogle = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { scriptGoogle = null; reject(new Error('Google indisponível')); };
    document.head.appendChild(script);
  });
  return scriptGoogle;
}

/**
 * Desenha o botão "Continuar com Google" dentro do elemento.
 * aoEntrar recebe o credential, que vai para POST /api/usuarios/google.
 * Devolve false se o login com Google não estiver configurado.
 */
export async function mostrarBotaoGoogle(
  elemento: HTMLElement,
  http: HttpClient,
  aoEntrar: (credential: string) => void,
): Promise<boolean> {
  try {
    const config = await new Promise<{ googleClientId: string | null }>((resolve, reject) =>
      http.get<{ googleClientId: string | null }>(`${API_URL}/usuarios/config`).subscribe({ next: resolve, error: reject })
    );
    if (!config.googleClientId) return false;
    await carregarScriptGoogle();
    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: (resposta: { credential: string }) => aoEntrar(resposta.credential),
    });
    window.google.accounts.id.renderButton(elemento, {
      theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale: 'pt-BR',
      width: Math.min(300, elemento.clientWidth || 300),
    });
    return true;
  } catch {
    return false;
  }
}

/** Guarda o login (token + usuário) e decide a primeira tela. */
export function guardarLogin(resposta: { token: string; usuario: any }, router: Router) {
  localStorage.setItem('meufluxo_token', resposta.token);
  localStorage.setItem('usuarioLogado', JSON.stringify(resposta.usuario));
  // atendente com senha provisória: troca a senha antes de usar o sistema
  router.navigate(resposta.usuario?.trocarSenha ? ['/perfil'] : ['/tela-inicial']);
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
  menuAberto = false; // menu lateral no celular
  menuUsuarioAberto = false;
  sininhoAberto = false;
  alertas: Alerta[] = [];
  aguardandoNaLista = 0; // bolinha da "Lista de espera" no menu
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
    carregarMensagensProntas(this.http);

    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = (event as NavigationEnd).urlAfterRedirects;
        this.menuAberto = false; // escolheu uma tela no celular: o menu fecha
        this.atualizarMostrarLayout(url);
        this.carregarUsuario();
        this.carregarDadosBusca();
        this.carregarAlertas();
        this.atualizarAparencia();
        carregarMensagensProntas(this.http); // textos dos botões de WhatsApp (só busca uma vez)
      });
  }

  /** Celular: abre e fecha o menu lateral (no computador o botão nem aparece). */
  alternarMenu(evento: Event) {
    evento.stopPropagation();
    this.menuAberto = !this.menuAberto;
  }

  /** O "Sair" do menu lateral também passa por aqui (mesma limpeza do menu do usuário). */
  @HostListener('window:meufluxo-sair')
  aoSairPeloMenu() {
    this.sair();
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

    // senha provisória (atendente novo ou senha redefinida pelo dono): só o Perfil até trocar
    try {
      const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || 'null');
      const telaInterna = !this.rotasSemLayout.includes(caminhoLimpo) && !caminhoLimpo.startsWith('/agendar/');
      if (usuario?.trocarSenha && telaInterna && caminhoLimpo !== '/perfil') {
        this.router.navigate(['/perfil']);
      }
    } catch {}
    // a página pública de agendamento (/agendar/:slug) também fica sem menu e sem cabeçalho
    this.mostrarLayout = !this.rotasSemLayout.includes(caminhoLimpo) && !caminhoLimpo.startsWith('/agendar/');

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
    this.http.get<{ alertas: Alerta[]; aguardandoNaLista?: number }>(`${API_URL}/alertas`, { headers }).subscribe({
      next: ({ alertas, aguardandoNaLista }) => {
        this.alertas = alertas || [];
        this.aguardandoNaLista = aguardandoNaLista || 0;
      },
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
    // sobras de versões antigas (cor de cada e-mail que já entrou neste navegador)
    try {
      Object.keys(localStorage).filter(k => k.startsWith('meufluxo_tema_')).forEach(k => localStorage.removeItem(k));
    } catch {}
    this.dadosBuscaCarregados = false;
    this.clientesCache = [];
    this.servicosCache = [];
    this.agendamentosCache = [];
    this.alertas = [];
    this.fotoUsuario = null;
    this.aparenciaAtualizada = false;
    esquecerMensagensProntas();
    this.router.navigate(['/login']);
  }
}

// =====================================================================
//  MENSAGENS PRONTAS (tela WhatsApp › "Mensagens prontas por serviço")
//  O dono envia do próprio WhatsApp: o botão abre o wa.me com o texto pronto.
//  Ordem para escolher o texto de um serviço:
//    1. a mensagem salva para o serviço;
//    2. o modelo pronto do serviço (manicure, escova, corte, sobrancelha);
//    3. a mensagem salva no "Padrão (todos)";
//    4. o modelo pronto do Padrão.
// =====================================================================
export type TipoMensagem = 'lembrete' | 'pos' | 'falta' | 'vaga';
export interface MensagemPronta { servicoId: number | null; servicoNome: string | null; tipo: TipoMensagem; texto: string; }

export const TIPOS_MENSAGEM: { tipo: TipoMensagem; titulo: string; usadoEm: string }[] = [
  { tipo: 'lembrete', titulo: 'Lembrete da véspera', usadoEm: 'Botão "Enviar" em Lembretes de amanhã, na Início.' },
  { tipo: 'pos', titulo: 'Depois do atendimento', usadoEm: 'Oferecido ao concluir o atendimento, na Agenda.' },
  { tipo: 'falta', titulo: 'Sentimos sua falta', usadoEm: 'Botão "Chamar no WhatsApp" da ficha do cliente em risco.' },
  { tipo: 'vaga', titulo: 'Abriu uma vaga', usadoEm: 'Botão "Avisar pelo WhatsApp" da Lista de espera.' },
];

type Modelos = Record<TipoMensagem, [string, string]>;

/** Modelos do "Padrão (todos)". */
export const MODELOS_PADRAO: Modelos = {
  lembrete: [
    'Oi {nome}! Lembrando do seu {servico} amanhã ({data}) às {hora}. Responda 1 para confirmar ou 2 para remarcar.',
    'Olá {nome}, passando para lembrar: {servico} amanhã às {hora} no {negocio}. Te esperamos!',
  ],
  pos: [
    'Obrigado pela visita, {nome}! Foi um prazer te atender. Até a próxima 💚',
    'Oi {nome}! O que achou do atendimento hoje? Sua opinião ajuda muito a gente.',
  ],
  falta: [
    'Oi {nome}, faz um tempinho que você não aparece por aqui! Quer agendar seu {servico}? É só responder 2.',
    '{nome}, estamos com saudade! Temos horários livres essa semana. Responda 2 para ver.',
  ],
  vaga: [
    'Boa notícia, {nome}! Abriu um horário para {servico} em {data} às {hora}. Quer? Responda SIM em até 1 hora.',
    'Oi {nome}! Liberou uma vaga para {servico} em {data} às {hora}. Quer que eu reserve para você?',
  ],
};

/** Modelos próprios de alguns serviços (achados pelo nome). Vaga usa sempre o Padrão. */
const MODELOS_POR_SERVICO: { nome: RegExp; modelos: Omit<Modelos, 'vaga'> }[] = [
  {
    nome: /manicure|pedicure|unha/i,
    modelos: {
      lembrete: [
        'Oi {nome}! Amanhã às {hora} é dia de deixar as unhas lindas 💅 Responda 1 para confirmar ou 2 para remarcar.',
        'Olá {nome}, sua manicure está marcada para amanhã ({data}) às {hora}. Até lá!',
      ],
      pos: [
        'Obrigado, {nome}! Dica: evite água quente nas próximas 2 horas para o esmalte durar mais.',
        'Unhas prontas! Hidratar as cutículas todo dia ajuda o resultado a durar mais, {nome} ✨',
      ],
      falta: [
        'Oi {nome}! Já faz um tempinho desde a sua última manicure. Que tal renovar? Responda 2.',
        '{nome}, suas unhas estão com saudade da gente 💅 Temos horários essa semana. Responda 2.',
      ],
    },
  },
  {
    nome: /escova/i,
    modelos: {
      lembrete: [
        'Oi {nome}! Amanhã às {hora} tem escova marcada. Se puder, venha com o cabelo lavado 😉',
        'Olá {nome}, lembrete da sua escova amanhã ({data}) às {hora}. Responda 1 para confirmar.',
      ],
      pos: [
        'Obrigado, {nome}! Para a escova durar mais, prenda o cabelo num coque frouxo para dormir.',
        'Que bom te ver, {nome}! Evite umidade nas próximas horas para manter o liso.',
      ],
      falta: [
        'Oi {nome}! Bateu saudade daquela escova? Responda 2 para ver os horários.',
        '{nome}, que tal um cabelo novo para o fim de semana? Responda 2 e a gente agenda.',
      ],
    },
  },
  {
    nome: /corte|barba/i,
    modelos: {
      lembrete: [
        'Fala, {nome}! Seu corte é amanhã às {hora}. Responda 1 para confirmar ou 2 para remarcar.',
        'Olá {nome}, lembrando do seu corte amanhã ({data}) às {hora}.',
      ],
      pos: [
        'Valeu pela visita, {nome}! Para manter o corte em dia, o ideal é voltar em 3 a 4 semanas.',
        'Corte feito! Qualquer ajuste, é só chamar aqui, {nome}.',
      ],
      falta: [
        '{nome}, já está na hora de dar aquele trato no cabelo? Responda 2 que a gente agenda.',
        'Oi {nome}! Seu último corte foi há um tempinho. Bora marcar? Responda 2.',
      ],
    },
  },
  {
    nome: /sobrancelha/i,
    modelos: {
      lembrete: [
        'Oi {nome}! Seu design de sobrancelha é amanhã às {hora}. Venha sem maquiagem na região 😉',
        'Olá {nome}, lembrete: design de sobrancelha amanhã ({data}) às {hora}.',
      ],
      pos: [
        'Obrigado, {nome}! Evite sol direto e maquiagem na região nas próximas 24 horas.',
        'Sobrancelhas prontas! O retoque ideal é em 15 a 20 dias, {nome}.',
      ],
      falta: [
        'Oi {nome}! Suas sobrancelhas já devem estar pedindo um retoque. Responda 2 para agendar.',
        '{nome}, que tal manter o desenho em dia? Responda 2 e escolha um horário.',
      ],
    },
  },
];

/** Os 2 modelos prontos para o tipo: os do serviço (se ele tiver) ou os do Padrão. */
export function modelosProntos(tipo: TipoMensagem, nomeServico: string | null | undefined): { modelos: [string, string]; doServico: boolean } {
  const proprio = tipo !== 'vaga' && nomeServico ? MODELOS_POR_SERVICO.find(m => m.nome.test(nomeServico)) : undefined;
  return proprio
    ? { modelos: proprio.modelos[tipo as Exclude<TipoMensagem, 'vaga'>], doServico: true }
    : { modelos: MODELOS_PADRAO[tipo], doServico: false };
}

// guardadas uma vez por abertura do sistema (o App busca depois do login)
let mensagensSalvas: MensagemPronta[] = [];
let nomeDoNegocio = '';
let mensagensCarregadas = false;

export function mensagensProntasSalvas(): MensagemPronta[] {
  return mensagensSalvas;
}

/** A tela WhatsApp chama depois de salvar: os botões das outras telas já usam o texto novo. */
export function guardarMensagensProntas(lista: MensagemPronta[]) {
  mensagensSalvas = Array.isArray(lista) ? lista : [];
}

/** Busca as mensagens salvas (uma vez). Sem resposta, as telas usam os modelos prontos. */
export function carregarMensagensProntas(http: HttpClient, forcar = false) {
  const token = localStorage.getItem('meufluxo_token');
  if (!token || (mensagensCarregadas && !forcar)) return;
  mensagensCarregadas = true;
  http.get<{ negocio: string; mensagens: MensagemPronta[] }>(`${API_URL}/whatsapp/mensagens`, {
    headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
  }).subscribe({
    next: (r) => {
      guardarMensagensProntas(r?.mensagens);
      nomeDoNegocio = r?.negocio || '';
    },
    error: () => (mensagensCarregadas = false),
  });
}

/** Ao sair, esquece as mensagens (outra conta pode entrar no mesmo navegador). */
export function esquecerMensagensProntas() {
  mensagensSalvas = [];
  nomeDoNegocio = '';
  mensagensCarregadas = false;
}

/**
 * Texto "Em uso" de um tipo para um serviço (ou para o Padrão, com servico = null).
 * origem: 'salva' (escrita/escolhida pelo dono), 'modelo' (modelo pronto do serviço)
 * ou 'padrao' (vem do Padrão (todos)).
 */
export function mensagemEmUso(
  tipo: TipoMensagem,
  servico: { id?: number | null; nome?: string | null } | null,
): { texto: string; origem: 'salva' | 'modelo' | 'padrao' } {
  const salvas = mensagensSalvas.filter(m => m.tipo === tipo);
  if (servico) {
    const doServico = salvas.find(m => m.servicoId !== null && (
      (servico.id != null && m.servicoId === servico.id) ||
      (!!servico.nome && m.servicoNome?.toLowerCase() === servico.nome.toLowerCase())
    ));
    if (doServico) return { texto: doServico.texto, origem: 'salva' };
    const prontos = modelosProntos(tipo, servico.nome);
    if (prontos.doServico) return { texto: prontos.modelos[0], origem: 'modelo' };
  }
  const padrao = salvas.find(m => m.servicoId === null);
  if (padrao) return { texto: padrao.texto, origem: servico ? 'padrao' : 'salva' };
  return { texto: MODELOS_PADRAO[tipo][0], origem: servico ? 'padrao' : 'modelo' };
}

/** '2026-11-01' → 'sáb 01/11' */
export function diaCurtoMensagem(data: string): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  const sigla = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(ano, mes - 1, dia).getDay()];
  return `${sigla} ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
}

/** Troca {nome}, {servico}, {data}, {hora} e {negocio} pelos valores. */
export function preencherMensagem(texto: string, campos: { nome?: string; servico?: string; data?: string; hora?: string }): string {
  const valores: Record<string, string> = {
    nome: String(campos.nome || '').trim().split(/\s+/)[0],
    servico: String(campos.servico || 'atendimento').toLowerCase(),
    data: campos.data ? diaCurtoMensagem(campos.data) : '',
    hora: campos.hora || '',
    negocio: nomeDoNegocio || 'salão',
  };
  return texto.replace(/\{(nome|servico|data|hora|negocio)\}/g, (_, c) => valores[c]);
}

/** Texto pronto (já preenchido) para mandar ao cliente. */
export function textoMensagemPronta(
  tipo: TipoMensagem,
  servico: { id?: number | null; nome?: string | null } | null,
  campos: { nome?: string; data?: string; hora?: string },
): string {
  return preencherMensagem(mensagemEmUso(tipo, servico).texto, { ...campos, servico: servico?.nome || undefined });
}

/** Link do WhatsApp do aparelho com a mensagem pronta (wa.me). Sem telefone: null. */
export function linkWhatsappPronto(telefone: string | null | undefined, texto: string): string | null {
  let numero = String(telefone || '').replace(/\D/g, '');
  if (!numero) return null;
  if (numero.length <= 11) numero = `55${numero}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}
