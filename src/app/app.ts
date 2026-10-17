import { Component, HostListener } from '@angular/core';
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

interface Cliente { id: number; nome: string; }
interface Servico { id: number; nome: string; valor: number; }
interface Agendamento { id: number; clienteId: number; servicoId: number; data: string; horario: string; }
interface MetaMensal { id: number; mes: string; tipo: 'faturamento' | 'clientes'; }

export interface TemaCores {
  nome: string;
  h: number; // matiz, 0–359 (posição no círculo cromático)
  s: number; // saturação da cor base, em %
}

export const TEMA_PADRAO: TemaCores = { nome: 'Sálvia', h: 100, s: 12 };

export const TEMAS_PRONTOS: TemaCores[] = [
  TEMA_PADRAO,
  { nome: 'Oceano', h: 200, s: 22 },
  { nome: 'Lavanda', h: 265, s: 18 },
  { nome: 'Rosé', h: 340, s: 20 },
  { nome: 'Terracota', h: 15, s: 28 },
  { nome: 'Grafite', h: 220, s: 8 },
];

/** Cada conta tem o seu tema, guardado no navegador pelo e-mail do usuário. */
function chaveTema(): string | null {
  try {
    const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || 'null');
    return usuario?.email ? `meufluxo_tema_${usuario.email}` : null;
  } catch {
    return null;
  }
}

export function carregarTemaSalvo(): TemaCores {
  const chave = chaveTema();
  if (!chave) return TEMA_PADRAO;
  try {
    const salvo = JSON.parse(localStorage.getItem(chave) || 'null');
    if (salvo && typeof salvo.h === 'number' && typeof salvo.s === 'number') {
      return { nome: String(salvo.nome || 'Personalizada'), h: salvo.h, s: salvo.s };
    }
  } catch {}
  return TEMA_PADRAO;
}

export function salvarTema(tema: TemaCores) {
  const chave = chaveTema();
  if (chave) localStorage.setItem(chave, JSON.stringify(tema));
}

/** Troca as variáveis do styles.css; todas as cores derivadas se recalculam sozinhas. */
export function aplicarTema(tema: TemaCores) {
  const raiz = document.documentElement.style;
  raiz.setProperty('--tema-h', String(Math.round(tema.h)));
  raiz.setProperty('--tema-s', `${Math.round(tema.s)}%`);
}

/**
 * Converte uma cor escolhida no seletor (#rrggbb) em matiz + saturação.
 * A saturação fica entre 6% e 30% para o sistema continuar com tom suave
 * e com bom contraste (a luminosidade é sempre controlada pelo CSS).
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

  return { nome: 'Personalizada', h: Math.round(h), s: Math.round(Math.min(30, Math.max(6, s))) };
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

interface ResultadoBusca {
  tipo: string;
  titulo: string;
  subtitulo: string;
  rota: string[];
  queryParams?: Record<string, string>;
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
  termoBusca = '';
  nomeUsuario = 'Usuário';

  resultadosBusca: ResultadoBusca[] = [];
  buscaAberta = false;

  private clientesCache: Cliente[] = [];
  private servicosCache: Servico[] = [];
  private agendamentosCache: Agendamento[] = [];
  private metasCache: MetaMensal[] = [];
  private dadosBuscaCarregados = false;

  private readonly rotulosMeta: Record<string, string> = { faturamento: 'Faturamento', clientes: 'Clientes' };

  private rotasSemLayout = ['/', '/login', '/cadastro'];

  constructor(private router: Router, private http: HttpClient) {
    this.carregarUsuario();
    this.atualizarMostrarLayout(this.router.url);
    this.carregarDadosBusca();

    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = (event as NavigationEnd).urlAfterRedirects;
        this.atualizarMostrarLayout(url);
        this.carregarUsuario();
        this.carregarDadosBusca();
      });
  }

 private atualizarMostrarLayout(url: string) {
    const caminhoLimpo = url.split('#')[0].split('?')[0];
    this.mostrarLayout = !this.rotasSemLayout.includes(caminhoLimpo);

    aplicarTema(this.mostrarLayout ? carregarTemaSalvo() : TEMA_PADRAO);
  }

  get primeiroNomeUsuario(): string {
    return this.nomeUsuario.trim().split(' ')[0] || 'Usuário';
  }

  get inicialUsuario(): string {
    return this.nomeUsuario ? this.nomeUsuario.charAt(0).toUpperCase() : 'U';
  }

  private carregarUsuario() {
    const salvo = localStorage.getItem('usuarioLogado');
    if (salvo) {
      const usuario = JSON.parse(salvo);
      this.nomeUsuario = usuario.nome || 'Usuário';
    }
  }

  toggleMenuUsuario(event: Event) {
    event.stopPropagation();
    this.menuUsuarioAberto = !this.menuUsuarioAberto;
  }

  @HostListener('document:click')
  fecharMenuUsuario() {
    this.menuUsuarioAberto = false;
    this.buscaAberta = false;
  }

  // =====================================================================
  //  BUSCA GERAL (clientes, serviços, agendamentos, metas)
  // =====================================================================

  private carregarDadosBusca() {
    if (this.dadosBuscaCarregados) return;
    const token = localStorage.getItem('meufluxo_token');
    if (!token) return;

    this.dadosBuscaCarregados = true;
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
        // metas são só do dono: para o atendente a API responde 403, então nem pede
    const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
    const ehDono = usuario.papel !== 'atendente';

    forkJoin({
      clientes: this.http.get<{ clientes: Cliente[] }>(`${API_URL}/clientes`, { headers }),
      servicos: this.http.get<{ servicos: Servico[] }>(`${API_URL}/servicos`, { headers }),
      agendamentos: this.http.get<{ agendamentos: Agendamento[] }>(`${API_URL}/agendamentos`, { headers }),
      metasMensais: ehDono
        ? this.http.get<{ metas: MetaMensal[] }>(`${API_URL}/metas/mensais`, { headers })
        : of({ metas: [] as MetaMensal[] }),
    }).subscribe({
      next: ({ clientes, servicos, agendamentos, metasMensais }) => {
        this.clientesCache = clientes.clientes;
        this.servicosCache = servicos.servicos;
        this.agendamentosCache = agendamentos.agendamentos;
        this.metasCache = metasMensais.metas;
      },
      error: (erro) => {
        console.error('Não foi possível carregar os dados da busca.', erro);
        this.dadosBuscaCarregados = false;
      },
    });
  }

  private nomeClienteBusca(id: number): string {
    return this.clientesCache.find(c => c.id === id)?.nome ?? '';
  }

  private nomeServicoBusca(id: number): string {
    return this.servicosCache.find(s => s.id === id)?.nome ?? '';
  }

  private formatarDataBusca(data: string): string {
    const [ano, mes, dia] = data.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  aoDigitarBusca() {
    const termo = this.termoBusca.trim().toLowerCase();

    if (!termo) {
      this.resultadosBusca = [];
      this.buscaAberta = false;
      return;
    }

    const resultados: ResultadoBusca[] = [];

    for (const c of this.clientesCache) {
      if (c.nome.toLowerCase().includes(termo)) {
        resultados.push({
          tipo: 'Cliente',
          titulo: c.nome,
          subtitulo: 'Cliente',
          rota: ['/clientes'],
          queryParams: { busca: c.nome },
        });
      }
    }

    for (const s of this.servicosCache) {
      if (s.nome.toLowerCase().includes(termo)) {
        resultados.push({
          tipo: 'Serviço',
          titulo: s.nome,
          subtitulo: `R$ ${s.valor.toFixed(2)}`,
          rota: ['/servicos'],
          queryParams: { busca: s.nome },
        });
      }
    }

    for (const a of this.agendamentosCache) {
      const nomeCliente = this.nomeClienteBusca(a.clienteId);
      const nomeServico = this.nomeServicoBusca(a.servicoId);
      if (nomeCliente.toLowerCase().includes(termo) || nomeServico.toLowerCase().includes(termo)) {
        resultados.push({
          tipo: 'Agendamento',
          titulo: `${nomeCliente} · ${nomeServico}`,
          subtitulo: `${this.formatarDataBusca(a.data)} às ${a.horario}`,
          rota: ['/agenda'],
        });
      }
    }

    for (const m of this.metasCache) {
      const nomeMeta = `Meta de ${this.rotulosMeta[m.tipo] ?? m.tipo}`;
      if (nomeMeta.toLowerCase().includes(termo)) {
        resultados.push({
          tipo: 'Meta',
          titulo: nomeMeta,
          subtitulo: m.mes,
          rota: ['/metas'],
        });
      }
    }

    this.resultadosBusca = resultados.slice(0, 8);
    this.buscaAberta = true;
  }

  onFocusBusca() {
    if (this.termoBusca.trim() && this.resultadosBusca.length > 0) {
      this.buscaAberta = true;
    }
  }

  selecionarPrimeiroResultado() {
    if (this.resultadosBusca.length > 0) {
      this.irParaResultado(this.resultadosBusca[0]);
    }
  }

  irParaResultado(resultado: ResultadoBusca) {
    this.buscaAberta = false;
    this.termoBusca = '';
    this.resultadosBusca = [];
    this.router.navigate(resultado.rota, resultado.queryParams ? { queryParams: resultado.queryParams } : {});
  }

  sair() {
    localStorage.removeItem('usuarioLogado');
    localStorage.removeItem('meufluxo_token');
    this.dadosBuscaCarregados = false;
    this.clientesCache = [];
    this.servicosCache = [];
    this.agendamentosCache = [];
    this.metasCache = [];
    this.router.navigate(['/login']);
  }
}