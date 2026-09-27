// src/app.js
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

const app = express();

app.use(cors());
app.use(express.json());

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

app.use('/api/usuarios/login', limiteAuth);
app.use('/api/usuarios/cadastro', limiteAuth);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/servicos', servicosRoutes);
app.use('/api/agendamentos', agendamentosRoutes);
app.use('/api/despesas', despesasRoutes);
app.use('/api/metas', metasRoutes);
app.use('/api/horario-trabalho', horarioTrabalhoRoutes);

module.exports = app;