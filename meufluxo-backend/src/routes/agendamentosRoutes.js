const express = require('express');
const router = express.Router();
const agendamentosController = require('../controllers/agendamentosController');
const { autenticar } = require('../middlewares/auth');

router.use(autenticar);

router.get('/', agendamentosController.listar);
router.post('/', agendamentosController.criar);
router.put('/:id/status', agendamentosController.atualizarStatus);
router.delete('/:id', agendamentosController.remover);

module.exports = router;