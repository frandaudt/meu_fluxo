import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin } from 'rxjs';

import { API_URL, dinheiro } from '../../app';

// =====================================================================
//  TIPOS (exportados: a tela de Busca usa os mesmos cálculos)
// =====================================================================

export interface Cliente {
  id: number;
  nome: string;
  telefone: string;
  email: string | null;
  endereco: string | null;
  origem: 'sistema' | 'whatsapp' | 'link' | 'importacao';
  criadoEm: string | null; // 'YYYY-MM-DD HH:mm:ss'
}

export interface ServicoCRM { id: number; nome: string; valor: number; duracao: number; }

export interface AgendamentoCRM {
  id: number;
  clienteId: number;
  servicoId: number;
  data: string;    // 'YYYY-MM-DD'
  horario: string; // 'HH:mm'
  status: 'agendado' | 'realizado' | 'cancelado' | 'nao_compareceu';
  observacao: string;
  origem: 'sistema' | 'whatsapp' | 'link' | 'lista_espera';
  criadoEm: string | null;
  valorCobrado: number | null;
  desconto: number;
  formaPagamento: 'dinheiro' | 'pix' | 'debito' | 'credito' | null;
  statusPagamento: 'pendente' | 'pago';
  pagoEm: string | null;
  recebidoPorNome: string | null;
  canceladoPor: 'cliente' | 'profissional' | null;
  motivoCancelamento: string;
}

export type Situacao = 'novo' | 'fiel' | 'ativo' | 'em_risco' | 'inativo';

/** Tudo o que a ficha e a tabela mostram sobre um cliente. */
export interface ResumoCliente {
  visitas: number;              // atendimentos realizados (dias diferentes)
  ultimaVisita: string | null;  // 'YYYY-MM-DD'
  proximaVisita: string | null; // próximo agendamento marcado
  prevista: string | null;      // sem próximo marcado: última visita + ritmo
  atrasada: boolean;            // a prevista já passou
  ritmo: number | null;         // "volta a cada X dias"
  diasSemVir: number | null;
  totalGasto: number;           // soma do que foi pago
  faltas: number;
  cancelamentos: number;
  situacao: Situacao;
  servicoFavorito: { nome: string; vezes: number } | null;
  horarioPreferido: string | null; // "sábado de manhã"
  formaPreferida: string | null;   // "Pix"
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  novo: 'Novo',
  fiel: 'Fiel',
  ativo: 'Ativo',
  em_risco: 'Em risco',
  inativo: 'Inativo',
};

const ROTULO_FORMA: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito' };
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// =====================================================================
//  CÁLCULOS DO CRM (classificação automática)
//    Novo     = 1 atendimento realizado (ou nenhum ainda)
//    Fiel     = 3 ou mais atendimentos nos últimos 6 meses
//    Em risco = dias sem vir > 1,5 × ritmo (com só 1 visita: mais de 30 dias)
//    Inativo  = mais de 90 dias sem vir
//    Ativo    = os demais (veio 2 vezes, está dentro do ritmo...)
//  Quem já tem um horário marcado não fica "em risco" nem "inativo".
// =====================================================================

export function diasEntre(inicio: string, fim: string): number {
  const [a1, m1, d1] = inicio.split('-').map(Number);
  const [a2, m2, d2] = fim.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Valor recebido de um atendimento (valor cobrado − desconto). */
export function valorRecebido(a: AgendamentoCRM): number {
  return Math.max(0, Number(a.valorCobrado ?? 0) - Number(a.desconto ?? 0));
}

/** O item que mais aparece numa lista (e quantas vezes). */
function maisComum(lista: string[]): { valor: string; vezes: number } | null {
  const contagem = new Map<string, number>();
  for (const item of lista) contagem.set(item, (contagem.get(item) || 0) + 1);
  let melhor: { valor: string; vezes: number } | null = null;
  for (const [valor, vezes] of contagem) {
    if (!melhor || vezes > melhor.vezes) melhor = { valor, vezes };
  }
  return melhor;
}

export function resumoDoCliente(
  clienteId: number,
  agendamentos: AgendamentoCRM[],
  servicos: ServicoCRM[],
  hoje = hojeISO()
): ResumoCliente {
  const doCliente = agendamentos.filter(a => a.clienteId === clienteId);
  const realizados = doCliente.filter(a => a.status === 'realizado').sort((a, b) => a.data.localeCompare(b.data));
  const datas = [...new Set(realizados.map(a => a.data))]; // vários no mesmo dia = 1 visita
  const ultimaVisita = datas.length ? datas[datas.length - 1] : null;

  const proximo = doCliente
    .filter(a => a.status === 'agendado' && a.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data) || a.horario.localeCompare(b.horario))[0];

  const ritmo = datas.length > 1
    ? Math.max(1, Math.round(diasEntre(datas[0], datas[datas.length - 1]) / (datas.length - 1)))
    : null;
  const diasSemVir = ultimaVisita ? diasEntre(ultimaVisita, hoje) : null;

  const prevista = !proximo && ultimaVisita && ritmo ? somarDias(ultimaVisita, ritmo) : null;

  // ----- situação -----
  const seisMesesAtras = somarDias(hoje, -182);
  const visitasRecentes = datas.filter(d => d >= seisMesesAtras).length;
  let situacao: Situacao;
  if (datas.length === 0) situacao = 'novo';
  else if (!proximo && diasSemVir! > 90) situacao = 'inativo';
  else if (!proximo && (ritmo ? diasSemVir! > 1.5 * ritmo : diasSemVir! > 30)) situacao = 'em_risco';
  else if (visitasRecentes >= 3) situacao = 'fiel';
  else if (datas.length === 1) situacao = 'novo';
  else situacao = 'ativo';

  // ----- preferências -----
  const favorito = maisComum(realizados.map(a => String(a.servicoId)));
  const nomeFavorito = favorito ? servicos.find(s => s.id === Number(favorito.valor))?.nome : null;

  const turnos = realizados.map(a => {
    const [ano, mes, dia] = a.data.split('-').map(Number);
    const hora = Number(a.horario.slice(0, 2));
    const turno = hora < 12 ? 'de manhã' : hora < 18 ? 'à tarde' : 'à noite';
    return `${DIAS_SEMANA[new Date(ano, mes - 1, dia).getDay()]} ${turno}`;
  });
  const horario = maisComum(turnos);

  const forma = maisComum(realizados.filter(a => a.formaPagamento).map(a => a.formaPagamento as string));

  return {
    visitas: datas.length,
    ultimaVisita,
    proximaVisita: proximo ? proximo.data : null,
    prevista,
    atrasada: !!prevista && prevista < hoje,
    ritmo,
    diasSemVir,
    totalGasto: realizados.filter(a => a.statusPagamento === 'pago').reduce((s, a) => s + valorRecebido(a), 0),
    faltas: doCliente.filter(a => a.status === 'nao_compareceu').length,
    cancelamentos: doCliente.filter(a => a.status === 'cancelado').length,
    situacao,
    servicoFavorito: favorito && nomeFavorito ? { nome: nomeFavorito, vezes: favorito.vezes } : null,
    horarioPreferido: horario ? horario.valor : null,
    formaPreferida: forma ? ROTULO_FORMA[forma.valor] : null,
  };
}

/** Link do WhatsApp do aparelho com a mensagem pronta (wa.me). */
export function linkWhatsapp(telefone: string | null | undefined, texto: string): string | null {
  let numero = String(telefone || '').replace(/\D/g, '');
  if (!numero) return null;
  if (numero.length <= 11) numero = `55${numero}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/** Mensagem "Sentimos sua falta" (cliente em risco ou inativo). */
export function mensagemSaudade(nome: string, servico: string | null): string {
  const primeiroNome = nome.trim().split(/\s+/)[0];
  const oQue = servico ? `seu ${servico.toLowerCase()}` : 'um horário';
  return `Oi ${primeiroNome}, faz um tempinho que você não aparece por aqui! Quer agendar ${oQue}?`;
}

/** "16/10" */
export function dataCurta(data: string | null): string {
  if (!data) return '—';
  const [, mes, dia] = data.split('-');
  return `${dia}/${mes}`;
}

// =====================================================================
//  JORNADA DO CLIENTE (linha do tempo da ficha)
// =====================================================================

interface EventoJornada {
  data: string;        // para ordenar ('YYYY-MM-DD')
  titulo: string;
  detalhe: string;
  cor: 'sucesso' | 'perigo' | 'aviso' | 'agendado' | 'neutro';
}

type FiltroSituacao = 'todos' | Situacao;

interface LinhaTabela {
  cliente: Cliente;
  resumo: ResumoCliente;
}

@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clientes.html',
  styleUrl: './clientes.css',
})
export class ClientesComponent implements OnInit {
  carregando = true;
  erro: string | null = null;

  clientes: Cliente[] = [];
  servicos: ServicoCRM[] = [];
  agendamentos: AgendamentoCRM[] = [];

  linhas: LinhaTabela[] = [];
  termoBusca = '';
  filtro: FiltroSituacao = 'todos';

  // ----- janela "Novo / Editar cliente" -----
  modalAberto = false;
  salvando = false;
  erroModal: string | null = null;
  editandoId: number | null = null;
  novoCliente = { nome: '', telefone: '', email: '', endereco: '' };
  private readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ----- ficha (janela "Visualizar") -----
  ficha: LinhaTabela | null = null;
  jornada: EventoJornada[] = [];

  /** Dono, ou atendente com acesso ao Financeiro: vê o "Total gasto". */
  veValores = true;
  /** Excluir cliente: dono, ou atendente com a permissão "excluirClientes". */
  podeExcluir = true;

  readonly filtros: { valor: FiltroSituacao; rotulo: string }[] = [
    { valor: 'todos', rotulo: 'Todos' },
    { valor: 'novo', rotulo: 'Novos' },
    { valor: 'fiel', rotulo: 'Fiéis' },
    { valor: 'em_risco', rotulo: 'Em risco' },
    { valor: 'inativo', rotulo: 'Inativos' },
  ];
  readonly rotuloSituacao = ROTULO_SITUACAO;
  readonly nomesMeses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
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

    try {
      const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
      const permissoes: string[] = Array.isArray(usuario.permissoes) ? usuario.permissoes : [];
      const ehAtendente = usuario.papel === 'atendente';
      this.veValores = !ehAtendente || permissoes.includes('financeiro');
      this.podeExcluir = !ehAtendente || permissoes.includes('excluirClientes');
    } catch {}

    const headers = this.cabecalhoAuth();
    forkJoin({
      clientes: this.http.get<{ clientes: Cliente[] }>(`${API_URL}/clientes`, { headers }),
      servicos: this.http.get<{ servicos: { id: number; nome: string; valor: number; duracaoMin: number }[] }>(`${API_URL}/servicos`, { headers }),
      agendamentos: this.http.get<{ agendamentos: AgendamentoCRM[] }>(`${API_URL}/agendamentos`, { headers }),
    }).subscribe({
      next: (r) => {
        this.clientes = r.clientes.clientes;
        this.servicos = r.servicos.servicos.map(s => ({ id: s.id, nome: s.nome, valor: s.valor, duracao: s.duracaoMin }));
        this.agendamentos = r.agendamentos.agendamentos;
        this.montarLinhas();
        this.carregando = false;

        // vindo de outra tela: /clientes?busca=Ana  ou  /clientes?ficha=12
        const params = this.route.snapshot.queryParamMap;
        if (params.get('busca')) this.termoBusca = params.get('busca')!;
        const fichaId = Number(params.get('ficha'));
        if (fichaId) this.abrirFicha(fichaId);
        if (params.get('busca') || fichaId) {
          this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        }
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.carregando = false;
        this.erro = 'Não foi possível carregar os clientes.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  TABELA, BUSCA E FILTROS
  // =====================================================================

  private montarLinhas() {
    const hoje = hojeISO();
    this.linhas = this.clientes.map(cliente => ({
      cliente,
      resumo: resumoDoCliente(cliente.id, this.agendamentos, this.servicos, hoje),
    }));
  }

  /** "65 clientes · 9 novos este mês · 7 em risco" */
  get resumoTopo(): string {
    const mes = hojeISO().slice(0, 7);
    const total = this.clientes.length;
    const novosMes = this.clientes.filter(c => (c.criadoEm || '').startsWith(mes)).length;
    const emRisco = this.linhas.filter(l => l.resumo.situacao === 'em_risco').length;
    return `${total} ${total === 1 ? 'cliente' : 'clientes'} · ${novosMes} ${novosMes === 1 ? 'novo' : 'novos'} este mês · ${emRisco} em risco`;
  }

  quantos(filtro: FiltroSituacao): number {
    return filtro === 'todos' ? this.linhas.length : this.linhas.filter(l => l.resumo.situacao === filtro).length;
  }

  get linhasFiltradas(): LinhaTabela[] {
    const termo = this.termoBusca.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    return this.linhas
      .filter(l => this.filtro === 'todos' || l.resumo.situacao === this.filtro)
      .filter(l => {
        if (!termo) return true;
        if (l.cliente.nome.toLowerCase().includes(termo)) return true;
        return digitos.length >= 3 && String(l.cliente.telefone || '').replace(/\D/g, '').includes(digitos);
      });
  }

  textoOrigem(c: Cliente): string {
    if (c.origem === 'whatsapp') return 'cadastrado pelo WhatsApp';
    if (c.origem === 'link') return 'cadastrado pelo link';
    if (c.origem === 'importacao') return 'importado';
    return 'cadastrado no sistema';
  }

  /** Próxima visita na tabela: a data marcada, ou a prevista ("prevista 21/10" / "atrasada"). */
  textoProxima(r: ResumoCliente): string {
    if (r.proximaVisita) return this.dataComDia(r.proximaVisita);
    if (r.prevista) return r.atrasada ? `atrasada (${dataCurta(r.prevista)})` : `prevista ${dataCurta(r.prevista)}`;
    return '—';
  }

  // =====================================================================
  //  FICHA DO CLIENTE (janela)
  // =====================================================================

  abrirFicha(id: number) {
    const linha = this.linhas.find(l => l.cliente.id === id);
    if (!linha) return;
    this.ficha = linha;
    this.jornada = this.montarJornada(linha);
  }

  fecharFicha() {
    this.ficha = null;
  }

  /** "cliente desde março de 2026" */
  clienteDesde(c: Cliente): string {
    const primeira = this.agendamentos
      .filter(a => a.clienteId === c.id)
      .map(a => a.data)
      .sort()[0];
    const data = [c.criadoEm?.slice(0, 10), primeira].filter(Boolean).sort()[0];
    if (!data) return '';
    const [ano, mes] = data!.split('-').map(Number);
    return `cliente desde ${this.nomesMeses[mes - 1]} de ${ano}`;
  }

  linkSaudade(linha: LinhaTabela): string | null {
    return linkWhatsapp(linha.cliente.telefone, mensagemSaudade(linha.cliente.nome, linha.resumo.servicoFavorito?.nome ?? null));
  }

  chamarNoWhatsapp(linha: LinhaTabela) {
    const link = this.linkSaudade(linha);
    if (link) window.open(link, '_blank');
  }

  /** "Agendar": abre a Agenda com o "Novo agendamento" já com este cliente. */
  agendar(c: Cliente) {
    this.router.navigate(['/agenda'], { queryParams: { novo: hojeISO(), cliente: c.id } });
  }

  editarDaFicha() {
    if (!this.ficha) return;
    const cliente = this.ficha.cliente;
    this.fecharFicha();
    this.abrirModalEdicao(cliente);
  }

  private montarJornada(linha: LinhaTabela): EventoJornada[] {
    const c = linha.cliente;
    const r = linha.resumo;
    const eventos: EventoJornada[] = [];
    const nomeServico = (id: number) => this.servicos.find(s => s.id === id)?.nome ?? 'Serviço removido';
    const ags = this.agendamentos.filter(a => a.clienteId === c.id).sort((a, b) => a.data.localeCompare(b.data));

    ags.forEach((a, i) => {
      const servico = nomeServico(a.servicoId);
      if (a.status === 'realizado') {
        const pago = a.statusPagamento === 'pago';
        const valor = pago
          ? ` · ${this.veValores ? dinheiro(valorRecebido(a)) : 'pago'}${a.formaPagamento ? ' · ' + ROTULO_FORMA[a.formaPagamento] : ''}`
          : ' · a receber';
        eventos.push({
          data: a.data,
          titulo: `${servico}${valor}`,
          detalhe: `Realizado${a.recebidoPorNome ? ' · atendido por ' + a.recebidoPorNome : ''}`,
          cor: 'sucesso',
        });
      } else if (a.status === 'cancelado') {
        const quem = a.canceladoPor === 'profissional' ? 'Cancelado por você' : 'Cancelado pelo cliente';
        const pelo = a.origem === 'whatsapp' ? ' pelo WhatsApp' : '';
        const motivo = a.motivoCancelamento ? ` · "${a.motivoCancelamento}"` : '';
        eventos.push({ data: a.data, titulo: `Cancelou · ${servico}`, detalhe: `${quem}${pelo}${motivo}`, cor: 'perigo' });
      } else if (a.status === 'nao_compareceu') {
        eventos.push({ data: a.data, titulo: `Não compareceu · ${servico}`, detalhe: `Marcado às ${a.horario}`, cor: 'aviso' });
      } else {
        const onde = a.origem === 'whatsapp' ? 'Agendou pelo WhatsApp' : a.origem === 'link' ? 'Agendou pelo link' : 'Agendado';
        eventos.push({ data: a.data, titulo: `${onde} · ${servico}`, detalhe: `Marcado para ${this.dataComDia(a.data)} às ${a.horario}`, cor: 'agendado' });
      }
      if (i === 0 && a.status === 'realizado') {
        eventos.push({ data: a.data, titulo: 'Primeiro atendimento', detalhe: servico, cor: 'neutro' });
      }
    });

    // entrou em "Em risco" (data em que passou de 1,5× o ritmo, ou 30 dias com 1 visita)
    if (r.situacao === 'em_risco' && r.ultimaVisita) {
      const limite = r.ritmo ? Math.ceil(1.5 * r.ritmo) : 31;
      eventos.push({
        data: somarDias(r.ultimaVisita, limite),
        titulo: 'Entrou em "Em risco"',
        detalhe: r.ritmo ? 'Passou de 1,5× o ritmo dele sem voltar' : 'Mais de 30 dias sem voltar',
        cor: 'perigo',
      });
    }

    if (c.criadoEm) {
      const pelo = c.origem === 'whatsapp' ? 'pelo WhatsApp' : c.origem === 'link' ? 'pelo link de agendamento' : 'no sistema';
      eventos.push({ data: c.criadoEm.slice(0, 10), titulo: 'Cadastro', detalhe: `Cadastrado ${pelo}`, cor: 'neutro' });
    }

    // mais recentes primeiro
    return eventos.sort((a, b) => b.data.localeCompare(a.data));
  }

  /** Data da jornada: "hoje", "ontem" ou "04/09". */
  quando(data: string): string {
    const hoje = hojeISO();
    if (data === hoje) return 'hoje';
    if (data === somarDias(hoje, -1)) return 'ontem';
    return dataCurta(data);
  }

  /** "sex 16/10" */
  dataComDia(data: string | null): string {
    if (!data) return '—';
    const [ano, mes, dia] = data.split('-').map(Number);
    const sigla = DIAS_SEMANA[new Date(ano, mes - 1, dia).getDay()].slice(0, 3);
    return `${sigla} ${dataCurta(data)}`;
  }

  dataCurta(data: string | null): string {
    return dataCurta(data);
  }

  valorEmReais(valor: number): string {
    return this.veValores ? dinheiro(valor) : '—';
  }

  iniciais(nome: string): string {
    return nome.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  }

  // =====================================================================
  //  NOVO / EDITAR / EXCLUIR
  // =====================================================================

  abrirModal() {
    this.editandoId = null;
    this.novoCliente = { nome: '', telefone: '', email: '', endereco: '' };
    this.erroModal = null;
    this.modalAberto = true;
  }

  abrirModalEdicao(cliente: Cliente) {
    this.editandoId = cliente.id;
    this.novoCliente = {
      nome: cliente.nome,
      telefone: cliente.telefone || '',
      email: cliente.email || '',
      endereco: cliente.endereco || '',
    };
    this.erroModal = null;
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
    this.editandoId = null;
    this.erroModal = null;
  }

  salvarCliente(event: Event) {
    event.preventDefault();
    this.erroModal = null;

    const digitos = this.novoCliente.telefone.replace(/\D/g, '');
    if (!this.novoCliente.nome.trim()) {
      this.erroModal = 'Preencha o nome do cliente.';
      return;
    }
    if (digitos.length < 10 || this.novoCliente.telefone.length > 20) {
      this.erroModal = 'Informe um telefone válido, com DDD.';
      return;
    }
    if (this.novoCliente.email && !this.EMAIL_REGEX.test(this.novoCliente.email)) {
      this.erroModal = 'Digite um e-mail válido.';
      return;
    }

    this.salvando = true;
    const requisicao = this.editandoId
      ? this.http.put<{ cliente: Cliente }>(`${API_URL}/clientes/${this.editandoId}`, this.novoCliente, { headers: this.cabecalhoAuth() })
      : this.http.post<{ cliente: Cliente }>(`${API_URL}/clientes`, this.novoCliente, { headers: this.cabecalhoAuth() });

    requisicao.subscribe({
      next: ({ cliente }) => {
        const i = this.clientes.findIndex(c => c.id === cliente.id);
        if (i >= 0) this.clientes[i] = cliente;
        else this.clientes.push(cliente);
        this.clientes.sort((a, b) => a.nome.localeCompare(b.nome));
        this.montarLinhas();
        this.salvando = false;
        this.fecharModal();
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.salvando = false;
        this.erroModal = erro?.error?.erro || 'Não foi possível salvar o cliente.';
        this.cdr.markForCheck();
      },
    });
  }

  removerCliente() {
    const id = this.editandoId;
    if (!id) return;
    if (!confirm('Excluir este cliente? Essa ação não pode ser desfeita.')) return;

    this.http.delete(`${API_URL}/clientes/${id}`, { headers: this.cabecalhoAuth() }).subscribe({
      next: () => {
        this.clientes = this.clientes.filter(c => c.id !== id);
        this.montarLinhas();
        this.fecharModal();
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.erroModal = erro?.error?.erro || 'Não foi possível excluir o cliente.';
        this.cdr.markForCheck();
      },
    });
  }
}
