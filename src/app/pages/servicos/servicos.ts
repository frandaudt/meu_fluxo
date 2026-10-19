import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';

import { API_URL, dinheiro } from '../../app';

interface Servico {
  id: number;
  nome: string;
  categoria: string;
  valor: number;
  duracao: number; // em minutos
}

type ServicoApi = { id: number; nome: string; categoria: string; valor: number; duracaoMin: number };

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

  /** Aviso amarelo depois de criar um serviço (ele já entra no bot e no link). */
  avisoNovo: string | null = null;

  novoServico: { nome: string; categoria: string; valor: number | null; duracao: number | null } = {
    nome: '',
    categoria: '',
    valor: null,
    duracao: null,
  };

  constructor(
    private router: Router,
    private rota: ActivatedRoute,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  private cabecalhoAuth(): HttpHeaders {
    const token = localStorage.getItem('meufluxo_token');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private paraServico(s: ServicoApi): Servico {
    return { id: s.id, nome: s.nome, categoria: s.categoria, valor: s.valor, duracao: s.duracaoMin };
  }

  ngOnInit() {
    const token = localStorage.getItem('meufluxo_token');
    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    this.http.get<{ servicos: ServicoApi[] }>(`${API_URL}/servicos`, { headers: this.cabecalhoAuth() }).subscribe({
      next: (resposta) => {
        this.servicos = resposta.servicos.map(s => this.paraServico(s));
        this.carregando = false;

        // vindo da Busca ("Editar serviço"): /servicos?editar=3 abre a janela direto
        const editar = Number(this.rota.snapshot.queryParamMap.get('editar'));
        if (editar) {
          const servico = this.servicos.find(s => s.id === editar);
          if (servico) this.abrirModalEdicao(servico);
          this.router.navigate([], { relativeTo: this.rota, queryParams: {}, replaceUrl: true });
        }
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

  /** Valor em reais respeitando o "Ocultar valores": "R$ 80,00" ou "R$ ••••". */
  valorEmReais(valor: number | null | undefined): string {
    return dinheiro(valor);
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
      valor: servico.valor,
      duracao: servico.duracao,
    };
    this.erroModal = null;
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
    this.editandoId = null;
    this.erroModal = null;
  }

  salvarServico(event: Event) {
    event.preventDefault();
    this.erroModal = null;

    if (!this.novoServico.nome.trim() || !this.novoServico.valor) {
      this.erroModal = 'Preencha o nome e o valor do serviço.';
      return;
    }
    // a duração é obrigatória: é com ela que a agenda, o bot e o link calculam os horários livres
    if (!this.novoServico.duracao || Number(this.novoServico.duracao) <= 0) {
      this.erroModal = 'Informe a duração do serviço, em minutos.';
      return;
    }

    const corpo = {
      nome: this.novoServico.nome.trim(),
      categoria: this.novoServico.categoria,
      valor: Number(this.novoServico.valor),
      duracaoMin: Number(this.novoServico.duracao),
    };

    this.salvando = true;
    const criando = !this.editandoId;

    const requisicao = this.editandoId
      ? this.http.put<{ servico: ServicoApi }>(`${API_URL}/servicos/${this.editandoId}`, corpo, { headers: this.cabecalhoAuth() })
      : this.http.post<{ servico: ServicoApi }>(`${API_URL}/servicos`, corpo, { headers: this.cabecalhoAuth() });

    requisicao.subscribe({
      next: (resposta) => {
        const servico = this.paraServico(resposta.servico);
        const i = this.servicos.findIndex(s => s.id === servico.id);
        if (i >= 0) this.servicos[i] = servico;
        else this.servicos.push(servico);

        if (criando) {
          this.avisoNovo = `"${servico.nome}" já vai aparecer no menu do bot e no link de agendamento. Você pode ocultá-lo na tela WhatsApp.`;
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
    if (!confirm('Excluir este serviço?')) return;
    this.http.delete(`${API_URL}/servicos/${id}`, { headers: this.cabecalhoAuth() }).subscribe({
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
