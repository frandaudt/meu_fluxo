// src/routes/whatsappRoutes.js
// Tela WhatsApp (dono ou atendente com a caixa "WhatsApp") + webhook da Meta.
const express = require('express');
const whatsapp = require('../controllers/whatsappController');
const { autenticar, permitir } = require('../middlewares/auth');

const router = express.Router();

// Webhook da Meta: SEM login. A Meta prova quem é pelo verify token (GET)
// e pela assinatura com a chave secreta do app (POST).
router.get('/webhook', whatsapp.verificarWebhook);
router.post('/webhook', whatsapp.receberWebhook);

// mensagens prontas: todo mundo logado lê (botões "Chamar no WhatsApp", lembretes...)
router.get('/mensagens', autenticar, whatsapp.listarMensagens);

// daqui para baixo, só quem está logado e pode mexer no WhatsApp
router.use(autenticar, permitir('whatsapp'));

router.get('/config', whatsapp.obterConfig);                  // bot ligado?, cadastro automático, respostas
router.put('/config', whatsapp.salvarConfig);                 // interruptores
router.put('/respostas', whatsapp.salvarRespostas);           // textos do bot
router.put('/mensagens', whatsapp.salvarMensagem);            // mensagem pronta "Em uso" de um serviço
router.delete('/mensagens', whatsapp.removerMensagem);        // volta ao modelo pronto
router.post('/simular', whatsapp.simular);                    // simulador: conversa com o bot pela tela
router.post('/simular/reiniciar', whatsapp.reiniciarSimulacao);

module.exports = router;
