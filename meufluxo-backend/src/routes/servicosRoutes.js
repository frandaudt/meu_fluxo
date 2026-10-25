// src/routes/servicosRoutes.js
const express = require('express');
const { listar, criar, atualizar, remover, alterarVisibilidade } = require('../controllers/servicosController');
const { autenticar, permitir } = require('../middlewares/auth');

const router = express.Router();

router.use(autenticar);

router.get('/', listar); // atendente também lista (para escolher o serviço ao agendar)
router.post('/', permitir('servicos'), criar);
router.put('/:id', permitir('servicos'), atualizar);
router.delete('/:id', permitir('servicos'), remover);
router.put('/:id/mostrar', permitir('whatsapp'), alterarVisibilidade); // aparece no link e no bot?

module.exports = router;