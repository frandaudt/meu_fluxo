// src/controllers/clientesController.js
const { pool } = require('../config/db');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatarCliente(linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    telefone: linha.telefone,
    email: linha.email,
    endereco: linha.endereco,
    origem: linha.origem || 'sistema',        // sistema | whatsapp | link | importacao
    criadoEm: linha.criado_em || null,        // "cliente desde"
  };
}

/** Confere os campos do formulário. Devolve a mensagem de erro, ou null se estiver tudo certo. */
function validar({ nome, telefone, email }) {
  if (!nome || !String(nome).trim()) return 'O nome do cliente é obrigatório.';
  // RN11: telefone obrigatório (o bot e o link reconhecem o cliente pelo telefone)
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (digitos.length < 10 || String(telefone).length > 20) return 'Informe um telefone válido, com DDD.';
  if (email && !EMAIL_REGEX.test(email)) return 'Digite um e-mail válido.';
  return null;
}

/** Erro de telefone repetido (chave única usuario_id + telefone). */
function ehTelefoneRepetido(erro) {
  return erro && erro.code === 'ER_DUP_ENTRY';
}

async function buscarCliente(id, usuarioId) {
  const [linhas] = await pool.query(
    'SELECT id, nome, telefone, email, endereco, origem, criado_em FROM clientes WHERE id = ? AND usuario_id = ?',
    [id, usuarioId]
  );
  return linhas[0] ? formatarCliente(linhas[0]) : null;
}

async function listar(req, res) {
  try {
    const [linhas] = await pool.query(
      'SELECT id, nome, telefone, email, endereco, origem, criado_em FROM clientes WHERE usuario_id = ? ORDER BY nome',
      [req.usuarioId]
    );
    res.json({ clientes: linhas.map(formatarCliente) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar clientes.' });
  }
}

async function criar(req, res) {
  const { nome, telefone, email, endereco } = req.body;
  const problema = validar(req.body);
  if (problema) return res.status(400).json({ erro: problema });

  try {
    const [resultado] = await pool.query(
      'INSERT INTO clientes (usuario_id, nome, telefone, email, endereco) VALUES (?, ?, ?, ?, ?)',
      [req.usuarioId, String(nome).trim(), String(telefone).trim(), email || null, endereco || null]
    );
    res.status(201).json({ cliente: await buscarCliente(resultado.insertId, req.usuarioId) });
  } catch (erro) {
    if (ehTelefoneRepetido(erro)) {
      return res.status(409).json({ erro: 'Já existe um cliente com esse telefone.' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar cliente.' });
  }
}

async function atualizar(req, res) {
  const { id } = req.params;
  const { nome, telefone, email, endereco } = req.body;
  const problema = validar(req.body);
  if (problema) return res.status(400).json({ erro: problema });

  try {
    const [resultado] = await pool.query(
      'UPDATE clientes SET nome = ?, telefone = ?, email = ?, endereco = ? WHERE id = ? AND usuario_id = ?',
      [String(nome).trim(), String(telefone).trim(), email || null, endereco || null, id, req.usuarioId]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado.' });
    }

    res.json({ cliente: await buscarCliente(id, req.usuarioId) });
  } catch (erro) {
    if (ehTelefoneRepetido(erro)) {
      return res.status(409).json({ erro: 'Já existe outro cliente com esse telefone.' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao atualizar cliente.' });
  }
}

async function remover(req, res) {
  const { id } = req.params;

  try {
    // RN12: cliente com histórico (agendamentos ou lista de espera) não pode ser excluído
    const [[historico]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM agendamentos WHERE cliente_id = ? AND usuario_id = ?) AS agendamentos,
         (SELECT COUNT(*) FROM lista_espera WHERE cliente_id = ? AND usuario_id = ?) AS espera`,
      [id, req.usuarioId, id, req.usuarioId]
    );
    if (historico.agendamentos > 0 || historico.espera > 0) {
      return res.status(409).json({
        erro: 'Esse cliente tem histórico (agendamentos ou lista de espera) e não pode ser excluído.',
      });
    }

    const [resultado] = await pool.query(
      'DELETE FROM clientes WHERE id = ? AND usuario_id = ?',
      [id, req.usuarioId]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado.' });
    }

    res.json({ mensagem: 'Cliente removido com sucesso.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao remover cliente.' });
  }
}

// POST /api/clientes/importar → { clientes: [{ nome, telefone, email, endereco }] }
// O front lê a planilha (.csv) ou o backup (.json) e manda só a lista de clientes.
// Telefones que já existem (ou repetidos no próprio arquivo) são ignorados, para não duplicar.
// Agendamentos e financeiro NÃO são importados.
async function importar(req, res) {
  const lista = req.body && req.body.clientes;
  if (!Array.isArray(lista) || lista.length === 0) {
    return res.status(400).json({ erro: 'O arquivo não tem nenhum cliente.' });
  }
  if (lista.length > 3000) {
    return res.status(400).json({ erro: 'Importe no máximo 3000 clientes de cada vez.' });
  }

  const soDigitos = (t) => String(t || '').replace(/\D/g, '');

  try {
    const [existentes] = await pool.query('SELECT telefone FROM clientes WHERE usuario_id = ?', [req.usuarioId]);
    const telefonesUsados = new Set(existentes.map(c => soDigitos(c.telefone)));

    let importados = 0;
    let repetidos = 0;
    const invalidos = []; // { linha, motivo } para mostrar no resumo

    for (let i = 0; i < lista.length; i++) {
      const bruto = lista[i] || {};
      const cliente = {
        nome: String(bruto.nome || '').trim().slice(0, 100),
        telefone: String(bruto.telefone || '').trim().slice(0, 20),
        email: String(bruto.email || '').trim() || null,
        endereco: String(bruto.endereco || '').trim().slice(0, 255) || null,
      };
      if (cliente.email && !EMAIL_REGEX.test(cliente.email)) cliente.email = null; // e-mail ruim não impede

      const problema = validar(cliente);
      if (problema) {
        invalidos.push({ linha: i + 1, nome: cliente.nome, motivo: problema });
        continue;
      }
      const digitos = soDigitos(cliente.telefone);
      if (telefonesUsados.has(digitos)) {
        repetidos++;
        continue;
      }

      try {
        await pool.query(
          "INSERT INTO clientes (usuario_id, nome, telefone, email, endereco, origem) VALUES (?, ?, ?, ?, ?, 'importacao')",
          [req.usuarioId, cliente.nome, cliente.telefone, cliente.email, cliente.endereco]
        );
        telefonesUsados.add(digitos);
        importados++;
      } catch (erro) {
        if (ehTelefoneRepetido(erro)) { repetidos++; continue; }
        throw erro;
      }
    }

    res.json({ importados, ignorados: repetidos + invalidos.length, repetidos, invalidos: invalidos.slice(0, 20) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao importar os clientes.' });
  }
}

module.exports = { listar, criar, atualizar, remover, importar };
