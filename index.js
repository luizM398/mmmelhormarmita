const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes');
const mensagens = require('./mensagens');

const app = express();
const PORT = process.env.PORT || 3000;

// permite receber dados em JSON
app.use(express.json());

// rota teste
app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

// rota do menu (teste direto)
app.get('/menu', (req, res) => {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');

    const workbook = xlsx.readFile(arquivo);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const dados = xlsx.utils.sheet_to_json(sheet);
    res.json(dados);
  } catch (erro) {
    console.log(erro);
    res.status(500).send('Erro ao ler o menu');
  }
});

// webhook Mercado Pago (não mexe)
app.post('/webhook', (req, res) => {
  console.log('Webhook recebido');
  res.status(200).send('ok');
});

// rota principal de mensagens
app.post('/mensagem', (req, res) => {
  const { numero, texto } = req.body;

  if (!numero || !texto) {
    return res.status(400).json({
      erro: 'Informe numero e texto'
    });
  }

  const cliente = estadoClientes.getEstado(numero);
  let resposta = '';

  // ESTADO: MENU
  if (cliente.estado === 'MENU') {

    if (texto === '1') {
      try {
        const arquivo = path.join(__dirname, 'menu.xlsx');
        const workbook = xlsx.readFile(arquivo);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const dados = xlsx.utils.sheet_to_json(sheet);

        let lista = '🍱 Cardápio:\n\n';

        dados.forEach(item => {
          lista += `${item['CÓDIGO']}️⃣ ${item['PRATO']} - R$ ${item['VALOR']}\n`;
        });

        lista += '\n🔥 A partir de 5 marmitas: R$ 17,49/unidade';
        resposta = lista;

      } catch (erro) {
        resposta = 'Erro ao carregar o cardápio.';
      }

    } else if (texto === '2') {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');
    const workbook = xlsx.readFile(arquivo);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const dados = xlsx.utils.sheet_to_json(sheet);

    let lista = '🍽️ Escolha um prato:\n\n';

    dados.forEach((item, index) => {
      lista += `${index + 1}️⃣ ${item['PRATO']}\n`;
    });

    cliente.estado = 'ESCOLHENDO_PRATO';
    cliente.opcoesPrato = dados;

    resposta = lista;

  } catch (erro) {
    resposta = 'Erro ao carregar os pratos.';
  }
}
      else if (texto === '3') {
      cliente.estado = 'ELOGIO';
      resposta = mensagens.elogios;

    } else {
      resposta = mensagens.menuPrincipal;
    }
  }

  // ESTADO: ELOGIO
  else if (cliente.estado === 'ELOGIO') {
    cliente.estado = 'MENU';
    resposta = mensagens.agradecimento + '\n\n' + mensagens.menuPrincipal;
  }

  // ESTADO: PEDIDO
  else if (cliente.estado === 'PEDIDO') {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');
    const workbook = xlsx.readFile(arquivo);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const dados = xlsx.utils.sheet_to_json(sheet);

    const pratoEscolhido = dados.find(
      item => String(item['CÓDIGO']) === texto
    );

    if (!pratoEscolhido) {
      resposta = 'Código inválido. Digite um código válido do cardápio.';
    } else {
      cliente.pedido.push({
        codigo: pratoEscolhido['CÓDIGO'],
        prato: pratoEscolhido['PRATO'],
        valor: pratoEscolhido['VALOR']
      });

      const nomePrato = pratoEscolhido['PRATO'].toLowerCase();

      if (nomePrato.includes('arroz')) {
        cliente.estado = 'VARIACAO_ARROZ';
        resposta =
          `🍚 Você escolheu: ${pratoEscolhido['PRATO']}\n\n` +
          `Escolha o tipo de arroz:\n` +
          `1️⃣ Branco\n` +
          `2️⃣ Integral`;
      }
      else if (nomePrato.includes('estrogonofe')) {
        cliente.estado = 'VARIACAO_ESTROGONOFE';
        resposta =
          `🍛 Você escolheu: ${pratoEscolhido['PRATO']}\n\n` +
          `Escolha a variação:\n` +
          `1️⃣ Tradicional\n` +
          `2️⃣ Light`;
      }
      else {
        cliente.estado = 'QUANTIDADE';
        resposta =
          `Você escolheu: ${pratoEscolhido['PRATO']}\n\n` +
          `Digite a quantidade desejada.`;
      }
    }

  } catch (erro) {
    resposta = 'Erro ao processar o pedido.';
  }
}

    else if (cliente.estado === 'VARIACAO_ARROZ') {
  if (texto === '1') {
    cliente.pedido[cliente.pedido.length - 1].variacao = 'Arroz branco';
  } else if (texto === '2') {
    cliente.pedido[cliente.pedido.length - 1].variacao = 'Arroz integral';
  } else {
    resposta = 'Opção inválida. Escolha 1 ou 2.';
    return res.json({ resposta });
  }

      if (cliente.precisaEstrogonofe) {
    cliente.estado = 'VARIACAO_ESTROGONOFE';
    resposta =
      `🍛 Escolha a variação do estrogonofe:\n` +
      `1️⃣ Tradicional\n` +
      `2️⃣ Light`;
  } else {
    cliente.estado = 'QUANTIDADE';
    resposta = 'Digite a quantidade desejada.';
  }
 
}

else if (cliente.estado === 'VARIACAO_ESTROGONOFE') {
  if (texto === '1') {
    cliente.pedido[cliente.pedido.length - 1].variacao = 'Tradicional';
  } else if (texto === '2') {
    cliente.pedido[cliente.pedido.length - 1].variacao = 'Light';
  } else {
    resposta = 'Opção inválida. Escolha 1 ou 2.';
    return res.json({ resposta });
  }

  cliente.estado = 'QUANTIDADE';
  resposta = 'Digite a quantidade desejada.';
}

// ESTADO: ESCOLHENDO_PRATO
else if (cliente.estado === 'ESCOLHENDO_PRATO') {
  const escolha = parseInt(texto);

  if (
    isNaN(escolha) ||
    escolha < 1 ||
    escolha > cliente.opcoesPrato.length
  ) {
    resposta = 'Por favor, escolha um número válido do cardápio.';
  } else {
    const pratoEscolhido = cliente.opcoesPrato[escolha - 1];

    const nomePrato = pratoEscolhido['PRATO'].toLowerCase();

cliente.pedido.push({
  prato: pratoEscolhido['PRATO'],
  valor: pratoEscolhido['VALOR'],
  variacao: null,
  quantidade: 0
});

cliente.precisaArroz = nomePrato.includes('arroz');
      cliente.precisaEstrogonofe = nomePrato.includes('estrogonofe');

     if (cliente.precisaArroz) {
  cliente.estado = 'VARIACAO_ARROZ';
  resposta =
    `🍚 Você escolheu: ${pratoEscolhido['PRATO']}\n\n` +
    `Escolha o tipo de arroz:\n` +
    `1️⃣ Branco\n` +
    `2️⃣ Integral`;

} else if (cliente.precisaEstrogonofe) {
  cliente.estado = 'VARIACAO_ESTROGONOFE';
  resposta =
    `🍛 Você escolheu: ${pratoEscolhido['PRATO']}\n\n` +
    `Escolha a variação do estrogonofe:\n` +
    `1️⃣ Tradicional\n` +
    `2️⃣ Light`;

} else {
  cliente.estado = 'QUANTIDADE';
  resposta = 'Digite a quantidade desejada.';
}
    
  }
}
  
  res.json({ resposta });
});

// inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
