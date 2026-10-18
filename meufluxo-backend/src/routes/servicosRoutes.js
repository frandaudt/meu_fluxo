// src/routes/servicosRoutes.js
const express = require('express');
const { listar, criar, atualizar, remover } = require('../controllers/servicosController');
const { autenticar, permitir } = require('../middlewares/auth');

const router = express.Router();

router.use(autenticar);

router.get('/', listar);
router.post('/', permitir('servicos'), criar);
router.put('/:id', permitir('servicos'), atualizar);
router.delete('/:id', permitir('servicos'), remover);

module.exports = router;