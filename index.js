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

// ================== MENSAGEM INVÁLIDA ==================
function respostaInvalida(mensagemAnterior) {
  return (
    '❌ Desculpe, não entendi o que você quis dizer.\n' +
    'Por favor, selecione uma das opções abaixo.\n\n' +
    mensagemAnterior
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

    return res.json({
      resposta:
        '⚠️ Tem certeza que deseja cancelar seu pedido?\n\n' +
        '1️⃣ Sim, cancelar pedido\n' +
        '2️⃣ Não, continuar pedido'
    });
  }

  // ================== SAUDAÇÃO ==================
  if (!cliente.recebeuSaudacao || cliente.estado === 'FINALIZADO') {
    cliente.recebeuSaudacao = true;
    cliente.estado = 'MENU';
    return res.json({ resposta: mensagemSaudacao() + mensagemMenu() });
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
    } else {
      resposta = respostaInvalida(mensagemMenu());
    }
  }

  // ================== CONFIRMAR CANCELAMENTO ==================
  else if (cliente.estado === 'CONFIRMAR_CANCELAMENTO') {
    if (mensagem === '1') {
      estadoClientes.limparPedido(numero);
      cliente.estado = 'MENU';
      cliente.recebeuSaudacao = true;
      resposta = '❌ Pedido cancelado com sucesso.\n\n' + mensagemMenu();
    } else if (mensagem === '2') {
      cliente.estado = cliente.estadoAnterior || 'MENU';
      resposta = '✅ Pedido mantido.\n\n' + mensagemMenu();
    } else {
      resposta = respostaInvalida(
        '1️⃣ Sim, cancelar pedido\n2️⃣ Não, continuar pedido'
      );
    }
  }

  // ================== ESCOLHA DO PRATO ==================
  else if (cliente.estado === 'ESCOLHENDO_PRATO') {
    const escolha = parseInt(texto);
    if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) {
      resposta = respostaInvalida(
        cliente.opcoesPrato
          .map((p, i) => `${i + 1}️⃣ ${p['PRATO']}`)
          .join('\n')
      );
    } else {
      const prato = cliente.opcoesPrato[escolha - 1];
      const nome = prato['PRATO'].toLowerCase();

      cliente.pedido = [{ prato: prato['PRATO'], valor: prato['VALOR'], quantidade: 0 }];
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

  // ================== VARIAÇÃO ARROZ ==================
  else if (cliente.estado === 'VARIACAO_ARROZ') {
    if (texto === '1') cliente.pedido[0].arroz = 'Branco';
    else if (texto === '2') cliente.pedido[0].arroz = 'Integral';
    else {
      return res.json({
        resposta: respostaInvalida('🍚 Escolha o tipo de arroz:\n1️⃣ Branco\n2️⃣ Integral')
      });
    }
    cliente.estado = 'QUANTIDADE';
    resposta = 'Digite a quantidade desejada.';
  }

  // ================== VARIAÇÃO STROGONOFF ==================
  else if (cliente.estado === 'VARIACAO_STROGONOFF') {
    if (texto === '1') cliente.pedido[0].strogonoff = 'Tradicional';
    else if (texto === '2') cliente.pedido[0].strogonoff = 'Light';
    else {
      return res.json({
        resposta: respostaInvalida('🍛 Escolha a variação do strogonoff:\n1️⃣ Tradicional\n2️⃣ Light')
      });
    }
    cliente.estado = 'QUANTIDADE';
    resposta = 'Digite a quantidade desejada.';
  }

  // ================== QUANTIDADE ==================
  else if (cliente.estado === 'QUANTIDADE') {
    const qtd = parseInt(texto);
    if (isNaN(qtd) || qtd < 1) {
      resposta = respostaInvalida('Digite a quantidade desejada.');
    } else {
      cliente.pedido[0].quantidade = qtd;
      cliente.estado = 'ADICIONAR_OUTRO';
      resposta = 'Deseja adicionar mais pratos?\n1️⃣ Sim\n2️⃣ Não';
    }
  }

  // ================== ADICIONAR OUTRO ==================
  else if (cliente.estado === 'ADICIONAR_OUTRO') {
    if (texto === '1') {
      cliente.estado = 'ESCOLHENDO_PRATO';
      resposta = cliente.opcoesPrato.map((p, i) => `${i + 1}️⃣ ${p['PRATO']}`).join('\n');
    } else if (texto === '2') {
      cliente.estado = 'AGUARDANDO_ENDERECO';
      resposta = 'Por favor, informe seu endereço de entrega.';
    } else {
      resposta = respostaInvalida('Deseja adicionar mais pratos?\n1️⃣ Sim\n2️⃣ Não');
    }
  }

  // ================== ENDEREÇO ==================
  else if (cliente.estado === 'AGUARDANDO_ENDERECO') {
    cliente.endereco = texto;
    cliente.estado = 'AGUARDANDO_FRETE';
    resposta = '✅ Recebido! Aguarde enquanto calculamos seu frete.';
  }

  res.json({ resposta });
});

// ================== SERVER ==================
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
