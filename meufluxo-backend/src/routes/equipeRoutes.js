// src/routes/equipeRoutes.js
const express = require('express');
const { listar, criar, redefinirSenha, atualizarPermissoes, remover } = require('../controllers/equipeController');
const { autenticar, somenteDono } = require('../middlewares/auth');

const router = express.Router();

router.use(autenticar, somenteDono);

router.get('/', listar);
router.post('/', criar);
router.put('/:id/senha', redefinirSenha);
router.put('/:id/permissoes', atualizarPermissoes);
router.delete('/:id', remover);

module.exports = router;