import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin } from 'rxjs';

import { API_URL, dinheiro, linkWhatsappPronto, textoMensagemPronta } from '../../app';

/** Uma pessoa na lista de espera (GET /api/lista-espera). Usado também na Agenda, Clientes e Busca. */
export interface EntradaFila {
  id: number;
  clienteId: number;
  clienteNome: string;
  clienteTelefone: string | null;
  servicoId: number;
  servicoNome: string;
  duracao: number;
  valor: number;
  dataPreferida: string | null;     // null = qualquer dia
  horarioPreferido: string | null;  // null = qualquer horário
  periodo: 'manha' | 'tarde' | 'qualquer';
  observacao: string;
  origem: 'sistema' | 'whatsapp' | 'link';
  situacao: 'aguardando' | 'avisado' | 'encaixado' | 'desistiu' | 'expirado';
  criadoEm: string | null;
  saiuEm: string | null;
  agendamentoId: number | null;
  encaixadoEm: { data: string; horario: string } | null;
  vaga: { data: string; horario: string } | null;  // vaga compatível agora
}

export interface RespostaFila {
  aguardando: EntradaFila[];
  historico: EntradaFila[];
  numeros: { aguardando: number; encaixadosMes: number; recuperadoMes: number; desistiramMes: number };
  destaque: { entradaId: number; data: string; horario: string; texto: string; quemCancelou: string | null } | null;
}

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** 'sáb 17/10' */
export function diaCurtoFila(data: string): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  return `${DIAS_CURTOS[new Date(ano, mes - 1, dia).getDay()]} ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

/** "sáb 17/10 · manhã", "qualquer dia · qualquer horário", "qui 22/10 · às 15:00" */
export function textoQuer(e: Pick<EntradaFila, 'dataPreferida' | 'periodo' | 'horarioPreferido'>): { dia: string; quando: string } {
  const dia = e.dataPreferida ? diaCurtoFila(e.dataPreferida) : 'qualquer dia';
  const quando = e.horarioPreferido ? `às ${e.horarioPreferido}`
    : e.periodo === 'manha' ? 'manhã'
    : e.periodo === 'tarde' ? 'tarde'
    : 'qualquer horário';
  return { dia, quando };
}

/** Link do WhatsApp com a mensagem pronta "Abriu uma vaga" (a que está "Em uso" na tela WhatsApp). */
export function linkAvisoVaga(e: EntradaFila, data: string, horario: string): string | null {
  const texto = textoMensagemPronta('vaga', { id: e.servicoId, nome: e.servicoNome }, { nome: e.clienteNome, data, hora: horario });
  return linkWhatsappPronto(e.clienteTelefone, texto);
}

interface Cliente { id: number; nome: string; telefone: string | null; }
interface Servico { id: number; nome: string; duracaoMin: number; valor: number; }

@Component({
  selector: 'app-lista-espera',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lista-espera.html',
  styleUrl: './lista-espera.css',
})
export class ListaEspera implements OnInit {
  carregando = true;
  erro = '';
  mensagem = '';

  aguardando: EntradaFila[] = [];
  historico: EntradaFila[] = [];
  numeros = { aguardando: 0, encaixadosMes: 0, recuperadoMes: 0, desistiramMes: 0 };
  destaque: RespostaFila['destaque'] = null;

  clientes: Cliente[] = [];
  servicos: Servico[] = [];

  /** Atendente sem a caixa "Financeiro" não vê valores em R$. */
  veValores = true;
  ocupado = false; // um botão de ação em andamento (evita clique duplo)

  // ----- modal Adicionar / Editar -----
  modalAberto = false;
  editandoId: number | null = null;
  form = this.formVazio();
  erroModal = '';
  salvando = false;
  buscaCliente = '';

  readonly mesAtual = MESES[new Date().getMonth()];
  readonly hoje = this.formatarData(new Date());

  constructor(
    private http: HttpClient,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
  ) {}

  private headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('meufluxo_token')}` });
  }

  ngOnInit() {
    if (!localStorage.getItem('meufluxo_token')) {
      this.router.navigate(['/login']);
      return;
    }
    try {
      const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
      this.veValores = usuario.papel !== 'atendente' || (usuario.permissoes || []).includes('financeiro');
    } catch {}
    this.carregar(true);
  }

  private carregar(primeiraVez = false) {
    const headers = this.headers();
    forkJoin({
      fila: this.http.get<RespostaFila>(`${API_URL}/lista-espera`, { headers }),
      clientes: this.http.get<{ clientes: Cliente[] }>(`${API_URL}/clientes`, { headers }),
      servicos: this.http.get<{ servicos: Servico[] }>(`${API_URL}/servicos`, { headers }),
    }).subscribe({
      next: ({ fila, clientes, servicos }) => {
        this.aguardando = fila.aguardando;
        this.historico = fila.historico;
        this.numeros = fila.numeros;
        this.destaque = fila.destaque;
        this.clientes = clientes.clientes;
        this.servicos = servicos.servicos;
        this.carregando = false;
        this.erro = '';
        if (primeiraVez) this.abrirPeloEndereco();
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.carregando = false;
        this.erro = erro?.error?.erro || 'Não foi possível carregar a lista de espera.';
        this.cdr.markForCheck();
      },
    });
  }

  /** /lista-espera?novo=1&cliente=3&servico=2&data=2026-10-20 abre o "Adicionar" já preenchido. */
  private abrirPeloEndereco() {
    const p = this.route.snapshot.queryParamMap;
    if (p.get('novo')) {
      this.abrirModal();
      if (p.get('cliente')) this.form.clienteId = Number(p.get('cliente'));
      if (p.get('servico')) this.form.servicoId = Number(p.get('servico'));
      if (p.get('data')) { this.form.qualquerDia = false; this.form.dataPreferida = String(p.get('data')); }
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  // =====================================================================
  //  TEXTOS
  // =====================================================================
  moeda(valor: number): string {
    return dinheiro(valor);
  }

  quer(e: EntradaFila) {
    return textoQuer(e);
  }

  diaCurto(data: string): string {
    return diaCurtoFila(data);
  }

  rotuloOrigem(origem: string): string {
    return origem === 'whatsapp' ? 'WhatsApp' : origem === 'link' ? 'Link' : 'Sistema';
  }

  /** "5 horas", "1 dia", "3 dias" */
  naFilaHa(e: EntradaFila): string {
    if (!e.criadoEm) return '—';
    const desde = new Date(e.criadoEm.replace(' ', 'T'));
    const horas = Math.max(0, Math.floor((Date.now() - desde.getTime()) / 3600000));
    if (horas < 1) return 'agora';
    if (horas < 24) return `${horas} ${horas === 1 ? 'hora' : 'horas'}`;
    const dias = Math.floor(horas / 24);
    return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  }

  /** Linha de detalhe do histórico. */
  detalheHistorico(e: EntradaFila): string {
    if (e.situacao === 'encaixado' && e.encaixadoEm) {
      const esperou = this.diasEntre(e.criadoEm, e.saiuEm);
      return `${this.diaCurto(e.encaixadoEm.data)} às ${e.encaixadoEm.horario} · esperou ${esperou === 0 ? 'menos de 1 dia' : esperou === 1 ? '1 dia' : esperou + ' dias'}`;
    }
    if (e.situacao === 'desistiu') return e.saiuEm ? `removida em ${e.saiuEm.slice(8, 10)}/${e.saiuEm.slice(5, 7)}` : 'removida da fila';
    if (e.situacao === 'expirado' && e.dataPreferida) return `queria ${e.dataPreferida.slice(8, 10)}/${e.dataPreferida.slice(5, 7)} · não abriu vaga`;
    return '';
  }

  rotuloSituacao(e: EntradaFila): string {
    return { encaixado: 'Encaixado', desistiu: 'Desistiu', expirado: 'Expirou', aguardando: 'Aguardando', avisado: 'Avisado' }[e.situacao];
  }

  private diasEntre(de: string | null, ate: string | null): number {
    if (!de || !ate) return 0;
    const a = new Date(de.slice(0, 10) + 'T00:00:00');
    const b = new Date(ate.slice(0, 10) + 'T00:00:00');
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
  }

  get entradaDestaque(): EntradaFila | undefined {
    return this.destaque ? this.aguardando.find(e => e.id === this.destaque!.entradaId) : undefined;
  }

  /** "exatamente esse dia, de manhã" / "qualquer dia, à tarde" */
  get oQueQuerDestaque(): string {
    const e = this.entradaDestaque;
    if (!e) return '';
    const dia = e.dataPreferida ? 'exatamente esse dia' : 'qualquer dia';
    const quando = e.horarioPreferido ? `às ${e.horarioPreferido}`
      : e.periodo === 'manha' ? 'de manhã'
      : e.periodo === 'tarde' ? 'à tarde'
      : 'em qualquer horário';
    return `${dia}, ${quando}`;
  }

  primeiroNome(nome: string): string {
    return nome.trim().split(/\s+/)[0];
  }

  // =====================================================================
  //  AÇÕES
  // =====================================================================

  /** Abre o WhatsApp com a mensagem "Abriu uma vaga..." e marca como avisada (continua na fila). */
  avisar(e: EntradaFila, vaga: { data: string; horario: string }) {
    const link = linkAvisoVaga(e, vaga.data, vaga.horario);
    if (!link) {
      this.erro = `${e.clienteNome} não tem telefone cadastrado.`;
      return;
    }
    window.open(link, '_blank');
    this.http.put(`${API_URL}/lista-espera/${e.id}/avisado`, {}, { headers: this.headers() }).subscribe({
      next: () => {
        e.situacao = 'avisado';
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  /** "Encaixar direto": cria o agendamento na vaga e tira da fila. */
  encaixar(e: EntradaFila, vaga: { data: string; horario: string }) {
    if (this.ocupado) return;
    if (!confirm(`Encaixar ${e.clienteNome} (${e.servicoNome}) em ${this.diaCurto(vaga.data)} às ${vaga.horario}?`)) return;
    this.ocupado = true;
    this.erro = '';
    this.http.post<{ mensagem: string }>(`${API_URL}/lista-espera/${e.id}/encaixar`, { data: vaga.data, horario: vaga.horario }, { headers: this.headers() }).subscribe({
      next: ({ mensagem }) => {
        this.ocupado = false;
        this.mostrarMensagem(`${mensagem} Já está na Agenda.`);
        this.carregar();
      },
      error: (erro) => {
        this.ocupado = false;
        this.erro = erro?.error?.erro || 'Não foi possível encaixar.';
        this.carregar();
        this.cdr.markForCheck();
      },
    });
  }

  remover(e: EntradaFila) {
    if (!confirm(`Tirar ${e.clienteNome} da lista de espera? Ela vai para o histórico como "Desistiu".`)) return;
    this.http.delete(`${API_URL}/lista-espera/${e.id}`, { headers: this.headers() }).subscribe({
      next: () => {
        this.mostrarMensagem(`${e.clienteNome} saiu da lista.`);
        this.carregar();
      },
      error: (erro) => {
        this.erro = erro?.error?.erro || 'Não foi possível remover.';
        this.cdr.markForCheck();
      },
    });
  }

  abrirFicha(e: EntradaFila) {
    this.router.navigate(['/clientes'], { queryParams: { ficha: e.clienteId } });
  }

  private mostrarMensagem(texto: string) {
    this.mensagem = texto;
    this.cdr.markForCheck();
    setTimeout(() => { this.mensagem = ''; this.cdr.markForCheck(); }, 4000);
  }

  // =====================================================================
  //  MODAL ADICIONAR / EDITAR
  // =====================================================================
  private formVazio() {
    return {
      clienteId: 0,
      servicoId: 0,
      qualquerDia: false,
      dataPreferida: '',
      periodo: 'qualquer' as 'manha' | 'tarde' | 'qualquer',
      horarioPreferido: '',
      observacao: '',
    };
  }

  get clientesFiltrados(): Cliente[] {
    const termo = this.buscaCliente.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    if (!termo) return this.clientes;
    return this.clientes.filter(c =>
      c.nome.toLowerCase().includes(termo) || (digitos.length >= 3 && String(c.telefone || '').replace(/\D/g, '').includes(digitos))
    );
  }

  abrirModal(e?: EntradaFila) {
    this.erroModal = '';
    this.buscaCliente = '';
    if (e) {
      this.editandoId = e.id;
      this.form = {
        clienteId: e.clienteId,
        servicoId: e.servicoId,
        qualquerDia: !e.dataPreferida,
        dataPreferida: e.dataPreferida || '',
        periodo: e.periodo,
        horarioPreferido: e.horarioPreferido || '',
        observacao: e.observacao,
      };
    } else {
      this.editandoId = null;
      this.form = this.formVazio();
    }
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
  }

  salvar(event: Event) {
    event.preventDefault();
    this.erroModal = '';
    const f = this.form;
    if (!Number(f.clienteId) || !Number(f.servicoId)) {
      this.erroModal = 'Escolha o cliente e o serviço.';
      return;
    }
    if (!f.qualquerDia && !f.dataPreferida) {
      this.erroModal = 'Escolha o dia ou marque "qualquer dia".';
      return;
    }
    if (!f.qualquerDia && f.dataPreferida < this.hoje) {
      this.erroModal = 'Esse dia já passou.';
      return;
    }

    const corpo = {
      clienteId: Number(f.clienteId),
      servicoId: Number(f.servicoId),
      dataPreferida: f.qualquerDia ? null : f.dataPreferida,
      periodo: f.horarioPreferido ? 'qualquer' : f.periodo,
      horarioPreferido: f.horarioPreferido || null,
      observacao: f.observacao,
    };
    this.salvando = true;
    const pedido = this.editandoId
      ? this.http.put(`${API_URL}/lista-espera/${this.editandoId}`, corpo, { headers: this.headers() })
      : this.http.post(`${API_URL}/lista-espera`, corpo, { headers: this.headers() });
    pedido.subscribe({
      next: () => {
        this.salvando = false;
        this.modalAberto = false;
        this.mostrarMensagem(this.editandoId ? 'Alterações salvas.' : 'Adicionado à lista de espera.');
        this.carregar();
      },
      error: (erro) => {
        this.salvando = false;
        this.erroModal = erro?.error?.erro || 'Não foi possível salvar.';
        this.cdr.markForCheck();
      },
    });
  }

  private formatarData(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
