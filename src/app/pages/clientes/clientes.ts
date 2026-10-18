import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';

const API_URL = 'http://localhost:3001/api';

interface Cliente {
  id: number;
  nome: string;
  telefone: string;
  email: string;
  endereco: string;
}

@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clientes.html',
  styleUrl: './clientes.css'
})
export class ClientesComponent implements OnInit {
  clientes: Cliente[] = [];
  modalAberto = false;
  termoBusca = '';

  carregando = true;
  erro: string | null = null;

  salvando = false;
  erroModal: string | null = null;

  editandoId: number | null = null;

  novoCliente = {
    nome: '',
    telefone: '',
    email: '',
    endereco: '',
  };
  private readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  private cabecalhoAuth(): HttpHeaders {
    const token = localStorage.getItem('meufluxo_token');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  ngOnInit() {
    const token = localStorage.getItem('meufluxo_token');
    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    this.http.get<{ clientes: Cliente[] }>(`${API_URL}/clientes`, {
      headers: this.cabecalhoAuth(),
    }).subscribe({
      next: (resposta) => {
        this.clientes = resposta.clientes;
        this.carregando = false;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.carregando = false;
        this.erro = 'Não foi possível carregar os clientes.';
        this.cdr.markForCheck();
      },
    });

    this.route.queryParams.subscribe(params => {
      if (params['busca']) {
        this.termoBusca = params['busca'];
        this.cdr.markForCheck();
      }
    });
  }

  get clientesFiltrados(): Cliente[] {
    if (!this.termoBusca.trim()) return this.clientes;
    const termo = this.termoBusca.toLowerCase();
    return this.clientes.filter(c => c.nome.toLowerCase().includes(termo));
  }

  iniciais(nome: string): string {
    return nome.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
  }

  limparBusca() {
    this.termoBusca = '';
  }

  abrirModal() {
    this.editandoId = null;
    this.novoCliente = { nome: '', telefone: '', email: '', endereco: '' };
    this.erroModal = null;
    this.modalAberto = true;
  }

  abrirModalEdicao(cliente: Cliente) {
    this.editandoId = cliente.id;
    this.novoCliente = {
      nome: cliente.nome,
      telefone: cliente.telefone,
      email: cliente.email,
      endereco: cliente.endereco,
    };
    this.erroModal = null;
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
    this.editandoId = null;
    this.erroModal = null;
    this.novoCliente = { nome: '', telefone: '', email: '', endereco: '' };
  }

  salvarCliente(event: Event) {
  event.preventDefault();
  this.erroModal = null;

  if (!this.novoCliente.nome || !this.novoCliente.telefone) {
    this.erroModal = 'Preencha ao menos o nome e o telefone!';
    return;
  }

  if (this.novoCliente.telefone.length > 15) {
    this.erroModal = 'O telefone informado está incorreto.';
    return;
  }

  if (this.novoCliente.email && !this.EMAIL_REGEX.test(this.novoCliente.email)) {
    this.erroModal = 'Digite um e-mail válido.';
    return;
  }

  this.salvando = true;


    const requisicao = this.editandoId
      ? this.http.put<{ cliente: Cliente }>(`${API_URL}/clientes/${this.editandoId}`, this.novoCliente, {
          headers: this.cabecalhoAuth(),
        })
      : this.http.post<{ cliente: Cliente }>(`${API_URL}/clientes`, this.novoCliente, {
          headers: this.cabecalhoAuth(),
        });

    requisicao.subscribe({
      next: (resposta) => {
        if (this.editandoId) {
          const indice = this.clientes.findIndex(c => c.id === this.editandoId);
          if (indice !== -1) this.clientes[indice] = resposta.cliente;
        } else {
          this.clientes.push(resposta.cliente);
        }
        this.salvando = false;
        this.fecharModal();
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.salvando = false;
        this.erroModal = erro?.error?.erro || 'Não foi possível salvar o cliente.';
        this.cdr.markForCheck();
      },
    });
  }

  removerCliente(id: number) {
    this.http.delete(`${API_URL}/clientes/${id}`, {
      headers: this.cabecalhoAuth(),
    }).subscribe({
      next: () => {
        this.clientes = this.clientes.filter(c => c.id !== id);
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.erro = erro?.error?.erro || 'Não foi possível remover o cliente.';
        this.cdr.markForCheck();
      },
    });
  }
}
