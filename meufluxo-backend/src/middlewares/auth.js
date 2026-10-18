const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

/**
 * Áreas que o dono pode liberar para cada atendente (caixas na aba Equipe).
 * Agenda, clientes (ver/cadastrar/editar), lista de espera e receber pagamento
 * são liberados para todo atendente e não aparecem aqui.
 */
const PERMISSOES = [
  'financeiro',      // ver valores, Financeiro e lançar despesas
  'servicos',        // criar, editar preço e excluir serviços
  'metas',           // ver e cadastrar metas
  'excluirClientes', // excluir clientes
  'horario',         // horário de trabalho e folgas
  'whatsapp',        // tela WhatsApp e mensagens prontas
];

/** Lê a coluna permissoes (JSON) e devolve só as permissões que existem. */
function lerPermissoes(valor) {
  let lista = valor;
  if (typeof valor === 'string') {
    try { lista = JSON.parse(valor); } catch { lista = []; }
  }
  return Array.isArray(lista) ? lista.filter(p => PERMISSOES.includes(p)) : [];
}

/**
 * Confere o token e prepara 3 informações para os controllers:
 *
 *  - req.usuarioId       → id do DONO do negócio. Para o atendente, é o id do
 *                          dono dele. Assim todos os controllers que já existem
 *                          (clientes, serviços, agenda...) continuam funcionando
 *                          e o atendente enxerga os dados do negócio onde trabalha.
 *  - req.usuarioLogadoId → id de quem está logado de verdade (usar no Perfil,
 *                          na troca de senha e em criado_por / recebido_por).
 *  - req.papel           → 'dono' ou 'atendente'.
 *  - req.permissoes      → o que o atendente pode acessar (o dono marca na aba Equipe).
 */
async function autenticar(req, res, next) {
  const cabecalho = req.headers.authorization;

  if (!cabecalho || !cabecalho.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token não informado.' });
  }

  const token = cabecalho.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (erro) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }

  // tokens antigos (de antes dos níveis de acesso) só têm o id: tratamos como dono
  const papel = payload.papel === 'atendente' ? 'atendente' : 'dono';

  try {
    if (papel === 'atendente') {
      // confere no banco a cada requisição: se o dono removeu o atendente,
      // o acesso acaba na hora, mesmo que o token ainda não tenha vencido
      // (as permissões também vêm do banco, então mudam na hora quando o dono edita)
      const [linhas] = await pool.query(
        "SELECT dono_id, permissoes FROM usuarios WHERE id = ? AND papel = 'atendente'",
        [payload.id]
      );
      if (!linhas[0] || !linhas[0].dono_id) {
        return res.status(401).json({ erro: 'Seu acesso foi removido. Fale com o dono do negócio.' });
      }
      req.usuarioId = linhas[0].dono_id;
      req.permissoes = lerPermissoes(linhas[0].permissoes);
    } else {
      req.usuarioId = payload.id;
      req.permissoes = PERMISSOES.slice(); // o dono pode tudo
    }

    req.usuarioLogadoId = payload.id;
    req.papel = papel;
    next();
  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ erro: 'Erro ao verificar o acesso.' });
  }
}

/**
 * Usar DEPOIS do autenticar. O dono sempre passa; o atendente só passa
 * se o dono marcou essa permissão para ele. Ex.: permitir('financeiro')
 */
function permitir(permissao) {
  return (req, res, next) => {
    if (req.papel === 'dono' || (req.permissoes || []).includes(permissao)) {
      return next();
    }
    return res.status(403).json({ erro: 'Você não tem permissão para isso. Fale com o dono do negócio.' });
  };
}

/** Usar DEPOIS do autenticar, no que é só do dono (Equipe, excluir conta, aparência). */
function somenteDono(req, res, next) {
  if (req.papel !== 'dono') {
    return res.status(403).json({ erro: 'Só o dono do negócio pode fazer isso.' });
  }
  next();
}

module.exports = { autenticar, permitir, somenteDono, PERMISSOES, lerPermissoes };