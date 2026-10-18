import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';

const API_URL = 'http://localhost:3001/api';

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
  servicos: Servico[] = [];
  modalAberto = false;

  carregando = true;
  erro: string | null = null;

  salvando = false;
  erroModal: string | null = null;

  editandoId: number | null = null;

  novoServico = {
    nome: '',
    categoria: '',
    valor: null,
    duracao: null,
  };

  constructor(private router: Router, private http: HttpClient, private cdr: ChangeDetectorRef) {}

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

    this.http.get<{ servicos: { id: number; nome: string; categoria: string; valor: number; duracaoMin: number }[] }>(
      `${API_URL}/servicos`,
      { headers: this.cabecalhoAuth() }
    ).subscribe({
      next: (resposta) => {
        this.servicos = resposta.servicos.map(s => ({
          id: s.id,
          nome: s.nome,
          categoria: s.categoria,
          valor: s.valor,
          duracao: s.duracaoMin,
        }));
        this.carregando = false;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.carregando = false;
        this.erro = 'Não foi possível carregar os serviços.';
        this.cdr.markForCheck();
      },
    });
  }

  abrirModal() {
    this.editandoId = null;
    this.novoServico = { nome: '', categoria: '', valor: null, duracao: null };
    this.erroModal = null;
    this.modalAberto = true;
  }

  abrirModalEdicao(servico: Servico) {
    this.editandoId = servico.id;
    this.novoServico = {
      nome: servico.nome,
      categoria: servico.categoria,
      valor: servico.valor as any,
      duracao: servico.duracao as any,
    };
    this.erroModal = null;
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
    this.editandoId = null;
    this.erroModal = null;
    this.novoServico = { nome: '', categoria: '', valor: null, duracao: null };
  }

  salvarServico(event: Event) {
    event.preventDefault();
    this.erroModal = null;

    if (!this.novoServico.nome || !this.novoServico.valor) {
      this.erroModal = 'Preencha ao menos o nome e o valor do serviço!';
      return;
    }

    const corpo = {
      nome: this.novoServico.nome,
      categoria: this.novoServico.categoria,
      valor: Number(this.novoServico.valor),
      duracaoMin: Number(this.novoServico.duracao) || 0,
    };

    this.salvando = true;

    const requisicao = this.editandoId
      ? this.http.put<{ servico: { id: number; nome: string; categoria: string; valor: number; duracaoMin: number } }>(
          `${API_URL}/servicos/${this.editandoId}`,
          corpo,
          { headers: this.cabecalhoAuth() }
        )
      : this.http.post<{ servico: { id: number; nome: string; categoria: string; valor: number; duracaoMin: number } }>(
          `${API_URL}/servicos`,
          corpo,
          { headers: this.cabecalhoAuth() }
        );

    requisicao.subscribe({
      next: (resposta) => {
        const servicoAtualizado: Servico = {
          id: resposta.servico.id,
          nome: resposta.servico.nome,
          categoria: resposta.servico.categoria,
          valor: resposta.servico.valor,
          duracao: resposta.servico.duracaoMin,
        };

        if (this.editandoId) {
          const indice = this.servicos.findIndex(s => s.id === this.editandoId);
          if (indice !== -1) this.servicos[indice] = servicoAtualizado;
        } else {
          this.servicos.push(servicoAtualizado);
        }

        this.salvando = false;
        this.fecharModal();
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.salvando = false;
        this.erroModal = erro?.error?.erro || 'Não foi possível salvar o serviço.';
        this.cdr.markForCheck();
      },
    });
  }

  removerServico(id: number) {
    this.http.delete(`${API_URL}/servicos/${id}`, {
      headers: this.cabecalhoAuth(),
    }).subscribe({
      next: () => {
        this.servicos = this.servicos.filter(s => s.id !== id);
        this.cdr.markForCheck();
      },
      error: (erro) => {
        this.erro = erro?.error?.erro || 'Não foi possível remover o serviço.';
        this.cdr.markForCheck();
      },
    });
  }
}