import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

const API_URL = 'http://localhost:3001/api';

@Component({
  selector: 'app-cadastro',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './cadastro.html',
  styleUrl: './cadastro.css'
})
export class Cadastro {
  nome: string = '';
  email: string = '';
  senha: string = '';
  carregando = false;
  erro: string | null = null;

  get senhaTemComprimento(): boolean { return this.senha.length >= 6; }
  get senhaTemMaiuscula(): boolean { return /[A-Z]/.test(this.senha); }
  get senhaTemEspecial(): boolean { return /[^A-Za-z0-9]/.test(this.senha); }
  get senhaValida(): boolean {
    return this.senhaTemComprimento && this.senhaTemMaiuscula && this.senhaTemEspecial;
  }

  constructor(private router: Router, private http: HttpClient, private cdr: ChangeDetectorRef) {}

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
      this.erro = 'A senha precisa ter no mínimo 6 caracteres, uma letra maiúscula e um caractere especial.';
      return;
    }

    this.carregando = true;

    this.http.post<{ usuario: any; token: string }>(`${API_URL}/usuarios/cadastro`, {
      nome: this.nome,
      email: this.email,
      senha: this.senha,
    }).subscribe({
      next: (resposta) => {
        localStorage.setItem('meufluxo_token', resposta.token);
        localStorage.setItem('usuarioLogado', JSON.stringify(resposta.usuario));
        this.router.navigate(['/tela-inicial']);
      },
      error: (erro) => {
        this.carregando = false;
        this.erro = erro?.error?.erro || 'Não foi possível concluir o cadastro. Tente novamente.';
        this.cdr.markForCheck();
      },
    });
  }
}
