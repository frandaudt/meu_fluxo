import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Servico {
  id: number;
  nome: string;
  categoria: string;
  valor: number;
  duracao: number; // em minutos
}

@Component({
  selector: 'app-servicos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './servicos.html',
  styleUrl: './servicos.css',
})
export class Servicos implements OnInit {
  private readonly STORAGE_KEY = 'meufluxo_servicos';

  servicos: Servico[] = [];
  modalAberto = false;

  novoServico = {
    nome: '',
    categoria: '',
    valor: 0,
    duracao: 30,
  };

  ngOnInit() {
    const salvos = localStorage.getItem(this.STORAGE_KEY);

    if (salvos) {
      this.servicos = JSON.parse(salvos);
    } else {
      // primeira vez: já entra com alguns exemplos pra não ficar vazio
      this.servicos = [
        { id: 1, nome: 'Corte de Cabelo', categoria: 'Cabelo', valor: 60, duracao: 45 },
        { id: 2, nome: 'Manicure', categoria: 'Unhas', valor: 35, duracao: 40 },
        { id: 3, nome: 'Design de Sobrancelha', categoria: 'Estética', valor: 25, duracao: 20 },
      ];
      this.salvarNoStorage();
    }
  }

  abrirModal() {
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
    this.novoServico = { nome: '', categoria: '', valor: 0, duracao: 30 };
  }

  salvarServico(event: Event) {
    event.preventDefault();

    if (!this.novoServico.nome || !this.novoServico.valor) {
      alert('Preencha ao menos o nome e o valor do serviço!');
      return;
    }

    const novoId = this.servicos.length > 0
      ? Math.max(...this.servicos.map(s => s.id)) + 1
      : 1;

    this.servicos.push({ id: novoId, ...this.novoServico });
    this.salvarNoStorage();
    this.fecharModal();
  }

  removerServico(id: number) {
    this.servicos = this.servicos.filter(s => s.id !== id);
    this.salvarNoStorage();
  }

  private salvarNoStorage() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.servicos));
  }
}
