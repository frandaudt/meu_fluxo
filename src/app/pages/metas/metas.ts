import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
  private readonly STORAGE_MENSAIS = 'meufluxo_metas_mensais';
  private readonly STORAGE_ANUAIS = 'meufluxo_metas_anuais';

  agendamentos: Agendamento[] = [];
  servicos: Servico[] = [];
  metasMensais: MetaMensal[] = [];
  metasAnuais: MetaAnual[] = [];

  private hoje = new Date();
  anoAtual = this.hoje.getFullYear();

  metaAnualDoAno: MetaAnual | null = null;
  progressoAnual = 0;
  percentualAnual = 0;

  metasMensaisExibicao: MetaMensalExibicao[] = [];

  modalMensalAberto = false;
  novaMetaMensal = {
    mes: this.chaveMes(this.hoje.getFullYear(), this.hoje.getMonth()),
    tipo: 'faturamento' as MetaMensal['tipo'],
    valorAlvo: 0,
  };

  modalAnualAberto = false;
  novaMetaAnual = { ano: this.anoAtual, valorAlvo: 0 };

  readonly nomesMesesExtenso = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  ngOnInit() {
    this.agendamentos = JSON.parse(localStorage.getItem('meufluxo_agendamentos') || '[]');
    this.servicos = JSON.parse(localStorage.getItem('meufluxo_servicos') || '[]');
    this.metasMensais = JSON.parse(localStorage.getItem(this.STORAGE_MENSAIS) || '[]');
    this.metasAnuais = JSON.parse(localStorage.getItem(this.STORAGE_ANUAIS) || '[]');
    this.atualizarDerivados();
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
    } else {
      this.progressoAnual = 0;
      this.percentualAnual = 0;
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
        return {
          ...m,
          progresso,
          percentual: m.valorAlvo > 0 ? Math.round((progresso / m.valorAlvo) * 100) : 0,
          label: this.formatarLabelMes(m.mes),
          atual: m.mes === chaveAtual,
        };
      });
  }

  abrirModalMensal() {
    this.novaMetaMensal = {
      mes: this.chaveMes(this.hoje.getFullYear(), this.hoje.getMonth()),
      tipo: 'faturamento',
      valorAlvo: 0,
    };
    this.modalMensalAberto = true;
  }

  fecharModalMensal() {
    this.modalMensalAberto = false;
  }

  salvarMetaMensal(event: Event) {
    event.preventDefault();

    if (!this.novaMetaMensal.mes || this.novaMetaMensal.valorAlvo <= 0) {
      alert('Escolha o mês e um valor alvo válido!');
      return;
    }

    const novoId = this.metasMensais.length > 0
      ? Math.max(...this.metasMensais.map(m => m.id)) + 1
      : 1;

    this.metasMensais.push({
      id: novoId,
      mes: this.novaMetaMensal.mes,
      tipo: this.novaMetaMensal.tipo,
      valorAlvo: Number(this.novaMetaMensal.valorAlvo),
    });

    localStorage.setItem(this.STORAGE_MENSAIS, JSON.stringify(this.metasMensais));
    this.atualizarDerivados();
    this.fecharModalMensal();
  }

  removerMetaMensal(id: number) {
    this.metasMensais = this.metasMensais.filter(m => m.id !== id);
    localStorage.setItem(this.STORAGE_MENSAIS, JSON.stringify(this.metasMensais));
    this.atualizarDerivados();
  }

  abrirModalAnual() {
    this.novaMetaAnual = { ano: this.anoAtual, valorAlvo: this.metaAnualDoAno?.valorAlvo ?? 0 };
    this.modalAnualAberto = true;
  }

  fecharModalAnual() {
    this.modalAnualAberto = false;
  }

  salvarMetaAnual(event: Event) {
    event.preventDefault();

    if (this.novaMetaAnual.valorAlvo <= 0) {
      alert('Informe um valor alvo válido!');
      return;
    }

    const existente = this.metasAnuais.find(m => m.ano === this.novaMetaAnual.ano);
    if (existente) {
      existente.valorAlvo = Number(this.novaMetaAnual.valorAlvo);
    } else {
      const novoId = this.metasAnuais.length > 0
        ? Math.max(...this.metasAnuais.map(m => m.id)) + 1
        : 1;
      this.metasAnuais.push({ id: novoId, ano: this.novaMetaAnual.ano, valorAlvo: Number(this.novaMetaAnual.valorAlvo) });
    }

    this.anoAtual = this.novaMetaAnual.ano;
    localStorage.setItem(this.STORAGE_ANUAIS, JSON.stringify(this.metasAnuais));
    this.atualizarDerivados();
    this.fecharModalAnual();
  }
}
