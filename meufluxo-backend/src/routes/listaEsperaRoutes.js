// src/routes/listaEsperaRoutes.js
// Lista de espera: liberada para dono e atendente (Perfil › Equipe: "Lista de espera · Pode").
const express = require('express');
const listaEspera = require('../controllers/listaEsperaController');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();

router.use(autenticar);

router.get('/', listaEspera.listar);                    // fila + histórico + números + vaga em destaque
router.post('/', listaEspera.criar);                    // + Adicionar à lista
router.put('/:id', listaEspera.atualizar);              // Editar
router.delete('/:id', listaEspera.remover);             // Remover (= desistiu, fica no histórico)
router.put('/:id/avisado', listaEspera.marcarAvisado);  // clicou em "Avisar pelo WhatsApp"
router.post('/:id/encaixar', listaEspera.encaixar);     // Encaixar: cria o agendamento

module.exports = router;
