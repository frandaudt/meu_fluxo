import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin } from 'rxjs';

const API_URL = 'http://localhost:3001/api';

interface Servico { id: number; nome: string; valor: number; }
interface Agendamento {
  id: number;
  servicoId: number;
  data: string; // 'YYYY-MM-DD'
  status: 'agendado' | 'realizado' | 'cancelado';
}

interface MetaMensal {
  id: number;
  mes: string; // 'YYYY-MM'
  tipo: 'faturamento' | 'clientes';
  valorAlvo: number;
}

interface MetaAnual {
  id: number;
  ano: number;
  valorAlvo: number;
}

interface MetaMensalExibicao extends MetaMensal {
  progresso: number;
  percentual: number;
  larguraBarra: number;
  label: string;
  atual: boolean;
}

@Component({
  selector: 'app-metas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './metas.html',
  styleUrl: './metas.css',
})
export class Metas implements OnInit {
  carregando = true;
  erro: string | null = null;
  erroModal: string | null = null;
  salvando = false;

  agendamentos: Agendamento[] = [];
  servicos: Servico[] = [];
  metasMensais: MetaMensal[] = [];
  metasAnuais: MetaAnual[] = [];

  private hoje = new Date();
  anoAtual = this.hoje.getFullYear();

  metaAnualDoAno: MetaAnual | null = null;
  progressoAnual = 0;
  percentualAnual = 0;
  larguraBarraAnual = 0;

  metasMensaisExibicao: MetaMensalExibicao[] = [];

  modalMensalAberto = false;
  novaMetaMensal: { mes: string; tipo: MetaMensal['tipo']; valorAlvo: number | null } = {
    mes: this.chaveMes(this.hoje.getFullYear(), this.hoje.getMonth()),
    tipo: 'faturamento',
    valorAlvo: null,
  };

  modalAnualAberto = false;
  novaMetaAnual: { ano: number; valorAlvo: number | null } = { ano: this.anoAtual, valorAlvo: null };

  readonly nomesMesesExtenso = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

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

    const headers = this.cabecalhoAuth();

    forkJoin({
      servicos: this.http.get<{ servicos: { id: number; nome: string; categoria: string; valor: number; duracaoMin: number }[] }>(
        `${API_URL}/servicos`,
        { headers }
      ),
      agendamentos: this.http.get<{ agendamentos: Agendamento[] }>(`${API_URL}/agendamentos`, { headers }),
      metasMensais: this.http.get<{ metas: MetaMensal[] }>(`${API_URL}/metas/mensais`, { headers }),
      metasAnuais: this.http.get<{ metas: MetaAnual[] }>(`${API_URL}/metas/anuais`, { headers }),
    }).subscribe({
      next: ({ servicos, agendamentos, metasMensais, metasAnuais }) => {
        this.servicos = servicos.servicos.map(s => ({ id: s.id, nome: s.nome, valor: s.valor }));
        this.agendamentos = agendamentos.agendamentos;
        this.metasMensais = metasMensais.metas;
        this.metasAnuais = metasAnuais.metas;
        this.atualizarDerivados();
        this.carregando = false;
        this.cdr.markForCheck();
      },
      error: (erro) => {
        console.error(erro);
        this.carregando = false;
        this.erro = 'Não foi possível carregar as metas.';
        this.cdr.markForCheck();
      },
    });
  }

  private chaveMes(ano: number, mes: number): string {
    return `${ano}-${String(mes + 1).padStart(2, '0')}`;
  }

  private valorServico(id: number): number {
    return this.servicos.find(s => s.id === id)?.valor ?? 0;
  }

  private faturamentoDe(ano: number, mes: number): number {
    const prefixo = this.chaveMes(ano, mes);
    return this.agendamentos
      .filter(a => a.status === 'realizado' && a.data.startsWith(prefixo))
      .reduce((soma, a) => soma + this.valorServico(a.servicoId), 0);
  }

  private clientesAtendidosDe(ano: number, mes: number): number {
    const prefixo = this.chaveMes(ano, mes);
    return this.agendamentos.filter(a => a.status === 'realizado' && a.data.startsWith(prefixo)).length;
  }

  private formatarLabelMes(chave: string): string {
    const [ano, mes] = chave.split('-').map(Number);
    return `${this.nomesMesesExtenso[mes - 1]} de ${ano}`;
  }

  private atualizarDerivados() {
    this.metaAnualDoAno = this.metasAnuais.find(m => m.ano === this.anoAtual) ?? null;

    if (this.metaAnualDoAno) {
      let soma = 0;
      for (let mes = 0; mes < 12; mes++) soma += this.faturamentoDe(this.anoAtual, mes);
      this.progressoAnual = soma;
      this.percentualAnual = this.metaAnualDoAno.valorAlvo > 0
        ? Math.round((soma / this.metaAnualDoAno.valorAlvo) * 100)
        : 0;
      this.larguraBarraAnual = Math.min(this.percentualAnual, 100);
    } else {
      this.progressoAnual = 0;
      this.percentualAnual = 0;
      this.larguraBarraAnual = 0;
    }

    const chaveAtual = this.chaveMes(this.hoje.getFullYear(), this.hoje.getMonth());

     this.metasMensaisExibicao = this.metasMensais
      .slice()
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map(m => {
        const [ano, mes] = m.mes.split('-').map(Number);
        const progresso = m.tipo === 'faturamento'
          ? this.faturamentoDe(ano, mes - 1)
          : this.clientesAtendidosDe(ano, mes - 1);
        const percentual = m.valorAlvo > 0 ? Math.round((progresso / m.valorAlvo) * 100) : 0;
        return {
          ...m,
          progresso,
          percentual,
          larguraBarra: Math.min(percentual, 100),
          label: this.formatarLabelMes(m.mes),
          atual: m.mes === chaveAtual,
        };
      });
  }

   abrirModalMensal() {
    this.novaMetaMensal = {
      mes: this.chaveMes(this.hoje.getFullYear(), this.hoje.getMonth()),
      tipo: 'faturamento',
      valorAlvo: null,
    };
    this.erroModal = null;
    this.modalMensalAberto = true;
  }

  fecharModalMensal() {
    this.modalMensalAberto = false;
    this.erroModal = null;
  }

  salvarMetaMensal(event: Event) {
    event.preventDefault();
    this.erroModal = null;

      if (!this.novaMetaMensal.mes || this.novaMetaMensal.valorAlvo === null || this.novaMetaMensal.valorAlvo <= 0) {
      this.erroModal = 'Escolha o mês e um valor alvo válido!';
      return;
    }

    const corpo = {
      mes: this.novaMetaMensal.mes,
      tipo: this.novaMetaMensal.tipo,
      valorAlvo: Number(this.novaMetaMensal.valorAlvo),
    };

    this.salvando = true;

    this.http.post<{ meta: MetaMensal }>(`${API_URL}/metas/mensais`, corpo, { headers: this.cabecalhoAuth() })
      .subscribe({
        next: ({ meta }) => {
          this.metasMensais.push(meta);
          this.atualizarDerivados();
          this.salvando = false;
          this.fecharModalMensal();
          this.cdr.markForCheck();
        },
        error: (erro) => {
          console.error(erro);
          this.salvando = false;
          this.erroModal = erro?.error?.erro || 'Não foi possível salvar a meta mensal.';
          this.cdr.markForCheck();
        },
      });
  }

  removerMetaMensal(id: number) {
    this.http.delete(`${API_URL}/metas/mensais/${id}`, { headers: this.cabecalhoAuth() })
      .subscribe({
        next: () => {
          this.metasMensais = this.metasMensais.filter(m => m.id !== id);
          this.atualizarDerivados();
          this.cdr.markForCheck();
        },
        error: (erro) => {
          console.error(erro);
          this.erro = 'Não foi possível remover a meta mensal.';
          this.cdr.markForCheck();
        },
      });
  }

   abrirModalAnual() {
    this.novaMetaAnual = { ano: this.anoAtual, valorAlvo: this.metaAnualDoAno?.valorAlvo ?? null };
    this.erroModal = null;
    this.modalAnualAberto = true;
  }

  fecharModalAnual() {
    this.modalAnualAberto = false;
    this.erroModal = null;
  }

  salvarMetaAnual(event: Event) {
    event.preventDefault();
    this.erroModal = null;

     if (this.novaMetaAnual.valorAlvo === null || this.novaMetaAnual.valorAlvo <= 0) {
      this.erroModal = 'Informe um valor alvo válido!';
      return;
    }

    const corpo = {
      ano: this.novaMetaAnual.ano,
      valorAlvo: Number(this.novaMetaAnual.valorAlvo),
    };

    this.salvando = true;

    this.http.post<{ meta: MetaAnual }>(`${API_URL}/metas/anuais`, corpo, { headers: this.cabecalhoAuth() })
      .subscribe({
        next: ({ meta }) => {
          const existente = this.metasAnuais.find(m => m.ano === meta.ano);
          if (existente) {
            existente.valorAlvo = meta.valorAlvo;
          } else {
            this.metasAnuais.push(meta);
          }
          this.anoAtual = meta.ano;
          this.atualizarDerivados();
          this.salvando = false;
          this.fecharModalAnual();
          this.cdr.markForCheck();
        },
        error: (erro) => {
          console.error(erro);
          this.salvando = false;
          this.erroModal = erro?.error?.erro || 'Não foi possível salvar a meta anual.';
          this.cdr.markForCheck();
        },
      });
  }
}
