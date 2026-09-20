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
// horário em que a pessoa atende (usado na grade de disponibilidade da tela Início)
interface DiaTrabalho { ativo: boolean; inicio: string; fim: string; }
interface HorarioTrabalho {
  blocoMin: number;     // tamanho de cada horário da grade, em minutos
  dias: DiaTrabalho[];  // dias[0] = domingo ... dias[6] = sábado
}


@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './perfil.html',
  styleUrl: './perfil.css',
})
export class Perfil implements OnInit {
  private readonly CHAVES_DADOS = [
    'meufluxo_clientes',
    'meufluxo_servicos',
    'meufluxo_agendamentos',
    'meufluxo_despesas',
    'meufluxo_metas_mensais',
    'meufluxo_metas_anuais',
  ];
  private readonly CHAVE_HORARIO = 'meufluxo_horario_trabalho';
  private readonly HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

  readonly blocos = [15, 30, 45, 60];
  readonly nomesDias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  /** ordem de exibição: começa na segunda e termina no domingo */
  readonly ordemDias = [1, 2, 3, 4, 5, 6, 0];

  horario: HorarioTrabalho = this.horarioPadrao();
  erroHorario = '';
  mensagemHorario = '';

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
    this.carregarHorario();   // <- nova
  }
    // ---------- horário de trabalho ----------

  /** Padrão: segunda a sábado, 08:00 às 18:00, domingo fechado, blocos de 30 min. */
  private horarioPadrao(): HorarioTrabalho {
    const util = (): DiaTrabalho => ({ ativo: true, inicio: '08:00', fim: '18:00' });
    return {
      blocoMin: 30,
      dias: [{ ativo: false, inicio: '08:00', fim: '18:00' }, util(), util(), util(), util(), util(), util()],
    };
  }

  private carregarHorario() {
    let salvo: unknown = null;
    try {
      salvo = JSON.parse(localStorage.getItem(this.CHAVE_HORARIO) || 'null');
    } catch { /* usa o horário padrão */ }
    this.horario = this.normalizarHorario(salvo);
  }

  /** Garante um horário válido a partir do que estiver salvo (ou devolve o padrão). */
  private normalizarHorario(bruto: unknown): HorarioTrabalho {
    const padrao = this.horarioPadrao();
    if (!bruto || typeof bruto !== 'object') return padrao;

    const b = bruto as { blocoMin?: unknown; dias?: unknown };
    const bloco = this.blocos.includes(Number(b.blocoMin)) ? Number(b.blocoMin) : padrao.blocoMin;

    const dias = padrao.dias.map((d, i) => {
      const salvo = Array.isArray(b.dias) ? (b.dias[i] as Record<string, unknown> | undefined) : undefined;
      if (!salvo || typeof salvo !== 'object') return d;
      return {
        ativo: typeof salvo['ativo'] === 'boolean' ? (salvo['ativo'] as boolean) : d.ativo,
        inicio: this.HORA_REGEX.test(String(salvo['inicio'])) ? String(salvo['inicio']) : d.inicio,
        fim: this.HORA_REGEX.test(String(salvo['fim'])) ? String(salvo['fim']) : d.fim,
      };
    });

    return { blocoMin: bloco, dias };
  }

  private paraMinutos(hhmm: string): number {
    const [h, m] = String(hhmm).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  }

  /** Devolve a mensagem do primeiro problema encontrado, ou '' se estiver tudo certo. */
  private validarHorario(): string {
    if (!this.horario.dias.some(d => d.ativo)) return 'Marque ao menos um dia de trabalho.';

    for (let i = 0; i < this.horario.dias.length; i++) {
      const d = this.horario.dias[i];
      if (!d.ativo) continue;
      if (!this.HORA_REGEX.test(d.inicio) || !this.HORA_REGEX.test(d.fim)) {
        return `${this.nomesDias[i]}: preencha o horário de início e de fim.`;
      }
      if (this.paraMinutos(d.fim) <= this.paraMinutos(d.inicio)) {
        return `${this.nomesDias[i]}: o horário final precisa ser depois do inicial.`;
      }
      if (this.paraMinutos(d.fim) - this.paraMinutos(d.inicio) < this.horario.blocoMin) {
        return `${this.nomesDias[i]}: o período é menor que um horário de ${this.horario.blocoMin} min.`;
      }
    }
    return '';
  }

  /** Copia o horário do primeiro dia ativo para todos os outros dias em que a pessoa trabalha. */
  aplicarHorarioATodos() {
    const modelo = this.ordemDias.map(i => this.horario.dias[i]).find(d => d.ativo);
    if (!modelo) return;
    for (const dia of this.horario.dias) {
      if (dia.ativo) {
        dia.inicio = modelo.inicio;
        dia.fim = modelo.fim;
      }
    }
  }

  salvarHorario() {
    this.mensagemHorario = '';
    this.erroHorario = this.validarHorario();
    if (this.erroHorario) return;

    localStorage.setItem(this.CHAVE_HORARIO, JSON.stringify(this.horario));
    this.mensagemHorario = 'Horário de trabalho salvo!';
    setTimeout(() => (this.mensagemHorario = ''), 3000);
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

  exportarDados() {
    const dados: Record<string, unknown> = {};
    for (const chave of this.CHAVES_DADOS) {
      const valor = localStorage.getItem(chave);
      dados[chave] = valor ? JSON.parse(valor) : [];
    }

    const conteudo = JSON.stringify(dados, null, 2);
    const blob = new Blob([conteudo], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const hoje = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meufluxo-backup-${hoje}.json`;
    link.click();

    URL.revokeObjectURL(url);
  }

  apagarDados() {
    const confirmou = confirm(
      'Isso vai apagar clientes, serviços, agendamentos, despesas e metas salvos neste navegador. Essa ação não pode ser desfeita. Continuar?'
    );
    if (!confirmou) return;

    for (const chave of this.CHAVES_DADOS) {
      localStorage.removeItem(chave);
    }

    alert('Dados apagados com sucesso!');
    this.router.navigate(['/tela-inicial']);
  }
}
