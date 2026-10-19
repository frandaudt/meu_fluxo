const express = require('express');
const router = express.Router();
const horarioTrabalhoController = require('../controllers/horarioTrabalhoController');
const { autenticar, permitir } = require('../middlewares/auth');

router.use(autenticar);

// ler: todo mundo (a Início e a Agenda precisam do horário para mostrar o que está livre)
router.get('/', horarioTrabalhoController.obter);
router.get('/bloqueios', horarioTrabalhoController.listarBloqueios);

// mudar: o dono, ou o atendente com a caixa "Horário de trabalho" marcada
router.put('/', permitir('horario'), horarioTrabalhoController.salvar);
router.post('/bloqueios', permitir('horario'), horarioTrabalhoController.criarBloqueio);
router.delete('/bloqueios/:id', permitir('horario'), horarioTrabalhoController.removerBloqueio);

module.exports = router;
