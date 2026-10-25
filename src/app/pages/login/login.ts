import { AfterViewInit, Component, ChangeDetectorRef, ElementRef, NgZone, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

import { API_URL, guardarLogin, mostrarBotaoGoogle } from '../../app';

/** Telas dentro do card: entrar, "esqueci minha senha" (e-mail) e "digite o código". */
type Modo = 'entrar' | 'email' | 'codigo';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class Login implements AfterViewInit {
  @ViewChild('botaoGoogle') botaoGoogle?: ElementRef<HTMLDivElement>;

  modo: Modo = 'entrar';
  email: string = '';
  senha: string = '';
  mostrarSenha = false;
  carregando = false;
  erro: string | null = null;
  aviso: string | null = null;
  temGoogle = false;

  // esqueci minha senha
  codigo = '';
  novaSenha = '';
  mostrarNovaSenha = false;

  get senhaTemComprimento(): boolean { return this.novaSenha.length >= 8; }
  get senhaTemMaiuscula(): boolean { return /[A-Z]/.test(this.novaSenha); }
  get senhaTemEspecial(): boolean { return /[^A-Za-z0-9]/.test(this.novaSenha); }

  constructor(
    private router: Router,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
  ) {}

  ngAfterViewInit() {
    this.prepararGoogle();
  }

  /** Desenha o botão do Google (só aparece se o back-end tiver o GOOGLE_CLIENT_ID). */
  private prepararGoogle() {
    const elemento = this.botaoGoogle?.nativeElement;
    if (!elemento) return;
    mostrarBotaoGoogle(elemento, this.http, (credential) => this.zone.run(() => this.entrarComGoogle(credential)))
      .then((ok) => {
        this.temGoogle = ok;
        this.cdr.markForCheck();
      });
  }

  fazerLogin(event: Event) {
    event.preventDefault();
    this.erro = null;
    this.aviso = null;

    if (!this.email || !this.senha) {
      this.erro = 'Preencha e-mail e senha!';
      return;
    }

    this.carregando = true;
    this.http.post<{ usuario: any; token: string }>(`${API_URL}/usuarios/login`, {
      email: this.email,
      senha: this.senha,
    }).subscribe({
      next: (resposta) => guardarLogin(resposta, this.router),
      error: (erro) => {
        this.carregando = false;
        this.erro = erro?.error?.erro || 'Não foi possível fazer login. Tente novamente.';
        this.cdr.markForCheck();
      },
    });
  }

  private entrarComGoogle(credential: string) {
    this.erro = null;
    this.carregando = true;
    this.http.post<{ usuario: any; token: string }>(`${API_URL}/usuarios/google`, { credential }).subscribe({
      next: (resposta) => guardarLogin(resposta, this.router),
      error: (erro) => {
        this.carregando = false;
        this.erro = erro?.error?.erro || 'Não foi possível entrar com o Google.';
        this.cdr.markForCheck();
      },
    });
  }

  // ---------- esqueci minha senha ----------

  irPara(modo: Modo) {
    this.modo = modo;
    this.erro = null;
    if (modo === 'entrar') {
      this.codigo = '';
      this.novaSenha = '';
      // o botão do Google é desenhado de novo quando a tela "Entrar" volta
      setTimeout(() => this.prepararGoogle());
    }
  }

  enviarCodigo(event?: Event) {
    event?.preventDefault();
    this.erro = null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      this.erro = 'Digite o e-mail da sua conta.';
      return;
    }
    this.carregando = true;
    this.http.post<{ mensagem: string }>(`${API_URL}/usuarios/senha/codigo`, { email: this.email.trim() }).subscribe({
      next: ({ mensagem }) => {
        this.carregando = false;
        this.aviso = mensagem;
        this.modo = 'codigo';
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.carregando = false;
        this.erro = erro?.error?.erro || 'Não foi possível enviar o código.';
        this.cdr.markForCheck();
      },
    });
  }

  redefinir(event: Event) {
    event.preventDefault();
    this.erro = null;
    if (this.codigo.replace(/\D/g, '').length !== 6) {
      this.erro = 'Digite o código de 6 números.';
      return;
    }
    if (!this.senhaTemComprimento || !this.senhaTemMaiuscula || !this.senhaTemEspecial) {
      this.erro = 'A nova senha precisa ter 8 caracteres, uma letra maiúscula e um caractere especial.';
      return;
    }
    this.carregando = true;
    this.http.post<{ usuario: any; token: string }>(`${API_URL}/usuarios/senha/redefinir`, {
      email: this.email.trim(),
      codigo: this.codigo,
      novaSenha: this.novaSenha,
    }).subscribe({
      next: (resposta) => guardarLogin(resposta, this.router), // senha nova → já entra
      error: (erro) => {
        this.carregando = false;
        this.erro = erro?.error?.erro || 'Não foi possível trocar a senha.';
        this.cdr.markForCheck();
      },
    });
  }
}
