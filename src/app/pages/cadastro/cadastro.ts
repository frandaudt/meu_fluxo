import { AfterViewInit, Component, ChangeDetectorRef, ElementRef, NgZone, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

import { API_URL, guardarLogin, mostrarBotaoGoogle } from '../../app';

@Component({
  selector: 'app-cadastro',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './cadastro.html',
  styleUrl: './cadastro.css'
})
export class Cadastro implements AfterViewInit {
  @ViewChild('botaoGoogle') botaoGoogle?: ElementRef<HTMLDivElement>;
  temGoogle = false;

  nome: string = '';
  email: string = '';
  senha: string = '';
  mostrarSenha = false;
  carregando = false;
  erro: string | null = null;

  get senhaTemComprimento(): boolean { return this.senha.length >= 8; }
  get senhaTemMaiuscula(): boolean { return /[A-Z]/.test(this.senha); }
  get senhaTemEspecial(): boolean { return /[^A-Za-z0-9]/.test(this.senha); }
  get senhaValida(): boolean {
    return this.senhaTemComprimento && this.senhaTemMaiuscula && this.senhaTemEspecial;
  }

  constructor(private router: Router, private http: HttpClient, private cdr: ChangeDetectorRef, private zone: NgZone) {}

  /** "Continuar com Google": cria a conta (ou entra, se já existir) sem precisar de senha. */
  ngAfterViewInit() {
    const elemento = this.botaoGoogle?.nativeElement;
    if (!elemento) return;
    mostrarBotaoGoogle(elemento, this.http, (credential) => this.zone.run(() => {
      this.erro = null;
      this.carregando = true;
      this.http.post<{ usuario: any; token: string }>(`${API_URL}/usuarios/google`, { credential }).subscribe({
        next: (resposta) => guardarLogin(resposta, this.router),
        error: (erro) => {
          this.carregando = false;
          this.erro = erro?.error?.erro || 'Não foi possível continuar com o Google.';
          this.cdr.markForCheck();
        },
      });
    })).then((ok) => {
      this.temGoogle = ok;
      this.cdr.markForCheck();
    });
  }

  fazerCadastro(event: Event) {
    event.preventDefault();
    this.erro = null;

    if (!this.email || !this.senha) {
      this.erro = 'Por favor, preencha todos os campos!';
      return;
    }

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(this.email)) {
      this.erro = 'Digite um e-mail válido.';
      return;
    }

    if (!this.senhaValida) {
      this.erro = 'A senha precisa ter no mínimo 8 caracteres, uma letra maiúscula e um caractere especial.';
      return;
    }

    this.carregando = true;

    this.http.post<{ usuario: any; token: string }>(`${API_URL}/usuarios/cadastro`, {
      nome: this.nome,
      email: this.email,
      senha: this.senha,
    }).subscribe({
      next: (resposta) => guardarLogin(resposta, this.router),
      error: (erro) => {
        this.carregando = false;
        this.erro = erro?.error?.erro || 'Não foi possível concluir o cadastro. Tente novamente.';
        this.cdr.markForCheck();
      },
    });
  }
}
