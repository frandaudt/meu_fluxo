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
  /** Bolinha coral da "Lista de espera" (quantos aguardam). Fica escondida quando é 0. */
  @Input() aguardandoNaLista = 0;

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

  /** "Sair" do menu: o App faz a limpeza completa (token, buscas, mensagens prontas...). */
  sair() {
    window.dispatchEvent(new Event('meufluxo-sair'));
  }
}
