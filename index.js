const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const TEMPO_INATIVO = 10 * 60 * 1000;

// ================= FUNÇÕES AUXILIARES =================

function saudacaoTexto() {
  return (
    `👋 Olá! Seja muito bem-vindo(a) à *Melhor Marmita* 🍱\n` +
    `Comida caseira, saborosa e feita com carinho para o seu dia a dia 😋`
  );
}

function menuPrincipal() {
  return (
    `\n\nO que você deseja hoje?\n\n` +
    `1️⃣ Ver cardápio\n` +
    `2️⃣ Fazer pedido\n` +
    `3️⃣ Elogios e Reclamações`
  );
}

function carregarMenu() {
  const arquivo = path.join(__dirname, 'menu.xlsx');
  const workbook = xlsx.readFile(arquivo);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet);
}

function encerrouPorInatividade(cliente) {
  if (!cliente.ultimoContato) return false;
  return Date.now() - cliente.ultimoContato > TEMPO_INATIVO;
}

function erroComUltimaMensagem(cliente) {
  return (
    `❌ Não entendi sua resposta.\n` +
    `Por favor, escolha uma das opções abaixo 👇\n\n` +
    cliente.ultimaMensagem
  );
}

// ================= ROTAS =================

app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

app.post('/mensagem', (req, res) => {
 const numero = req.body?.data?.from;
const texto = req.body?.data?.body;

// ignora eventos que não são mensagens de texto
if (typeof texto !== 'string' || !numero) {
  return res.status(200).json({ ok: true });
}

const mensagem = texto.trim().toLowerCase();

  const cliente = estadoClientes.getEstado(numero);
  let resposta = '';

  cliente.ultimoContato = Date.now();

  // ===== INATIVIDADE =====
  if (encerrouPorInatividade(cliente)) {
    estadoClientes.limparPedido(numero);
    resposta =
      `⏰ Seu atendimento foi encerrado por inatividade.\n\n` +
      saudacaoTexto() +
      menuPrincipal();
    cliente.ultimaMensagem = resposta;
    return res.json({ resposta });
  }

  // ===== PRIMEIRO CONTATO =====
  if (!cliente.recebeuSaudacao) {
    cliente.recebeuSaudacao = true;
    cliente.estado = 'MENU';
    resposta = saudacaoTexto() + menuPrincipal();
    cliente.ultimaMensagem = resposta;
    return res.json({ resposta });
  }

 // ===== CANCELAR =====
if (mensagem === 'cancelar') {
  cliente.estadoAnterior = cliente.estado; // <<< GUARDA ONDE ESTAVA
  cliente.mensagemAntesDoCancelar = cliente.ultimaMensagem;
  cliente.estado = 'CONFIRMAR_CANCELAMENTO';

  resposta =
    `⚠️ Tem certeza que deseja cancelar o pedido?\n\n` +
    `1️⃣ Sim, cancelar\n` +
    `2️⃣ Não, continuar`;

  cliente.ultimaMensagem = resposta;
  return res.json({ resposta });
}

 if (cliente.estado === 'CONFIRMAR_CANCELAMENTO') {

  // 1️⃣ CONFIRMOU CANCELAMENTO
  if (mensagem === '1') {
    estadoClientes.limparPedido(numero);

    cliente.estado = 'MENU';

    resposta =
      `❌ Pedido cancelado com sucesso.\n\n` +
      menuPrincipal();

    cliente.ultimaMensagem = resposta;
    return res.json({ resposta });
  }

  // 2️⃣ NÃO QUIS CANCELAR → CONTINUA DE ONDE PAROU
if (mensagem === '2') {
  cliente.estado = cliente.estadoAnterior || 'MENU';

  resposta = cliente.mensagemAntesDoCancelar;
  cliente.ultimaMensagem = resposta;

  return res.json({ resposta });
}

  return res.json({ resposta: erroComUltimaMensagem(cliente) });
}

  // ================= MENU =================
  if (cliente.estado === 'MENU') {
    if (mensagem === '1') {
      const dados = carregarMenu();
      let cardapio = `🍱 *Cardápio*\n\n`;

      dados.forEach(item => {
        cardapio += `• ${item.PRATO} — R$ ${item.VALOR}\n`;
      });

      cardapio +=
        `\n🔥 *Promoção*\n` +
        `A partir de *5 marmitas*, o valor de ~~R$ 19,99~~ cai para *R$ 17,49* por unidade.\n\n` +
        `1️⃣ Voltar ao menu\n` +
        `2️⃣ Fazer pedido`;

      cliente.estado = 'CARDAPIO';
      cliente.ultimaMensagem = cardapio;
      return res.json({ resposta: cardapio });
    }

    if (mensagem === '2') {
      const dados = carregarMenu();
      let lista = `🍽️ Escolha um prato:\n\n`;

      dados.forEach((item, i) => {
        lista += `${i + 1}️⃣ ${item.PRATO}\n`;
      });

      lista += `\n0️⃣ Voltar ao menu`;

      cliente.estado = 'ESCOLHENDO_PRATO';
      cliente.opcoesPrato = dados;
      cliente.ultimaMensagem = lista;
      return res.json({ resposta: lista });
    }

    if (mensagem === '3') {
      cliente.estado = 'ELOGIOS';
      resposta =
        `💬 Elogios ou reclamações\n\n` +
        `Escreva sua mensagem abaixo.\n\n` +
        `0️⃣ Voltar ao menu`;
      cliente.ultimaMensagem = resposta;
      return res.json({ resposta });
    }

    return res.json({ resposta: erroComUltimaMensagem(cliente) });
  }

 // ================= CARDÁPIO =================
if (cliente.estado === 'CARDAPIO') {

  // 1️⃣ Voltar ao menu
  if (mensagem === '1') {
    cliente.estado = 'MENU';
    return res.json({ resposta: menuPrincipal() });
  }

  // 2️⃣ Fazer pedido
  if (mensagem === '2') {
    const dados = carregarMenu();
    let lista = `🍽️ Escolha um prato:\n\n`;

    dados.forEach((item, i) => {
      lista += `${i + 1}️⃣ ${item.PRATO}\n`;
    });

    lista += `\n0️⃣ Voltar ao menu`;

    cliente.estado = 'ESCOLHENDO_PRATO';
    cliente.opcoesPrato = dados;
    cliente.ultimaMensagem = lista;
    return res.json({ resposta: lista });
  }

  return res.json({ resposta: erroComUltimaMensagem(cliente) });
}

  // ================= ESCOLHENDO PRATO =================
  if (cliente.estado === 'ESCOLHENDO_PRATO') {
    if (mensagem === '0') {
      cliente.estado = 'MENU';
      resposta = menuPrincipal();
      cliente.ultimaMensagem = resposta;
      return res.json({ resposta });
    }

    const escolha = parseInt(mensagem);
    if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) {
      return res.json({ resposta: erroComUltimaMensagem(cliente) });
    }

    const prato = cliente.opcoesPrato[escolha - 1];
    const nome = prato.PRATO.toLowerCase();

    cliente.pedido.push({
      prato: prato.PRATO,
      valor: prato.VALOR,
      arroz: null,
      strogonoff: null,
      quantidade: 0
    });

    cliente.precisaArroz = nome.includes('arroz');
    cliente.precisaStrogonoff = nome.includes('strogonoff');

    if (cliente.precisaArroz) {
      cliente.estado = 'VARIACAO_ARROZ';
      resposta = `🍚 Escolha o tipo de arroz:\n1️⃣ Branco\n2️⃣ Integral`;
    } else if (cliente.precisaStrogonoff) {
      cliente.estado = 'VARIACAO_STROGONOFF';
      resposta = `🍛 Escolha o tipo de strogonoff:\n1️⃣ Tradicional\n2️⃣ Light`;
    } else {
      cliente.estado = 'QUANTIDADE';
      resposta = `Digite a quantidade desejada.`;
    }

    cliente.ultimaMensagem = resposta;
    return res.json({ resposta });
  }

  // ================= VARIAÇÃO ARROZ =================
  if (cliente.estado === 'VARIACAO_ARROZ') {
    if (mensagem === '1') cliente.pedido.at(-1).arroz = 'Branco';
    else if (mensagem === '2') cliente.pedido.at(-1).arroz = 'Integral';
    else return res.json({ resposta: erroComUltimaMensagem(cliente) });

    if (cliente.precisaStrogonoff) {
      cliente.estado = 'VARIACAO_STROGONOFF';
      resposta = `🍛 Escolha o tipo de strogonoff:\n1️⃣ Tradicional\n2️⃣ Light`;
    } else {
      cliente.estado = 'QUANTIDADE';
      resposta = `Digite a quantidade desejada.`;
    }

    cliente.ultimaMensagem = resposta;
    return res.json({ resposta });
  }

  // ================= VARIAÇÃO STROGONOFF =================
  if (cliente.estado === 'VARIACAO_STROGONOFF') {
    if (mensagem === '1') cliente.pedido.at(-1).strogonoff = 'Tradicional';
    else if (mensagem === '2') cliente.pedido.at(-1).strogonoff = 'Light';
    else return res.json({ resposta: erroComUltimaMensagem(cliente) });

    cliente.estado = 'QUANTIDADE';
    resposta = `Digite a quantidade desejada.`;
    cliente.ultimaMensagem = resposta;
    return res.json({ resposta });
  }

  // ================= QUANTIDADE =================
  if (cliente.estado === 'QUANTIDADE') {
    const qtd = parseInt(mensagem);
    if (isNaN(qtd) || qtd < 1) {
      return res.json({ resposta: erroComUltimaMensagem(cliente) });
    }

    cliente.pedido.at(-1).quantidade = qtd;
    cliente.estado = 'ADICIONAR_OUTRO';
    resposta =
      `✅ Item adicionado!\n\nDeseja adicionar mais algum prato?\n\n` +
      `1️⃣ Sim\n` +
      `2️⃣ Não`;
    cliente.ultimaMensagem = resposta;
    return res.json({ resposta });
  }

  // ================= ADICIONAR OUTRO =================
  if (cliente.estado === 'ADICIONAR_OUTRO') {
    if (mensagem === '1') {
      cliente.estado = 'ESCOLHENDO_PRATO';
      const dados = carregarMenu();
      let lista = `🍽️ Escolha um prato:\n\n`;

      dados.forEach((item, i) => {
        lista += `${i + 1}️⃣ ${item.PRATO}\n`;
      });

      lista += `\n0️⃣ Cancelar pedido`;

      cliente.opcoesPrato = dados;
      cliente.ultimaMensagem = lista;
      return res.json({ resposta: lista });
    }

   if (mensagem === '2') {

  const totalMarmitas = cliente.pedido.reduce(
    (soma, item) => soma + item.quantidade,
    0
  );

  let valorUnitario = 19.99;
  let textoPromocao = '';

  if (totalMarmitas >= 5) {
    valorUnitario = 17.49;

    textoPromocao =
      `🎉 *Parabéns! Promoção aplicada!*\n\n` +
      `🔥 A partir de *5 marmitas*, o valor unitário cai de\n` +
      `~~R$ 19,99~~ *R$ 17,49 por unidade*\n\n`;
  }

  const subtotal = (totalMarmitas * valorUnitario).toFixed(2);

  cliente.estado = 'AGUARDANDO_ENDERECO';

  resposta =
    textoPromocao +
    `🍱 Total de marmitas: *${totalMarmitas}*\n` +
    `💰 Subtotal: *R$ ${subtotal}*\n\n` +
    `📍 Informe o endereço de entrega para calcular o frete.`;

  cliente.ultimaMensagem = resposta;
  return res.json({ resposta });
}

    return res.json({ resposta: erroComUltimaMensagem(cliente) });
  }

  // ================= ENDEREÇO =================
  if (cliente.estado === 'AGUARDANDO_ENDERECO') {
    cliente.endereco = texto;
    cliente.estado = 'AGUARDANDO_FRETE';
    resposta =
      `✅ Endereço recebido.\n` +
      `Aguarde enquanto calculamos o frete.`;
    cliente.ultimaMensagem = resposta;
    return res.json({ resposta });
  }

  // ================= FALLBACK =================
  estadoClientes.limparPedido(numero);
  resposta = saudacaoTexto() + menuPrincipal();
  return res.json({ resposta });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
