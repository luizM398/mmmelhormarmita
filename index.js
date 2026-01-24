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
          lista += `${item.codigo}️⃣ ${item.nome}\n`;
        });

        lista += '\n🔥 A partir de 5 marmitas: R$ 17,49/unidade';
        resposta = lista;

      } catch (erro) {
        resposta = 'Erro ao carregar o cardápio.';
      }

    } else if (texto === '2') {
      cliente.estado = 'PEDIDO';
      resposta = 'Pedido iniciado. Em breve vamos listar os pratos.';

    } else if (texto === '3') {
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
    resposta = 'Fluxo de pedido em construção.';
  }

  res.json({ resposta });
});

// inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
