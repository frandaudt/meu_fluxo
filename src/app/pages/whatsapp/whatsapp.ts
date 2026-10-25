import { ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin } from 'rxjs';

import {
  API_URL,
  dinheiro,
  MensagemPronta,
  TipoMensagem,
  TIPOS_MENSAGEM,
  guardarMensagensProntas,
  mensagemEmUso,
  modelosProntos,
} from '../../app';

/**
 * Tela WhatsApp (só dono ou atendente com a caixa "WhatsApp").
 * Coluna da esquerda: bot (liga/desliga), link de agendamento, serviços que aparecem,
 * cadastro automático, as respostas do bot e as mensagens prontas por serviço.
 * Coluna da direita: "Como o cliente vê" — um simulador que conversa com o bot de verdade.
 */
interface Link {
  slug: string;
  linkAtivo: boolean;
  nomeNegocio: string;
  descricaoNegocio: string;
  enderecoNegocio: string;
}
interface Servico { id: number; nome: string; valor: number; duracaoMin: number; mostrarNoBot: boolean; }
interface Bot { ativo: boolean; cadastroAutomatico: boolean; conectado: boolean; numero: string | null; }
type ChaveResposta = 'saudacao' | 'primeiroContato' | 'confirmado' | 'semHorario' | 'cancelMenos2h';
type Respostas = Record<ChaveResposta, string>;
interface RespostaConfig { bot: Bot; respostas: Respostas; respostasPadrao: Respostas; }
interface Mensagem { de: 'cliente' | 'bot' | 'aviso'; texto: string; hora: string; }

/** As caixas de "Respostas do bot", na ordem em que aparecem. */
const CAMPOS_RESPOSTA: { chave: ChaveResposta; titulo: string; quando: string; campos: string[] }[] = [
  { chave: 'saudacao', titulo: 'Saudação e menu', quando: 'Quando o cliente manda "oi" ou "menu".', campos: ['{nome}', '{negocio}'] },
  { chave: 'primeiroContato', titulo: 'Primeiro contato', quando: 'Número que ainda não é cliente: o bot pede o nome.', campos: ['{negocio}'] },
  { chave: 'confirmado', titulo: 'Agendamento confirmado', quando: 'Depois que o cliente confirma o horário.', campos: ['{nome}', '{servico}', '{data}', '{hora}'] },
  { chave: 'semHorario', titulo: 'Dia sem horários', quando: 'O dia escolhido está lotado: oferece a lista de espera.', campos: ['{nome}', '{data}'] },
  { chave: 'cancelMenos2h', titulo: 'Cancelar ou remarcar com menos de 2h', quando: 'Pelo bot, só dá para mudar com 2 horas ou mais de antecedência.', campos: ['{nome}', '{telefone}'] },
];

@Component({
  selector: 'app-whatsapp',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './whatsapp.html',
  styleUrl: './whatsapp.css',
})
export class Whatsapp implements OnInit {
  @ViewChild('conversa') conversaEl?: ElementRef<HTMLDivElement>;

  carregando = true;
  erro = '';

  // ---------- bot ----------
  bot: Bot = { ativo: false, cadastroAutomatico: true, conectado: false, numero: null };
  erroBot = '';

  // ---------- link ----------
  link: Link = { slug: '', linkAtivo: true, nomeNegocio: '', descricaoNegocio: '', enderecoNegocio: '' };
  /** O que está salvo (para saber se mudou e para montar o endereço copiado). */
  private linkSalvo: Link | null = null;
  salvandoLink = false;
  erroLink = '';
  mensagemLink = '';
  copiado = false;

  // ---------- serviços ----------
  servicos: Servico[] = [];
  erroServicos = '';

  // ---------- respostas do bot ----------
  readonly camposResposta = CAMPOS_RESPOSTA;
  respostas = {} as Respostas;
  private respostasSalvas = {} as Respostas;
  private respostasPadrao = {} as Respostas;
  salvandoRespostas = false;
  erroRespostas = '';
  mensagemRespostas = '';

  // ---------- mensagens prontas por serviço ----------
  readonly tiposMensagem = TIPOS_MENSAGEM;
  /** Serviço escolhido nos botões (null = "Padrão (todos)"). */
  servicoMensagem: number | null = null;
  /** Caixa de edição aberta (um tipo por vez). */
  editando: { tipo: TipoMensagem; texto: string } | null = null;
  criandoDoZero = false;
  salvandoMensagem = false;
  erroMensagens = '';
  copiadoTipo: TipoMensagem | null = null;
  readonly camposMensagem = ['{nome}', '{servico}', '{data}', '{hora}', '{negocio}'];

  // ---------- simulador ----------
  telefoneTeste = '(11) 91234-5678';
  textoDigitado = '';
  mensagens: Mensagem[] = [];
  enviando = false;
  readonly atalhos = ['oi', '1', '2', '3', 'sim', 'menu'];

  constructor(private http: HttpClient, private router: Router, private cdr: ChangeDetectorRef) {}

  private headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('meufluxo_token')}` });
  }

  ngOnInit() {
    if (!localStorage.getItem('meufluxo_token')) {
      this.router.navigate(['/login']);
      return;
    }
    const headers = this.headers();
    forkJoin({
      link: this.http.get<{ link: Link }>(`${API_URL}/usuarios/link`, { headers }),
      servicos: this.http.get<{ servicos: Servico[] }>(`${API_URL}/servicos`, { headers }),
      config: this.http.get<RespostaConfig>(`${API_URL}/whatsapp/config`, { headers }),
      mensagens: this.http.get<{ mensagens: MensagemPronta[] }>(`${API_URL}/whatsapp/mensagens`, { headers }),
    }).subscribe({
      next: ({ link, servicos, config, mensagens }) => {
        guardarMensagensProntas(mensagens.mensagens);
        this.link = { ...link.link };
        this.linkSalvo = { ...link.link };
        this.servicos = servicos.servicos;
        this.bot = config.bot;
        this.respostas = { ...config.respostas };
        this.respostasSalvas = { ...config.respostas };
        this.respostasPadrao = { ...config.respostasPadrao };
        this.carregando = false;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.carregando = false;
        this.erro = erro?.status === 403
          ? 'Você não tem acesso a esta tela. Fale com o dono do negócio.'
          : erro?.error?.erro || 'Não foi possível carregar a tela.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  BOT: interruptores (salvam na hora)
  // =====================================================================
  private salvarBot(mudanca: Partial<Bot>, desfazer: () => void) {
    this.erroBot = '';
    this.http.put<{ bot: Bot }>(`${API_URL}/whatsapp/config`, mudanca, { headers: this.headers() }).subscribe({
      next: ({ bot }) => {
        this.bot = bot;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        desfazer();
        this.erroBot = erro?.error?.erro || 'Não foi possível salvar.';
        this.cdr.markForCheck();
      },
    });
  }

  alternarBot() {
    const antes = this.bot.ativo;
    this.bot.ativo = !antes;
    this.salvarBot({ ativo: this.bot.ativo }, () => (this.bot.ativo = antes));
  }

  alternarCadastro() {
    const antes = this.bot.cadastroAutomatico;
    this.bot.cadastroAutomatico = !antes;
    this.salvarBot({ cadastroAutomatico: this.bot.cadastroAutomatico }, () => (this.bot.cadastroAutomatico = antes));
  }

  // =====================================================================
  //  LINK DE AGENDAMENTO
  // =====================================================================
  /** Endereço completo do link (o domínio é o do próprio site: localhost no teste, Render depois). */
  get enderecoLink(): string {
    return `${window.location.origin}/agendar/${this.linkSalvo?.slug || this.link.slug}`;
  }

  get inicioEndereco(): string {
    return `${window.location.host}/agendar/`;
  }

  get linkMudou(): boolean {
    const s = this.linkSalvo;
    return !s || s.slug !== this.link.slug || s.linkAtivo !== this.link.linkAtivo
      || s.descricaoNegocio !== this.link.descricaoNegocio || s.enderecoNegocio !== this.link.enderecoNegocio;
  }

  /** Deixa o endereço só com letras minúsculas, números e hífen enquanto a pessoa digita. */
  limparSlug(valor: string) {
    this.link.slug = valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-');
  }

  salvarLink() {
    this.erroLink = '';
    this.mensagemLink = '';
    const slug = this.link.slug.replace(/^-+|-+$/g, '');
    if (slug.length < 3) {
      this.erroLink = 'O endereço precisa ter pelo menos 3 letras.';
      return;
    }
    this.salvandoLink = true;
    this.http.put<{ link: Link }>(`${API_URL}/usuarios/link`, { ...this.link, slug }, { headers: this.headers() }).subscribe({
      next: ({ link }) => {
        this.salvandoLink = false;
        this.link = { ...link };
        this.linkSalvo = { ...link };
        this.mensagemLink = link.linkAtivo ? 'Link salvo! Já pode mandar para os clientes.' : 'Link salvo e desligado: ninguém consegue agendar por ele.';
        this.cdr.markForCheck();
        setTimeout(() => { this.mensagemLink = ''; this.cdr.markForCheck(); }, 4000);
      },
      error: (erro) => {
        this.salvandoLink = false;
        this.erroLink = erro?.error?.erro || 'Não foi possível salvar o link.';
        this.cdr.markForCheck();
      },
    });
  }

  copiarLink() {
    const pronto = () => {
      this.copiado = true;
      this.cdr.markForCheck();
      setTimeout(() => { this.copiado = false; this.cdr.markForCheck(); }, 2000);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(this.enderecoLink).then(pronto, () => window.prompt('Copie o link:', this.enderecoLink));
    } else {
      window.prompt('Copie o link:', this.enderecoLink);
    }
  }

  abrirLink() {
    window.open(this.enderecoLink, '_blank');
  }

  // =====================================================================
  //  SERVIÇOS NO BOT E NO LINK
  // =====================================================================
  moeda(valor: number): string {
    return dinheiro(valor);
  }

  /** Interruptor de cada serviço: aparece no bot e no link, ou não. Salva na hora. */
  alternarServico(s: Servico) {
    const antes = s.mostrarNoBot;
    s.mostrarNoBot = !antes;
    this.erroServicos = '';
    this.http.put(`${API_URL}/servicos/${s.id}/mostrar`, { mostrarNoBot: s.mostrarNoBot }, { headers: this.headers() }).subscribe({
      error: (erro) => {
        s.mostrarNoBot = antes;
        this.erroServicos = erro?.error?.erro || 'Não foi possível salvar.';
        this.cdr.markForCheck();
      },
    });
  }

  get servicosVisiveis(): number {
    return this.servicos.filter(s => s.mostrarNoBot).length;
  }

  // =====================================================================
  //  RESPOSTAS DO BOT
  // =====================================================================
  get respostasMudaram(): boolean {
    return this.camposResposta.some(c => this.respostas[c.chave] !== this.respostasSalvas[c.chave]);
  }

  ehPadrao(chave: ChaveResposta): boolean {
    return this.respostas[chave] === this.respostasPadrao[chave];
  }

  voltarAoPadrao(chave: ChaveResposta) {
    this.respostas[chave] = this.respostasPadrao[chave];
  }

  /** Coloca {nome}, {data}... no fim do texto (o bot troca pelo valor de verdade). */
  inserirCampo(chave: ChaveResposta, campo: string) {
    const atual = this.respostas[chave] || '';
    this.respostas[chave] = atual + (atual && !atual.endsWith(' ') ? ' ' : '') + campo;
  }

  salvarRespostas() {
    this.erroRespostas = '';
    this.mensagemRespostas = '';
    const vazia = this.camposResposta.find(c => !(this.respostas[c.chave] || '').trim());
    if (vazia) {
      this.erroRespostas = `Escreva o texto de "${vazia.titulo}" (ou clique em Voltar ao padrão).`;
      return;
    }
    this.salvandoRespostas = true;
    this.http.put<{ respostas: Respostas }>(`${API_URL}/whatsapp/respostas`, this.respostas, { headers: this.headers() }).subscribe({
      next: ({ respostas }) => {
        this.salvandoRespostas = false;
        this.respostas = { ...respostas };
        this.respostasSalvas = { ...respostas };
        this.mensagemRespostas = 'Respostas salvas! Teste no simulador ao lado.';
        this.cdr.markForCheck();
        setTimeout(() => { this.mensagemRespostas = ''; this.cdr.markForCheck(); }, 4000);
      },
      error: (erro) => {
        this.salvandoRespostas = false;
        this.erroRespostas = erro?.error?.erro || 'Não foi possível salvar as respostas.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  MENSAGENS PRONTAS POR SERVIÇO
  // =====================================================================
  private get servicoEscolhido(): Servico | null {
    return this.servicos.find(s => s.id === this.servicoMensagem) || null;
  }

  get nomeServicoMensagem(): string {
    return this.servicoEscolhido?.nome || 'Padrão (todos)';
  }

  escolherServicoMensagem(id: number | null) {
    this.servicoMensagem = id;
    this.editando = null;
    this.criandoDoZero = false;
    this.erroMensagens = '';
  }

  /** O texto que os botões de WhatsApp usam hoje para esse tipo. */
  emUso(tipo: TipoMensagem): { texto: string; origem: 'salva' | 'modelo' | 'padrao' } {
    const s = this.servicoEscolhido;
    return mensagemEmUso(tipo, s ? { id: s.id, nome: s.nome } : null);
  }

  /** Os modelos prontos que não estão em uso (botão "Usar este"), com o número de cada um. */
  outrosModelos(tipo: TipoMensagem): { numero: number; texto: string }[] {
    const atual = this.emUso(tipo).texto;
    return modelosProntos(tipo, this.servicoEscolhido?.nome).modelos
      .map((texto, i) => ({ numero: i + 1, texto }))
      .filter(m => m.texto !== atual);
  }

  /** Texto salvo que é igual a um modelo pronto não conta como "escrita por você". */
  escritaPorVoce(tipo: TipoMensagem): boolean {
    const uso = this.emUso(tipo);
    return uso.origem === 'salva' && !modelosProntos(tipo, this.servicoEscolhido?.nome).modelos.includes(uso.texto);
  }

  editar(tipo: TipoMensagem) {
    this.criandoDoZero = false;
    this.editando = { tipo, texto: this.emUso(tipo).texto };
  }

  criarDoZero() {
    this.criandoDoZero = true;
    this.editando = { tipo: 'lembrete', texto: '' };
  }

  cancelarEdicao() {
    this.editando = null;
    this.criandoDoZero = false;
  }

  inserirCampoMensagem(campo: string) {
    if (!this.editando) return;
    const atual = this.editando.texto;
    this.editando.texto = atual + (atual && !atual.endsWith(' ') ? ' ' : '') + campo;
  }

  private depoisDeSalvar(mensagens: MensagemPronta[]) {
    this.salvandoMensagem = false;
    guardarMensagensProntas(mensagens); // os botões das outras telas já usam o texto novo
    this.editando = null;
    this.criandoDoZero = false;
    this.cdr.markForCheck();
  }

  private erroAoSalvar(erro: { error?: { erro?: string } }) {
    this.salvandoMensagem = false;
    this.erroMensagens = erro?.error?.erro || 'Não foi possível salvar a mensagem.';
    this.cdr.markForCheck();
  }

  /** Salva o texto como "Em uso" (usado por "Usar este" e pelo Salvar da edição). */
  usarTexto(tipo: TipoMensagem, texto: string) {
    if (!texto.trim()) {
      this.erroMensagens = 'Escreva a mensagem.';
      return;
    }
    this.erroMensagens = '';
    this.salvandoMensagem = true;
    this.http.put<{ mensagens: MensagemPronta[] }>(
      `${API_URL}/whatsapp/mensagens`,
      { servicoId: this.servicoMensagem, tipo, texto },
      { headers: this.headers() }
    ).subscribe({
      next: ({ mensagens }) => this.depoisDeSalvar(mensagens),
      error: (erro) => this.erroAoSalvar(erro),
    });
  }

  salvarEdicao() {
    if (this.editando) this.usarTexto(this.editando.tipo, this.editando.texto);
  }

  /** Apaga o texto salvo: volta a usar o modelo pronto (ou o do Padrão). */
  voltarAoModelo(tipo: TipoMensagem) {
    this.erroMensagens = '';
    this.salvandoMensagem = true;
    const servico = this.servicoMensagem === null ? '' : String(this.servicoMensagem);
    this.http.delete<{ mensagens: MensagemPronta[] }>(
      `${API_URL}/whatsapp/mensagens?tipo=${tipo}&servicoId=${servico}`,
      { headers: this.headers() }
    ).subscribe({
      next: ({ mensagens }) => this.depoisDeSalvar(mensagens),
      error: (erro) => this.erroAoSalvar(erro),
    });
  }

  copiarMensagem(tipo: TipoMensagem) {
    const texto = this.emUso(tipo).texto;
    const pronto = () => {
      this.copiadoTipo = tipo;
      this.cdr.markForCheck();
      setTimeout(() => { this.copiadoTipo = null; this.cdr.markForCheck(); }, 2000);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(texto).then(pronto, () => window.prompt('Copie a mensagem:', texto));
    } else {
      window.prompt('Copie a mensagem:', texto);
    }
  }

  // =====================================================================
  //  SIMULADOR ("Como o cliente vê")
  // =====================================================================
  get nomeNegocio(): string {
    return this.link.nomeNegocio || 'Seu negócio';
  }

  get inicialNegocio(): string {
    return this.nomeNegocio.trim().charAt(0).toUpperCase() || 'M';
  }

  private horaAgora(): string {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  private rolarParaBaixo() {
    setTimeout(() => {
      const el = this.conversaEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  enviar(texto = this.textoDigitado) {
    const mensagem = texto.trim();
    if (!mensagem || this.enviando) return;
    this.textoDigitado = '';
    this.mensagens.push({ de: 'cliente', texto: mensagem, hora: this.horaAgora() });
    this.enviando = true;
    this.rolarParaBaixo();

    this.http.post<{ respostas: string[] }>(
      `${API_URL}/whatsapp/simular`,
      { telefone: this.telefoneTeste, texto: mensagem },
      { headers: this.headers() }
    ).subscribe({
      next: ({ respostas }) => {
        this.enviando = false;
        for (const r of respostas) this.mensagens.push({ de: 'bot', texto: r, hora: this.horaAgora() });
        this.cdr.markForCheck();
        this.rolarParaBaixo();
      },
      error: (erro) => {
        this.enviando = false;
        this.mensagens.push({ de: 'aviso', texto: erro?.error?.erro || 'O bot não respondeu. Confira se o back-end está rodando.', hora: '' });
        this.cdr.markForCheck();
        this.rolarParaBaixo();
      },
    });
  }

  /** Apaga a conversa simulada (o bot esquece em que etapa estava). Clientes e agendamentos criados continuam. */
  reiniciar() {
    this.mensagens = [];
    this.http.post(`${API_URL}/whatsapp/simular/reiniciar`, { telefone: this.telefoneTeste }, { headers: this.headers() }).subscribe({
      error: () => {},
    });
  }
}
