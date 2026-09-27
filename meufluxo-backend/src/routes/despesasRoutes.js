const express = require('express');
const router = express.Router();
const despesasController = require('../controllers/despesasController');
const { autenticar } = require('../middlewares/auth');

router.use(autenticar);

router.get('/', despesasController.listar);
router.post('/', despesasController.criar);
router.delete('/:id', despesasController.remover);

module.exports = router;