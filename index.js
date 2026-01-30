const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const axios = require('axios');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

// ==============================================================================
// 🧠 MEMÓRIA DO ROBÔ
// ==============================================================================
const clientes = {};

// 🛡️ CONTROLE DE SEGURANÇA (ANTI-HACKER / ANTI-GASTOS)
const CONTROLE_MAPS = {
  dia: new Date().getDate(),
  consultas: 0,
  LIMITE_DIARIO: 50 // 🔒 MÁXIMO DE 50 CONSULTAS AO GOOGLE POR DIA
};

const estadoClientes = {
  getEstado: (numero) => {
    if (!clientes[numero]) {
      clientes[numero] = { 
        estado: 'INICIAL', 
        pedido: [], 
        nome: '', 
        recebeuSaudacao: false,
        ultimoContato: Date.now()
      };
    }
    return clientes[numero];
  },
  resetarCliente: (numero) => {
    clientes[numero] = { 
      estado: 'INICIAL', 
      pedido: [], 
      nome: '',
      recebeuSaudacao: false,
      ultimoContato: Date.now()
    };
  },
  limparCarrinhoManterMenu: (numero) => {
    if (clientes[numero]) {
      clientes[numero].pedido = []; 
      clientes[numero].estado = 'MENU';
    }
  }
};

// ==============================================================================
// 🧹 FAXINA AUTOMÁTICA (12H INATIVIDADE)
// ==============================================================================
setInterval(() => {
  const agora = Date.now();
  const tempoLimite = 12 * 60 * 60 * 1000; // 12 horas
  
  const diaHoje = new Date().getDate();
  if (CONTROLE_MAPS.dia !== diaHoje) {
      console.log('🔄 Novo dia! Resetando contador do Google Maps.');
      CONTROLE_MAPS.dia = diaHoje;
      CONTROLE_MAPS.consultas = 0;
  }

  Object.keys(clientes).forEach(numero => {
    const cliente = clientes[numero];
    if ((agora - cliente.ultimoContato) > tempoLimite && cliente.estado !== 'FINALIZADO') {
       delete clientes[numero];
    }
  });
}, 60 * 60 * 1000); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ==============================================================================
// ⚙️ ÁREA DE CONFIGURAÇÃO (MODO TESTE 🧪)
// ==============================================================================

const NUMERO_ADMIN = '5551984050946'; 
const MP_ACCESS_TOKEN = 'APP_USR-3976540518966482-012110-64c2873d7929c168846b389d4f6c311e-281673709'; 
const WASENDER_TOKEN = process.env.WASENDER_TOKEN || '399f73920f6d3300e39fc9f8f0e34eb40510a8a14847e288580d5d10e40cdae4'; 
const URL_DO_SEU_SITE = 'https://mmmelhormarmita.onrender.com';
const GOOGLE_API_KEY = 'AIzaSyAc6xZjyQRgBS52UfOKc93PthX9HlMMqHw'; 
const ORIGEM_COZINHA = 'Rua Guaíba, 10 - CEP 91560-640, Lomba do Pinheiro, Porto Alegre, RS';

// ==============================================================================

const TEMPO_INATIVO = 10 * 60 * 1000; 
const timersClientes = {};
const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN, options: { timeout: 5000 } });

// ==============================================================================
// 🗺️ FRETE INTELIGENTE
// ==============================================================================

async function calcularFreteGoogle(cepDestino) {
  try {
    if (CONTROLE_MAPS.consultas >= CONTROLE_MAPS.LIMITE_DIARIO) {
        return { erro: true, msg: "⚠️ O sistema automático de frete está indisponível. Envie seu endereço por escrito." };
    }
    const cepLimpo = String(cepDestino).replace(/\D/g, '');
    if (cepLimpo.length !== 8) return { erro: true, msg: "⚠️ CEP inválido. Digite os 8 números." };

    console.log(`🗺️ Rota (${CONTROLE_MAPS.consultas + 1}): CEP ${cepLimpo}`);
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGEM_COZINHA)}&destinations=cep+${cepLimpo}&mode=driving&language=pt-BR&key=${GOOGLE_API_KEY}`;
    CONTROLE_MAPS.consultas++;

    const response = await axios.get(url);
    const data = response.data;

    if (data.status !== 'OK' || !data.rows[0].elements[0].distance) return { erro: true, msg: "❌ CEP não localizado." };
    const elemento = data.rows[0].elements[0];
    if (elemento.status !== 'OK') return { erro: true, msg: "🚫 Rota não encontrada." };

    const distanciaKm = elemento.distance.value / 1000;
    const enderecoGoogle = data.destination_addresses[0]; 

    // TABELA DE PREÇOS (TESTE R$ 1.00+)
    if (distanciaKm <= 3.0) return { valor: 1.01, texto: "R$ 1,01", endereco: enderecoGoogle };
    if (distanciaKm <= 6.0) return { valor: 1.02, texto: "R$ 1.02", endereco: enderecoGoogle };
    if (distanciaKm <= 15.0) return { valor: 1.03, texto: "R$ 1,03", endereco: enderecoGoogle };
    if (distanciaKm <= 20.0) return { valor: 1.04, texto: "R$ 1,04", endereco: enderecoGoogle };

    return { erro: true, msg: "🚫 Endereço fora da área de entrega." };
  } catch (error) {
    return { erro: true, msg: "⚠️ Erro no cálculo de frete." };
  }
}

// ==============================================================================
// 💰 PAGAMENTO
// ==============================================================================
async function gerarPix(valor, clienteNome, clienteTelefone) {
  try {
    const payment = new Payment(client);
    const body = {
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: `Marmita - ${clienteNome}`, 
      payment_method_id: 'pix',
      notification_url: `${URL_DO_SEU_SITE}/webhook`, 
      external_reference: String(clienteTelefone).replace(/\D/g, ''), 
      payer: { email: `testuser.${Date.now()}@test.com` }
    };
    const response = await payment.create({ body });
    return { copiaCola: response.point_of_interaction.transaction_data.qr_code, idPagamento: response.id };
  } catch (error) { return null; }
}

async function gerarLinkPagamento(itens, frete, clienteTelefone) {
  try {
    const preference = new Preference(client);
    const itemsPreference = itens.map(item => {
      let nomeFinal = item.prato;
      // ✅ Nomenclatura inteligente no link de pagamento
      if (item.arroz === 'Integral') nomeFinal = nomeFinal.replace(/arroz/gi, 'arroz INTEGRAL');
      if (item.strogonoff === 'Light') nomeFinal = nomeFinal.replace(/strogonoff/gi, 'strogonoff LIGHT');

      return {
        title: nomeFinal,
        quantity: parseInt(item.quantidade),
        unit_price: item.quantidade >= 5 ? 0.01 : 0.05,
        currency_id: 'BRL'
      };
    });

    if (frete > 0) {
      itemsPreference.push({ title: 'Taxa de Entrega', quantity: 1, unit_price: parseFloat(frete), currency_id: 'BRL' });
    }

    const body = {
      items: itemsPreference,
      external_reference: String(clienteTelefone).replace(/\D/g, ''),
      notification_url: `${URL_DO_SEU_SITE}/webhook`,
      auto_return: 'approved',
      payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 }
    };

    const response = await preference.create({ body });
    return response.init_point;
  } catch (error) {
    console.error("Erro link MP:", error);
    return null;
  }
}
// ==============================================================================
// 🖨️ AUXILIARES DE FORMATAÇÃO (QUEBRA DE LINHA INTELIGENTE)
// ==============================================================================
function pad(str, length) { return (str + '                                        ').substring(0, length); }
function padL(str, length) { return ('                                        ' + str).slice(-length); }

// ==============================================================================
// 🔔 WEBHOOK (V19 - FORMATAÇÃO AVANÇADA DO RECIBO)
// ==============================================================================

app.post('/webhook', async (req, res) => {
  const { action, data } = req.body;
  if (action === 'payment.created' || action === 'payment.updated') {
     try {
       const payment = new Payment(client);
       const pagamentoInfo = await payment.get({ id: data.id });
       
       if (pagamentoInfo.status === 'approved') {
         const numeroCliente = pagamentoInfo.external_reference; 
         const valorPago = pagamentoInfo.transaction_amount;
         const memoria = clientes[numeroCliente];
         
         if (memoria) {
             memoria.estado = 'FINALIZADO';
             let resumoItens = "";     
             let resumoItensAdmin = ""; 
             let subtotalVal = 0;

             memoria.pedido.forEach(item => {
                 let nomeExibicao = item.prato;

                 // ✅ NOMENCLATURA INTELIGENTE (Substituição no meio da frase)
                 if (item.arroz === 'Integral') {
                     nomeExibicao = nomeExibicao.replace(/arroz/gi, 'arroz INTEGRAL');
                 }
                 if (item.strogonoff === 'Light') {
                     nomeExibicao = nomeExibicao.replace(/strogonoff/gi, 'strogonoff LIGHT');
                 }

                 const precoItem = item.quantidade >= 5 ? 0.01 : 0.05;
                 const totalItem = item.quantidade * precoItem;
                 subtotalVal += totalItem;

                 // FORMATAÇÃO DO CUPOM (Nota Fiscal alinhada)
                 const qtdStr = (item.quantidade + 'x').padEnd(3);
                 const totalStr = padL('R$ ' + totalItem.toFixed(2), 8);
                 const limiteChar = 25; 

                 if (nomeExibicao.length <= limiteChar) {
                     resumoItens += `${qtdStr} ${pad(nomeExibicao, 25)} ${totalStr}\n`;
                 } else {
                     let corte = nomeExibicao.lastIndexOf(' ', limiteChar);
                     if (corte === -1) corte = limiteChar;
                     resumoItens += `${qtdStr} ${nomeExibicao.substring(0, corte)}\n`;
                     resumoItens += `    ${pad(nomeExibicao.substring(corte + 1), 25)} ${totalStr}\n`;
                 }

                 // DEDO DURO (ADMIN) ATUALIZADO COM OS NOMES NOVOS
                 resumoItensAdmin += `▪️ ${item.quantidade}x ${nomeExibicao}\n`;
             });

             const dataBr = new Date().toLocaleDateString('pt-BR');
             const horaBr = new Date().toLocaleTimeString('pt-BR').substring(0,5);

             const cupomCliente = 
`\`\`\`
       🧾  MELHOR MARMITA  🍱
     CUPOM DE PEDIDO: #${data.id.slice(-4)}
--------------------------------------
CLIENTE: ${memoria.nome.toUpperCase()}
DATA: ${dataBr} - ${horaBr}
--------------------------------------
ITEM                      QTD    VALOR
--------------------------------------
${resumoItens}
--------------------------------------
SUBTOTAL:                 R$ ${subtotalVal.toFixed(2)}
FRETE:                    R$ ${memoria.valorFrete.toFixed(2)}
--------------------------------------
TOTAL PAGO:               R$ ${valorPago.toFixed(2)}
--------------------------------------
✅  PAGAMENTO CONFIRMADO
    OBRIGADO PELA PREFERÊNCIA!
\`\`\``;

             const msgAdmin = 
`🔔 *NOVO PEDIDO PAGO!* 👨‍🍳🔥
--------------------------------
👤 *CLIENTE:* ${memoria.nome}
📞 *CONTATO:* wa.me/${numeroCliente}
📍 *ENTREGA:* ${memoria.endereco}
--------------------------------
📦 *ITENS:*
${resumoItensAdmin}
🚚 Frete: R$ ${memoria.valorFrete.toFixed(2)}
💰 *TOTAL DA VENDA: R$ ${valorPago.toFixed(2)}*
--------------------------------
✅ *Status:* PAGO`;

             await enviarMensagemWA(numeroCliente, `Aqui está seu comprovante detalhado:`);
             await enviarMensagemWA(numeroCliente, cupomCliente);
             await enviarMensagemWA(numeroCliente, `Muito obrigado, ${memoria.nome}! Já enviamos para a cozinha. 🍱🔥`);
             await enviarMensagemWA(NUMERO_ADMIN, msgAdmin);
         }
       }
     } catch (error) { console.error("Erro Webhook:", error); }
  }
  res.sendStatus(200);
});

// ==============================================================================
// 🧠 LÓGICA DO ROBÔ
// ==============================================================================

function menuPrincipal(nomeCliente) {
  const nomeDisplay = nomeCliente ? ` ${nomeCliente}` : '';
  return `🔻 *Menu Principal para${nomeDisplay}*\n\n1️⃣  Ver Cardápio do Dia\n2️⃣  Fazer Pedido\n3️⃣  Elogios ou Reclamações\n\n_Digite o número da opção desejada._`;
}

function msgNaoEntendi(textoAnterior) {
  return `🤔 *Não entendi sua resposta.*\nPor favor, escolha uma das opções abaixo:\n\n-----------------------------\n${textoAnterior}`;
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
    if (cliente.estado !== 'INICIAL' && cliente.estado !== 'MENU' && cliente.estado !== 'FINALIZADO') {
      estadoClientes.resetarCliente(numero); 
      await enviarMensagemWA(numero, `💤 *Atendimento encerrado por falta de interação.*`);
    }
    delete timersClientes[numero];
  }, TEMPO_INATIVO);
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
// 🚀 ROTAS
// ==============================================================================

app.get('/', (req, res) => { res.send('🤖 Bot V19 (RECIBO INTELIGENTE) ON 🚀'); });

app.post('/mensagem', async (req, res) => {
  try {
    const body = req.body;
    if (body.event !== 'messages.received') return res.status(200).json({ ok: true });
    
    const dadosMensagem = body?.data?.messages;
    if (!dadosMensagem) return res.status(200).json({ ok: true });

    const remoteJid = dadosMensagem.key?.remoteJid || "";
    const fromMe = dadosMensagem.key?.fromMe;
    
    if (remoteJid.includes('status') || remoteJid.includes('@g.us') || fromMe === true) return res.status(200).json({ ok: true });

    let numeroRaw = dadosMensagem.key?.cleanedSenderPn || dadosMensagem.key?.senderPn || remoteJid;
    const numero = String(numeroRaw).split('@')[0].replace(/\D/g, '');
    const texto = dadosMensagem.messageBody || dadosMensagem.message?.conversation || dadosMensagem.message?.extendedTextMessage?.text || "";

    if (!texto || !numero) return res.status(200).json({ ok: true });
    const mensagem = texto.trim().toLowerCase();
    
    // ⏰ HORÁRIO
    const dataBrasil = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    const diaSemana = dataBrasil.getDay(); 
    const horaAtual = dataBrasil.getHours();

    if ((diaSemana === 0 || diaSemana === 6) || (horaAtual < 8 || horaAtual >= 18)) {
       if (numero !== NUMERO_ADMIN) {
         await enviarMensagemWA(numero, `🚫 *Olá! A Melhor Marmita está fechada agora.*\n\n⏰ Nosso horário de atendimento é:\nSegunda a Sexta, das 08h às 18h.\n\nEsperamos seu contato no horário comercial! 👋`);
         return res.status(200).json({ ok: true });
       }
    }

    iniciarTimerInatividade(numero);
    
    const cliente = estadoClientes.getEstado(numero);
    cliente.ultimoContato = Date.now();
    let resposta = '';

    console.log(`📩 Cliente ${numero}: "${mensagem}"`);

    // 1. SAUDAÇÃO
    if (!cliente.recebeuSaudacao) {
      cliente.recebeuSaudacao = true;
      cliente.estado = 'PERGUNTANDO_NOME_INICIO';
      resposta = `👋 Olá! Seja muito bem-vindo(a) à *Melhor Marmita* 🍱\n\nAntes de começarmos, *como gostaria de ser chamado(a)?*`;
      cliente.ultimaMensagem = resposta; 
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }
    
    // 2. NOME
    if (cliente.estado === 'PERGUNTANDO_NOME_INICIO') {
        if (texto.length < 2) {
            await enviarMensagemWA(numero, "❌ Nome muito curto. Por favor, digite seu nome:");
            return res.status(200).json({ ok: true });
        }
        cliente.nome = texto;
        cliente.estado = 'MENU';
        resposta = `Prazer, ${cliente.nome}! 🤝\n\n` + menuPrincipal(cliente.nome);
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
        return res.status(200).json({ ok: true });
    }
    
    // 3. CANCELAR
    if (mensagem === 'cancelar') {
      if (cliente.estado === 'FINALIZADO') {
         await enviarMensagemWA(numero, `⚠️ *Pedido já pago e confirmado!*`);
         return res.status(200).json({ ok: true });
      }
      const nomeSalvo = cliente.nome;
      estadoClientes.resetarCliente(numero); 
      const reset = estadoClientes.getEstado(numero);
      reset.nome = nomeSalvo;
      reset.recebeuSaudacao = true; 
      reset.estado = 'MENU'; 
      await enviarMensagemWA(numero, `❌ Pedido cancelado, ${nomeSalvo}.\n\n` + menuPrincipal(nomeSalvo));
      return res.status(200).json({ ok: true });
    }

    // 4. MENU
    if (cliente.estado === 'MENU') {
      if (mensagem === '1') { 
        const dados = carregarMenu();
        if(dados.length === 0) { await enviarMensagemWA(numero, "⚠️ Cardápio indisponível."); return res.status(200).json({ok:true}); }
        let cardapio = `🍱 *Cardápio do Dia para ${cliente.nome}*\n🔥 *PROMOÇÃO:* Acima de 5 unid = *R$ 0,01/un*!\n\n`;
        dados.forEach(item => { cardapio += `🔹 ${item.PRATO} – R$ 0,05\n`; });
        cardapio += `\nPara fazer seu pedido, digite *2*.\nOu digite *0* para voltar.`;
        cliente.estado = 'VENDO_CARDAPIO';
        cliente.ultimaMensagem = cardapio; 
        await enviarMensagemWA(numero, cardapio);
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2') {
        const dados = carregarMenu();
        let lista = `🍽️ *Vamos montar seu pedido, ${cliente.nome}!* 😋\n\nDigite o NÚMERO do prato que deseja:\n\n`;
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
        await enviarMensagemWA(numero, `💬 *Espaço do Cliente*\n${cliente.nome}, escreva abaixo seu elogio, sugestão ou reclamação:\n\n(Digite 0 para voltar)`); 
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '0') { await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); return res.status(200).json({ ok: true }); }
      
      await enviarMensagemWA(numero, msgNaoEntendi(menuPrincipal(cliente.nome)));
      return res.status(200).json({ ok: true });
    }

    // 5. LEITURA
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
         await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
         return res.status(200).json({ ok: true });
       }
       await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
       return res.status(200).json({ ok: true });
    }

    // 6. PEDIDO
    if (cliente.estado === 'ESCOLHENDO_PRATO') {
      if (mensagem === '0') { 
          estadoClientes.limparCarrinhoManterMenu(numero); 
          await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); 
          return res.status(200).json({ ok: true }); 
      }
      const escolha = parseInt(mensagem);
      if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }
      
      const prato = cliente.opcoesPrato[escolha - 1];
      const nomePrato = prato.PRATO.toLowerCase();
      
      cliente.pedido.push({ prato: prato.PRATO, valor: 0.05, arroz: null, strogonoff: null, quantidade: 0 });
      cliente.precisaArroz = nomePrato.includes('arroz');
      cliente.precisaStrogonoff = nomePrato.includes('strogonoff');

      if (cliente.precisaArroz) {
        cliente.estado = 'VARIACAO_ARROZ';
        resposta = `🍚 *Qual tipo de arroz?*\n\n1️⃣ Branco\n2️⃣ Integral`;
      } else if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta = `🍛 *Qual tipo de strogonoff?*\n\n1️⃣ Tradicional\n2️⃣ Light`;
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `🔢 *Quantas marmitas desse prato deseja adicionar ao seu pedido?*`;
      }
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'VARIACAO_ARROZ') {
      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      if (mensagem === '1' || mensagem.includes('branco')) itemAtual.arroz = 'Branco';
      else if (mensagem === '2' || mensagem.includes('integral')) itemAtual.arroz = 'Integral';
      else { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }

      if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta = `🍛 *Qual tipo de strogonoff?*\n\n1️⃣ Tradicional\n2️⃣ Light`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `🔢 *Quantas marmitas desse prato deseja adicionar ao seu pedido?*`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
      }
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'VARIACAO_STROGONOFF') {
      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      if (mensagem === '1' || mensagem.includes('tradicional')) itemAtual.strogonoff = 'Tradicional';
      else if (mensagem === '2' || mensagem.includes('light')) itemAtual.strogonoff = 'Light';
      else { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }
      cliente.estado = 'QUANTIDADE';
      resposta = `🔢 *Quantas marmitas desse prato deseja adicionar ao seu pedido?*`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'QUANTIDADE') {
      const qtd = parseInt(mensagem);
      if (isNaN(qtd) || qtd < 1) { await enviarMensagemWA(numero, "❌ Por favor, digite um número válido (ex: 1, 2, 3)."); return res.status(200).json({ ok: true }); }
      cliente.pedido[cliente.pedido.length - 1].quantidade = qtd;
      cliente.estado = 'ADICIONAR_OUTRO';
      resposta = `✅ *Adicionado!*\n\nDeseja pedir mais alguma coisa, ${cliente.nome}?\n\n1️⃣ Sim, escolher outro prato\n2️⃣ Não, fechar pedido`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }

    // 7. FECHAMENTO
    if (cliente.estado === 'ADICIONAR_OUTRO') {
      if (mensagem === '1' || mensagem.includes('sim')) {
        cliente.estado = 'ESCOLHENDO_PRATO';
        const dados = carregarMenu();
        let lista = `🍽️ *Escolha mais um prato:*\n\n`;
        dados.forEach((item, i) => { lista += `${i + 1}️⃣  ${item.PRATO}\n`; });
        lista += `\n0️⃣ Cancelar tudo`;
        cliente.opcoesPrato = dados;
        await enviarMensagemWA(numero, lista);
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2' || mensagem.includes('nao') || mensagem.includes('não')) {
        
        const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
        let valorUnitario = 0.05; // TESTE
        let textoPreco = "R$ 0,05/un";
        let msgPromo = "";

        if (totalMarmitas >= 5) {
          valorUnitario = 0.01; // TESTE
          textoPreco = "R$ 0,01 (Promoção)"; 
          msgPromo = "🎉 *PROMOÇÃO APLICADA!* (Acima de 5 un)\n";
        }

        const subtotal = (totalMarmitas * valorUnitario).toFixed(2);

        cliente.estado = 'AGUARDANDO_CEP'; 
        resposta = `📝 *Resumo do Pedido de ${cliente.nome}:*\n\n${msgPromo}Marmitas: ${totalMarmitas}\nValor: ${textoPreco}\n💰 *Subtotal: R$ ${subtotal}* (Sem frete)\n------------------------------\n\n📍 Para calcular a entrega, digite seu *CEP* (apenas números):`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '0') {
         estadoClientes.limparCarrinhoManterMenu(numero);
         await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
         return res.status(200).json({ ok: true });
      }
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
      return res.status(200).json({ ok: true });
    }

    // 8. CEP
    if (cliente.estado === 'AGUARDANDO_CEP') {
      await enviarMensagemWA(numero, "🔍 Calculando rota no Google Maps... Só um instante.");
      const frete = await calcularFreteGoogle(texto);
      
      if (frete.erro) {
          await enviarMensagemWA(numero, frete.msg);
          return res.status(200).json({ ok: true });
      }

      cliente.endereco = `CEP: ${texto} (${frete.endereco})`; 
      
      const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
      const valorUnitario = totalMarmitas >= 5 ? 0.01 : 0.05; // TESTE
      const subtotalMarmitas = totalMarmitas * valorUnitario;

      const totalComFrete = subtotalMarmitas + frete.valor;
      const textoFrete = frete.texto;
      cliente.valorFrete = frete.valor; 
      cliente.totalFinal = totalComFrete;
      cliente.estado = 'CONFIRMANDO_ENDERECO_COMPLEMENTO';
      
      resposta = `✅ *Localizado!*\n📍 ${frete.endereco}\n🚚 Frete: *${textoFrete}*\n\n${cliente.nome}, por favor digite o *NÚMERO DA CASA* e *COMPLEMENTO*:\n\n_(Ou digite *0* para corrigir o CEP)_`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'CONFIRMANDO_ENDERECO_COMPLEMENTO') {
        if (mensagem === '0') {
            cliente.estado = 'AGUARDANDO_CEP';
            cliente.endereco = '';
            cliente.valorFrete = 0;
            await enviarMensagemWA(numero, `🔄 Sem problemas! Digite o *CEP correto* (apenas números):`);
            return res.status(200).json({ ok: true });
        }
        cliente.endereco += ` - Compl: ${texto}`;
        cliente.estado = 'ESCOLHENDO_PAGAMENTO';
        
        resposta = `📝 *Fechamento da Conta:*\n👤 Cliente: ${cliente.nome}\n💰 *TOTAL FINAL: R$ ${cliente.totalFinal.toFixed(2)}* (Teste)\n\n🚚 *Entrega prevista: de 3 a 5 dias* (Sob encomenda)\n\n💳 *Como deseja pagar?*\n1️⃣ PIX (Aprovação Imediata)\n2️⃣ Cartão de Crédito/Débito (Link)`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
        return res.status(200).json({ ok: true });
    }

    // 9. PAGAMENTO
    if (cliente.estado === 'ESCOLHENDO_PAGAMENTO') {
      cliente.pagamento = texto; 

      if (mensagem === '1' || mensagem.includes('pix')) {
         await enviarMensagemWA(numero, "💠 *Gerando PIX Copia e Cola...*");
         const dadosPix = await gerarPix(cliente.totalFinal, cliente.nome, numero);
         
         if (dadosPix) {
             await enviarMensagemWA(numero, `Aqui está seu código PIX:`);
             await enviarMensagemWA(numero, dadosPix.copiaCola); 
             await enviarMensagemWA(numero, `✅ *Copie e cole no seu banco.*`);
         } else {
             await enviarMensagemWA(numero, "⚠️ Erro no PIX. Tente novamente.");
         }
      } 
      else if (mensagem === '2' || mensagem.includes('cartao') || mensagem.includes('cartão')) {
         await enviarMensagemWA(numero, "💳 *Gerando Link de Teste...*");
         const link = await gerarLinkPagamento(cliente.pedido, cliente.valorFrete, numero);
         
         if (link) {
             await enviarMensagemWA(numero, `✅ Clique para pagar (Teste):\n\n${link}`);
         } else {
             await enviarMensagemWA(numero, "⚠️ Erro no Link. Tente novamente.");
         }
      }
      else {
         await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
         return res.status(200).json({ ok: true });
      }

      cliente.estado = 'FINALIZADO';
      return res.status(200).json({ ok: true });
    }
    
    // 10. ESTADO FINALIZADO
    if (cliente.estado === 'FINALIZADO') {
       if (mensagem === 'menu' || mensagem === '0') {
           estadoClientes.resetarCliente(numero);
           await enviarMensagemWA(numero, menuPrincipal());
           return res.status(200).json({ ok: true });
       }
       await enviarMensagemWA(numero, `👋 Olá, ${cliente.nome}! Seu pedido anterior já está sendo preparado. \n\nSe quiser fazer um *novo pedido*, digite *MENU*.`);
       return res.status(200).json({ ok: true });
    }

    // 11. ELOGIOS
    if (cliente.estado === 'ELOGIOS') {
      console.log(`[FEEDBACK] Cliente ${numero}: ${texto}`);
      cliente.estado = 'MENU';
      await enviarMensagemWA(numero, `✅ Obrigado! Sua mensagem foi registrada.\n\n` + menuPrincipal(cliente.nome));
      return res.status(200).json({ ok: true });
    }

    await enviarMensagemWA(numero, `👋 Olá! Bem-vindo de volta, ${cliente.nome || 'Visitante'}!\n\n` + menuPrincipal(cliente.nome));
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Erro fatal:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });
