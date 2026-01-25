const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes');
const mensagens = require('./mensagens');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ================== SAUDAÇÃO ==================

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
  } catch {
    res.status(500).send('Erro ao ler o menu');
  }
});

app.post('/webhook', (req, res) => {
  res.status(200).send('ok');
});

// ================== ROTA PRINCIPAL ==================
app.post('/mensagem', (req, res) => {
  const { numero, texto } = req.body;
  const mensagem = texto.trim().toLowerCase();

  if (!numero || !texto) {
    return res.status(400).json({ erro: 'Informe numero e texto' });
  }

  const cliente = estadoClientes.getEstado(numero);
  let resposta = '';

  cliente.ultimoContato = Date.now();

  // ================== CANCELAMENTO ==================
  if (mensagem === 'cancelar') {
    cliente.estadoAnterior = cliente.estado;
    cliente.estado = 'CONFIRMAR_CANCELAMENTO';

    resposta =
      '⚠️ Tem certeza que deseja cancelar seu pedido?\n\n' +
      '1️⃣ Sim, cancelar pedido\n' +
      '2️⃣ Não, continuar pedido';

    return res.json({ resposta });
  }

  // ================== SAUDAÇÃO ==================
  if (!cliente.recebeuSaudacao || cliente.estado === 'FINALIZADO') {
    cliente.recebeuSaudacao = true;
    cliente.estado = 'MENU';

    resposta = mensagemSaudacao() + mensagemMenu();
    return res.json({ resposta });
  }

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

  // ================== CONFIRMAR CANCELAMENTO ==================
  else if (cliente.estado === 'CONFIRMAR_CANCELAMENTO') {
    if (mensagem === '1') {
      estadoClientes.limparPedido(numero);
      cliente.estado = 'MENU';
      cliente.recebeuSaudacao = true;

      resposta =
        '❌ Pedido cancelado com sucesso.\n\n' +
        mensagemMenu();

      return res.json({ resposta });
    }

    if (mensagem === '2') {
      cliente.estado = cliente.estadoAnterior || 'MENU';
      resposta = '✅ Pedido mantido.\n\n';
    }
  }

  // ================== ESCOLHA DO PRATO ==================
  else if (cliente.estado === 'ESCOLHENDO_PRATO') {
    const escolha = parseInt(texto);
    if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) {
      resposta = '';
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
        resposta = '🍚 Escolha o tipo de arroz:\n1️⃣ Branco\n2️⃣ Integral';
      } else if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta = '🍛 Escolha a variação do strogonoff:\n1️⃣ Tradicional\n2️⃣ Light';
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = 'Digite a quantidade desejada.';
      }
    }
  }

  // ================== FALLBACK GLOBAL ==================
  if (!resposta) {
    resposta =
      '❌ Desculpe, não entendi o que você quis dizer.\n' +
      'Por favor, selecione uma das opções abaixo.\n\n';

    switch (cliente.estado) {
      case 'MENU':
        resposta += mensagemMenu();
        break;

      case 'ESCOLHENDO_PRATO':
        resposta += '🍽️ Escolha um prato:\n\n';
        cliente.opcoesPrato.forEach((item, index) => {
          resposta += `${index + 1}️⃣ ${item['PRATO']}\n`;
        });
        break;

      case 'VARIACAO_ARROZ':
        resposta += '🍚 Escolha o tipo de arroz:\n1️⃣ Branco\n2️⃣ Integral';
        break;

      case 'VARIACAO_STROGONOFF':
        resposta += '🍛 Escolha a variação do strogonoff:\n1️⃣ Tradicional\n2️⃣ Light';
        break;

      case 'QUANTIDADE':
        resposta += 'Digite a quantidade desejada.';
        break;

      case 'ADICIONAR_OUTRO':
        resposta += 'Deseja adicionar mais pratos?\n1️⃣ Sim\n2️⃣ Não';
        break;

      default:
        resposta += mensagemMenu();
    }
  }

  res.json({ resposta });
});

// ================== SERVER ==================
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
