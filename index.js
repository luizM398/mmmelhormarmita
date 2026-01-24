const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes');
const mensagens = require('./mensagens');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ================== ROTAS BÁSICAS ==================

app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

app.get('/menu', (req, res) => {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');
    const workbook = xlsx.readFile(arquivo);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const dados = xlsx.utils.sheet_to_json(sheet);
    res.json(dados);
  } catch (erro) {
    res.status(500).send('Erro ao ler o menu');
  }
});

app.post('/webhook', (req, res) => {
  res.status(200).send('ok');
});

// ================== ROTA PRINCIPAL ==================

app.post('/mensagem', (req, res) => {
  const { numero, texto } = req.body;

  if (!numero || !texto) {
    return res.status(400).json({ erro: 'Informe numero e texto' });
  }

  const cliente = estadoClientes.getEstado(numero);
  let resposta = '';

// ================== MENU ==================

  if (cliente.estado === 'MENU') {

    if (texto === '1') {
      try {
        const arquivo = path.join(__dirname, 'menu.xlsx');
        const workbook = xlsx.readFile(arquivo);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const dados = xlsx.utils.sheet_to_json(sheet);

        let lista = '🍱 Cardápio:\n\n';
        dados.forEach(item => {
          lista += `${item['CÓDIGO']}️⃣ ${item['PRATO']} - R$ ${item['VALOR']}\n`;
        });

        resposta = lista;
      } catch {
        resposta = 'Erro ao carregar o cardápio.';
      }

    } else if (texto === '2') {
      try {
        const arquivo = path.join(__dirname, 'menu.xlsx');
        const workbook = xlsx.readFile(arquivo);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const dados = xlsx.utils.sheet_to_json(sheet);

        let lista = '🍽️ Escolha um prato:\n\n';
        dados.forEach((item, index) => {
          lista += `${index + 1}️⃣ ${item['PRATO']}\n`;
        });

        cliente.estado = 'ESCOLHENDO_PRATO';
        cliente.opcoesPrato = dados;

        resposta = lista;
      } catch {
        resposta = 'Erro ao carregar os pratos.';
      }

    } else {
      resposta = mensagens.menuPrincipal;
    }
  }

// ================== ESCOLHA DO PRATO ==================

  else if (cliente.estado === 'ESCOLHENDO_PRATO') {
    const escolha = parseInt(texto);

    if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) {
      resposta = 'Escolha um número válido.';
    } else {
      const prato = cliente.opcoesPrato[escolha - 1];
      const nome = prato['PRATO'].toLowerCase();

      cliente.pedido = [{
        prato: prato['PRATO'],
        valor: prato['VALOR'],
        arroz: null,
        strogonoff: null,
        quantidade: 0
      }];

      cliente.precisaArroz = nome.includes('arroz');
      cliente.precisaStrogonoff = nome.includes('strogon');

      if (cliente.precisaArroz) {
        cliente.estado = 'VARIACAO_ARROZ';
        resposta =
          `🍚 ${prato['PRATO']}\n\nEscolha o tipo de arroz:\n` +
          `1️⃣ Branco\n2️⃣ Integral`;
      } 
      else if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta =
          `🍛 ${prato['PRATO']}\n\nEscolha a variação do strogonoff:\n` +
          `1️⃣ Tradicional\n2️⃣ Light`;
      } 
      else {
        cliente.estado = 'QUANTIDADE';
        resposta = 'Digite a quantidade desejada.';
      }
    }
  }

// ================== VARIAÇÃO ARROZ ==================

  else if (cliente.estado === 'VARIACAO_ARROZ') {
    if (texto === '1') cliente.pedido[0].arroz = 'Branco';
    else if (texto === '2') cliente.pedido[0].arroz = 'Integral';
    else return res.json({ resposta: 'Escolha 1 ou 2.' });

    if (cliente.precisaStrogonoff) {
      cliente.estado = 'VARIACAO_STROGONOFF';
      resposta =
        `🍛 Escolha a variação do strogonoff:\n` +
        `1️⃣ Tradicional\n2️⃣ Light`;
    } else {
      cliente.estado = 'QUANTIDADE';
      resposta = 'Digite a quantidade desejada.';
    }
  }

// ================== VARIAÇÃO STROGONOFF ==================

  else if (cliente.estado === 'VARIACAO_STROGONOFF') {
    if (texto === '1') cliente.pedido[0].strogonoff = 'Tradicional';
    else if (texto === '2') cliente.pedido[0].strogonoff = 'Light';
    else return res.json({ resposta: 'Escolha 1 ou 2.' });

    cliente.estado = 'QUANTIDADE';
    resposta = 'Digite a quantidade desejada.';
  }

// ================== QUANTIDADE ==================

  else if (cliente.estado === 'QUANTIDADE') {
    const qtd = parseInt(texto);

    if (isNaN(qtd) || qtd < 1) {
      resposta = 'Digite uma quantidade válida.';
    } else {
      cliente.pedido[0].quantidade = qtd;
      cliente.estado = 'MENU';
      resposta = '✅ Pedido anotado! Volte ao menu.';
    }
  }

  res.json({ resposta });
});

// ================== SERVER ==================

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
