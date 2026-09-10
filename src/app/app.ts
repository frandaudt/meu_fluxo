import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterOutlet, RouterLink, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { MenuLateral } from './components/menu-lateral/menu-lateral';
import { Cabecalho } from './components/cabecalho/cabecalho';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, MenuLateral, Cabecalho],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  mostrarLayout = true;
  menuUsuarioAberto = false;
  termoBusca = '';
  nomeUsuario = 'Usuário';

  private rotasSemLayout = ['/login', '/cadastro'];

  constructor(private router: Router) {
    this.carregarUsuario();

    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = (event as NavigationEnd).urlAfterRedirects;
        this.mostrarLayout = !this.rotasSemLayout.includes(url);
        this.carregarUsuario();
      });
  }

  get primeiroNomeUsuario(): string {
    return this.nomeUsuario.trim().split(' ')[0] || 'Usuário';
  }

  get inicialUsuario(): string {
    return this.nomeUsuario ? this.nomeUsuario.charAt(0).toUpperCase() : 'U';
  }

  private carregarUsuario() {
    const salvo = localStorage.getItem('usuarioLogado');
    if (salvo) {
      const usuario = JSON.parse(salvo);
      this.nomeUsuario = usuario.nome || 'Usuário';
    }
  }

  toggleMenuUsuario(event: Event) {
    event.stopPropagation();
    this.menuUsuarioAberto = !this.menuUsuarioAberto;
  }

  @HostListener('document:click')
  fecharMenuUsuario() {
    this.menuUsuarioAberto = false;
  }

  buscarClientes() {
    const termo = this.termoBusca.trim();
    if (!termo) return;
    this.router.navigate(['/clientes'], { queryParams: { busca: termo } });
  }

  sair() {
    localStorage.removeItem('usuarioLogado');
    this.router.navigate(['/login']);
  }
}
