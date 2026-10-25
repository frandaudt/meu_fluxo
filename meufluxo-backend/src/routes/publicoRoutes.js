// src/routes/publicoRoutes.js
// Página pública de agendamento (/agendar/:slug). SEM login: os limites por IP ficam no app.js.
const express = require('express');
const publico = require('../controllers/publicoController');

const router = express.Router();

router.get('/:slug', publico.obterNegocio);
router.get('/:slug/dias', publico.listarDias);
router.get('/:slug/horarios', publico.listarHorarios);
router.post('/:slug/agendar', publico.agendar);
router.post('/:slug/espera', publico.entrarNaEspera);

module.exports = router;
