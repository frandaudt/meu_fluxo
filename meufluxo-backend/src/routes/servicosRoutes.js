// src/routes/servicosRoutes.js
const express = require('express');
const { listar, criar, atualizar, remover } = require('../controllers/servicosController');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();

router.use(autenticar);

router.get('/', listar);
router.post('/', criar);
router.put('/:id', atualizar);
router.delete('/:id', remover);

module.exports = router;