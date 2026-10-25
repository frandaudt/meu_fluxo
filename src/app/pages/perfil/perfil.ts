import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import {
  API_URL,
  Aparencia,
  Bloqueio,
  HorarioTrabalho,
  TemaCores,
  TEMAS_PRONTOS,
  aparenciaSalva,
  aplicarAparencia,
  aplicarTamanhoTexto,
  aplicarTema,
  contrasteComBranco,
  guardarAparencia,
  hexDoTema,
  horarioPadrao,
  normalizarHorarioTrabalho,
  temaDaAparencia,
  temaDeHex,
} from '../../app';

/** As 4 abas do Perfil (botões no topo). */
type Aba = 'dados' | 'horario' | 'equipe' | 'aparencia';

interface Usuario {
  id: number;
  nome: string;
  email: string;
  telefone?: string;
  nomeNegocio?: string;
  papel: 'dono' | 'atendente';
  permissoes: string[];
  foto: string | null;
  aparencia?: Aparencia;
  trocarSenha?: boolean; // entrou com senha provisória: precisa criar a dele
  temSenha?: boolean;    // false = conta só do Google (ainda sem senha)
  temGoogle?: boolean;
}

/** Uma pessoa da aba Equipe (GET /api/equipe). */
interface Pessoa {
  id: number;
  nome: string;
  email: string;
  papel: 'dono' | 'atendente';
  permissoes: string[];
  ultimoAcesso: string | null;
  foto: string | null;
}

/** Linha da tabela "O que cada um pode fazer". permissao = caixa que o dono marca; null = fixo. */
interface LinhaPermissao {
  area: string;
  permissao: string | null;
  atendentePode: boolean; // vale quando permissao = null
}

/** Folgas seguidas com o mesmo nome (ex.: 10 dias de férias) aparecem numa linha só. */
interface GrupoBloqueio {
  ids: number[];
  inicio: string;            // 'YYYY-MM-DD'
  fim: string;               // 'YYYY-MM-DD' (igual ao início quando é um dia só)
  horaInicio: string | null; // só quando é um período de um dia
  horaFim: string | null;
  descricao: string;
}

/** Um cliente lido da planilha ou do backup (antes de mandar para a API). */
interface ClienteImportado { nome: string; telefone: string; email?: string; endereco?: string; }

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './perfil.html',
  styleUrl: './perfil.css',
})
export class Perfil implements OnInit, OnDestroy {
  carregando = true;
  aba: Aba = 'dados';
  usuario: Usuario = { id: 0, nome: '', email: '', papel: 'dono', permissoes: [], foto: null };

  get ehDono(): boolean {
    return this.usuario.papel !== 'atendente';
  }

  /** Horário: o dono, ou o atendente com a caixa "Horário de trabalho" marcada. */
  get podeHorario(): boolean {
    return this.ehDono || this.usuario.permissoes.includes('horario');
  }

  get abas(): { id: Aba; rotulo: string }[] {
    const lista: { id: Aba; rotulo: string }[] = [{ id: 'dados', rotulo: 'Meus dados' }];
    if (this.podeHorario) lista.push({ id: 'horario', rotulo: 'Horário de trabalho' });
    if (this.ehDono) {
      lista.push({ id: 'equipe', rotulo: 'Equipe' });
      lista.push({ id: 'aparencia', rotulo: 'Aparência' });
    }
    return lista;
  }

  // =====================================================================
  //  MEUS DADOS
  // =====================================================================
  form = { nome: '', email: '', telefone: '', nomeNegocio: '' };
  erroPerfil = '';
  mensagemPerfil = '';
  salvandoPerfil = false;

  erroFoto = '';
  salvandoFoto = false;

  senhaAtual = '';
  novaSenha = '';
  mostrarSenhaAtual = false;
  mostrarNovaSenha = false;
  erroSenha = '';
  mensagemSenha = '';
  salvandoSenha = false;

  get senhaTemComprimento(): boolean { return this.novaSenha.length >= 8; }
  get senhaTemMaiuscula(): boolean { return /[A-Z]/.test(this.novaSenha); }
  get senhaTemEspecial(): boolean { return /[^A-Za-z0-9]/.test(this.novaSenha); }
  get senhaValida(): boolean { return this.senhaTemComprimento && this.senhaTemMaiuscula && this.senhaTemEspecial; }

  // "Seus dados" (só dono)
  baixandoTudo = false;
  exportandoCsv = false;
  importando = false;
  resumoImportacao = '';
  detalhesImportacao: string[] = [];
  erroDados = '';
  erroConta = '';
  excluindoConta = false;

  // =====================================================================
  //  HORÁRIO DE TRABALHO
  // =====================================================================
  readonly blocos = [15, 30, 60];
  readonly nomesDias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  /** ordem de exibição: começa na segunda e termina no domingo */
  readonly ordemDias = [1, 2, 3, 4, 5, 6, 0];
  readonly mesesCurtos = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

  horario: HorarioTrabalho = horarioPadrao();
  erroHorario = '';
  mensagemHorario = '';
  salvandoHorario = false;

  // folgas e feriados
  formBloqueioAberto = false;
  readonly tiposBloqueio = ['Folga', 'Férias', 'Feriado', 'Curso', 'Outro'];
  formBloqueio = this.formBloqueioVazio();
  erroBloqueio = '';
  erroCarregarHorario = '';
  avisoBloqueio = '';
  salvandoBloqueio = false;

  // =====================================================================
  //  EQUIPE
  // =====================================================================
  equipe: Pessoa[] = [];
  erroEquipe = '';
  mensagemEquipe = '';
  novoAtendente = { nome: '', email: '', senha: '', permissoes: [] as string[] };
  criandoAcesso = false;
  erroNovo = '';
  mostrarSenhaNovo = false;

  /** Modal "Redefinir senha". */
  redefinindo: Pessoa | null = null;
  senhaRedefinir = '';
  erroRedefinir = '';
  salvandoRedefinir = false;

  readonly linhasPermissao: LinhaPermissao[] = [
    { area: 'Agenda: criar, editar, reagendar, cancelar', permissao: null, atendentePode: true },
    { area: 'Concluir atendimento e receber pagamento (caixa)', permissao: null, atendentePode: true },
    { area: 'Lista de espera', permissao: null, atendentePode: true },
    { area: 'Clientes: ver, cadastrar e editar', permissao: null, atendentePode: true },
    { area: 'Clientes: excluir', permissao: 'excluirClientes', atendentePode: false },
    { area: 'Serviços: criar, mudar preço, excluir', permissao: 'servicos', atendentePode: false },
    { area: 'Financeiro, despesas e saldo (ver valores)', permissao: 'financeiro', atendentePode: false },
    { area: 'Metas', permissao: 'metas', atendentePode: false },
    { area: 'WhatsApp e mensagens', permissao: 'whatsapp', atendentePode: false },
    { area: 'Horário de trabalho e folgas', permissao: 'horario', atendentePode: false },
    { area: 'Equipe, aparência e excluir conta', permissao: null, atendentePode: false },
  ];

  /** As áreas que o dono escolhe (caixas de marcar). */
  get permissoesEscolhiveis(): LinhaPermissao[] {
    return this.linhasPermissao.filter(l => l.permissao);
  }

  alternarPermissaoNova(permissao: string) {
    const lista = this.novoAtendente.permissoes;
    this.novoAtendente.permissoes = lista.includes(permissao) ? lista.filter(p => p !== permissao) : [...lista, permissao];
  }

  get atendentes(): Pessoa[] {
    return this.equipe.filter(p => p.papel === 'atendente');
  }

  // =====================================================================
  //  APARÊNCIA
  // =====================================================================
  readonly temasProntos = TEMAS_PRONTOS;
  /** O que está salvo no banco (volta para ele se sair sem salvar). */
  private aparenciaGravada: Aparencia = aparenciaSalva();
  tema: TemaCores = temaDaAparencia(this.aparenciaGravada);
  tamanhoTexto: 'normal' | 'grande' = this.aparenciaGravada.tamanhoTexto;
  /** Cores dos 3 seletores da Personalizada. */
  corPersonalizada = this.aparenciaGravada.corPrimaria || hexDoTema(this.tema);
  corAcento = '';
  corDestaque = '';
  /** true = a pessoa escolheu a cor; false = calculada pelo círculo cromático a partir da principal. */
  acentoManual = !!this.aparenciaGravada.corAcento;
  destaqueManual = !!this.aparenciaGravada.corDestaque;
  salvandoAparencia = false;
  mensagemAparencia = '';
  erroAparencia = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
  ) {
    this.iniciarCoresPersonalizadas();
  }

  private cabecalhoAuth(): HttpHeaders {
    const token = localStorage.getItem('meufluxo_token');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  ngOnInit() {
    const token = localStorage.getItem('meufluxo_token');
    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    this.http.get<{ usuario: Usuario }>(`${API_URL}/usuarios/perfil`, { headers: this.cabecalhoAuth() }).subscribe({
      next: ({ usuario }) => {
        this.usarUsuario(usuario);
        this.carregando = false;

        // /perfil?aba=horario abre direto numa aba (ex.: link "Ajuste no Perfil")
        const pedida = this.route.snapshot.queryParamMap.get('aba') as Aba | null;
        if (pedida && this.abas.some(a => a.id === pedida)) this.aba = pedida;

        if (this.podeHorario) this.carregarHorario();
        if (this.ehDono) this.carregarEquipe();
        this.cdr.markForCheck();
      },
      error: () => {
        localStorage.removeItem('meufluxo_token');
        localStorage.removeItem('usuarioLogado');
        this.router.navigate(['/login']);
      },
    });
  }

  /** Ao sair do Perfil sem salvar a aparência, o sistema volta para a que está salva. */
  ngOnDestroy() {
    aplicarAparencia(aparenciaSalva());
  }

  escolherAba(aba: Aba) {
    this.aba = aba;
    this.router.navigate([], { queryParams: { aba: aba === 'dados' ? null : aba }, replaceUrl: true });
  }

  /** Guarda o usuário na tela e no localStorage (o cabeçalho lê de lá). */
  private usarUsuario(usuario: Usuario) {
    this.usuario = { ...usuario, permissoes: usuario.permissoes || [], foto: usuario.foto || null };
    this.form = {
      nome: usuario.nome || '',
      email: usuario.email || '',
      telefone: usuario.telefone || '',
      nomeNegocio: usuario.nomeNegocio || '',
    };
    localStorage.setItem('usuarioLogado', JSON.stringify(usuario));
    window.dispatchEvent(new Event('meufluxo-usuario')); // atualiza nome e foto no cabeçalho
  }

  get inicialNome(): string {
    return (this.usuario.nome || this.form.nome || 'U').charAt(0).toUpperCase();
  }

  inicial(nome: string): string {
    return (nome || '?').trim().charAt(0).toUpperCase();
  }

  // =====================================================================
  //  MEUS DADOS
  // =====================================================================

  salvarPerfil(event: Event) {
    event.preventDefault();
    this.erroPerfil = '';
    this.mensagemPerfil = '';

    if (!this.form.nome.trim() || !this.form.email.trim()) {
      this.erroPerfil = 'Preencha ao menos o nome e o e-mail.';
      return;
    }

    this.salvandoPerfil = true;
    this.http.put<{ usuario: Usuario }>(`${API_URL}/usuarios/perfil`, {
      nome: this.form.nome.trim(),
      email: this.form.email.trim(),
      telefone: this.form.telefone,
      nomeNegocio: this.form.nomeNegocio,
    }, { headers: this.cabecalhoAuth() }).subscribe({
      next: ({ usuario }) => {
        this.usarUsuario(usuario);
        this.salvandoPerfil = false;
        this.mensagemPerfil = 'Dados salvos!';
        this.cdr.markForCheck();
        setTimeout(() => { this.mensagemPerfil = ''; this.cdr.markForCheck(); }, 3000);
      },
      error: (erro) => {
        this.salvandoPerfil = false;
        this.erroPerfil = erro?.error?.erro || 'Não foi possível salvar.';
        this.cdr.markForCheck();
      },
    });
  }

  // ---------- foto ----------

  /** Recorta o centro da imagem em 256x256 e salva (JPG, uns 20 KB). */
  escolherFoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const arquivo = input.files?.[0];
    input.value = ''; // deixa escolher o mesmo arquivo de novo
    this.erroFoto = '';
    if (!arquivo) return;
    if (!arquivo.type.startsWith('image/')) {
      this.erroFoto = 'Escolha uma imagem (JPG ou PNG).';
      return;
    }
    if (arquivo.size > 10 * 1024 * 1024) {
      this.erroFoto = 'A imagem tem mais de 10 MB. Escolha outra.';
      return;
    }

    const leitor = new FileReader();
    leitor.onload = () => {
      const imagem = new Image();
      imagem.onload = () => {
        const lado = Math.min(imagem.width, imagem.height);
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        // recorte central (quadrado) → 256x256
        ctx.drawImage(imagem, (imagem.width - lado) / 2, (imagem.height - lado) / 2, lado, lado, 0, 0, 256, 256);
        this.enviarFoto(canvas.toDataURL('image/jpeg', 0.85));
      };
      imagem.onerror = () => {
        this.erroFoto = 'Não foi possível abrir essa imagem.';
        this.cdr.markForCheck();
      };
      imagem.src = String(leitor.result);
    };
    leitor.readAsDataURL(arquivo);
  }

  removerFoto() {
    this.enviarFoto(null);
  }

  private enviarFoto(foto: string | null) {
    this.salvandoFoto = true;
    this.http.put<{ usuario: Usuario }>(`${API_URL}/usuarios/foto`, { foto }, { headers: this.cabecalhoAuth() }).subscribe({
      next: ({ usuario }) => {
        this.salvandoFoto = false;
        this.usarUsuario(usuario);
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.salvandoFoto = false;
        this.erroFoto = erro?.error?.erro || 'Não foi possível salvar a foto.';
        this.cdr.markForCheck();
      },
    });
  }

  // ---------- senha ----------

  // ---------- criar senha (conta do Google, sem senha) ----------
  codigoEnviado = false;
  codigoSenha = '';

  /** Manda o código de 6 números para o e-mail da conta (o mesmo do "Esqueci minha senha"). */
  enviarCodigoSenha() {
    this.erroSenha = '';
    this.salvandoSenha = true;
    this.http.post<{ mensagem: string }>(`${API_URL}/usuarios/senha/codigo`, { email: this.usuario.email }).subscribe({
      next: () => {
        this.salvandoSenha = false;
        this.codigoEnviado = true;
        this.mensagemSenha = `Enviamos um código para ${this.usuario.email}.`;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.salvandoSenha = false;
        this.erroSenha = erro?.error?.erro || 'Não foi possível enviar o código.';
        this.cdr.markForCheck();
      },
    });
  }

  criarSenhaComCodigo(event: Event) {
    event.preventDefault();
    this.erroSenha = '';
    if (this.codigoSenha.replace(/\D/g, '').length !== 6) {
      this.erroSenha = 'Digite o código de 6 números.';
      return;
    }
    if (!this.senhaValida) {
      this.erroSenha = 'A senha precisa ter pelo menos 8 caracteres, uma letra maiúscula e um caractere especial.';
      return;
    }
    this.salvandoSenha = true;
    this.http.post<{ usuario: Usuario; token: string }>(`${API_URL}/usuarios/senha/redefinir`, {
      email: this.usuario.email,
      codigo: this.codigoSenha,
      novaSenha: this.novaSenha,
    }).subscribe({
      next: ({ usuario, token }) => {
        this.salvandoSenha = false;
        localStorage.setItem('meufluxo_token', token);
        this.usarUsuario(usuario);
        this.codigoEnviado = false;
        this.codigoSenha = '';
        this.novaSenha = '';
        this.mensagemSenha = 'Senha criada! Agora você também pode entrar com e-mail e senha.';
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.salvandoSenha = false;
        this.erroSenha = erro?.error?.erro || 'Não foi possível criar a senha.';
        this.cdr.markForCheck();
      },
    });
  }

  alterarSenha(event: Event) {
    event.preventDefault();
    this.erroSenha = '';
    this.mensagemSenha = '';

    if (!this.senhaAtual) {
      this.erroSenha = 'Digite a senha atual.';
      return;
    }
    if (!this.senhaValida) {
      this.erroSenha = 'A nova senha precisa ter pelo menos 8 caracteres, uma letra maiúscula e um caractere especial.';
      return;
    }

    this.salvandoSenha = true;
    this.http.put<{ mensagem: string }>(`${API_URL}/usuarios/senha`, {
      senhaAtual: this.senhaAtual,
      novaSenha: this.novaSenha,
    }, { headers: this.cabecalhoAuth() }).subscribe({
      next: () => {
        this.salvandoSenha = false;
        this.senhaAtual = '';
        this.novaSenha = '';
        this.mostrarSenhaAtual = false;
        this.mostrarNovaSenha = false;
        // era a senha provisória: libera o resto do sistema
        const eraProvisoria = !!this.usuario.trocarSenha;
        this.usarUsuario({ ...this.usuario, trocarSenha: false });
        this.mensagemSenha = eraProvisoria ? 'Senha criada! Já pode usar o sistema.' : 'Senha alterada!';
        this.cdr.markForCheck();
        setTimeout(() => { this.mensagemSenha = ''; this.cdr.markForCheck(); }, 3000);
        if (eraProvisoria) setTimeout(() => this.router.navigate(['/tela-inicial']), 1200);
      },
      error: (erro) => {
        this.salvandoSenha = false;
        this.erroSenha = erro?.error?.erro || 'Não foi possível trocar a senha.';
        this.cdr.markForCheck();
      },
    });
  }

  // ---------- seus dados (só dono) ----------

  /** Baixa um arquivo gerado aqui mesmo no navegador. */
  private baixarArquivo(conteudo: string, nome: string, tipo: string) {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private hojeParaArquivo(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** "Baixar todos os meus dados (.json)": backup + portabilidade (LGPD). */
  baixarTudo() {
    this.erroDados = '';
    this.baixandoTudo = true;
    this.http.get<unknown>(`${API_URL}/usuarios/exportar`, { headers: this.cabecalhoAuth() }).subscribe({
      next: (dados) => {
        this.baixandoTudo = false;
        this.baixarArquivo(JSON.stringify(dados, null, 2), `meufluxo-dados-${this.hojeParaArquivo()}.json`, 'application/json');
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.baixandoTudo = false;
        this.erroDados = erro?.error?.erro || 'Não foi possível juntar os seus dados.';
        this.cdr.markForCheck();
      },
    });
  }

  /** "Exportar clientes para planilha (.csv)": separado por ponto e vírgula, abre direto no Excel em português. */
  exportarCsv() {
    this.erroDados = '';
    this.exportandoCsv = true;
    this.http.get<{ clientes: { nome: string; telefone: string; email: string | null; endereco: string | null; criadoEm: string | null }[] }>(
      `${API_URL}/clientes`, { headers: this.cabecalhoAuth() }
    ).subscribe({
      next: ({ clientes }) => {
        this.exportandoCsv = false;
        const celula = (valor: unknown) => {
          const texto = String(valor ?? '');
          return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
        };
        const linhas = [
          ['Nome', 'Telefone', 'E-mail', 'Endereço', 'Cliente desde'].join(';'),
          ...clientes.map(c => [c.nome, c.telefone, c.email, c.endereco, (c.criadoEm || '').slice(0, 10)].map(celula).join(';')),
        ];
        // ﻿ no começo: o Excel entende os acentos
        this.baixarArquivo('﻿' + linhas.join('\r\n'), `meufluxo-clientes-${this.hojeParaArquivo()}.csv`, 'text/csv;charset=utf-8');
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.exportandoCsv = false;
        this.erroDados = erro?.error?.erro || 'Não foi possível exportar os clientes.';
        this.cdr.markForCheck();
      },
    });
  }

  /** "Importar clientes": lê o .csv ou o .json aqui e manda só a lista de clientes para a API. */
  importarClientes(event: Event) {
    const input = event.target as HTMLInputElement;
    const arquivo = input.files?.[0];
    input.value = '';
    this.erroDados = '';
    this.resumoImportacao = '';
    this.detalhesImportacao = [];
    if (!arquivo) return;
    if (arquivo.size > 5 * 1024 * 1024) {
      this.erroDados = 'O arquivo tem mais de 5 MB.';
      return;
    }

    const leitor = new FileReader();
    leitor.onload = () => {
      let clientes: ClienteImportado[];
      try {
        const texto = String(leitor.result || '').replace(/^﻿/, '');
        clientes = arquivo.name.toLowerCase().endsWith('.json') ? this.lerJson(texto) : this.lerCsv(texto);
      } catch (e) {
        this.erroDados = (e as Error).message || 'Não foi possível ler o arquivo.';
        this.cdr.markForCheck();
        return;
      }
      if (clientes.length === 0) {
        this.erroDados = 'Não encontramos nenhum cliente nesse arquivo.';
        this.cdr.markForCheck();
        return;
      }

      this.importando = true;
      this.cdr.markForCheck();
      this.http.post<{ importados: number; ignorados: number; repetidos: number; invalidos: { linha: number; nome: string; motivo: string }[] }>(
        `${API_URL}/clientes/importar`, { clientes }, { headers: this.cabecalhoAuth() }
      ).subscribe({
        next: (r) => {
          this.importando = false;
          this.resumoImportacao = `${r.importados} ${r.importados === 1 ? 'importado' : 'importados'}, ${r.ignorados} ${r.ignorados === 1 ? 'ignorado' : 'ignorados'}.`;
          if (r.repetidos > 0) this.detalhesImportacao.push(`${r.repetidos} com telefone que já estava cadastrado.`);
          for (const inv of r.invalidos) {
            this.detalhesImportacao.push(`Linha ${inv.linha}${inv.nome ? ` (${inv.nome})` : ''}: ${inv.motivo}`);
          }
          this.cdr.markForCheck();
        },
        error: (erro) => {
          this.importando = false;
          this.erroDados = erro?.error?.erro || 'Não foi possível importar os clientes.';
          this.cdr.markForCheck();
        },
      });
    };
    leitor.readAsText(arquivo, 'utf-8');
  }

  /** Backup do MeuFluxo ({ clientes: [...] }) ou uma lista simples de clientes. */
  private lerJson(texto: string): ClienteImportado[] {
    let dados: unknown;
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new Error('Esse .json não é válido.');
    }
    const lista = Array.isArray(dados) ? dados : (dados as { clientes?: unknown })?.clientes;
    if (!Array.isArray(lista)) throw new Error('Não encontramos a lista de clientes nesse .json.');
    return lista
      .filter(c => c && typeof c === 'object')
      .map(c => ({
        nome: String(c.nome ?? ''),
        telefone: String(c.telefone ?? ''),
        email: c.email ? String(c.email) : '',
        endereco: c.endereco ? String(c.endereco) : '',
      }));
  }

  /**
   * Planilha .csv (separada por ; ou ,). Se a primeira linha tiver os títulos
   * (Nome, Telefone, E-mail, Endereço), as colunas são achadas pelo nome;
   * sem títulos, a ordem é nome, telefone, e-mail, endereço.
   */
  private lerCsv(texto: string): ClienteImportado[] {
    const primeiraLinha = texto.split(/\r?\n/)[0] || '';
    const separador = (primeiraLinha.match(/;/g) || []).length >= (primeiraLinha.match(/,/g) || []).length ? ';' : ',';
    const linhas = this.dividirCsv(texto, separador).filter(l => l.some(c => c.trim()));
    if (linhas.length === 0) return [];

    const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const titulos = linhas[0].map(semAcento);
    const achar = (...nomes: string[]) => titulos.findIndex(t => nomes.some(n => t.includes(n)));
    let colNome = achar('nome', 'cliente');
    let colTelefone = achar('telefone', 'celular', 'whatsapp', 'fone');
    let colEmail = achar('e-mail', 'email');
    let colEndereco = achar('endereco');

    const temTitulos = colNome >= 0 && colTelefone >= 0;
    if (!temTitulos) {
      [colNome, colTelefone, colEmail, colEndereco] = [0, 1, 2, 3];
    }

    return linhas.slice(temTitulos ? 1 : 0).map(l => ({
      nome: (l[colNome] || '').trim(),
      telefone: (l[colTelefone] || '').trim(),
      email: colEmail >= 0 ? (l[colEmail] || '').trim() : '',
      endereco: colEndereco >= 0 ? (l[colEndereco] || '').trim() : '',
    }));
  }

  /** Divide o CSV em linhas e células, respeitando "aspas" (que podem ter ; e quebras de linha). */
  private dividirCsv(texto: string, separador: string): string[][] {
    const linhas: string[][] = [];
    let linha: string[] = [];
    let celula = '';
    let dentroDeAspas = false;

    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (dentroDeAspas) {
        if (c === '"' && texto[i + 1] === '"') { celula += '"'; i++; }
        else if (c === '"') dentroDeAspas = false;
        else celula += c;
      } else if (c === '"') {
        dentroDeAspas = true;
      } else if (c === separador) {
        linha.push(celula); celula = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && texto[i + 1] === '\n') i++;
        linha.push(celula); linhas.push(linha);
        linha = []; celula = '';
      } else {
        celula += c;
      }
    }
    if (celula || linha.length) { linha.push(celula); linhas.push(linha); }
    return linhas;
  }

  excluirConta() {
    const confirmou = confirm(
      'Isso vai excluir sua conta e apagar para sempre todos os clientes, serviços, agendamentos, despesas, metas, horário de trabalho e os acessos da equipe. Não pode ser desfeito.\n\nDica: baixe seus dados antes.\n\nExcluir mesmo assim?'
    );
    if (!confirmou) return;

    this.erroConta = '';
    this.excluindoConta = true;
    this.http.delete<{ mensagem: string }>(`${API_URL}/usuarios/conta`, { headers: this.cabecalhoAuth() }).subscribe({
      next: () => {
        localStorage.removeItem('meufluxo_token');
        localStorage.removeItem('usuarioLogado');
        this.router.navigate(['/login']);
      },
      error: (erro) => {
        this.excluindoConta = false;
        this.erroConta = erro?.error?.erro || 'Não foi possível excluir a conta. Tente novamente.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  HORÁRIO DE TRABALHO
  // =====================================================================

  private carregarHorario() {
    this.http.get<unknown>(`${API_URL}/horario-trabalho`, { headers: this.cabecalhoAuth() }).subscribe({
      next: (resposta) => {
        this.horario = normalizarHorarioTrabalho(resposta);
        this.erroCarregarHorario = '';
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.erroCarregarHorario = erro?.error?.erro || 'Não foi possível carregar o horário de trabalho.';
        this.cdr.markForCheck();
      },
    });
  }

  /** Opções do "Tamanho de cada horário" (se estava salvo 45 min, ele continua aparecendo). */
  get opcoesBloco(): number[] {
    return this.blocos.includes(this.horario.blocoMin) ? this.blocos : [...this.blocos, this.horario.blocoMin].sort((a, b) => a - b);
  }

  private paraMinutos(hhmm: string): number {
    const [h, m] = String(hhmm).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  }

  /** Mensagem do primeiro problema encontrado, ou '' se estiver tudo certo. */
  private validarHorario(): string {
    if (!this.horario.dias.some(d => d.ativo)) return 'Marque ao menos um dia de trabalho.';

    for (const i of this.ordemDias) {
      const d = this.horario.dias[i];
      if (!d.ativo) continue;
      const nome = this.nomesDias[i];
      if (!d.inicio || !d.fim) return `${nome}: preencha o horário de abrir e de fechar.`;
      const ini = this.paraMinutos(d.inicio);
      const fim = this.paraMinutos(d.fim);
      if (fim <= ini) return `${nome}: o horário de fechar precisa ser depois do de abrir.`;
      if (fim - ini < this.horario.blocoMin) return `${nome}: o período é menor que um horário de ${this.horario.blocoMin} min.`;

      if (!!d.pausaInicio !== !!d.pausaFim) return `${nome}: preencha o começo e o fim da pausa (ou deixe as duas vazias).`;
      if (d.pausaInicio) {
        const pi = this.paraMinutos(d.pausaInicio);
        const pf = this.paraMinutos(d.pausaFim);
        if (pf <= pi) return `${nome}: o fim da pausa precisa ser depois do começo.`;
        if (pi <= ini || pf >= fim) return `${nome}: a pausa precisa ficar dentro do horário de trabalho.`;
      }
    }
    return '';
  }

  /** "Copiar o horário de segunda para os outros dias" (os dias marcados; o domingo desmarcado continua fechado). */
  copiarSegunda() {
    const segunda = this.horario.dias[1];
    for (const i of this.ordemDias) {
      if (i === 1) continue;
      const dia = this.horario.dias[i];
      if (!dia.ativo) continue;
      dia.inicio = segunda.inicio;
      dia.fim = segunda.fim;
      dia.pausaInicio = segunda.pausaInicio;
      dia.pausaFim = segunda.pausaFim;
    }
    this.mensagemHorario = 'Copiado. Confira e clique em "Salvar horário".';
    this.erroHorario = '';
  }

  limparPausa(i: number) {
    this.horario.dias[i].pausaInicio = '';
    this.horario.dias[i].pausaFim = '';
  }

  salvarHorario() {
    this.mensagemHorario = '';
    this.erroHorario = this.validarHorario();
    if (this.erroHorario) return;

    this.salvandoHorario = true;
    this.http.put<unknown>(`${API_URL}/horario-trabalho`, {
      blocoMin: this.horario.blocoMin,
      dias: this.horario.dias,
    }, { headers: this.cabecalhoAuth() }).subscribe({
      next: (resposta) => {
        this.salvandoHorario = false;
        this.horario = normalizarHorarioTrabalho(resposta);
        this.mensagemHorario = 'Horário de trabalho salvo!';
        this.cdr.markForCheck();
        setTimeout(() => { this.mensagemHorario = ''; this.cdr.markForCheck(); }, 3000);
      },
      error: (erro) => {
        this.salvandoHorario = false;
        this.erroHorario = erro?.error?.erro || 'Não foi possível salvar o horário de trabalho.';
        this.cdr.markForCheck();
      },
    });
  }

  // ---------- folgas e feriados ----------

  get hojeISO(): string {
    return this.hojeParaArquivo();
  }

  private formBloqueioVazio() {
    return { tipo: 'Folga', descricao: 'Folga', data: '', dataFim: '', diaInteiro: true, horaInicio: '12:00', horaFim: '18:00' };
  }

  /** Vários dias (ex.: férias de 20 a 30): sempre o dia inteiro. */
  get bloqueioVariosDias(): boolean {
    const f = this.formBloqueio;
    return !!f.data && !!f.dataFim && f.dataFim > f.data;
  }

  abrirFormBloqueio() {
    this.formBloqueio = this.formBloqueioVazio();
    this.erroBloqueio = '';
    this.avisoBloqueio = '';
    this.formBloqueioAberto = true;
  }

  fecharFormBloqueio() {
    this.formBloqueioAberto = false;
  }

  /** Trocar o tipo preenche o nome (se a pessoa ainda não escreveu outro). */
  escolherTipoBloqueio(tipo: string) {
    const f = this.formBloqueio;
    if (!f.descricao.trim() || this.tiposBloqueio.includes(f.descricao.trim())) {
      f.descricao = tipo === 'Outro' ? '' : tipo;
    }
    f.tipo = tipo;
  }

  /** Ao mudar o "De", o "Até" não pode ficar antes dele. */
  aoMudarInicioBloqueio() {
    const f = this.formBloqueio;
    if (f.dataFim && f.dataFim < f.data) f.dataFim = f.data;
  }

  salvarBloqueio(event: Event) {
    event.preventDefault();
    this.erroBloqueio = '';
    const f = this.formBloqueio;
    const fim = f.dataFim || f.data;
    if (!f.data) { this.erroBloqueio = 'Escolha a data.'; return; }
    if (f.data < this.hojeISO) { this.erroBloqueio = 'Essa data já passou.'; return; }
    if (fim < f.data) { this.erroBloqueio = 'A data final precisa ser depois da inicial.'; return; }
    if (!f.descricao.trim()) { this.erroBloqueio = 'Dê um nome (ex.: Férias, Folga, Finados).'; return; }
    const umPeriodo = !this.bloqueioVariosDias && !f.diaInteiro;
    if (umPeriodo && this.paraMinutos(f.horaFim) <= this.paraMinutos(f.horaInicio)) {
      this.erroBloqueio = 'A hora final precisa ser depois da inicial.';
      return;
    }

    this.salvandoBloqueio = true;
    this.http.post<{ bloqueios: Bloqueio[]; agendamentosNoPeriodo: number }>(`${API_URL}/horario-trabalho/bloqueios`, {
      data: f.data,
      dataFim: fim,
      descricao: f.descricao.trim(),
      horaInicio: umPeriodo ? f.horaInicio : null,
      horaFim: umPeriodo ? f.horaFim : null,
    }, { headers: this.cabecalhoAuth() }).subscribe({
      next: ({ bloqueios, agendamentosNoPeriodo }) => {
        this.salvandoBloqueio = false;
        this.horario.bloqueios = [...this.horario.bloqueios, ...bloqueios]
          .sort((a, b) => a.data.localeCompare(b.data) || String(a.horaInicio).localeCompare(String(b.horaInicio)));
        this.formBloqueioAberto = false;
        this.avisoBloqueio = agendamentosNoPeriodo > 0
          ? `Atenção: ${agendamentosNoPeriodo} ${agendamentosNoPeriodo === 1 ? 'agendamento continua marcado' : 'agendamentos continuam marcados'} nesse período. Remarque ou cancele na Agenda.`
          : '';
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.salvandoBloqueio = false;
        this.erroBloqueio = erro?.error?.erro || 'Não foi possível bloquear o dia.';
        this.cdr.markForCheck();
      },
    });
  }

  /** Junta os dias seguidos de dia inteiro com o mesmo nome (férias de 20 a 30 = uma linha). */
  get gruposBloqueio(): GrupoBloqueio[] {
    const grupos: GrupoBloqueio[] = [];
    for (const b of this.horario.bloqueios) {
      const ultimo = grupos[grupos.length - 1];
      const diaInteiro = !b.horaInicio;
      if (ultimo && diaInteiro && !ultimo.horaInicio && ultimo.descricao === b.descricao && this.diaSeguinte(ultimo.fim) === b.data) {
        ultimo.fim = b.data;
        ultimo.ids.push(b.id);
      } else {
        grupos.push({ ids: [b.id], inicio: b.data, fim: b.data, horaInicio: b.horaInicio, horaFim: b.horaFim, descricao: b.descricao });
      }
    }
    return grupos;
  }

  private diaSeguinte(data: string): string {
    const [ano, mes, dia] = data.split('-').map(Number);
    const d = new Date(ano, mes - 1, dia + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private dataCurtaBloqueio(data: string): string {
    return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
  }

  removerGrupo(g: GrupoBloqueio) {
    const quando = g.inicio === g.fim ? this.dataCurtaBloqueio(g.inicio) : `${this.dataCurtaBloqueio(g.inicio)} a ${this.dataCurtaBloqueio(g.fim)}`;
    if (!confirm(`Remover "${g.descricao}" (${quando})? Esses dias voltam a aceitar agendamentos.`)) return;
    forkJoin(g.ids.map(id => this.http.delete(`${API_URL}/horario-trabalho/bloqueios/${id}`, { headers: this.cabecalhoAuth() }))).subscribe({
      next: () => {
        this.horario.bloqueios = this.horario.bloqueios.filter(x => !g.ids.includes(x.id));
        this.avisoBloqueio = '';
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.erroBloqueio = erro?.error?.erro || 'Não foi possível remover.';
        this.carregarHorario(); // recarrega para mostrar o que sobrou
        this.cdr.markForCheck();
      },
    });
  }

  diaDoGrupo(g: GrupoBloqueio): string {
    return g.inicio.slice(8, 10);
  }

  mesDoGrupo(g: GrupoBloqueio): string {
    return this.mesesCurtos[Number(g.inicio.slice(5, 7)) - 1];
  }

  /** "segunda · dia inteiro" · "20/10 a 30/10 · 11 dias" · "terça · fechado à tarde (12:00 – 18:00)" */
  detalheGrupo(g: GrupoBloqueio): string {
    if (g.inicio !== g.fim) {
      return `${this.dataCurtaBloqueio(g.inicio)} a ${this.dataCurtaBloqueio(g.fim)} · ${g.ids.length} dias`;
    }
    const [ano, mes, dia] = g.inicio.split('-').map(Number);
    const semana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(ano, mes - 1, dia).getDay()];
    if (!g.horaInicio || !g.horaFim) return `${semana} · dia inteiro`;
    const periodo = `${g.horaInicio} – ${g.horaFim}`;
    if (this.paraMinutos(g.horaInicio) >= 12 * 60) return `${semana} · fechado à tarde (${periodo})`;
    if (this.paraMinutos(g.horaFim) <= 12 * 60) return `${semana} · fechado de manhã (${periodo})`;
    return `${semana} · fechado das ${g.horaInicio} às ${g.horaFim}`;
  }

  // =====================================================================
  //  EQUIPE
  // =====================================================================

  private carregarEquipe() {
    this.http.get<{ equipe: Pessoa[] }>(`${API_URL}/equipe`, { headers: this.cabecalhoAuth() }).subscribe({
      next: ({ equipe }) => {
        this.equipe = equipe;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.erroEquipe = erro?.error?.erro || 'Não foi possível carregar a equipe.';
        this.cdr.markForCheck();
      },
    });
  }

  /** "você" · "último acesso hoje" · "último acesso ontem" · "último acesso em 12/10" · "ainda não entrou" */
  situacao(p: Pessoa): string {
    if (p.id === this.usuario.id) return 'você';
    if (!p.ultimoAcesso) return 'ainda não entrou';
    const dia = p.ultimoAcesso.slice(0, 10);
    const hoje = this.hojeISO;
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const ontemISO = `${ontem.getFullYear()}-${String(ontem.getMonth() + 1).padStart(2, '0')}-${String(ontem.getDate()).padStart(2, '0')}`;
    if (dia === hoje) return 'último acesso hoje';
    if (dia === ontemISO) return 'último acesso ontem';
    return `último acesso em ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  }

  primeiroNome(nome: string): string {
    return (nome || '').trim().split(/\s+/)[0];
  }

  criarAcesso(event: Event) {
    event.preventDefault();
    this.erroNovo = '';
    this.mensagemEquipe = '';
    const n = this.novoAtendente;
    if (!n.nome.trim() || !n.email.trim() || !n.senha) {
      this.erroNovo = 'Preencha nome, e-mail e senha provisória.';
      return;
    }
    if (n.senha.length < 8 || !/[A-Z]/.test(n.senha) || !/[^A-Za-z0-9]/.test(n.senha)) {
      this.erroNovo = 'A senha provisória precisa ter 8 caracteres, uma letra maiúscula e um caractere especial.';
      return;
    }

    this.criandoAcesso = true;
    // o que ficou marcado em "O que pode acessar" (dá para mudar depois na tabela)
    this.http.post<{ pessoa: Pessoa }>(`${API_URL}/equipe`, {
      nome: n.nome.trim(),
      email: n.email.trim(),
      senha: n.senha,
      permissoes: n.permissoes,
    }, { headers: this.cabecalhoAuth() }).subscribe({
      next: ({ pessoa }) => {
        this.criandoAcesso = false;
        this.equipe = [...this.equipe, pessoa];
        this.novoAtendente = { nome: '', email: '', senha: '', permissoes: [] };
        this.mostrarSenhaNovo = false;
        this.mensagemEquipe = `Acesso criado para ${this.primeiroNome(pessoa.nome)}. Passe o e-mail e a senha provisória para ela.`;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.criandoAcesso = false;
        this.erroNovo = erro?.error?.erro || 'Não foi possível criar o acesso.';
        this.cdr.markForCheck();
      },
    });
  }

  abrirRedefinir(p: Pessoa) {
    this.redefinindo = p;
    this.senhaRedefinir = '';
    this.erroRedefinir = '';
  }

  fecharRedefinir() {
    this.redefinindo = null;
  }

  salvarRedefinir(event: Event) {
    event.preventDefault();
    const p = this.redefinindo;
    if (!p) return;
    const s = this.senhaRedefinir;
    if (s.length < 8 || !/[A-Z]/.test(s) || !/[^A-Za-z0-9]/.test(s)) {
      this.erroRedefinir = 'A senha provisória precisa ter 8 caracteres, uma letra maiúscula e um caractere especial.';
      return;
    }
    this.salvandoRedefinir = true;
    this.http.put(`${API_URL}/equipe/${p.id}/senha`, { senha: s }, { headers: this.cabecalhoAuth() }).subscribe({
      next: () => {
        this.salvandoRedefinir = false;
        this.redefinindo = null;
        this.mensagemEquipe = `Senha de ${this.primeiroNome(p.nome)} redefinida. Ela troca no próximo acesso.`;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.salvandoRedefinir = false;
        this.erroRedefinir = erro?.error?.erro || 'Não foi possível redefinir a senha.';
        this.cdr.markForCheck();
      },
    });
  }

  removerPessoa(p: Pessoa) {
    if (!confirm(`Remover o acesso de ${p.nome}? Ela não consegue mais entrar. Os atendimentos que registrou continuam no sistema.`)) return;
    this.http.delete(`${API_URL}/equipe/${p.id}`, { headers: this.cabecalhoAuth() }).subscribe({
      next: () => {
        this.equipe = this.equipe.filter(x => x.id !== p.id);
        this.mensagemEquipe = `Acesso de ${this.primeiroNome(p.nome)} removido.`;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.erroEquipe = erro?.error?.erro || 'Não foi possível remover.';
        this.cdr.markForCheck();
      },
    });
  }

  /** O atendente pode fazer isso? (linha fixa ou caixa marcada) */
  pode(p: Pessoa, linha: LinhaPermissao): boolean {
    return linha.permissao ? p.permissoes.includes(linha.permissao) : linha.atendentePode;
  }

  /** Marca/desmarca a caixa e salva na hora. */
  alternarPermissao(p: Pessoa, permissao: string) {
    const antes = p.permissoes;
    p.permissoes = antes.includes(permissao) ? antes.filter(x => x !== permissao) : [...antes, permissao];
    this.erroEquipe = '';
    this.http.put<{ permissoes: string[] }>(`${API_URL}/equipe/${p.id}/permissoes`, { permissoes: p.permissoes }, { headers: this.cabecalhoAuth() }).subscribe({
      next: ({ permissoes }) => {
        p.permissoes = permissoes;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        p.permissoes = antes; // volta como estava
        this.erroEquipe = erro?.error?.erro || 'Não foi possível salvar a permissão.';
        this.cdr.markForCheck();
      },
    });
  }

  // =====================================================================
  //  APARÊNCIA (as cores mudam na hora; "Salvar aparência" grava para a equipe toda)
  // =====================================================================

  /** 3 bolinhas de cada paleta: principal, acento e destaque (a mesma conta do styles.css). */
  amostrasDoTema(t: TemaCores): string[] {
    return [
      `hsl(${t.h} ${t.s}% 35%)`,
      `hsl(${(t.h + 150) % 360} 45% 56%)`,
      `hsl(${(t.h + 210) % 360} 34% 45%)`,
    ];
  }

  temaEstaAtivo(t: TemaCores): boolean {
    return this.tema.id === t.id;
  }

  /** Ângulos das 3 cores no círculo cromático (harmonia complementar dividida). */
  get angulosHarmonia() {
    const h = this.tema.h;
    return [
      { papel: 'Base', angulo: h },
      { papel: 'Acento', angulo: this.tema.hAcento ?? (h + 150) % 360 },
      { papel: 'Destaque', angulo: this.tema.hDestaque ?? (h + 210) % 360 },
    ];
  }

  /** Converte HSL em #rrggbb (para mostrar no seletor a cor que o sistema calculou). */
  private hslParaHex(h: number, s: number, l: number): string {
    const sat = s / 100;
    const luz = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = sat * Math.min(luz, 1 - luz);
    const f = (n: number) => luz - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const paraHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${paraHex(f(0))}${paraHex(f(8))}${paraHex(f(4))}`;
  }

  /** Acento e destaque: os salvos, ou os calculados pelo círculo cromático a partir da principal. */
  private iniciarCoresPersonalizadas() {
    const salva = this.aparenciaGravada;
    this.corAcento = salva.corAcento || '';
    this.corDestaque = salva.corDestaque || '';
    this.recalcularCoresAutomaticas();
  }

  /** Atualiza nos seletores as cores que estão no automático. */
  private recalcularCoresAutomaticas() {
    const h = temaDeHex(this.corPersonalizada).h;
    if (!this.acentoManual) this.corAcento = this.hslParaHex((h + 150) % 360, 45, 56);
    if (!this.destaqueManual) this.corDestaque = this.hslParaHex((h + 210) % 360, 34, 45);
  }

  /** Aplica na hora as 3 cores da Personalizada (a prévia e o sistema mudam juntos). */
  private aplicarPersonalizada() {
    this.tema = temaDaAparencia(this.aparenciaEscolhidaPersonalizada());
    this.mensagemAparencia = '';
    aplicarTema(this.tema);
  }

  private aparenciaEscolhidaPersonalizada(): Aparencia {
    return {
      paleta: 'personalizada',
      corPrimaria: this.corPersonalizada.toLowerCase(),
      corAcento: this.acentoManual ? this.corAcento.toLowerCase() : null,
      corDestaque: this.destaqueManual ? this.corDestaque.toLowerCase() : null,
      tamanhoTexto: this.tamanhoTexto,
    };
  }

  /** Os 3 seletores mudam o sistema na hora (enquanto arrasta a cor). */
  mudarCorPrincipal(hex: string) {
    this.corPersonalizada = hex;
    this.recalcularCoresAutomaticas();
    this.aplicarPersonalizada();
  }

  mudarCorAcento(hex: string) {
    this.corAcento = hex;
    this.acentoManual = true;
    this.aplicarPersonalizada();
  }

  mudarCorDestaque(hex: string) {
    this.corDestaque = hex;
    this.destaqueManual = true;
    this.aplicarPersonalizada();
  }

  /** "Calcular pelo círculo cromático": acento e destaque voltam a acompanhar a cor principal. */
  calcularPeloCirculo() {
    this.acentoManual = false;
    this.destaqueManual = false;
    this.recalcularCoresAutomaticas();
    this.aplicarPersonalizada();
  }

  /** Cor clara demais para texto branco (contraste < 4,5:1). */
  get corPersonalizadaClara(): boolean {
    return /^#[0-9a-f]{6}$/i.test(this.corPersonalizada) && contrasteComBranco(this.corPersonalizada) < 4.5;
  }

  /** Mudou alguma coisa em relação ao que está salvo? */
  get aparenciaAlterada(): boolean {
    const atual = this.aparenciaEscolhida();
    const salva = this.aparenciaGravada;
    return atual.paleta !== salva.paleta
      || (atual.corPrimaria || '') !== (salva.corPrimaria || '')
      || (atual.corAcento || '') !== (salva.corAcento || '')
      || (atual.corDestaque || '') !== (salva.corDestaque || '')
      || atual.tamanhoTexto !== salva.tamanhoTexto;
  }

  escolherTema(t: TemaCores) {
    this.tema = { ...t };
    this.mensagemAparencia = '';
    aplicarTema(this.tema);
  }

  escolherTamanho(tamanho: 'normal' | 'grande') {
    this.tamanhoTexto = tamanho;
    this.mensagemAparencia = '';
    aplicarTamanhoTexto(tamanho);
  }

  private aparenciaEscolhida(): Aparencia {
    if (this.tema.id === 'personalizada') return this.aparenciaEscolhidaPersonalizada();
    return { paleta: this.tema.id, corPrimaria: null, corAcento: null, corDestaque: null, tamanhoTexto: this.tamanhoTexto };
  }

  salvarAparencia() {
    this.erroAparencia = '';
    this.mensagemAparencia = '';
    this.salvandoAparencia = true;
    this.http.put<{ aparencia: Aparencia }>(`${API_URL}/usuarios/aparencia`, this.aparenciaEscolhida(), { headers: this.cabecalhoAuth() }).subscribe({
      next: ({ aparencia }) => {
        this.salvandoAparencia = false;
        this.aparenciaGravada = aparencia;
        guardarAparencia(aparencia);
        aplicarAparencia(aparencia);
        this.mensagemAparencia = 'Aparência salva! Vale para você e para a sua equipe.';
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.salvandoAparencia = false;
        this.erroAparencia = erro?.error?.erro || 'Não foi possível salvar a aparência.';
        this.cdr.markForCheck();
      },
    });
  }

  /** Volta para o que está salvo (desfaz a prévia). */
  desfazerAparencia() {
    this.tema = temaDaAparencia(this.aparenciaGravada);
    this.tamanhoTexto = this.aparenciaGravada.tamanhoTexto;
    this.corPersonalizada = this.aparenciaGravada.corPrimaria || hexDoTema(this.tema);
    this.acentoManual = !!this.aparenciaGravada.corAcento;
    this.destaqueManual = !!this.aparenciaGravada.corDestaque;
    this.iniciarCoresPersonalizadas();
    this.mensagemAparencia = '';
    aplicarAparencia(this.aparenciaGravada);
  }
}
