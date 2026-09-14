import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

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

  constructor(private router: Router) {}

  fazerLogin(event: Event) {
    event.preventDefault();


    const usuarioSalvo = localStorage.getItem('usuario_' + this.email);

    if (usuarioSalvo) {
      const usuario = JSON.parse(usuarioSalvo);


      if (this.senha === usuario.senha) {
        localStorage.setItem('usuarioLogado', JSON.stringify(usuario));
                this.router.navigate(['/tela-inicial']);
      } else {
        alert('Senha incorreta!');
      }
    } else {

      alert('Usuário não encontrado! Faça o cadastro primeiro.');
    }
  }
}
