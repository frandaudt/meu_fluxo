// src/routes/publicoRoutes.js
// Página pública de agendamento (/agendar/:slug) e link "Confirmar presença" (/confirmar/:token).
// SEM login: os limites por IP ficam no app.js.
const express = require('express');
const publico = require('../controllers/publicoController');

const router = express.Router();

// link "Confirmar presença" do lembrete (vem antes de /:slug para não se confundir)
router.get('/horario/:token', publico.obterHorario);
router.get('/horario/:token/dias', publico.diasParaRemarcar);
router.get('/horario/:token/horarios', publico.horariosParaRemarcar);
router.post('/horario/:token/confirmar', publico.confirmarPresenca);
router.post('/horario/:token/cancelar', publico.cancelarPeloLink);
router.post('/horario/:token/remarcar', publico.remarcarPeloLink);

// página de agendamento
router.get('/:slug', publico.obterNegocio);
router.get('/:slug/dias', publico.listarDias);
router.get('/:slug/horarios', publico.listarHorarios);
router.post('/:slug/agendar', publico.agendar);
router.post('/:slug/espera', publico.entrarNaEspera);

module.exports = router;