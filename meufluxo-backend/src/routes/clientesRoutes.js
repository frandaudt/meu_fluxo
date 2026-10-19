// src/routes/clientesRoutes.js
const express = require('express');
const { listar, criar, atualizar, remover, importar } = require('../controllers/clientesController');
const { autenticar, permitir, somenteDono } = require('../middlewares/auth');

const router = express.Router();

router.use(autenticar);

router.get('/', listar);
router.post('/', criar);
router.post('/importar', somenteDono, importar); // Perfil › Seus dados
router.put('/:id', atualizar);
router.delete('/:id', permitir('excluirClientes'), remover);

module.exports = router;
