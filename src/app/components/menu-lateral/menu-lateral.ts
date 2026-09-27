import { Component, Input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-menu-lateral',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './menu-lateral.html',
  styleUrl: './menu-lateral.css',
})
export class MenuLateral {

  nomeUsuario: string = 'Utilizador';
  emailUsuario: string = 'usuario@email.com';

  sair() {
    localStorage.removeItem('usuarioLogado');
  }

  get inicialNome(): string {
    return this.nomeUsuario ? this.nomeUsuario.charAt(0).toUpperCase() : 'U';
  }
}
