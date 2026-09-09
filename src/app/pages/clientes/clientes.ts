import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

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
  private readonly STORAGE_KEY = 'meufluxo_clientes';

  clientes: Cliente[] = [];
  modalAberto = false;
  termoBusca = '';

  novoCliente = {
    nome: '',
    telefone: '',
    email: '',
    endereco: '',
  };

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    const salvos = localStorage.getItem(this.STORAGE_KEY);

    if (salvos) {
      this.clientes = JSON.parse(salvos);
    } else {
      this.clientes = [
        { id: 1, nome: 'Nicole Sales', telefone: '11 99765-9321', email: 'nicolesales@gmail.com', endereco: 'Rua Nicole, 123' },
        { id: 2, nome: 'Francisco Daudt', telefone: '11 99999-9999', email: 'frandaudt@gmail.com', endereco: 'Rua Daudt, 45' },
      ];
      this.salvarNoStorage();
    }

    this.route.queryParams.subscribe(params => {
      if (params['busca']) {
        this.termoBusca = params['busca'];
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
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
    this.novoCliente = { nome: '', telefone: '', email: '', endereco: '' };
  }

  salvarCliente(event: Event) {
    event.preventDefault();

    if (!this.novoCliente.nome || !this.novoCliente.telefone) {
      alert('Preencha ao menos o nome e o telefone!');
      return;
    }

    const novoId = this.clientes.length > 0
      ? Math.max(...this.clientes.map(c => c.id)) + 1
      : 1;

    this.clientes.push({ id: novoId, ...this.novoCliente });
    this.salvarNoStorage();
    this.fecharModal();
  }

  removerCliente(id: number) {
    this.clientes = this.clientes.filter(c => c.id !== id);
    this.salvarNoStorage();
  }

  private salvarNoStorage() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.clientes));
  }
}
