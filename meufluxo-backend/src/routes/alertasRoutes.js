// src/routes/alertasRoutes.js
const express = require('express');
const alertasController = require('../controllers/alertasController');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();

// dono e atendente veem os avisos (o controller tira o que o atendente não pode ver)
router.use(autenticar);

router.get('/', alertasController.listar);
router.put('/notificacoes/:id/lida', alertasController.marcarLida);

module.exports = router;
