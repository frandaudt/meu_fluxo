const express = require('express');
const router = express.Router();
const agendamentosController = require('../controllers/agendamentosController');
const { autenticar, somenteDono } = require('../middlewares/auth');

router.use(autenticar);

router.get('/', agendamentosController.listar);
router.get('/a-receber', agendamentosController.listarAReceber);
router.post('/', agendamentosController.criar);
router.put('/:id', agendamentosController.atualizar);                       // observação / reagendar
router.put('/:id/status', agendamentosController.atualizarStatus);          // concluir, falta, cancelar, desfazer
router.put('/:id/pagamento', agendamentosController.registrarPagamento);    // registrar pagamento ("Receber agora")
router.delete('/:id', somenteDono, agendamentosController.remover);         // apagar de vez: só o dono (some do histórico)

module.exports = router;