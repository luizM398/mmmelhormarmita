const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes'); // Garanta que este arquivo está na mesma pasta
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração para processar o JSON automaticamente (conforme suporte WaSender)
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

async function enviarMensagemWA(numero, texto) {
  // ATENÇÃO: Nunca suba chaves reais para o GitHub público. Use variáveis de ambiente no Render.
  const token = process.env.WASENDER_TOKEN || 'SUA_CHAVE_AQUI_SE_FOR_TESTE_LOCAL';
  
  // Formatando número para garantir que tenha apenas digitos (WaSender geralmente aceita o numero limpo ou com @s.whatsapp.net, vamos limpar)
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

// ================= ROTAS =================

app.get('/', (req, res) => {
  res.send('Servidor da Marmita está ON! 🚀');
});

app.post('/mensagem', async (req, res) => {
  try {
    const body = req.body;
    
    // LOG para debug no Render (verifique isso nos logs se der erro)
    console.log('WEBHOOK RECEBIDO:', JSON.stringify(body, null, 2));

    // 1. Validação do Evento (conforme suporte WaSender)
    // Se não for recebimento de mensagem, ignoramos
    if (body.event !== 'messages.received') {
      return res.status(200).json({ ok: true, info: 'Evento ignorado' });
    }

    // 2. Extração dos dados (baseado na resposta do suporte)
    const dadosMensagem = body?.data?.messages;
    
    if (!dadosMensagem) {
      console.log('Payload sem dados de mensagem.');
      return res.status(200).json({ ok: true });
    }

    // 3. Identificação do Remetente
    // O suporte mostrou "remoteJid": "123456789@lid" ou @s.whatsapp.net
    const remoteJid = dadosMensagem.key?.remoteJid || "";
    const fromMe = dadosMensagem.key?.fromMe;

    // Ignora mensagens enviadas pelo próprio bot para evitar loop infinito
    if (fromMe === true) {
      return res.status(200).json({ ok: true });
    }

    const numero = remoteJid.split('@')[0]; // Pega "5551999..."

    // 4. Extração do Texto
    // O suporte mostrou que pode vir em "messageBody" ou dentro de "message.conversation"
    const texto = 
      dadosMensagem.messageBody || 
      dadosMensagem.message?.conversation || 
      dadosMensagem.message?.extendedTextMessage?.text || 
      "";

    if (!texto || !numero) {
      return res.status(200).json({ ok: true }); // Mensagem vazia ou sem numero
    }

    const mensagem = texto.trim().toLowerCase();
    
    // --- LÓGICA DO BOT (MANTIDA DO SEU CÓDIGO) ---
    
    const cliente = estadoClientes.getEstado(numero);
    let resposta = '';

    // Verifica Inatividade ANTES de atualizar o ultimoContato
    if (encerrouPorInatividade(cliente) && cliente.estado !== 'INICIAL') {
      estadoClientes.limparPedido(numero);
      resposta = `⏰ Seu atendimento foi encerrado por inatividade.\n\n` + saudacaoTexto() + menuPrincipal();
      
      cliente.ultimoContato = Date.now();
      cliente.ultimaMensagem = resposta;
      cliente.estado = 'MENU';
      
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    cliente.ultimoContato = Date.now();

    // ===== PRIMEIRO CONTATO =====
    if (!cliente.recebeuSaudacao) {
      cliente.recebeuSaudacao = true;
      cliente.estado = 'MENU';
      resposta = saudacaoTexto() + menuPrincipal();
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }
    
    // ===== CANCELAR GERAL =====
    if (mensagem === 'cancelar') {
      cliente.estadoAnterior = cliente.estado;
      cliente.mensagemAntesDoCancelar = cliente.ultimaMensagem;
      cliente.estado = 'CONFIRMAR_CANCELAMENTO';

      resposta = `⚠️ Tem certeza que deseja cancelar o pedido?\n\n1️⃣ Sim, cancelar\n2️⃣ Não, continuar`;

      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ===== LÓGICA DE CANCELAMENTO =====
    if (cliente.estado === 'CONFIRMAR_CANCELAMENTO') {
      if (mensagem === '1') {
        estadoClientes.limparPedido(numero);
        // Reinicia como se fosse novo, mas já com menu
        cliente.estado = 'MENU'; 
        resposta = `❌ Pedido cancelado.\n\n` + menuPrincipal();
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2') {
        cliente.estado = cliente.estadoAnterior || 'MENU';
        resposta = cliente.mensagemAntesDoCancelar;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      // Se digitou algo inválido no cancelamento
      await enviarMensagemWA(numero, erroComUltimaMensagem(cliente));
      return res.status(200).json({ ok: true });
    }

    // ================= MENU =================
    if (cliente.estado === 'MENU') {
      if (mensagem === '1') { // Ver Cardápio (Apenas visualização)
        const dados = carregarMenu();
        if(dados.length === 0) {
            await enviarMensagemWA(numero, "Desculpe, cardápio indisponível no momento.");
            return res.status(200).json({ok:true});
        }

        let cardapio = `🍱 *Cardápio*\n\n`;
        dados.forEach(item => { cardapio += `• ${item.PRATO} – R$ ${item.VALOR}\n`; });
        
        cardapio += `\n1️⃣ Voltar ao menu\n2️⃣ Fazer pedido`;

        cliente.estado = 'CARDAPIO';
        cliente.ultimaMensagem = cardapio;
        await enviarMensagemWA(numero, cardapio);
        return res.status(200).json({ ok: true });
      }

      if (mensagem === '2') { // Fazer Pedido Direto
        const dados = carregarMenu();
        if(dados.length === 0) {
            await enviarMensagemWA(numero, "Desculpe, cardápio indisponível no momento.");
            return res.status(200).json({ok:true});
        }

        let lista = `🍽️ Escolha um prato:\n\n`;
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

      await enviarMensagemWA(numero, erroComUltimaMensagem(cliente));
      return res.status(200).json({ ok: true });
    }

    // ================= CARDAPIO (Visualização) =================
    if (cliente.estado === 'CARDAPIO') {
      if (mensagem === '1') {
        cliente.estado = 'MENU';
        resposta = menuPrincipal();
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2') {
        const dados = carregarMenu();
        let lista = `🍽️ Escolha um prato:\n\n`;
        dados.forEach((item, i) => { lista += `${i + 1}️⃣ ${item.PRATO}\n`; });
        lista += `\n0️⃣ Voltar ao menu`;

        cliente.estado = 'ESCOLHENDO_PRATO';
        cliente.opcoesPrato = dados;
        cliente.ultimaMensagem = lista;
        await enviarMensagemWA(numero, lista);
        return res.status(200).json({ ok: true });
      }
      await enviarMensagemWA(numero, erroComUltimaMensagem(cliente));
      return res.status(200).json({ ok: true });
    }

    // ================= ESCOLHENDO PRATO =================
    if (cliente.estado === 'ESCOLHENDO_PRATO') {
      if (mensagem === '0') {
        cliente.estado = 'MENU';
        resposta = menuPrincipal();
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }

      const escolha = parseInt(mensagem);
      if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) {
        await enviarMensagemWA(numero, erroComUltimaMensagem(cliente));
        return res.status(200).json({ ok: true });
      }

      const prato = cliente.opcoesPrato[escolha - 1];
      const nomePrato = prato.PRATO.toLowerCase();

      // Inicia item no pedido
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
        resposta = `🍚 Escolha o tipo de arroz:\n1️⃣ Branco\n2️⃣ Integral`;
      } else if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta = `🍛 Escolha o tipo de strogonoff:\n1️⃣ Tradicional\n2️⃣ Light`;
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `Digite a quantidade para *${prato.PRATO}*:`;
      }

      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ================= VARIAÇÃO ARROZ =================
    if (cliente.estado === 'VARIACAO_ARROZ') {
      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      if (mensagem === '1') itemAtual.arroz = 'Branco';
      else if (mensagem === '2') itemAtual.arroz = 'Integral';
      else {
        await enviarMensagemWA(numero, erroComUltimaMensagem(cliente));
        return res.status(200).json({ ok: true });
      }

      if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta = `🍛 Escolha o tipo de strogonoff:\n1️⃣ Tradicional\n2️⃣ Light`;
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `Digite a quantidade:`;
      }
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ================= VARIAÇÃO STROGONOFF =================
    if (cliente.estado === 'VARIACAO_STROGONOFF') {
      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      if (mensagem === '1') itemAtual.strogonoff = 'Tradicional';
      else if (mensagem === '2') itemAtual.strogonoff = 'Light';
      else {
        await enviarMensagemWA(numero, erroComUltimaMensagem(cliente));
        return res.status(200).json({ ok: true });
      }

      cliente.estado = 'QUANTIDADE';
      resposta = `Digite a quantidade:`;
      cliente.ultimaMensagem = resposta;
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
      resposta = `✅ Adicionado com sucesso!\n\nDeseja pedir mais algo?\n1️⃣ Sim, escolher outro prato\n2️⃣ Não, fechar pedido`;
      
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ================= ADICIONAR OUTRO / FECHAR =================
    if (cliente.estado === 'ADICIONAR_OUTRO') {
      if (mensagem === '1') {
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

      if (mensagem === '2') {
        // CÁLCULO DE TOTAIS
        const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
        
        let valorUnitario = 19.99;
        let textoPromo = "";
        
        // Regra de negócio (Exemplo)
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

      await enviarMensagemWA(numero, erroComUltimaMensagem(cliente));
      return res.status(200).json({ ok: true });
    }

    // ================= ENDEREÇO =================
    if (cliente.estado === 'AGUARDANDO_ENDERECO') {
      cliente.endereco = texto; // Usa o texto original (com maiúsculas/minúsculas)
      cliente.estado = 'FINALIZADO';
      
      // AQUI ENTRARIA A LÓGICA DO MERCADO PAGO
      // Por enquanto, apenas confirma
      resposta = 
        `✅ *Pedido Recebido!*\n\n` +
        `Endereço: ${cliente.endereco}\n\n` +
        `Aguarde, um atendente irá confirmar seu pedido e enviar o link de pagamento em instantes. 🛵`;

      // Limpar o cliente após finalizar? Ou manter histórico?
      // Por segurança, mantemos o estado FINALIZADO para não processar mais mensagens como pedido
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ================= ELOGIOS =================
    if (cliente.estado === 'ELOGIOS') {
      if (mensagem === '0') {
        cliente.estado = 'MENU';
        resposta = menuPrincipal();
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
        return res.status(200).json({ ok: true });
      }
      console.log(`[FEEDBACK] Cliente ${numero}: ${texto}`);
      cliente.estado = 'MENU';
      resposta = `✅ Obrigado! Sua opinião foi registrada.\n\n` + menuPrincipal();
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }

    // FALLBACK GERAL
    await enviarMensagemWA(numero, saudacaoTexto() + menuPrincipal());
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Erro fatal no processamento:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
