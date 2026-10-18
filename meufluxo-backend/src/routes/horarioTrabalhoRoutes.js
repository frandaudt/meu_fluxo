const express = require('express');
const router = express.Router();
const horarioTrabalhoController = require('../controllers/horarioTrabalhoController');
const { autenticar, permitir } = require('../middlewares/auth');

router.use(autenticar);

router.get('/', horarioTrabalhoController.obter);
router.put('/', permitir('horario'), horarioTrabalhoController.salvar);

module.exports = router;