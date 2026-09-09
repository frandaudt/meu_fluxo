import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

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

  constructor(private router: Router) {}

  fazerCadastro(event: Event) {
    event.preventDefault();

    if (!this.email || !this.senha) {
      alert('Por favor, preencha todos os campos!');
      return;
    }

    // Registra o usuário
    const usuario = {
      nome: this.nome,
      email: this.email,
      senha: this.senha
    };

    // Salva temporariamente (no futuro, aqui será a chamada para salvar no seu Banco)
    localStorage.setItem('usuario_' + this.email, JSON.stringify(usuario));
    localStorage.setItem('usuarioLogado', JSON.stringify(usuario));

    // Como ele acabou de se cadastrar, vai direto para a tela inicial!
    this.router.navigate(['/inicio']);
  }
}
