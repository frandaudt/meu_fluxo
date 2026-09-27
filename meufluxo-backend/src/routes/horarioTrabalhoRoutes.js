const express = require('express');
const router = express.Router();
const horarioTrabalhoController = require('../controllers/horarioTrabalhoController');
const { autenticar } = require('../middlewares/auth');

router.use(autenticar);

router.get('/', horarioTrabalhoController.obter);
router.put('/', horarioTrabalhoController.salvar);

module.exports = router;