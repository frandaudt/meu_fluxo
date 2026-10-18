import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

const API_URL = 'http://localhost:3001/api';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class Login {
  email: string = '';
  senha: string = '';
  carregando = false;
  erro: string | null = null;

  constructor(private router: Router, private http: HttpClient, private cdr: ChangeDetectorRef) {}

  fazerLogin(event: Event) {
    event.preventDefault();
    this.erro = null;

    if (!this.email || !this.senha) {
      this.erro = 'Preencha email e senha!';
      return;
    }

    this.carregando = true;

    this.http.post<{ usuario: any; token: string }>(`${API_URL}/usuarios/login`, {
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
        this.erro = erro?.error?.erro || 'Não foi possível fazer login. Tente novamente.';
        this.cdr.markForCheck();
      },
    });
  }
}