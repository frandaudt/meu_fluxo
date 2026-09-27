import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';

const API_URL = 'http://localhost:3001/api';

interface Usuario {
  nome: string;
  email: string;
  telefone?: string;
  nomeNegocio?: string;
}
// horário em que a pessoa atende (usado na grade de disponibilidade da tela Início)
interface DiaTrabalho { ativo: boolean; inicio: string; fim: string; }
interface HorarioTrabalho {
  blocoMin: number;     // tamanho de cada horário da grade, em minutos
  dias: DiaTrabalho[];  // dias[0] = domingo ... dias[6] = sábado
}

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './perfil.html',
  styleUrl: './perfil.css',
})
export class Perfil implements OnInit {

  erroConta: string | null = null;
excluindoConta = false;

  private readonly HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

  readonly blocos = [15, 30, 45, 60];
  readonly nomesDias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  /** ordem de exibição: começa na segunda e termina no domingo */
  readonly ordemDias = [1, 2, 3, 4, 5, 6, 0];

  carregando = true;

  horario: HorarioTrabalho = this.horarioPadrao();
  erroHorario = '';
  mensagemHorario = '';

  usuario: Usuario = { nome: '', email: '' };
  form = { nome: '', email: '', telefone: '', nomeNegocio: '' };
  erroPerfil: string | null = null;
  mensagemPerfil: string | null = null;
  salvandoPerfil = false;

  modalSenhaAberto = false;
  senhaAtual = '';
  novaSenha = '';
  confirmarSenha = '';
  erroSenha: string | null = null;
  salvandoSenha = false;

  get senhaTemComprimento(): boolean {
    return this.novaSenha.length >= 6;
  }
  get senhaTemMaiuscula(): boolean {
    return /[A-Z]/.test(this.novaSenha);
  }
  get senhaTemEspecial(): boolean {
    return /[^A-Za-z0-9]/.test(this.novaSenha);
  }
  get senhaValida(): boolean {
    return this.senhaTemComprimento && this.senhaTemMaiuscula && this.senhaTemEspecial;
  }

  constructor(private router: Router, private http: HttpClient, private cdr: ChangeDetectorRef) {}

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

    this.http.get<{ usuario: Usuario }>(`${API_URL}/usuarios/perfil`, {
      headers: this.cabecalhoAuth(),
    }).subscribe({
      next: (resposta) => {
        this.usuario = resposta.usuario;
        this.form = {
          nome: this.usuario.nome || '',
          email: this.usuario.email || '',
          telefone: this.usuario.telefone || '',
          nomeNegocio: this.usuario.nomeNegocio || '',
        };
        this.carregando = false;
        this.cdr.markForCheck();
      },
      error: () => {
        localStorage.removeItem('meufluxo_token');
        localStorage.removeItem('usuarioLogado');
        this.router.navigate(['/login']);
      },
    });

    this.http.get<{ horario: HorarioTrabalho | null }>(`${API_URL}/horario-trabalho`, {
      headers: this.cabecalhoAuth(),
    }).subscribe({
      next: (resposta) => {
        this.horario = this.normalizarHorario(resposta.horario);
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
      },
    });
  }
  // ---------- horário de trabalho ----------

  /** Padrão: segunda a sábado, 08:00 às 18:00, domingo fechado, blocos de 30 min. */
  private horarioPadrao(): HorarioTrabalho {
    const util = (): DiaTrabalho => ({ ativo: true, inicio: '08:00', fim: '18:00' });
    return {
      blocoMin: 30,
      dias: [{ ativo: false, inicio: '08:00', fim: '18:00' }, util(), util(), util(), util(), util(), util()],
    };
  }

  /** Garante um horário válido a partir do que estiver salvo (ou devolve o padrão). */
  private normalizarHorario(bruto: unknown): HorarioTrabalho {
    const padrao = this.horarioPadrao();
    if (!bruto || typeof bruto !== 'object') return padrao;

    const b = bruto as { blocoMin?: unknown; dias?: unknown };
    const bloco = this.blocos.includes(Number(b.blocoMin)) ? Number(b.blocoMin) : padrao.blocoMin;

    const dias = padrao.dias.map((d, i) => {
      const salvo = Array.isArray(b.dias) ? (b.dias[i] as Record<string, unknown> | undefined) : undefined;
      if (!salvo || typeof salvo !== 'object') return d;
      return {
        ativo: typeof salvo['ativo'] === 'boolean' ? (salvo['ativo'] as boolean) : d.ativo,
        inicio: this.HORA_REGEX.test(String(salvo['inicio'])) ? String(salvo['inicio']) : d.inicio,
        fim: this.HORA_REGEX.test(String(salvo['fim'])) ? String(salvo['fim']) : d.fim,
      };
    });

    return { blocoMin: bloco, dias };
  }

  private paraMinutos(hhmm: string): number {
    const [h, m] = String(hhmm).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  }

  /** Devolve a mensagem do primeiro problema encontrado, ou '' se estiver tudo certo. */
  private validarHorario(): string {
    if (!this.horario.dias.some(d => d.ativo)) return 'Marque ao menos um dia de trabalho.';

    for (let i = 0; i < this.horario.dias.length; i++) {
      const d = this.horario.dias[i];
      if (!d.ativo) continue;
      if (!this.HORA_REGEX.test(d.inicio) || !this.HORA_REGEX.test(d.fim)) {
        return `${this.nomesDias[i]}: preencha o horário de início e de fim.`;
      }
      if (this.paraMinutos(d.fim) <= this.paraMinutos(d.inicio)) {
        return `${this.nomesDias[i]}: o horário final precisa ser depois do inicial.`;
      }
      if (this.paraMinutos(d.fim) - this.paraMinutos(d.inicio) < this.horario.blocoMin) {
        return `${this.nomesDias[i]}: o período é menor que um horário de ${this.horario.blocoMin} min.`;
      }
    }
    return '';
  }

  /** Copia o horário do primeiro dia ativo para todos os outros dias em que a pessoa trabalha. */
  aplicarHorarioATodos() {
    const modelo = this.ordemDias.map(i => this.horario.dias[i]).find(d => d.ativo);
    if (!modelo) return;
    for (const dia of this.horario.dias) {
      if (dia.ativo) {
        dia.inicio = modelo.inicio;
        dia.fim = modelo.fim;
      }
    }
  }

  salvarHorario() {
    this.mensagemHorario = '';
    this.erroHorario = this.validarHorario();
    if (this.erroHorario) return;

    this.http.put<{ horario: HorarioTrabalho }>(`${API_URL}/horario-trabalho`, this.horario, {
      headers: this.cabecalhoAuth(),
    }).subscribe({
      next: (resposta) => {
        this.horario = this.normalizarHorario(resposta.horario);
        this.mensagemHorario = 'Horário de trabalho salvo!';
        this.cdr.markForCheck();
        setTimeout(() => {
          this.mensagemHorario = '';
          this.cdr.markForCheck();
        }, 3000);
      },
      error: (erro) => {
        console.error(erro);
        this.erroHorario = 'Não foi possível salvar o horário de trabalho.';
        this.cdr.markForCheck();
      },
    });
  }

  get inicialNome(): string {
    return this.form.nome ? this.form.nome.charAt(0).toUpperCase() : 'U';
  }

  salvarPerfil(event: Event) {
    event.preventDefault();
    this.erroPerfil = null;
    this.mensagemPerfil = null;

    if (!this.form.nome || !this.form.email) {
      this.erroPerfil = 'Preencha ao menos o nome e o e-mail!';
      return;
    }

    this.salvandoPerfil = true;

    this.http.put<{ usuario: Usuario }>(`${API_URL}/usuarios/perfil`, {
      nome: this.form.nome,
      email: this.form.email,
      telefone: this.form.telefone,
      nomeNegocio: this.form.nomeNegocio,
    }, { headers: this.cabecalhoAuth() }).subscribe({
      next: (resposta) => {
        this.usuario = resposta.usuario;
        localStorage.setItem('usuarioLogado', JSON.stringify(resposta.usuario));
        this.salvandoPerfil = false;
        this.mensagemPerfil = 'Perfil atualizado com sucesso!';
        this.cdr.markForCheck();
        setTimeout(() => {
          this.mensagemPerfil = null;
          this.cdr.markForCheck();
        }, 3000);
      },
      error: (erro) => {
        this.salvandoPerfil = false;
        this.erroPerfil = erro?.error?.erro || 'Não foi possível atualizar o perfil.';
        this.cdr.markForCheck();
      },
    });
  }

  abrirModalSenha() {
    this.senhaAtual = '';
    this.novaSenha = '';
    this.confirmarSenha = '';
    this.erroSenha = null;
    this.modalSenhaAberto = true;
  }

  fecharModalSenha() {
    this.modalSenhaAberto = false;
  }

  salvarNovaSenha(event: Event) {
    event.preventDefault();
    this.erroSenha = null;

   if (!this.senhaValida) {
    this.erroSenha = 'A senha precisa ter pelo menos 6 caracteres, uma letra maiúscula e um caractere especial.';
    return;
  }

  if (this.novaSenha !== this.confirmarSenha) {
    this.erroSenha = 'A nova senha e a confirmação precisam ser iguais!';
    return;
  }

    this.salvandoSenha = true;

    this.http.put<{ mensagem: string }>(`${API_URL}/usuarios/senha`, {
      senhaAtual: this.senhaAtual,
      novaSenha: this.novaSenha,
    }, { headers: this.cabecalhoAuth() }).subscribe({
      next: () => {
        this.salvandoSenha = false;
        this.fecharModalSenha();
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.salvandoSenha = false;
        this.erroSenha = erro?.error?.erro || 'Não foi possível trocar a senha.';
        this.cdr.markForCheck();
      },
    });
  }

excluirConta() {
  const confirmou = confirm(
    'Isso vai excluir sua conta e apagar permanentemente todos os seus clientes, serviços, agendamentos, despesas, metas e horário de trabalho. Essa ação não pode ser desfeita. Continuar?'
  );
  if (!confirmou) return;

  this.erroConta = null;
  this.excluindoConta = true;

  this.http.delete<{ mensagem: string }>(`${API_URL}/usuarios/conta`, {
    headers: this.cabecalhoAuth(),
  }).subscribe({
    next: () => {
      localStorage.removeItem('meufluxo_token');
      localStorage.removeItem('usuarioLogado');
      this.router.navigate(['/login']);
    },
    error: (erro) => {
      console.error(erro);
      this.excluindoConta = false;
      this.erroConta = erro?.error?.erro || 'Não foi possível excluir a conta. Tente novamente.';
      this.cdr.markForCheck();
    },
  });
}
}
