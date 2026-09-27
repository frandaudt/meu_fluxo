import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterOutlet, RouterLink, NavigationEnd } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { filter } from 'rxjs/operators';
import { MenuLateral } from './components/menu-lateral/menu-lateral';
import { Cabecalho } from './components/cabecalho/cabecalho';

const API_URL = 'http://localhost:3001/api';

interface Cliente { id: number; nome: string; }
interface Servico { id: number; nome: string; valor: number; }
interface Agendamento { id: number; clienteId: number; servicoId: number; data: string; horario: string; }
interface MetaMensal { id: number; mes: string; tipo: 'faturamento' | 'clientes'; }

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

    forkJoin({
      clientes: this.http.get<{ clientes: Cliente[] }>(`${API_URL}/clientes`, { headers }),
      servicos: this.http.get<{ servicos: Servico[] }>(`${API_URL}/servicos`, { headers }),
      agendamentos: this.http.get<{ agendamentos: Agendamento[] }>(`${API_URL}/agendamentos`, { headers }),
      metasMensais: this.http.get<{ metas: MetaMensal[] }>(`${API_URL}/metas/mensais`, { headers }),
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
    this.dadosBuscaCarregados = false;
    this.clientesCache = [];
    this.servicosCache = [];
    this.agendamentosCache = [];
    this.metasCache = [];
    this.router.navigate(['/login']);
  }
}