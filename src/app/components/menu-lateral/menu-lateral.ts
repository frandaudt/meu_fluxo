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

  /**
   * O menu mostra só o que a pessoa pode acessar. O dono pode tudo; o atendente,
   * só o que o dono marcou na aba Equipe. (A API também bloqueia o resto.)
   */
  pode(permissao: string): boolean {
    try {
      const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
      if (usuario.papel !== 'atendente') return true;
      return Array.isArray(usuario.permissoes) && usuario.permissoes.includes(permissao);
    } catch {
      return false;
    }
  }

  sair() {
    localStorage.removeItem('usuarioLogado');
    localStorage.removeItem('meufluxo_token');
  }

  get inicialNome(): string {
    return this.nomeUsuario ? this.nomeUsuario.charAt(0).toUpperCase() : 'U';
  }
}
