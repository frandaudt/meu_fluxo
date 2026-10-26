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
      descricao: 'Dia, semana ou mês, com os horários livres à vista. Marque, conclua, remarque ou cancele com um clique, e veja quanto da agenda está ocupada.',
      print: 'assets/prints/print-agenda.png',
      icone: 'calendar_month',
      classeCor: 'cor-agenda',
      aberto: true,
    },
    {
      nome: 'Clientes',
      descricao: 'A ficha de cada cliente com histórico, serviço favorito e quanto já gastou. O sistema avisa quem está sumido para você chamar no WhatsApp.',
      print: 'assets/prints/print-clientes.png',
      icone: 'group',
      classeCor: 'cor-clientes',
      aberto: false,
    },
    {
      nome: 'Lista de espera',
      descricao: 'Dia lotado? A cliente entra na fila. Quando alguém cancela, o sistema mostra quem serve para a vaga e você encaixa com um clique.',
      print: 'assets/prints/print-lista-espera.png',
      icone: 'schedule',
      classeCor: 'cor-lista',
      aberto: false,
    },
    {
      nome: 'WhatsApp e link de agendamento',
      descricao: 'Um link para a cliente marcar sozinha e um atendente automático no WhatsApp que mostra serviços, agenda, cancela e remarca. Mensagens prontas para lembrete, agradecimento e vaga.',
      print: 'assets/prints/print-whatsapp.png',
      icone: 'chat',
      classeCor: 'cor-whatsapp',
      aberto: false,
    },
    {
      nome: 'Financeiro',
      descricao: 'Recebimentos por Pix, cartão ou dinheiro, o que ainda falta receber, despesas e lucro do mês, calculados a partir dos atendimentos.',
      print: 'assets/prints/print-financas.png',
      icone: 'account_balance_wallet',
      classeCor: 'cor-financeiro',
      aberto: false,
    },
    {
      nome: 'Metas',
      descricao: 'Defina metas de faturamento e de clientes novos e acompanhe o progresso direto na tela inicial.',
      print: 'assets/prints/print-metas.png',
      icone: 'flag',
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
