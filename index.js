const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes'); // Garanta que este arquivo está na mesma pasta
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração para processar o JSON automaticamente
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const TEMPO_INATIVO = 10 * 60 * 1000; // 10 minutos

// ================= FUNÇÕES AUXILIARES =================

function saudacaoTexto() {
  return (
    `👋 Olá! Seja muito bem-vindo(a) à *Melhor Marmita* 🍱\n` +
    `Comida caseira, saborosa e feita com carinho para o seu dia a dia 😋`
  );
}

function menuPrincipal() {
  // Mantemos essa função para usar como texto de fallback se precisar
  return (
    `\n\nO que você deseja hoje?\n\n` +
    `1️⃣ Ver cardápio\n` +
    `2️⃣ Fazer pedido\n` +
    `3️⃣ Elogios e Reclamações`
  );
}

function carregarMenu() {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');
    const workbook = xlsx.readFile(arquivo);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return xlsx.utils.sheet_to_json(sheet);
  } catch (error) {
    console.error("ERRO AO LER MENU.XLSX: Verifique se o arquivo está na raiz do projeto.");
    return [];
  }
}

function encerrouPorInatividade(cliente) {
  if (!cliente.ultimoContato) return false;
  return Date.now() - cliente.ultimoContato > TEMPO_INATIVO;
}

function erroComUltimaMensagem(cliente) {
  return (
    `❌ Não entendi sua resposta.\n` +
    `Por favor, escolha uma das opções abaixo 👇\n\n` +
    (cliente.ultimaMensagem || menuPrincipal())
  );
}

// Função para enviar TEXTO simples
async function enviarMensagemWA(numero, texto) {
  const token = process.env.WASENDER_TOKEN || 'SUA_CHAVE_AQUI';
  const numeroLimpo = String(numero).replace(/\D/g, '');

  try {
    await axios.post(
      'https://www.wasenderapi.com/api/send-message',
      {
        to: numeroLimpo,
        text: texto
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Mensagem enviada para ${numeroLimpo}`);
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err.response?.data || err.message);
  }
}

// Função para enviar ENQUETE (Botões)
async function enviarEnqueteWA(numero, pergunta, opcoes) {
  const token = process.env.WASENDER_TOKEN || 'SUA_CHAVE_AQUI';
  const numeroLimpo = String(numero).replace(/\D/g, '');

  try {
    await axios.post(
      'https://www.wasenderapi.com/api/send-message',
      {
        to: numeroLimpo,
        poll: {
          question: pergunta,
          options: opcoes,
          multiSelect: false
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Enquete enviada para ${numeroLimpo}`);
  } catch (err) {
    console.error('Erro ao enviar enquete:', err.response?.data || err.message);
  }
}

// ================= ROTAS =================

app.get('/', (req, res) => {
  res.send('Servidor da Marmita está ON! 🚀');
});

app.post('/mensagem', async (req, res) => {
  try {
    const body = req.body;
    
    // 1. Validação do Evento
    if (body.event !== 'messages.received') {
      return res.status(200).json({ ok: true, info: 'Evento ignorado' });
    }

    const dadosMensagem = body?.data?.messages;
    if (!dadosMensagem) {
      return res.status(200).json({ ok: true });
    }

    // 2. Identificação do Remetente e Filtros
    const remoteJid = dadosMensagem.key?.remoteJid || "";
    const fromMe = dadosMensagem.key?.fromMe;

    if (remoteJid.includes('status@broadcast')) {
      return res.status(200).json({ ok: true, info: 'Status ignorado' });
    }

    if (remoteJid.includes('@g.us')) {
      return res.status(200).json({ ok: true, info: 'Grupo ignorado' });
    }

    if (fromMe === true) {
      return res.status(200).json({ ok: true });
    }

    // Correção do número (LID vs Telefone)
    let numeroRaw = 
      dadosMensagem.key?.cleanedSenderPn || 
      dadosMensagem.key?.senderPn || 
      remoteJid;
      
    const numero = String(numeroRaw).split('@')[0].replace(/\D/g, '');

    // 3. Extração do Texto (Corrigido ordem)
    const texto = 
      dadosMensagem.messageBody || 
      dadosMensagem.message?.conversation || 
      dadosMensagem.message?.extendedTextMessage?.text || 
      "";

    if (!texto || !numero) {
      return res.status(200).json({ ok: true });
    }

    // 4. Criação da variável mensagem e Tradução dos Botões
    let mensagem = texto.trim().toLowerCase();

    // Se o cliente clicou no botão da enquete, o texto vem completo.
    // Transformamos em "1", "2" ou "3" para o bot entender.
    if (mensagem.includes('ver cardápio')) mensagem = '1';
    if (mensagem.includes('fazer pedido')) mensagem = '2';
    if (mensagem.includes('elogios')) mensagem = '3';
    
    // --- LÓGICA DO BOT ---
    
    const cliente = estadoClientes.getEstado(numero);
    let resposta = '';

    // Verifica Inatividade
    if (encerrouPorInatividade(cliente) && cliente.estado !== 'INICIAL') {
      estadoClientes.limparPedido(numero);
      
      const textoInatividade = `⏰ Seu atendimento foi encerrado por inatividade.\n\n` + saudacaoTexto();
      await enviarMensagemWA(numero, textoInatividade);
      
      // Manda o menu como enquete novamente
      await enviarEnqueteWA(numero, "O que deseja fazer agora?", [
        "1. Ver Cardápio",
        "2. Fazer Pedido",
        "3. Elogios"
      ]);
      
      cliente.ultimoContato = Date.now();
      cliente.estado = 'MENU';
      
      return res.status(200).json({ ok: true });
    }

    cliente.ultimoContato = Date.now();

    // ===== PRIMEIRO CONTATO (Com Botões) =====
    if (!cliente.recebeuSaudacao) {
      cliente.recebeuSaudacao = true;
      cliente.estado = 'MENU';
      
      // Manda msg de texto
      const textoOla = saudacaoTexto();
      await enviarMensagemWA(numero, textoOla);
      
      // Manda Botões
      await enviarEnqueteWA(numero, "O que você deseja hoje?", [
        "1. Ver Cardápio",
        "2. Fazer Pedido",
        "3. Elogios"
      ]);

      return res.status(200).json({ ok: true });
    }
    
    // ===== CANCELAR GERAL =====
    if (mensagem === 'cancelar') {
      cliente.estadoAnterior = cliente.estado;
      cliente.mensagemAntesDoCancelar = cliente.ultimaMensagem;
      cliente.estado = 'CONFIRMAR_CANCELAMENTO';

      // Aqui também podemos usar enquete no futuro se quiser
      resposta = `⚠️ Tem certeza que deseja cancelar o pedido?\n\n1️⃣ Sim, cancelar\n2️⃣ Não, continuar`;

      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ===== CONFIRMAR CANCELAMENTO =====
    if (cliente.estado === 'CONFIRMAR_CANCELAMENTO') {
      if (mensagem === '1') {
        estadoClientes.limparPedido(numero);
        cliente.estado = 'MENU'; 
        
        await enviarMensagemWA(numero, "❌ Pedido cancelado.");
        await enviarEnqueteWA(numero, "Menu Principal", [
            "1. Ver Cardápio",
            "2. Fazer Pedido",
            "3. Elogios"
        ]);
        
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2') {
        cliente.estado = cliente.estadoAnterior || 'MENU';
        resposta = cliente.mensagemAntesDoCancelar;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      await enviarMensagemWA(numero, erroComUltimaMensagem(cliente));
      return res.status(200).json({ ok: true });
    }

    // ================= MENU (Agora aceita os cliques dos botões) =================
    if (cliente.estado === 'MENU') {
      if (mensagem === '1') { // Ver Cardápio
        const dados = carregarMenu();
        if(dados.length === 0) {
            await enviarMensagemWA(numero, "Desculpe, cardápio indisponível no momento.");
            return res.status(200).json({ok:true});
        }

        let cardapio = `🍱 *Cardápio*\n\n`;
        dados.forEach(item => { cardapio += `• ${item.PRATO} – R$ ${item.VALOR}\n`; });
        
        // Finaliza com texto pois lista longa não cabe em botão
        cardapio += `\nPara pedir, digite *2* ou selecione no menu acima.`;

        cliente.estado = 'CARDAPIO'; // Mantemos no estado cardapio ou menu?
        // Vamos manter no menu para ele poder clicar em "Fazer Pedido" de novo se quiser
        // Mas se quiser voltar, ele manda "1" de novo. 
        // Simplificação: vamos mandar o cardápio e logo em seguida a enquete de novo
        
        await enviarMensagemWA(numero, cardapio);
        await enviarEnqueteWA(numero, "O que deseja fazer?", ["1. Ver Cardápio", "2. Fazer Pedido", "3. Elogios"]);
        
        return res.status(200).json({ ok: true });
      }

      if (mensagem === '2') { // Fazer Pedido
        const dados = carregarMenu();
        if(dados.length === 0) {
            await enviarMensagemWA(numero, "Desculpe, cardápio indisponível.");
            return res.status(200).json({ok:true});
        }

        let lista = `🍽️ *Escolha um prato digitando o número:*\n\n`;
        dados.forEach((item, i) => { lista += `${i + 1}️⃣ ${item.PRATO}\n`; });
        lista += `\n0️⃣ Voltar ao menu`;

        cliente.estado = 'ESCOLHENDO_PRATO';
        cliente.opcoesPrato = dados;
        cliente.ultimaMensagem = lista;
        await enviarMensagemWA(numero, lista);
        return res.status(200).json({ ok: true });
      }

      if (mensagem === '3') { // Elogios
        cliente.estado = 'ELOGIOS';
        resposta = `💬 Escreva seu elogio ou reclamação abaixo:\n\n0️⃣ Voltar ao menu`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }

      // Se digitou algo nada a ver
      await enviarMensagemWA(numero, "Não entendi. Use os botões abaixo:");
      await enviarEnqueteWA(numero, "Menu Principal", ["1. Ver Cardápio", "2. Fazer Pedido", "3. Elogios"]);
      return res.status(200).json({ ok: true });
    }

    // ================= CARDAPIO =================
    if (cliente.estado === 'CARDAPIO') {
        // Se ele estava só vendo cardápio e digitou algo, tratamos como menu
        cliente.estado = 'MENU';
        // Reprocessa a mensagem como se estivesse no menu
        // Mas como já retornamos lá em cima, o fluxo segue na proxima msg
        // Aqui só cai se ele digitou algo estranho enquanto via cardápio
        await enviarEnqueteWA(numero, "Menu Principal", ["1. Ver Cardápio", "2. Fazer Pedido", "3. Elogios"]);
        return res.status(200).json({ ok: true });
    }

    // ================= ESCOLHENDO PRATO =================
    if (cliente.estado === 'ESCOLHENDO_PRATO') {
      if (mensagem === '0') {
        cliente.estado = 'MENU';
        await enviarEnqueteWA(numero, "Menu Principal", ["1. Ver Cardápio", "2. Fazer Pedido", "3. Elogios"]);
        return res.status(200).json({ ok: true });
      }

      const escolha = parseInt(mensagem);
      if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) {
        await enviarMensagemWA(numero, "Opção inválida. Digite o número do prato.");
        return res.status(200).json({ ok: true });
      }

      const prato = cliente.opcoesPrato[escolha - 1];
      const nomePrato = prato.PRATO.toLowerCase();

      cliente.pedido.push({
        prato: prato.PRATO,
        valor: prato.VALOR,
        arroz: null,
        strogonoff: null,
        quantidade: 0
      });

      cliente.precisaArroz = nomePrato.includes('arroz');
      cliente.precisaStrogonoff = nomePrato.includes('strogonoff');

      if (cliente.precisaArroz) {
        cliente.estado = 'VARIACAO_ARROZ';
        // AQUI TAMBÉM PODE VIRAR ENQUETE!
        await enviarEnqueteWA(numero, "🍚 Escolha o tipo de arroz:", ["1. Branco", "2. Integral"]);
      } else if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        await enviarEnqueteWA(numero, "🍛 Escolha o strogonoff:", ["1. Tradicional", "2. Light"]);
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `Digite a quantidade para *${prato.PRATO}*:`;
        await enviarMensagemWA(numero, resposta);
      }
      return res.status(200).json({ ok: true });
    }

    // ================= VARIAÇÃO ARROZ =================
    if (cliente.estado === 'VARIACAO_ARROZ') {
      // Traduz enquete de arroz se precisar
      let escolhaArroz = mensagem;
      if(mensagem.includes('branco')) escolhaArroz = '1';
      if(mensagem.includes('integral')) escolhaArroz = '2';

      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      
      if (escolhaArroz === '1') itemAtual.arroz = 'Branco';
      else if (escolhaArroz === '2') itemAtual.arroz = 'Integral';
      else {
        await enviarMensagemWA(numero, "Opção inválida.");
        return res.status(200).json({ ok: true });
      }

      if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        await enviarEnqueteWA(numero, "🍛 Escolha o strogonoff:", ["1. Tradicional", "2. Light"]);
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `Digite a quantidade:`;
        await enviarMensagemWA(numero, resposta);
      }
      return res.status(200).json({ ok: true });
    }

    // ================= VARIAÇÃO STROGONOFF =================
    if (cliente.estado === 'VARIACAO_STROGONOFF') {
      let escolhaStrog = mensagem;
      if(mensagem.includes('tradicional')) escolhaStrog = '1';
      if(mensagem.includes('light')) escolhaStrog = '2';

      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      
      if (escolhaStrog === '1') itemAtual.strogonoff = 'Tradicional';
      else if (escolhaStrog === '2') itemAtual.strogonoff = 'Light';
      else {
        await enviarMensagemWA(numero, "Opção inválida.");
        return res.status(200).json({ ok: true });
      }

      cliente.estado = 'QUANTIDADE';
      resposta = `Digite a quantidade:`;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ================= QUANTIDADE =================
    if (cliente.estado === 'QUANTIDADE') {
      const qtd = parseInt(mensagem);
      if (isNaN(qtd) || qtd < 1) {
        await enviarMensagemWA(numero, "Por favor, digite um número válido maior que 0.");
        return res.status(200).json({ ok: true });
      }

      cliente.pedido[cliente.pedido.length - 1].quantidade = qtd;
      
      cliente.estado = 'ADICIONAR_OUTRO';
      await enviarMensagemWA(numero, "✅ Adicionado!");
      await enviarEnqueteWA(numero, "Deseja pedir mais algo?", ["1. Sim, escolher outro", "2. Não, fechar pedido"]);
      
      return res.status(200).json({ ok: true });
    }

    // ================= ADICIONAR OUTRO / FECHAR =================
    if (cliente.estado === 'ADICIONAR_OUTRO') {
      // Traduz enquete
      let decisao = mensagem;
      if(mensagem.includes('sim')) decisao = '1';
      if(mensagem.includes('não') || mensagem.includes('nao') || mensagem.includes('fechar')) decisao = '2';

      if (decisao === '1') {
        cliente.estado = 'ESCOLHENDO_PRATO';
        const dados = carregarMenu();
        let lista = `🍽️ Escolha mais um prato:\n\n`;
        dados.forEach((item, i) => { lista += `${i + 1}️⃣ ${item.PRATO}\n`; });
        lista += `\n0️⃣ Cancelar tudo`;
        cliente.opcoesPrato = dados;
        cliente.ultimaMensagem = lista;
        await enviarMensagemWA(numero, lista);
        return res.status(200).json({ ok: true });
      }

      if (decisao === '2') {
        // CÁLCULO DE TOTAIS
        const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
        
        let valorUnitario = 19.99;
        let textoPromo = "";
        
        if (totalMarmitas >= 5) {
          valorUnitario = 17.49;
          textoPromo = `🎉 *Promoção Ativada!* (5+ unidades)\nPreço reduzido para R$ ${valorUnitario}/unidade.\n\n`;
        }

        const subtotal = (totalMarmitas * valorUnitario).toFixed(2);
        
        cliente.estado = 'AGUARDANDO_ENDERECO';
        resposta = 
          textoPromo +
          `📦 *Resumo do Pedido*\n` +
          `Qtd Total: ${totalMarmitas}\n` +
          `Valor Total: R$ ${subtotal}\n\n` +
          `📍 Por favor, digite seu *ENDEREÇO COMPLETO* para entrega:`;

        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }

      await enviarMensagemWA(numero, "Opção inválida.");
      return res.status(200).json({ ok: true });
    }

    // ================= ENDEREÇO =================
    if (cliente.estado === 'AGUARDANDO_ENDERECO') {
      cliente.endereco = texto; 
      cliente.estado = 'FINALIZADO';
      
      resposta = 
        `✅ *Pedido Recebido!*\n\n` +
        `Endereço: ${cliente.endereco}\n\n` +
        `Aguarde, um atendente irá confirmar seu pedido e enviar o link de pagamento em instantes. 🛵`;

      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ================= ELOGIOS =================
    if (cliente.estado === 'ELOGIOS') {
      if (mensagem === '0') {
        cliente.estado = 'MENU';
        await enviarEnqueteWA(numero, "Menu Principal", ["1. Ver Cardápio", "2. Fazer Pedido", "3. Elogios"]);
        return res.status(200).json({ ok: true });
      }
      console.log(`[FEEDBACK] Cliente ${numero}: ${texto}`);
      cliente.estado = 'MENU';
      
      await enviarMensagemWA(numero, `✅ Obrigado! Sua opinião foi registrada.`);
      await enviarEnqueteWA(numero, "Menu Principal", ["1. Ver Cardápio", "2. Fazer Pedido", "3. Elogios"]);
      
      return res.status(200).json({ ok: true });
    }

    // FALLBACK GERAL
    await enviarMensagemWA(numero, saudacaoTexto());
    await enviarEnqueteWA(numero, "Menu Principal", ["1. Ver Cardápio", "2. Fazer Pedido", "3. Elogios"]);
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Erro fatal no processamento:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
