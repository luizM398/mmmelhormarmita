const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const TEMPO_INATIVO = 10 * 60 * 1000;

// ================== FUNÇÕES AUXILIARES ==================

function enviarSaudacao(cliente) {
  cliente.estado = 'MENU';
  cliente.recebeuSaudacao = true;

  return (
    `👋 Olá! Bem-vindo(a) à *Melhor Marmita* 🍱\n\n` +
    `O que você deseja hoje?\n\n` +
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

function mensagemErroComUltimaOpcao(texto) {
  return `❌ Não entendi sua mensagem.\n\n${texto}`;
}

// ================== ROTAS ==================

app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

app.post('/mensagem', (req, res) => {
  const { numero, texto } = req.body;
  const mensagem = texto.trim().toLowerCase();

  if (!numero || !texto) {
    return res.status(400).json({ erro: 'Número e texto são obrigatórios' });
  }

  const cliente = estadoClientes.getEstado(numero);
  let resposta = '';

  // Atualiza contato
  cliente.ultimoContato = Date.now();

  // ================== INATIVIDADE ==================
  if (encerrouPorInatividade(cliente)) {
    cliente.estado = 'MENU';
    cliente.recebeuSaudacao = false;
    return res.json({
      resposta:
        `⏰ Seu atendimento foi encerrado por inatividade.\n\n` +
        enviarSaudacao(cliente)
    });
  }

  // ================== SAUDAÇÃO ==================
  if (!cliente.recebeuSaudacao || cliente.estado === 'FINALIZADO') {
    return res.json({ resposta: enviarSaudacao(cliente) });
  }

  // ================== CANCELAMENTO GLOBAL ==================
  if (mensagem === 'cancelar') {
    estadoClientes.limparPedido(numero);
    return res.json({
      resposta:
        `❌ Pedido cancelado com sucesso.\n\n` +
        `Voltando ao menu principal:\n\n` +
        enviarSaudacao(cliente)
    });
  }

  // ================== MENU ==================
  if (cliente.estado === 'MENU') {
    if (mensagem === '1') {
      const dados = carregarMenu();
      let textoMenu = `🍱 *Cardápio*\n\n`;

      dados.forEach(item => {
        textoMenu += `• ${item.PRATO} — R$ ${item.VALOR}\n`;
      });

      textoMenu +=
        `\n1️⃣ Fazer pedido\n` +
        `2️⃣ Voltar ao menu`;

      cliente.estado = 'CARDAPIO';
      cliente.ultimaMensagem = textoMenu;
      resposta = textoMenu;
    }

    else if (mensagem === '2') {
      const dados = carregarMenu();
      let lista = `🍽️ Escolha um prato:\n\n`;

      dados.forEach((item, i) => {
        lista += `${i + 1}️⃣ ${item.PRATO}\n`;
      });

      lista += `\n0️⃣ Voltar ao menu`;

      cliente.estado = 'ESCOLHENDO_PRATO';
      cliente.opcoesPrato = dados;
      cliente.ultimaMensagem = lista;
      resposta = lista;
    }

    else if (mensagem === '3') {
      cliente.estado = 'ELOGIOS';
      resposta =
        `💬 Elogios ou reclamações\n\n` +
        `Escreva sua mensagem abaixo.\n\n` +
        `0️⃣ Voltar ao menu`;
      cliente.ultimaMensagem = resposta;
    }

    else {
      resposta = mensagemErroComUltimaOpcao(enviarSaudacao(cliente));
    }
  }

  // ================== CARDÁPIO ==================
  else if (cliente.estado === 'CARDAPIO') {
    if (mensagem === '1') {
      cliente.estado = 'ESCOLHENDO_PRATO';
      return res.json({ resposta: enviarSaudacao(cliente) });
    }

    if (mensagem === '2') {
      cliente.estado = 'MENU';
      resposta = enviarSaudacao(cliente);
    } else {
      resposta = mensagemErroComUltimaOpcao(cliente.ultimaMensagem);
    }
  }

  // ================== ESCOLHA DO PRATO ==================
  else if (cliente.estado === 'ESCOLHENDO_PRATO') {
    if (mensagem === '0') {
      cliente.estado = 'MENU';
      return res.json({ resposta: enviarSaudacao(cliente) });
    }

    const escolha = parseInt(mensagem);
    if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) {
      resposta = mensagemErroComUltimaOpcao(cliente.ultimaMensagem);
    } else {
      const prato = cliente.opcoesPrato[escolha - 1];
      const nome = prato.PRATO.toLowerCase();

      cliente.pedido.push({
        prato: prato.PRATO,
        valor: prato.VALOR,
        arroz: null,
        strogonoff: null,
        quantidade: 0
      });

      cliente.menuBloqueado = true;

      if (nome.includes('arroz')) {
        cliente.estado = 'VARIACAO_ARROZ';
        resposta =
          `🍚 Escolha o tipo de arroz:\n` +
          `1️⃣ Branco\n` +
          `2️⃣ Integral`;
      }
      else if (nome.includes('strogonofe')) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta =
          `🍛 Escolha o tipo de strogonoff:\n` +
          `1️⃣ Tradicional\n` +
          `2️⃣ Light`;
      }
      else {
        cliente.estado = 'QUANTIDADE';
        resposta = `Digite a quantidade desejada.`;
      }
    }
  }

  // ================== VARIAÇÕES ==================
  else if (cliente.estado === 'VARIACAO_ARROZ') {
    if (mensagem === '1') cliente.pedido.at(-1).arroz = 'Branco';
    else if (mensagem === '2') cliente.pedido.at(-1).arroz = 'Integral';
    else return res.json({ resposta: 'Escolha 1 ou 2.' });

    cliente.estado = 'QUANTIDADE';
    resposta = 'Digite a quantidade desejada.';
  }

  else if (cliente.estado === 'VARIACAO_STROGONOFF') {
    if (mensagem === '1') cliente.pedido.at(-1).strogonoff = 'Tradicional';
    else if (mensagem === '2') cliente.pedido.at(-1).strogonoff = 'Light';
    else return res.json({ resposta: 'Escolha 1 ou 2.' });

    cliente.estado = 'QUANTIDADE';
    resposta = 'Digite a quantidade desejada.';
  }

  // ================== QUANTIDADE ==================
  else if (cliente.estado === 'QUANTIDADE') {
    const qtd = parseInt(mensagem);
    if (isNaN(qtd) || qtd < 1) {
      resposta = 'Digite uma quantidade válida.';
    } else {
      cliente.pedido.at(-1).quantidade = qtd;
      cliente.estado = 'AGUARDANDO_ENDERECO';
      resposta = `📍 Informe o endereço de entrega.`;
    }
  }

  // ================== ENDEREÇO ==================
  else if (cliente.estado === 'AGUARDANDO_ENDERECO') {
    cliente.endereco = texto;
    cliente.estado = 'AGUARDANDO_FRETE';
    resposta =
      `✅ Endereço recebido.\n` +
      `Aguarde enquanto calculamos o frete.`;
  }

  // ================== FALLBACK ==================
  else {
    resposta = 'Algo deu errado. Voltando ao menu.';
    cliente.estado = 'MENU';
    resposta += '\n\n' + enviarSaudacao(cliente);
  }

  res.json({ resposta });
});

// ================== SERVER ==================
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
