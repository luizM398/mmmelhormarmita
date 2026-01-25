const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ================== MENSAGENS ==================

function mensagemSaudacao() {
  return (
    `👋 Olá! Bem-vindo(a) à Melhor Marmita!\n` +
    `Aqui você encontra comida de qualidade, saborosa e fresquinha. 😋\n` +
    `✨ Qualidade e sabor garantidos!`
  );
}

function mensagemMenu() {
  return (
    `\nO que você deseja hoje?\n\n` +
    `1️⃣ Ver o cardápio\n` +
    `2️⃣ Fazer um pedido\n` +
    `3️⃣ Elogios e reclamações`
  );
}

function erroPadrao(cliente) {
  return (
    `❌ Não entendi sua resposta.\n` +
    `Por favor, escolha uma das opções abaixo:\n\n` +
    (cliente.ultimaMensagem || mensagemMenu())
  );
}

// ================== ROTAS ==================

app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

app.post('/mensagem', (req, res) => {
  const { numero, texto } = req.body;
  if (!numero || !texto) {
    return res.status(400).json({ erro: 'Informe numero e texto' });
  }

  const mensagem = texto.trim().toLowerCase();
  const cliente = estadoClientes.getEstado(numero);
  let resposta = '';

  // ================== CANCELAMENTO ==================
  if (mensagem === 'cancelar') {
    cliente.estadoAnterior = cliente.estado;
    cliente.estado = 'CONFIRMAR_CANCELAMENTO';

    resposta =
      '⚠️ Tem certeza que deseja cancelar seu pedido?\n\n' +
      '1️⃣ Sim, cancelar pedido\n' +
      '2️⃣ Não, continuar pedido';

    cliente.ultimaMensagem = resposta;
    return res.json({ resposta });
  }

  // ================== SAUDAÇÃO ==================
  if (!cliente.recebeuSaudacao || cliente.estado === 'FINALIZADO') {
    cliente.recebeuSaudacao = true;
    cliente.estado = 'MENU';

    resposta = mensagemSaudacao() + mensagemMenu();
    cliente.ultimaMensagem = mensagemMenu();
    return res.json({ resposta });
  }

  // ================== MENU ==================
  if (cliente.estado === 'MENU') {
    if (mensagem === '1') {
      const dados = xlsx.utils.sheet_to_json(
        xlsx.readFile(path.join(__dirname, 'menu.xlsx'))
          .Sheets['Sheet1']
      );

      resposta = '🍱 Cardápio:\n\n';
      dados.forEach(i => {
        resposta += `${i['CÓDIGO']}️⃣ ${i['PRATO']} - R$ ${i['VALOR']}\n`;
      });

      cliente.ultimaMensagem = resposta;
      return res.json({ resposta });
    }

    if (mensagem === '2') {
      const dados = xlsx.utils.sheet_to_json(
        xlsx.readFile(path.join(__dirname, 'menu.xlsx'))
          .Sheets['Sheet1']
      );

      resposta = '🍽️ Escolha um prato:\n\n';
      dados.forEach((i, idx) => {
        resposta += `${idx + 1}️⃣ ${i['PRATO']}\n`;
      });

      cliente.estado = 'ESCOLHENDO_PRATO';
      cliente.opcoesPrato = dados;
      cliente.ultimaMensagem = resposta;
      return res.json({ resposta });
    }

    return res.json({ resposta: erroPadrao(cliente) });
  }

  // ================== CONFIRMAR CANCELAMENTO ==================
  if (cliente.estado === 'CONFIRMAR_CANCELAMENTO') {
    if (mensagem === '1') {
      estadoClientes.limparPedido(numero);
      cliente.estado = 'MENU';
      resposta = '❌ Pedido cancelado.\n\n' + mensagemMenu();
      cliente.ultimaMensagem = mensagemMenu();
      return res.json({ resposta });
    }

    if (mensagem === '2') {
      cliente.estado = cliente.estadoAnterior || 'MENU';
      resposta = cliente.ultimaMensagem;
      return res.json({ resposta });
    }

    return res.json({ resposta: erroPadrao(cliente) });
  }

  // ================== ESCOLHENDO PRATO ==================
  if (cliente.estado === 'ESCOLHENDO_PRATO') {
    const escolha = parseInt(mensagem);
    if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) {
      return res.json({ resposta: erroPadrao(cliente) });
    }

    const prato = cliente.opcoesPrato[escolha - 1];
    cliente.pedido = [{ prato: prato.PRATO, quantidade: 0 }];

    cliente.estado = 'QUANTIDADE';
    resposta = 'Digite a quantidade desejada.';
    cliente.ultimaMensagem = resposta;
    return res.json({ resposta });
  }

  // ================== QUANTIDADE ==================
  if (cliente.estado === 'QUANTIDADE') {
    const qtd = parseInt(mensagem);
    if (isNaN(qtd) || qtd < 1) {
      return res.json({ resposta: erroPadrao(cliente) });
    }

    cliente.pedido[0].quantidade = qtd;
    cliente.estado = 'MENU';
    resposta = '✅ Pedido registrado!\n\n' + mensagemMenu();
    cliente.ultimaMensagem = mensagemMenu();
    return res.json({ resposta });
  }

  // ================== FALLBACK GLOBAL ==================
  return res.json({ resposta: erroPadrao(cliente) });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
