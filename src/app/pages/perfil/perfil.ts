import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

interface Usuario {
  nome: string;
  email: string;
  senha: string;
  telefone?: string;
  nomeNegocio?: string;
}

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './perfil.html',
  styleUrl: './perfil.css',
})
export class Perfil implements OnInit {
  usuario: Usuario = { nome: '', email: '', senha: '' };
  form = { nome: '', email: '', telefone: '', nomeNegocio: '' };

  modalSenhaAberto = false;
  senhaAtual = '';
  novaSenha = '';
  confirmarSenha = '';

  constructor(private router: Router) {}

  ngOnInit() {
    const salvo = localStorage.getItem('usuarioLogado');
    if (!salvo) {
      this.router.navigate(['/login']);
      return;
    }
    this.usuario = JSON.parse(salvo);
     this.form = {
      nome: this.usuario.nome || '',
      email: this.usuario.email || '',
      telefone: this.usuario.telefone || '',
      nomeNegocio: this.usuario.nomeNegocio || '',
    };
  }

  get inicialNome(): string {
    return this.form.nome ? this.form.nome.charAt(0).toUpperCase() : 'U';
  }



  salvarPerfil(event: Event) {
    event.preventDefault();

    if (!this.form.nome || !this.form.email) {
      alert('Preencha ao menos o nome e o e-mail!');
      return;
    }

    const emailAntigo = this.usuario.email;
    const emailNovo = this.form.email;

    const usuarioAtualizado: Usuario = {
      ...this.usuario,
      nome: this.form.nome,
      email: emailNovo,
      telefone: this.form.telefone,
      nomeNegocio: this.form.nomeNegocio,
    };

    if (emailAntigo !== emailNovo) {
      localStorage.removeItem('usuario_' + emailAntigo);
    }
    localStorage.setItem('usuario_' + emailNovo, JSON.stringify(usuarioAtualizado));
    localStorage.setItem('usuarioLogado', JSON.stringify(usuarioAtualizado));

    this.usuario = usuarioAtualizado;
    alert('Perfil atualizado com sucesso!');
  }

  abrirModalSenha() {
    this.senhaAtual = '';
    this.novaSenha = '';
    this.confirmarSenha = '';
    this.modalSenhaAberto = true;
  }

  fecharModalSenha() {
    this.modalSenhaAberto = false;
  }

  salvarNovaSenha(event: Event) {
    event.preventDefault();

    if (this.senhaAtual !== this.usuario.senha) {
      alert('Senha atual incorreta!');
      return;
    }
    if (!this.novaSenha || this.novaSenha !== this.confirmarSenha) {
      alert('A nova senha e a confirmação precisam ser iguais!');
      return;
    }

    const usuarioAtualizado: Usuario = { ...this.usuario, senha: this.novaSenha };
    localStorage.setItem('usuario_' + usuarioAtualizado.email, JSON.stringify(usuarioAtualizado));
    localStorage.setItem('usuarioLogado', JSON.stringify(usuarioAtualizado));
    this.usuario = usuarioAtualizado;

    this.fecharModalSenha();
    alert('Senha alterada com sucesso!');
  }
}
