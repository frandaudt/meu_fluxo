// src/routes/usuariosRoutes.js
const express = require('express');
const {
  cadastrar,
  login,
  obterPerfil,
  atualizarPerfil,
  trocarSenha,
  excluirConta,
  salvarFoto,
  obterAparencia,
  salvarAparencia,
  exportarDados,
} = require('../controllers/usuariosController');
const { autenticar, somenteDono } = require('../middlewares/auth');

const router = express.Router();

router.post('/cadastro', cadastrar);
router.post('/login', login);
router.get('/perfil', autenticar, obterPerfil);
router.put('/perfil', autenticar, atualizarPerfil);
router.put('/senha', autenticar, trocarSenha);
router.put('/foto', autenticar, salvarFoto);
router.get('/aparencia', autenticar, obterAparencia);
router.put('/aparencia', autenticar, somenteDono, salvarAparencia);
router.get('/exportar', autenticar, somenteDono, exportarDados);
router.delete('/conta', autenticar, somenteDono, excluirConta);

module.exports = router;
