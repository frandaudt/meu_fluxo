import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface Funcionalidade {
  nome: string;
  descricao: string;
  print: string;
  icone: string;
  classeCor: string;
  aberto: boolean;
}

@Component({
  selector: 'app-anuncio',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './anuncio.html',
  styleUrl: './anuncio.css',
})
export class Anuncio {
  funcionalidades: Funcionalidade[] = [
    {
      nome: 'Agenda',
      descricao: 'Calendário completo com seus agendamentos, organizados por dia e por status.',
      print: 'assets/prints/print-agenda.png',
      icone: 'assets/icons/icone-dashboard-agendamentos.png',
      classeCor: 'cor-agenda',
      aberto: true,
    },
    {
      nome: 'Clientes',
      descricao: 'Cadastro completo de contatos, histórico e informações de cada cliente.',
      print: 'assets/prints/print-clientes.png',
      icone: 'assets/icons/icone-anuncio-clientes.png',
      classeCor: 'cor-clientes',
      aberto: false,
    },
    {
      nome: 'Serviços',
      descricao: 'Defina os serviços que você oferece, com preço e duração de cada um.',
      print: 'assets/prints/print-servicos.png',
      icone: 'assets/icons/icone-servicos.png',
      classeCor: 'cor-servicos',
      aberto: false,
    },
    {
      nome: 'Financeiro',
      descricao: 'Ganhos, gastos e lucro calculados automaticamente a partir dos seus atendimentos.',
      print: 'assets/prints/print-financas.png',
      icone: 'assets/icons/icone-anuncio-financeiro.png',
      classeCor: 'cor-financeiro',
      aberto: false,
    },
    {
      nome: 'Metas',
      descricao: 'Defina objetivos mensais e anuais e acompanhe o progresso em tempo real.',
      print: 'assets/prints/print-metas.png',
      icone: 'assets/icons/icone-dashboard-metas.png',
      classeCor: 'cor-metas',
      aberto: false,
    },
  ];

  lightboxAberto = false;
  lightboxIndex = 0;

  get itemLightbox(): Funcionalidade {
    return this.funcionalidades[this.lightboxIndex];
  }

  alternar(index: number) {
    this.funcionalidades[index].aberto = !this.funcionalidades[index].aberto;
  }

  abrirLightbox(index: number, event: Event) {
    event.stopPropagation();
    this.lightboxIndex = index;
    this.lightboxAberto = true;
  }

  fecharLightbox() {
    this.lightboxAberto = false;
  }

  proximo(event: Event) {
    event.stopPropagation();
    this.lightboxIndex = (this.lightboxIndex + 1) % this.funcionalidades.length;
  }

  anterior(event: Event) {
    event.stopPropagation();
    this.lightboxIndex = (this.lightboxIndex - 1 + this.funcionalidades.length) % this.funcionalidades.length;
  }
}
