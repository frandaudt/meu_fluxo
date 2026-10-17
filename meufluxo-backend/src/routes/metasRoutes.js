const express = require('express');
const router = express.Router();
const metasController = require('../controllers/metasController');
const { autenticar, permitir } = require('../middlewares/auth');

router.use(autenticar, permitir('metas'));

router.get('/mensais', metasController.listarMensais);
router.post('/mensais', metasController.criarMensal);
router.delete('/mensais/:id', metasController.removerMensal);

router.get('/anuais', metasController.listarAnuais);
router.post('/anuais', metasController.salvarAnual);

module.exports = router;