// src/routes/clientesRoutes.js
const express = require('express');
const { listar, criar, atualizar, remover } = require('../controllers/clientesController');
const { autenticar, permitir } = require('../middlewares/auth');

const router = express.Router();

router.use(autenticar);

router.get('/', listar);
router.post('/', criar);
router.put('/:id', atualizar);
router.delete('/:id', permitir('excluirClientes'), remover);

module.exports = router;