import { Routes } from '@angular/router';
import { Agenda } from './pages/agenda/agenda';
import { Agendar } from './pages/agendar/agendar';
import { Busca } from './pages/busca/busca';
import { Anuncio } from './pages/anuncio/anuncio';
import { Cadastro } from './pages/cadastro/cadastro';
import { ClientesComponent } from './pages/clientes/clientes';
import { Financeiro } from './pages/financeiro/financeiro';
import { ListaEspera } from './pages/lista-espera/lista-espera';
import { Login } from './pages/login/login';
import { Metas } from './pages/metas/metas';
import { Perfil } from './pages/perfil/perfil';
import { Servicos } from './pages/servicos/servicos';
import { TelaInicial } from './pages/tela-inicial/tela-inicial';
import { Whatsapp } from './pages/whatsapp/whatsapp';

export const routes: Routes = [
  {path: '', component: Anuncio},
  {path: 'login', component: Login},
  {path: 'cadastro', component: Cadastro},
  {path: 'tela-inicial', component: TelaInicial},
  {path: 'agenda', component: Agenda},
  {path: 'clientes', component: ClientesComponent},
  {path: 'servicos', component: Servicos},
  {path: 'financeiro', component: Financeiro},
  {path: 'metas', component: Metas},
  {path: 'perfil', component: Perfil},
  {path: 'busca', component: Busca},
  {path: 'lista-espera', component: ListaEspera},
  {path: 'whatsapp', component: Whatsapp},
  {path: 'agendar/:slug', component: Agendar}, // página pública, sem login

];
