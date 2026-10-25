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
  obterLink,
  salvarLink,
  enviarCodigoSenha,
  redefinirSenhaComCodigo,
  configPublica,
  entrarComGoogle,
} = require('../controllers/usuariosController');
const { autenticar, somenteDono, permitir } = require('../middlewares/auth');

const router = express.Router();

router.post('/cadastro', cadastrar);
router.post('/login', login);
router.get('/config', configPublica);                       // Client ID do Google (não é segredo)
router.post('/google', entrarComGoogle);                    // "Continuar com Google"
router.post('/senha/codigo', enviarCodigoSenha);            // "Esqueci minha senha": manda o código
router.post('/senha/redefinir', redefinirSenhaComCodigo);   // código + nova senha
router.get('/perfil', autenticar, obterPerfil);
router.put('/perfil', autenticar, atualizarPerfil);
router.put('/senha', autenticar, trocarSenha);
router.put('/foto', autenticar, salvarFoto);
router.get('/aparencia', autenticar, obterAparencia);
router.put('/aparencia', autenticar, somenteDono, salvarAparencia);
router.get('/exportar', autenticar, somenteDono, exportarDados);
// link de agendamento (tela WhatsApp)
router.get('/link', autenticar, permitir('whatsapp'), obterLink);
router.put('/link', autenticar, permitir('whatsapp'), salvarLink);
router.delete('/conta', autenticar, somenteDono, excluirConta);

module.exports = router;