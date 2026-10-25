// src/app.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const usuariosRoutes = require('./routes/usuariosRoutes');
const clientesRoutes = require('./routes/clientesRoutes');
const servicosRoutes = require('./routes/servicosRoutes');
const agendamentosRoutes = require('./routes/agendamentosRoutes');
const despesasRoutes = require('./routes/despesasRoutes');
const metasRoutes = require('./routes/metasRoutes');
const horarioTrabalhoRoutes = require('./routes/horarioTrabalhoRoutes');
const equipeRoutes = require('./routes/equipeRoutes');
const alertasRoutes = require('./routes/alertasRoutes');
const listaEsperaRoutes = require('./routes/listaEsperaRoutes');
const publicoRoutes = require('./routes/publicoRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');

const app = express();

// no Render as requisições passam por um proxy; sem isso, todo mundo
// teria o mesmo IP e os limites de requisição virariam um limite global
app.set('trust proxy', 1);

app.use(cors());
// 2 MB: cabe a foto do perfil e a importação de clientes (o padrão do Express é 100 KB)
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// limita tentativas de login/cadastro pra dificultar força bruta e criação em massa de contas
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // no máximo 10 tentativas por IP nesse período
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

// link público de agendamento (sem login):
// - consultar: até 120 por IP a cada 15 minutos;
// - agendar / entrar na lista de espera: até 8 por IP por hora
const limitePublicoLeitura = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas consultas. Espere alguns minutos e tente de novo.' },
});
const limitePublicoEnvio = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true, // erro de digitação não gasta tentativa
  message: { erro: 'Muitos agendamentos deste aparelho. Tente de novo mais tarde ou fale pelo WhatsApp.' },
});
app.use('/api/publico', (req, res, next) => (req.method === 'POST' ? limitePublicoEnvio : limitePublicoLeitura)(req, res, next));

app.use('/api/usuarios/login', limiteAuth);
app.use('/api/usuarios/cadastro', limiteAuth);
app.use('/api/usuarios/google', limiteAuth);
app.use('/api/usuarios/senha/codigo', limiteAuth);    // não deixa mandar e-mail sem parar
app.use('/api/usuarios/senha/redefinir', limiteAuth); // e nem ficar chutando o código
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/servicos', servicosRoutes);
app.use('/api/agendamentos', agendamentosRoutes);
app.use('/api/despesas', despesasRoutes);
app.use('/api/metas', metasRoutes);
app.use('/api/horario-trabalho', horarioTrabalhoRoutes);
app.use('/api/equipe', equipeRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/lista-espera', listaEsperaRoutes);
app.use('/api/publico', publicoRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// rota da API que não existe → 404 em JSON (e não a página do Angular)
app.use('/api', (req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// ---------------------------------------------------------------------
// Front-end: em produção (Render) o mesmo servidor entrega o Angular.
// O build fica em dist/meufluxotcc/browser, na raiz do projeto.
// Rodando localmente sem build, essa parte é ignorada (use o ng serve).
// ---------------------------------------------------------------------
const pastaFront = path.join(__dirname, '..', '..', 'dist', 'meufluxotcc', 'browser');

if (fs.existsSync(pastaFront)) {
  app.use(express.static(pastaFront));

  // qualquer outra página (/agenda, /clientes, /agendar/studio-x...) devolve o
  // index.html, e o roteador do Angular decide qual tela mostrar
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(pastaFront, 'index.html'));
  });
}

module.exports = app;