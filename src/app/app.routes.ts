import { Routes } from '@angular/router';
import { Agenda } from './pages/agenda/agenda';
import { Cadastro } from './pages/cadastro/cadastro';
import { ClientesComponent } from './pages/clientes/clientes';
import { Financeiro } from './pages/financeiro/financeiro';
import { Login } from './pages/login/login';
import { Metas } from './pages/metas/metas';
import { Perfil } from './pages/perfil/perfil';
import { Servicos } from './pages/servicos/servicos';
import { TelaInicial } from './pages/tela-inicial/tela-inicial';

export const routes: Routes = [
  {path: '', redirectTo: 'login', pathMatch: 'full'},
  {path: 'login', component: Login},
  {path: 'cadastro', component: Cadastro},
  {path: 'tela-inicial', component: TelaInicial},
  {path: 'agenda', component: Agenda},
  {path: 'clientes', component: ClientesComponent},
  {path: 'servicos', component: Servicos},
  {path: 'financeiro', component: Financeiro},
  {path: 'metas', component: Metas},
  {path: 'perfil', component: Perfil},


];
