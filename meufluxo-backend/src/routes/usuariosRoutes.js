// src/routes/usuariosRoutes.js
const express = require('express');
const {
  cadastrar,
  login,
  obterPerfil,
  atualizarPerfil,
  trocarSenha,
  excluirConta,
} = require('../controllers/usuariosController');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();

router.post('/cadastro', cadastrar);
router.post('/login', login);
router.get('/perfil', autenticar, obterPerfil);
router.put('/perfil', autenticar, atualizarPerfil);
router.put('/senha', autenticar, trocarSenha);
router.delete('/conta', autenticar, excluirConta);

module.exports = router;