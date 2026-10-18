const express = require('express');
const router = express.Router();
const despesasController = require('../controllers/despesasController');
const { autenticar, permitir } = require('../middlewares/auth');

router.use(autenticar, permitir('financeiro'));

router.get('/', despesasController.listar);
router.post('/', despesasController.criar);
router.delete('/:id', despesasController.remover);

module.exports = router;