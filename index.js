const express = require('express');
const xlsx = require('xlsx');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ================= CONFIG =================
const TEMPO_INATIVO = 10 * 60 * 1000; // 10 minutos

// ================= ESTADOS =================
const clientes = {};

function getCliente(numero) {
  if (!clientes[numero]) {
    clientes[numero] = {
      estado: 'MENU',
      pedido: [],
      quantidadeTotal: 0,
      ultimoContato: Date.now(),
      recebeuSaudacao: false
    };
  }
  return clientes[numero];
}

function limparPedido(cliente) {
  cliente.pedido = [];
  cliente.quantidadeTotal = 0;
  cliente.estado = 'MENU';
}

// ================= UTIL =================
function verificarInatividade(cliente) {
  return Date.now() - cliente.ultimoContato > TEMPO_INATIVO;
}

function saudacao() {
  return (
    `👋 Olá! Bem-vindo(a) à *Melhor Marmita* 🍱\n\n` +
    `O que você deseja?\n` +
    `1️⃣ Ver cardápio\n` +
    `2️⃣ Fazer pedido\n` +
    `3️⃣ Elogios ou reclamações`
  );
}

function menuTexto() {
  return (
    `📋 *Menu principal*\n\n` +
    `1️⃣ Cardápio\n` +
    `2️⃣ Fazer pedido\n` +
    `3️⃣ Elogios ou reclamações`
  );
}

function mensagemInvalida() {
  return `❌ Não entendi.\nPor favor, escolha uma das opções válidas.`;
}

// ================= ROTAS =================
app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

// ================= WEBHOOK (WhatsApp simulado) =================
app.post('/mensagem', (req, res) => {
  const { numero, texto } = req.body;
  if (!numero || !texto) {
    return res.status(400).json({ erro: 'Informe numero e texto' });
  }

  const cliente = getCliente(numero);

  // -------- INATIVIDADE --------
  if (verificarInatividade(cliente)) {
    limparPedido(cliente);
    cliente.recebeuSaudacao = false;
    cliente.ultimoContato = Date.now();
    return res.json({
      resposta:
        `⚠️ Atendimento encerrado por inatividade.\n\n` +
        saudacao()
    });
  }

  cliente.ultimoContato = Date.now();

  // -------- CANCELAMENTO GLOBAL --------
  if (texto.toUpperCase().includes('CANCELAR')) {
    limparPedido(cliente);
    return res.json({
      resposta:
        `❌ Pedido cancelado com sucesso.\n\n` +
        menuTexto()
    });
  }

  // -------- SAUDAÇÃO --------
  if (!cliente.recebeuSaudacao || cliente.estado === 'FINALIZADO') {
    cliente.recebeuSaudacao = true;
    cliente.estado = 'MENU';
    return res.json({ resposta: saudacao() });
  }

  // ================= MENU =================
  if (cliente.estado === 'MENU') {
    if (texto === '1') {
      // CARDÁPIO
      const arquivo = path.join(__dirname, 'menu.xlsx');
      const workbook = xlsx.readFile(arquivo);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const dados = xlsx.utils.sheet_to_json(sheet);

      let msg = '🍱 *Cardápio*\n\n';
      dados.forEach(item => {
        msg += `• ${item.PRATO} – R$ ${item.VALOR}\n`;
      });

      msg += `\n➡️ Digite:\n2️⃣ Fazer pedido\n0️⃣ Voltar ao menu`;
      cliente.estado = 'CARDAPIO';

      return res.json({ resposta: msg });
    }

    if (texto === '2') {
      cliente.estado = 'ESCOLHENDO_PRATO';
    } else if (texto === '3') {
      cliente.estado = 'ELOGIOS';
      return res.json({
        resposta:
          `💬 Envie seu elogio ou reclamação.\n` +
          `Responderemos assim que possível.\n\n` +
          `Digite 0️⃣ para voltar ao menu`
      });
    } else {
      return res.json({ resposta: mensagemInvalida() });
    }
  }

  // ================= CARDÁPIO =================
  if (cliente.estado === 'CARDAPIO') {
    if (texto === '2') {
      cliente.estado = 'ESCOLHENDO_PRATO';
    } else if (texto === '0') {
      cliente.estado = 'MENU';
      return res.json({ resposta: menuTexto() });
    } else {
      return res.json({ resposta: mensagemInvalida() });
    }
  }

  // ================= ESCOLHENDO PRATO =================
  if (cliente.estado === 'ESCOLHENDO_PRATO') {
    const arquivo = path.join(__dirname, 'menu.xlsx');
    const workbook = xlsx.readFile(arquivo);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const dados = xlsx.utils.sheet_to_json(sheet);

    let lista = '🍽️ Escolha um prato:\n\n';
    dados.forEach((item, index) => {
      lista += `${index + 1}️⃣ ${item.PRATO}\n`;
    });

    cliente.opcoes = dados;
    cliente.estado = 'PRATO_SELECIONADO';

    return res.json({ resposta: lista });
  }

  // ================= PRATO SELECIONADO =================
  if (cliente.estado === 'PRATO_SELECIONADO') {
    const idx = parseInt(texto);
    if (isNaN(idx) || idx < 1 || idx > cliente.opcoes.length) {
      return res.json({ resposta: mensagemInvalida() });
    }

    const prato = cliente.opcoes[idx - 1];
    cliente.pedido.push({
      prato: prato.PRATO,
      valor: prato.VALOR,
      quantidade: 0
    });

    cliente.estado = 'QUANTIDADE';
    return res.json({
      resposta:
        `🍽️ ${prato.PRATO}\n\n` +
        `Digite a quantidade desejada.\n\n` +
        `⚠️ Para voltar, é necessário *cancelar o pedido*.`
    });
  }

  // ================= QUANTIDADE =================
  if (cliente.estado === 'QUANTIDADE') {
    const qtd = parseInt(texto);
    if (isNaN(qtd) || qtd < 1) {
      return res.json({ resposta: 'Digite uma quantidade válida.' });
    }

    cliente.pedido[cliente.pedido.length - 1].quantidade = qtd;
    cliente.quantidadeTotal += qtd;

    cliente.estado = 'AGUARDANDO_ENDERECO';
    return res.json({
      resposta:
        `✅ Pedido anotado.\n\n` +
        `Informe o endereço de entrega.`
    });
  }

  // ================= ENDEREÇO =================
  if (cliente.estado === 'AGUARDANDO_ENDERECO') {
    cliente.endereco = texto;
    cliente.estado = 'AGUARDANDO_ATENDIMENTO_HUMANO';

    return res.json({
      resposta:
        `📍 Endereço recebido.\n\n` +
        `Aguarde enquanto calculamos o frete.`
    });
  }

  // ================= ATENDIMENTO HUMANO =================
  if (cliente.estado === 'AGUARDANDO_ATENDIMENTO_HUMANO') {
    return res.json({
      resposta:
        `⏳ Seu pedido está em atendimento.\n` +
        `Em breve retornaremos.`
    });
  }

  // ================= FALLBACK =================
  res.json({ resposta: mensagemInvalida() });
});

// ================= SERVER =================
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
