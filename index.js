const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const axios = require('axios');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
const estadoClientes = require('./estadoClientes'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ==============================================================================
// ⚙️ CONFIGURAÇÕES (PREENCHA AQUI!)
// ==============================================================================

const NUMERO_ADMIN = '5551984050946'; 
const MP_ACCESS_TOKEN = 'APP_USR-SEU-TOKEN-GIGANTE-AQUI'; // <--- SEU TOKEN DO MERCADO PAGO
const WASENDER_TOKEN = process.env.WASENDER_TOKEN || 'SUA_CHAVE_WASENDER_AQUI'; // <--- SEU TOKEN WASENDER

// ⚠️ IMPORTANTE: Coloque aqui o link do seu Render (sem barra no final)
// Exemplo: https://bot-marmita.onrender.com
const URL_DO_SEU_SITE = 'https://SEU-APP.onrender.com'; 

// ==============================================================================

const TEMPO_INATIVO = 10 * 60 * 1000; 
const timersClientes = {};

const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN, options: { timeout: 5000 } });

// ==============================================================================
// 💰 FUNÇÕES DE PAGAMENTO
// ==============================================================================

async function gerarPix(valor, clienteNome, clienteTelefone) {
  try {
    const payment = new Payment(client);
    const emailCliente = `cliente${clienteTelefone}@marmita.com`;

    const body = {
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: 'Pedido Marmita Delivery',
      payment_method_id: 'pix',
      notification_url: `${URL_DO_SEU_SITE}/webhook`, 
      external_reference: String(clienteTelefone), 
      payer: {
        email: emailCliente,
        first_name: clienteNome || 'Cliente',
        last_name: clienteTelefone || 'WhatsApp'
      }
    };

    const response = await payment.create({ body });
    return {
      copiaCola: response.point_of_interaction.transaction_data.qr_code,
      idPagamento: response.id
    };
  } catch (error) {
    console.error('Erro ao gerar PIX:', error);
    return null;
  }
}

async function gerarLinkPagamento(itens, frete, clienteTelefone) {
  try {
    const preference = new Preference(client);
    const itemsPreference = itens.map(item => ({
      title: `(TESTE) ${item.prato}`,
      quantity: item.quantidade,
      currency_id: 'BRL',
      unit_price: item.quantidade >= 5 ? 0.01 : 0.05 // PREÇO DE TESTE
    }));

    if (frete > 0) {
      itemsPreference.push({
        title: 'Taxa de Entrega',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: parseFloat(frete)
      });
    }

    const body = {
      items: itemsPreference,
      notification_url: `${URL_DO_SEU_SITE}/webhook`,
      external_reference: String(clienteTelefone),
      back_urls: {
        success: 'https://www.google.com', 
        failure: 'https://www.google.com',
        pending: 'https://www.google.com'
      },
      auto_return: 'approved'
    };

    const response = await preference.create({ body });
    return response.init_point;
  } catch (error) {
    console.error('Erro ao gerar Link:', error);
    return null;
  }
}

// ==============================================================================
// 🔔 WEBHOOK (Onde o Mercado Pago avisa que pagou)
// ==============================================================================

app.post('/webhook', async (req, res) => {
  const { action, data } = req.body;

  if (action === 'payment.created' || action === 'payment.updated') {
     try {
       const payment = new Payment(client);
       const pagamentoInfo = await payment.get({ id: data.id });
       
       const status = pagamentoInfo.status;
       const numeroCliente = pagamentoInfo.external_reference; 
       const valorPago = pagamentoInfo.transaction_amount;
       const dataPagamento = new Date().toLocaleString('pt-BR');
       const idTransacao = pagamentoInfo.id;

       // Evita duplicidade simples checando se já está aprovado
       if (status === 'approved') {
         console.log(`✅ Pagamento Aprovado! Cliente: ${numeroCliente}`);
         
         const comprovante = 
           `🧾 *COMPROVANTE DE PAGAMENTO*\n` +
           `--------------------------------\n` +
           `✅ *Status:* APROVADO\n` +
           `📅 *Data:* ${dataPagamento}\n` +
           `💰 *Valor:* R$ ${valorPago.toFixed(2)}\n` +
           `🆔 *Transação:* ${idTransacao}\n` +
           `--------------------------------\n` +
           `Pedido Confirmado! Já estamos preparando tudo por aqui.\n` +
           `Qualquer dúvida, é só chamar! 😋`;

         await enviarMensagemWA(numeroCliente, comprovante);
         await enviarMensagemWA(NUMERO_ADMIN, `🔔 *PAGAMENTO CONFIRMADO!*\nO cliente ${numeroCliente} pagou R$ ${valorPago}. Pode preparar!`);
       }
     } catch (error) {
       console.error("Erro no Webhook:", error);
     }
  }
  res.status(200).send('OK');
});

// ==============================================================================
// 🧠 LÓGICA DO ROBÔ
// ==============================================================================

function saudacaoTexto() {
  return `👋 Olá! Seja muito bem-vindo(a) à *Melhor Marmita* 🍱\n⚠️ *PEDIDOS ONLINE (MODO TESTE)* ⚠️`;
}

function menuPrincipal() {
  return `🔻 *Menu Principal*\n\n1️⃣  Ver Cardápio do Dia\n2️⃣  Fazer Pedido\n3️⃣  Elogios ou Reclamações\n\n_Digite o número da opção desejada._`;
}

function msgNaoEntendi(textoAnterior) {
  return `🤔 *Não entendi sua resposta.*\nPor favor, escolha uma das opções abaixo:\n\n-----------------------------\n${textoAnterior || menuPrincipal()}`;
}

function carregarMenu() {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');
    const workbook = xlsx.readFile(arquivo);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return xlsx.utils.sheet_to_json(sheet);
  } catch (error) { return []; }
}

function iniciarTimerInatividade(numero) {
  if (timersClientes[numero]) clearTimeout(timersClientes[numero]);
  timersClientes[numero] = setTimeout(async () => {
    const cliente = estadoClientes.getEstado(numero);
    if (cliente.estado !== 'INICIAL' && cliente.estado !== 'MENU') {
      estadoClientes.limparPedido(numero);
      const novoEstado = estadoClientes.getEstado(numero);
      novoEstado.recebeuSaudacao = false; 
      await enviarMensagemWA(numero, `💤 *Atendimento encerrado por falta de interação.*`);
    }
    delete timersClientes[numero];
  }, TEMPO_INATIVO);
}

function calcularFrete(textoEndereco) {
  const endereco = textoEndereco.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "");
  const contem = (lista) => lista.some(termo => endereco.includes(termo));

  const zonaBloqueada = ['hipica', 'belem novo', 'lami', 'sarandi', 'humaita', 'navegantes', 'centro historico', 'rubem berta', 'centro', 'viamao'];
  if (contem(zonaBloqueada) && !endereco.includes('restinga')) return { erro: true, msg: "🚫 Ainda não entregamos nesta região." };

  const zonaLocal = ['lomba do pinheiro', 'lomba', 'agronomia', 'parada', 'pda', 'joao de oliveira', 'mapa'];
  if (contem(zonaLocal)) return { valor: 0.01, texto: "R$ 0,01 (Teste)" };

  const zonaAlvo = ['bela vista', 'moinhos', 'mont serrat', 'auxiliadora', 'rio branco', 'petropolis'];
  if (contem(zonaAlvo)) return { valor: 0.03, texto: "R$ 0,03 (Teste)" };

  const zonaMedia = ['restinga', 'partenon', 'bento', 'jardim botanico', 'santana', 'sao jose', 'ipiranga'];
  if (contem(zonaMedia)) return { valor: 0.02, texto: "R$ 0,02 (Teste)" };

  return null; 
}

async function enviarMensagemWA(numero, texto) {
  const numeroLimpo = String(numero).replace(/\D/g, '');
  try {
    await axios.post('https://www.wasenderapi.com/api/send-message', 
      { to: numeroLimpo, text: texto }, 
      { headers: { Authorization: `Bearer ${WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) { console.error(`Erro envio msg:`, err.message); }
}

// ==============================================================================
// 🚀 ROTAS E FLUXO PRINCIPAL
// ==============================================================================

app.get('/', (req, res) => { res.send('🤖 Bot Marmita V6.1 (Online Only) ON 🚀'); });

app.post('/mensagem', async (req, res) => {
  try {
    const body = req.body;
    if (body.event !== 'messages.received') return res.status(200).json({ ok: true });
    
    const dadosMensagem = body?.data?.messages;
    if (!dadosMensagem) return res.status(200).json({ ok: true });

    const remoteJid = dadosMensagem.key?.remoteJid || "";
    const fromMe = dadosMensagem.key?.fromMe;
    if (remoteJid.includes('status') || remoteJid.includes('@g.us') || fromMe) return res.status(200).json({ ok: true });

    let numeroRaw = dadosMensagem.key?.cleanedSenderPn || dadosMensagem.key?.senderPn || remoteJid;
    const numero = String(numeroRaw).split('@')[0].replace(/\D/g, '');
    const texto = dadosMensagem.messageBody || dadosMensagem.message?.conversation || dadosMensagem.message?.extendedTextMessage?.text || "";

    if (!texto || !numero) return res.status(200).json({ ok: true });
    const mensagem = texto.trim().toLowerCase();
    iniciarTimerInatividade(numero);
    
    const cliente = estadoClientes.getEstado(numero);
    cliente.ultimoContato = Date.now();
    let resposta = '';

    // 1. SAUDAÇÃO
    if (!cliente.recebeuSaudacao) {
      cliente.recebeuSaudacao = true;
      cliente.estado = 'MENU';
      resposta = saudacaoTexto() + `\n\n` + menuPrincipal();
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }
    
    // 2. CANCELAR
    if (mensagem === 'cancelar') {
      estadoClientes.limparPedido(numero);
      const reset = estadoClientes.getEstado(numero);
      reset.recebeuSaudacao = true; 
      reset.estado = 'MENU'; 
      await enviarMensagemWA(numero, `❌ Pedido cancelado.\n\n` + menuPrincipal());
      return res.status(200).json({ ok: true });
    }

    // 3. MENU
    if (cliente.estado === 'MENU') {
      if (mensagem === '1') { 
        const dados = carregarMenu();
        if(dados.length === 0) { await enviarMensagemWA(numero, "⚠️ Cardápio off."); return res.status(200).json({ok:true}); }
        let cardapio = `🍱 *Cardápio* (TESTE ONLINE)\n\n`;
        dados.forEach(item => { cardapio += `🔹 ${item.PRATO} – R$ 0,05\n`; });
        cardapio += `\n2️⃣ Fazer Pedido\n0️⃣ Voltar`;
        cliente.estado = 'VENDO_CARDAPIO';
        cliente.ultimaMensagem = cardapio; 
        await enviarMensagemWA(numero, cardapio);
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2') {
        const dados = carregarMenu();
        let lista = `🍽️ *Vamos montar seu pedido!*\nDigite o NÚMERO do prato:\n\n`;
        dados.forEach((item, i) => { lista += `${i + 1}️⃣  ${item.PRATO}\n`; });
        lista += `\n0️⃣ Voltar`;
        cliente.estado = 'ESCOLHENDO_PRATO';
        cliente.opcoesPrato = dados;
        cliente.ultimaMensagem = lista;
        await enviarMensagemWA(numero, lista);
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '3') { 
        cliente.estado = 'ELOGIOS';
        await enviarMensagemWA(numero, `💬 Digite seu elogio/reclamação:`); 
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '0') { await enviarMensagemWA(numero, menuPrincipal()); return res.status(200).json({ ok: true }); }
      await enviarMensagemWA(numero, msgNaoEntendi(menuPrincipal()));
      return res.status(200).json({ ok: true });
    }

    // 4. LEITURA DE CARDÁPIO
    if (cliente.estado === 'VENDO_CARDAPIO') {
       if (mensagem === '2') {
         const dados = carregarMenu();
         let lista = `🍽️ *Vamos montar seu pedido!*\nDigite o NÚMERO do prato:\n\n`;
         dados.forEach((item, i) => { lista += `${i + 1}️⃣  ${item.PRATO}\n`; });
         lista += `\n0️⃣ Voltar`;
         cliente.estado = 'ESCOLHENDO_PRATO';
         cliente.opcoesPrato = dados;
         await enviarMensagemWA(numero, lista);
         return res.status(200).json({ ok: true });
       }
       if (mensagem === '0') {
         cliente.estado = 'MENU';
         await enviarMensagemWA(numero, menuPrincipal());
         return res.status(200).json({ ok: true });
       }
       await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
       return res.status(200).json({ ok: true });
    }

    // 5. ESCOLHA DE PRATO
    if (cliente.estado === 'ESCOLHENDO_PRATO') {
      if (mensagem === '0') { cliente.estado = 'MENU'; await enviarMensagemWA(numero, menuPrincipal()); return res.status(200).json({ ok: true }); }
      const escolha = parseInt(mensagem);
      if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }
      
      const prato = cliente.opcoesPrato[escolha - 1];
      const nomePrato = prato.PRATO.toLowerCase();
      cliente.pedido.push({ prato: prato.PRATO, valor: 0.05, arroz: null, strogonoff: null, quantidade: 0 });
      cliente.precisaArroz = nomePrato.includes('arroz');
      cliente.precisaStrogonoff = nomePrato.includes('strogonoff');

      if (cliente.precisaArroz) {
        cliente.estado = 'VARIACAO_ARROZ';
        resposta = `🍚 *Arroz?*\n1️⃣ Branco\n2️⃣ Integral`;
      } else if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta = `🍛 *Strogonoff?*\n1️⃣ Tradicional\n2️⃣ Light`;
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `🔢 Digite a *quantidade*:`;
      }
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'VARIACAO_ARROZ') {
      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      if (mensagem === '1') itemAtual.arroz = 'Branco';
      else if (mensagem === '2') itemAtual.arroz = 'Integral';
      else { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }

      if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta = `🍛 *Strogonoff?*\n1️⃣ Tradicional\n2️⃣ Light`;
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `🔢 Digite a *quantidade*:`;
      }
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'VARIACAO_STROGONOFF') {
      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      if (mensagem === '1') itemAtual.strogonoff = 'Tradicional';
      else if (mensagem === '2') itemAtual.strogonoff = 'Light';
      else { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }
      cliente.estado = 'QUANTIDADE';
      resposta = `🔢 Digite a *quantidade*:`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'QUANTIDADE') {
      const qtd = parseInt(mensagem);
      if (isNaN(qtd) || qtd < 1) { await enviarMensagemWA(numero, "❌ Número inválido."); return res.status(200).json({ ok: true }); }
      cliente.pedido[cliente.pedido.length - 1].quantidade = qtd;
      cliente.estado = 'ADICIONAR_OUTRO';
      resposta = `✅ *Adicionado!*\n\n1️⃣ Escolher outro prato\n2️⃣ Fechar pedido`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'ADICIONAR_OUTRO') {
      if (mensagem === '1') {
        cliente.estado = 'ESCOLHENDO_PRATO';
        const dados = carregarMenu();
        let lista = `🍽️ *Escolha mais um:*\n`;
        dados.forEach((item, i) => { lista += `${i + 1}️⃣  ${item.PRATO}\n`; });
        lista += `\n0️⃣ Cancelar tudo`;
        cliente.opcoesPrato = dados;
        await enviarMensagemWA(numero, lista);
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2') {
        const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
        const valorUnitario = totalMarmitas >= 5 ? 0.01 : 0.05;
        const subtotal = (totalMarmitas * valorUnitario).toFixed(2);
        
        cliente.estado = 'AGUARDANDO_ENDERECO';
        resposta = `🥡 *Resumo:*\n${totalMarmitas} marmitas\n💰 Subtotal: R$ ${subtotal}\n\n📍 Digite seu *ENDEREÇO COMPLETO*:`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
      return res.status(200).json({ ok: true });
    }

    // 6. FRETE E FECHAMENTO
    if (cliente.estado === 'AGUARDANDO_ENDERECO') {
      cliente.endereco = texto; 
      const frete = calcularFrete(texto);
      
      if (frete && frete.erro) { await enviarMensagemWA(numero, frete.msg); return res.status(200).json({ ok: true }); }

      const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
      const valorUnitario = totalMarmitas >= 5 ? 0.01 : 0.05;
      const subtotalMarmitas = totalMarmitas * valorUnitario;

      let totalComFrete = 0;
      let textoFrete = "";
      if (frete && !frete.erro) {
         totalComFrete = subtotalMarmitas + frete.valor;
         textoFrete = frete.texto;
         cliente.valorFrete = frete.valor; 
      } else {
         totalComFrete = subtotalMarmitas; 
         textoFrete = "A calcular";
         cliente.valorFrete = 0;
      }

      cliente.totalFinal = totalComFrete;
      cliente.estado = 'ESCOLHENDO_PAGAMENTO';
      
      // MENSAGEM DE PAGAMENTO (SEM DINHEIRO)
      resposta = `✅ *Endereço OK!*\n\n💰 *TOTAL: R$ ${totalComFrete.toFixed(2)}*\n(Frete: ${textoFrete})\n\n💳 *Escolha o Pagamento Online:*\n\n1️⃣ PIX (Aprovação Imediata)\n2️⃣ Cartão de Crédito/Débito (Link)`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // 7. PAGAMENTO ONLINE
    if (cliente.estado === 'ESCOLHENDO_PAGAMENTO') {
      cliente.pagamento = texto; 

      // OPÇÃO 1: PIX
      if (mensagem === '1' || mensagem.includes('pix')) {
         await enviarMensagemWA(numero, "💠 *Gerando PIX...*");
         const dadosPix = await gerarPix(cliente.totalFinal, "Cliente", numero);
         
         if (dadosPix) {
             await enviarMensagemWA(numero, `Aqui está o código:`);
             await enviarMensagemWA(numero, dadosPix.copiaCola); 
             await enviarMensagemWA(numero, `⏳ *Aguardando pagamento...*\nAssim que confirmar, enviarei seu comprovante aqui mesmo!`);
         } else {
             await enviarMensagemWA(numero, "⚠️ Erro no banco. Tente novamente.");
         }
      } 
      // OPÇÃO 2: CARTÃO (Agora é a opção 2!)
      else if (mensagem === '2' || mensagem.includes('cartao') || mensagem.includes('cartão')) {
         await enviarMensagemWA(numero, "💳 *Gerando Link...*");
         const link = await gerarLinkPagamento(cliente.pedido, cliente.valorFrete, numero);
         
         if (link) {
             await enviarMensagemWA(numero, `✅ Pague com Cartão aqui:\n${link}\n\nAssim que aprovar, envio o comprovante!`);
         } else {
             await enviarMensagemWA(numero, "⚠️ Erro ao gerar link.");
         }
      }
      else {
         await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
         return res.status(200).json({ ok: true });
      }

      cliente.estado = 'FINALIZADO';
      return res.status(200).json({ ok: true });
    }

    // 8. ELOGIOS
    if (cliente.estado === 'ELOGIOS') {
      console.log(`[FEEDBACK] Cliente ${numero}: ${texto}`);
      cliente.estado = 'MENU';
      await enviarMensagemWA(numero, `✅ Obrigado!\n\n` + menuPrincipal());
      return res.status(200).json({ ok: true });
    }

    await enviarMensagemWA(numero, saudacaoTexto() + `\n\n` + menuPrincipal());
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Erro fatal:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });
