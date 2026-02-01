require('dotenv').config(); 
const express = require('express');
const path = require('path');
const axios = require('axios');
const xlsx = require('xlsx'); 
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

// ----------------------------------------------------------------------
// ⚙️ CONFIGURAÇÕES GERAIS
// ----------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 👇 SEU NÚMERO PARA RECEBER OS FEEDBACKS (Dedo Duro Ativado 🚨)
const NUMERO_ADMIN = process.env.NUMERO_ADMIN; 

// 🗺️ CONFIGURAÇÃO MAPBOX
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN; 
const COORD_COZINHA = "-51.11161606538164,-30.109913348576296"; // Rua Guaíba, 10

// 💳 CONFIGURAÇÃO MERCADO PAGO
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'SEU_TOKEN_MP_AQUI'
});

// 🧠 MEMÓRIA DO SISTEMA
const clientes = {};

// ----------------------------------------------------------------------
// 🔄 GESTÃO DE ESTADOS DO CLIENTE
// ----------------------------------------------------------------------
const estadoClientes = {
  getEstado: (numero) => {
    if (!clientes[numero]) {
      clientes[numero] = { 
        estado: 'INICIAL', 
        pedido: [], 
        nome: '', 
        recebeuSaudacao: false,
        pagamentoConfirmado: false,
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
      pagamentoConfirmado: false,
      ultimoContato: Date.now()
    };
  },

  limparCarrinhoManterMenu: (numero) => {
    if (clientes[numero]) {
      clientes[numero].pedido = []; 
      clientes[numero].estado = 'MENU';
      clientes[numero].pagamentoConfirmado = false;
    }
  }
};

// 🧹 MANUTENÇÃO: Limpa sessões inativas após 60 minutos
setInterval(() => {
  const agora = Date.now();
  for (const numero in clientes) {
    if (agora - clientes[numero].ultimoContato > 60 * 60 * 1000) {
      delete clientes[numero];
    }
  }
}, 60000);


// ----------------------------------------------------------------------
// 🚚 MOTOR DE FRETE (VERSÃO FINAL: HÍBRIDO + PREÇO AJUSTADO)
// ----------------------------------------------------------------------
async function calcularFreteGoogle(cepDestino) {
  console.log(`🔎 [DEBUG] Iniciando cálculo para o CEP: ${cepDestino}`);
  
  if (!MAPBOX_ACCESS_TOKEN) {
      return { erro: true, msg: "Erro interno (Token Mapbox ausente)." };
  }

  try {
    // 1. LIMPEZA DO CEP
    const cepLimpo = String(cepDestino).replace(/\D/g, '');
    if (cepLimpo.length !== 8) return { erro: true, msg: "⚠️ CEP inválido. Digite os 8 números." };

    // 2. CONSULTA O VIACEP (Para garantir o nome da rua correto)
    console.log("🇧🇷 [DEBUG] Consultando ViaCEP...");
    const urlViaCep = `https://viacep.com.br/ws/${cepLimpo}/json/`;
    const viaCepRes = await axios.get(urlViaCep);

    if (viaCepRes.data.erro) {
        console.log("❌ [DEBUG] ViaCEP não encontrou este CEP.");
        return { erro: true, msg: "❌ CEP não encontrado na base dos Correios." };
    }

    // Monta o endereço: "Rua X, Porto Alegre, RS, Brasil"
    const enderecoTexto = `${viaCepRes.data.logradouro}, ${viaCepRes.data.localidade}, ${viaCepRes.data.uf}, Brasil`;
    console.log(`✅ [DEBUG] Endereço descoberto: ${enderecoTexto}`);

    // 3. MAPBOX GEOCODING (Com preferência para perto da sua cozinha)
    const urlGeo = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(enderecoTexto)}.json?country=br&limit=1&proximity=${COORD_COZINHA}&access_token=${MAPBOX_ACCESS_TOKEN}`;
    const geoRes = await axios.get(urlGeo);
    
    if (!geoRes.data.features || geoRes.data.features.length === 0) {
        return { erro: true, msg: "❌ O mapa não conseguiu localizar a rua informada." };
    }

    const destino = geoRes.data.features[0];
    const coordsDestino = destino.center.join(','); // Longitude,Latitude
    
    // 4. CÁLCULO DA ROTA (Directions)
    console.log("🚗 [DEBUG] Calculando rota exata...");
    const urlDist = `https://api.mapbox.com/directions/v5/mapbox/driving/${COORD_COZINHA};${coordsDestino}?access_token=${MAPBOX_ACCESS_TOKEN}`;
    const distRes = await axios.get(urlDist);

    if (!distRes.data.routes || distRes.data.routes.length === 0) {
        return { erro: true, msg: "🚫 Rota não encontrada." };
    }

    const distanciaKm = distRes.data.routes[0].distance / 1000;
    console.log(`📏 [DEBUG] Distância Final: ${distanciaKm.toFixed(2)} km`);

    // ---------------------------------------------------------
    // 💰 TABELA DE PREÇOS OFICIAL
    // ---------------------------------------------------------
    let valor = 0;
    let texto = "";

    // Até 3km -> R$ 5,00
    if (distanciaKm <= 3.0) { 
        valor = 1.00; 
        texto = "R$ 5,00"; 
    } 
    // De 3km até 8km -> R$ 10,00
    else if (distanciaKm <= 8.0) { 
        valor = 10.00; 
        texto = "R$ 10,00"; 
    }
    // De 8km até 14km -> R$ 15,00
    else if (distanciaKm <= 14.0) { 
        valor = 15.00; 
        texto = "R$ 15,00"; 
    }
    // Acima de 14km (Bela Vista cai aqui) -> R$ 20,00
    else if (distanciaKm <= 20.0) { 
        valor = 20.00; 
        texto = "R$ 20,00"; 
    }
    // Acima de 20km -> Não entrega
    else {
        return { erro: true, msg: "🚫 Muito distante (fora da área de entrega de 20km)." };
    }
    // ---------------------------------------------------------

    return { valor, texto, endereco: enderecoTexto };

  } catch (error) {
    console.error("🔥 [ERRO]:", error.message);
    return { valor: 15.00, texto: "R$ 15,00 (Contingência)", endereco: "Endereço via CEP" };
  }
}

// ----------------------------------------------------------------------
// 💰 PROCESSAMENTO DE PAGAMENTOS
// ----------------------------------------------------------------------
async function gerarPix(valor, clienteNome, clienteTelefone) {
  try {
    const payment = new Payment(client);
    const body = {
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: `Marmita - ${clienteNome}`, 
      payment_method_id: 'pix',
      notification_url: `${process.env.URL_DO_SEU_SITE}/webhook`, 
      external_reference: String(clienteTelefone).replace(/\D/g, ''), 
      payer: { email: `vendas.${Date.now()}@marmitaria.com` }
    };

    const response = await payment.create({ body });
    return { 
      copiaCola: response.point_of_interaction.transaction_data.qr_code, 
      idPagamento: response.id 
    };
  } catch (error) { 
    console.error("Erro ao gerar Pix:", error.message);
    return null; 
  }
}

// 💳 GERADOR DE LINK DE CARTÃO (MERCADO PAGO)
async function gerarLinkPagamento(itens, frete, clienteTelefone) {
  try {
    const preference = new Preference(client);
    
    // Calcula o total de marmitas para aplicar a promoção
    const totalMarmitas = itens.reduce((acc, i) => acc + i.quantidade, 0);
    const precoUnitario = totalMarmitas >= 5 ? 0.01 : 19.99;

    const items = itens.map(item => ({
      title: item.prato,
      quantity: Number(item.quantidade),
      unit_price: Number(precoUnitario),
      currency_id: 'BRL'
    }));

    if (frete > 0) {
      items.push({
        title: 'Taxa de Entrega',
        quantity: 1,
        unit_price: Number(frete),
        currency_id: 'BRL'
      });
    }

    const response = await preference.create({
      body: {
        items: items,
        external_reference: String(clienteTelefone).replace(/\D/g, ''),
        back_urls: {
          success: `https://wa.me/${NUMERO_ADMIN.replace('@c.us','')}?text=Oi!%20Já%20concluí%20meu%20pagamento!%20🍱`,
          failure: `https://wa.me/${NUMERO_ADMIN.replace('@c.us','')}?text=Tive%20um%20problema%20no%20pagamento.`,
          pending: `https://wa.me/${NUMERO_ADMIN.replace('@c.us','')}`
        },
        auto_return: "approved"
      }
    });

    return response.init_point;
  } catch (error) {
    console.error("Erro no Link MP:", error);
    return null;
  }
}

// ----------------------------------------------------------------------
// 🔔 RECEBIMENTO E CONFIRMAÇÃO (WEBHOOK) - VERSÃO ORIGINAL SEGURA
// ----------------------------------------------------------------------
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
              memoria.pagamentoConfirmado = true;
              memoria.estado = 'FINALIZADO';
              
              let resumoItens = "";     
              let resumoItensAdmin = ""; 
              let subtotalVal = 0;

              memoria.pedido.forEach(item => {
                let nomeExibicao = item.prato;

                // 1. Aplica as variações no texto
                if (item.arroz === 'Integral') nomeExibicao = nomeExibicao.replace(/arroz/gi, 'Arroz Integral');
                if (item.strogonoff === 'Light') nomeExibicao = nomeExibicao.replace(/strogonoff/gi, 'Strogonoff Light');
                
                // 2. Formatação simples (Original)
                nomeExibicao = nomeExibicao.replace(/,/g, ',\n  '); 
                nomeExibicao = nomeExibicao.replace(/ e /g, '\n  e ');
                nomeExibicao = nomeExibicao.replace(/cnoura/gi, 'cenoura'); // Aquele fix que você tinha
                nomeExibicao = nomeExibicao.charAt(0).toUpperCase() + nomeExibicao.slice(1);

                // Define preço
                const precoItem = memoria.totalMarmitas >= 5 ? 0.01 : 19.99;
                const totalItem = item.quantidade * precoItem;
                subtotalVal += totalItem;

                // 3. Monta o visual final
                resumoItens += `${item.quantidade}x ${nomeExibicao.substring(0,25)}\n`;
                
                // Preço (Versão antiga que você usava)
                const precoFormatado = `R$ ${totalItem.toFixed(2).replace('.', ',')}`;
                resumoItens += precoFormatado.padStart(30, ' ') + `\n\n`; 

                // Resumo simples para o ADMIN
                resumoItensAdmin += `▪️ ${item.quantidade}x ${nomeExibicao}\n`;
              });

              const dataBr = new Date().toLocaleDateString('pt-BR');
              const horaBr = new Date().toLocaleTimeString('pt-BR').substring(0,5);

              const cupomCliente = `\`\`\`
      🧾  MELHOR MARMITA  🍱
      CUPOM: #${data.id.slice(-4)}
--------------------------------------
CLIENTE: ${memoria.nome.toUpperCase()}
DATA: ${dataBr} - ${horaBr}
--------------------------------------
${resumoItens}
--------------------------------------
SUBTOTAL:           R$ ${subtotalVal.toFixed(2)}
FRETE:              R$ ${memoria.valorFrete.toFixed(2)}
TOTAL PAGO:         R$ ${valorPago.toFixed(2)}
--------------------------------------
✅ PAGAMENTO CONFIRMADO
\`\`\``;

              const msgAdmin = `🔔 *NOVO PEDIDO PAGO!* 👨‍🍳🔥\n👤 *CLIENTE:* ${memoria.nome}\n📍 *ENTREGA:* ${memoria.endereco}\n📦 *ITENS:*\n${resumoItensAdmin}\n🚚 Frete: R$ ${memoria.valorFrete.toFixed(2)}\n💰 *TOTAL: R$ ${valorPago.toFixed(2)}*`;

              await enviarMensagemWA(numeroCliente, cupomCliente);
              await enviarMensagemWA(numeroCliente, `Muito obrigado, ${memoria.nome}! Seu pedido já foi para a cozinha. 🍱🔥`);
              
              // Mantive a proteção para garantir que chega no seu número
              const adminDestino = process.env.NUMERO_ADMIN || NUMERO_ADMIN;
              await enviarMensagemWA(adminDestino, msgAdmin); 
          }
        }
      } catch (error) { console.error("Erro Webhook:", error); }
  }
  res.sendStatus(200);
});

// ----------------------------------------------------------------------
// 🏠 MENU PRINCIPAL
// ----------------------------------------------------------------------
function menuPrincipal(nomeCliente) {
  const nomeDisplay = nomeCliente ? ` ${nomeCliente}` : '';
  return `🔻 *Menu Principal para${nomeDisplay}*\n\n1️⃣  Ver Cardápio 🍱\n2️⃣  Fazer Pedido 🛒\n3️⃣  Falar com Atendente (Sugestões/Críticas) 💬\n\n_Escolha uma opção digitando o número._`;
}

function msgNaoEntendi(textoAnterior) {
  return `🤔 *Não entendi sua resposta.*\nPor favor, escolha uma das opções abaixo:\n\n-----------------------------\n${textoAnterior}`;
}

// 📂 GESTÃO DE DADOS (EXCEL)
function carregarMenu() {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');
    const workbook = xlsx.readFile(arquivo);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return xlsx.utils.sheet_to_json(sheet);
  } catch (error) { 
    console.error("Erro ao carregar menu.xlsx:", error.message);
    return []; 
  }
}

// ⏱️ CONTROLE DE INATIVIDADE (Timer)
const timersClientes = {};
const TEMPO_INATIVO = 10 * 60 * 1000; // 20 minutos

function iniciarTimerInatividade(numero) {
  if (timersClientes[numero]) clearTimeout(timersClientes[numero]);
  
  timersClientes[numero] = setTimeout(async () => {
    const cliente = estadoClientes.getEstado(numero);
    if (cliente.estado !== 'INICIAL' && cliente.estado !== 'MENU' && cliente.estado !== 'FINALIZADO') {
      estadoClientes.resetarCliente(numero); 
      await enviarMensagemWA(numero, `💤 *Atendimento encerrado por inatividade.* Para recomeçar, basta dizer "Oi".`);
    }
    delete timersClientes[numero];
  }, TEMPO_INATIVO);
}

// 📲 INTEGRAÇÃO WHATSAPP (Wasender)
async function enviarMensagemWA(numero, texto) {
  const numeroLimpo = String(numero).replace(/\D/g, '');
  try {
    await axios.post('https://www.wasenderapi.com/api/send-message', 
      { to: numeroLimpo, text: texto }, 
      { headers: { Authorization: `Bearer ${process.env.WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) { 
    console.error(`Erro envio msg para ${numeroLimpo}:`, err.message); 
  }
}

// ----------------------------------------------------------------------
// 🚀 ROTAS DE EXECUÇÃO
// ----------------------------------------------------------------------
app.get('/', (req, res) => { 
  res.send('🍱 A Melhor Marmita - Servidor Online 🚀'); 
});

app.post('/mensagem', async (req, res) => {
  try {
    const body = req.body;
    if (body.event !== 'messages.received') return res.status(200).json({ ok: true });
    
    const dadosMensagem = body?.data?.messages;
    if (!dadosMensagem) return res.status(200).json({ ok: true });

    const remoteJid = dadosMensagem.key?.remoteJid || "";
    const fromMe = dadosMensagem.key?.fromMe;
    
    // 🛡️ SEGURANÇA: Não responde grupos ou o próprio bot
    if (remoteJid.includes('status') || remoteJid.includes('@g.us') || fromMe === true) {
        return res.status(200).json({ ok: true });
    }

    let numeroRaw = dadosMensagem.key?.cleanedSenderPn || dadosMensagem.key?.senderPn || remoteJid;
    const numero = String(numeroRaw).split('@')[0].replace(/\D/g, '');
    const texto = (dadosMensagem.messageBody || "").trim();

    if (!texto || !numero) return res.status(200).json({ ok: true });
    const mensagem = texto.toLowerCase();
    
    // ⏰ CONTROLE DE HORÁRIO (08h às 18h)
    const dataBrasil = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const diaSemana = dataBrasil.getDay(); 
    const horaAtual = dataBrasil.getHours();

    const isFinalDeSemana = (diaSemana === 0 || diaSemana === 6);
    const isForaDoHorario = (horaAtual < 8 || horaAtual >= 18);

    if (isFinalDeSemana || isForaDoHorario) {
        if (numero !== process.env.NUMERO_ADMIN && numero !== NUMERO_ADMIN.replace('@c.us', '')) {
            const avisoFechado = `🍱 *Olá! A Melhor Marmita agradece seu contato.*\n\n🚫 No momento estamos *FECHADOS*.\n\n⏰ Horário: Seg a Sex, das 08h às 18h.\n\nResponderemos assim que iniciarmos nosso expediente! 👋`;
            await enviarMensagemWA(numero, avisoFechado);
            return res.status(200).json({ ok: true });
        }
    }

    const cliente = estadoClientes.getEstado(numero);
    iniciarTimerInatividade(numero);
    cliente.ultimoContato = Date.now();

    // 🚩 CANCELAMENTO GLOBAL
    if (mensagem === 'cancelar' || mensagem === 'desistir') {
        if (cliente.pagamentoConfirmado) {
            await enviarMensagemWA(numero, "❌ *Pedido em produção!* O pagamento já foi aprovado. Para alterações, fale com o suporte.");
        } else {
            // Limpa só o pedido, mantém o nome e joga pro Menu
            estadoClientes.limparCarrinhoManterMenu(numero);
            
            await enviarMensagemWA(numero, "✅ Pedido cancelado.");
            await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
        }
        return res.status(200).json({ ok: true });
    }
    console.log(`📩 Cliente ${numero} (${cliente.estado}): "${mensagem}"`);

// 👋 SAUDAÇÃO INICIAL
if (!cliente.recebeuSaudacao) {
  cliente.recebeuSaudacao = true;
  cliente.estado = 'PERGUNTANDO_NOME_INICIO';
  let resposta = `👋 Olá! Seja muito bem-vindo(a) à *Melhor Marmita* 🍱\n\nAntes de começarmos, *como gostaria de ser chamado(a)?*`;
  cliente.ultimaMensagem = resposta; 
  await enviarMensagemWA(numero, resposta);
  return res.status(200).json({ ok: true });
}

// 👤 COLETA DE NOME
if (cliente.estado === 'PERGUNTANDO_NOME_INICIO') {
    if (texto.length < 2) {
        await enviarMensagemWA(numero, "❌ Nome muito curto. Por favor, digite seu nome:");
        return res.status(200).json({ ok: true });
    }
    cliente.nome = texto;
    cliente.estado = 'MENU';
    let resposta = `Prazer, ${cliente.nome}! 🤝\n\n` + menuPrincipal(cliente.nome);
    cliente.ultimaMensagem = resposta;
    await enviarMensagemWA(numero, resposta);
    return res.status(200).json({ ok: true });
}

// 📋 NAVEGAÇÃO DO MENU PRINCIPAL
if (cliente.estado === 'MENU') {
  if (mensagem === '1') { 
    const dados = carregarMenu();
    if(dados.length === 0) { 
        await enviarMensagemWA(numero, "⚠️ Cardápio indisponível no momento."); 
        return res.status(200).json({ok:true}); 
    }

    // AJUSTE SOLICITADO: Promoção em destaque, peso em baixo
    let cardapio = `🍱 *Cardápio do Dia para ${cliente.nome}*\n` +
                  `🔥 *PROMOÇÃO:* Acima de 5 unid o preço *CAI* para *R$ 17,49/un*!\n` +
                  `⚖️ Peso: 400g por marmita\n\n`;
    
    dados.forEach(item => { cardapio += `🔹 ${item.PRATO} – R$ 19,99\n`; });
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

  // 👇 OPÇÃO 3 (FEEDBACK / FALAR COM ATENDENTE)
  if (mensagem === '3') { 
    cliente.estado = 'ELOGIOS';
    await enviarMensagemWA(numero, `💬 *Fale com o Atendente*\n\n${cliente.nome}, escreva abaixo sua mensagem, elogio, crítica ou sugestão.👇\n\n(Digite 0 para cancelar e voltar)`); 
    return res.status(200).json({ ok: true });
  }

  if (mensagem === '0') { 
    await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); 
    return res.status(200).json({ ok: true }); 
  }
  
  await enviarMensagemWA(numero, msgNaoEntendi(menuPrincipal(cliente.nome)));
  return res.status(200).json({ ok: true });
}
    
// 📖 VISUALIZAÇÃO DO CARDÁPIO
if (cliente.estado === 'VENDO_CARDAPIO') {
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

  if (mensagem === '0') {
    cliente.estado = 'MENU';
    await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
    return res.status(200).json({ ok: true });
  }

  await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
  return res.status(200).json({ ok: true });
}

// 🛒 ESCOLHA DO PRATO
if (cliente.estado === 'ESCOLHENDO_PRATO') {
  if (mensagem === '0') { 
      estadoClientes.limparCarrinhoManterMenu(numero); 
      await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); 
      return res.status(200).json({ ok: true }); 
  }

  const escolha = parseInt(mensagem);
  if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) { 
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); 
      return res.status(200).json({ ok: true }); 
  }
  
  const prato = cliente.opcoesPrato[escolha - 1];
  const nomePrato = prato.PRATO.toLowerCase();
  let proximaResposta = '';
  
  // Inicia o item no pedido
  cliente.pedido.push({ 
      prato: prato.PRATO, 
      valor: 19.99, 
      arroz: null, 
      strogonoff: null, 
      quantidade: 0,
      peso: "400g" 
  });
  
  cliente.precisaArroz = nomePrato.includes('arroz');
  cliente.precisaStrogonoff = nomePrato.includes('strogonoff');

  if (cliente.precisaArroz) {
    cliente.estado = 'VARIACAO_ARROZ';
    proximaResposta = `🍚 *Qual tipo de arroz?*\n\n1️⃣ Branco\n2️⃣ Integral`;
  } else if (cliente.precisaStrogonoff) {
    cliente.estado = 'VARIACAO_STROGONOFF';
    proximaResposta = `🍛 *Qual tipo de strogonoff?*\n\n1️⃣ Tradicional\n2️⃣ Light`;
  } else {
    cliente.estado = 'QUANTIDADE';
    proximaResposta = `🔢 *Quantas marmitas deste prato deseja?*`;
  }

  cliente.ultimaMensagem = proximaResposta;
  await enviarMensagemWA(numero, proximaResposta);
  return res.status(200).json({ ok: true });
}

// 🍚 VARIAÇÕES (ARROZ)
if (cliente.estado === 'VARIACAO_ARROZ') {
  const itemAtual = cliente.pedido[cliente.pedido.length - 1];
  let proximaResposta = '';

  if (mensagem === '1' || mensagem.includes('branco')) itemAtual.arroz = 'Branco';
  else if (mensagem === '2' || mensagem.includes('integral')) itemAtual.arroz = 'Integral';
  else { 
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); 
      return res.status(200).json({ ok: true }); 
  }

  if (cliente.precisaStrogonoff) {
    cliente.estado = 'VARIACAO_STROGONOFF';
    proximaResposta = `🍛 *Qual tipo de strogonoff?*\n\n1️⃣ Tradicional\n2️⃣ Light`;
  } else {
    cliente.estado = 'QUANTIDADE';
    proximaResposta = `🔢 *Quantas marmitas deste prato deseja?*`;
  }
  
  cliente.ultimaMensagem = proximaResposta;
  await enviarMensagemWA(numero, proximaResposta);
  return res.status(200).json({ ok: true });
}

// 🥘 VARIAÇÕES (STROGONOFF)
if (cliente.estado === 'VARIACAO_STROGONOFF') {
  const itemAtual = cliente.pedido[cliente.pedido.length - 1];
  let proximaResposta = '';

  if (mensagem === '1' || mensagem.includes('tradicional')) itemAtual.strogonoff = 'Tradicional';
  else if (mensagem === '2' || mensagem.includes('light')) itemAtual.strogonoff = 'Light';
  else { 
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); 
      return res.status(200).json({ ok: true }); 
  }

  cliente.estado = 'QUANTIDADE';
  proximaResposta = `🔢 *Quantas marmitas deste prato deseja?*`;
  cliente.ultimaMensagem = proximaResposta;
  await enviarMensagemWA(numero, proximaResposta); 
  return res.status(200).json({ ok: true });
}
    
// 📈 QUANTIDADE E CARRINHO
if (cliente.estado === 'QUANTIDADE') {
  const qtd = parseInt(mensagem);
  if (isNaN(qtd) || qtd < 1) { 
      await enviarMensagemWA(numero, "❌ Por favor, digite um número válido (ex: 1, 2, 3)."); 
      return res.status(200).json({ ok: true }); 
  }

  cliente.pedido[cliente.pedido.length - 1].quantidade = qtd;
  cliente.estado = 'ADICIONAR_OUTRO';
  let resposta = `✅ *Adicionado!*\n\nDeseja pedir mais alguma coisa, ${cliente.nome}?\n\n1️⃣ Sim, escolher outro prato\n2️⃣ Não, fechar pedido`;
  
  cliente.ultimaMensagem = resposta;
  await enviarMensagemWA(numero, resposta);
  return res.status(200).json({ ok: true });
}

// 🏁 RESUMO E FECHAMENTO DE CARRINHO
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
    
    // Regra de Promoção (Preços oficiais)
    let valorUnitario = totalMarmitas >= 5 ? 0.01 : 19.99; 
    let textoPreco = totalMarmitas >= 5 ? "R$ 17,49 (Promoção)" : "R$ 19,99/un";
    let msgPromo = totalMarmitas >= 5 ? "🎉 *PROMOÇÃO APLICADA!* (Acima de 5 un)\n" : "";

    const subtotal = (totalMarmitas * valorUnitario).toFixed(2);
    cliente.totalMarmitas = totalMarmitas; 
    cliente.subtotal = parseFloat(subtotal);
    cliente.estado = 'AGUARDANDO_CEP'; 

    let resposta = `📝 *Resumo do Pedido de ${cliente.nome}:*\n\n` +
                   `${msgPromo}` +
                   `📦 Itens: ${totalMarmitas} marmitas\n` +
                   `💰 *Subtotal: R$ ${subtotal.replace('.', ',')}* (Sem frete)\n` +
                   `------------------------------\n\n` +
                   `📍 Para calcular a entrega, digite seu *CEP*:`;
    
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
    
// 📍 RECEPÇÃO DO CEP E CÁLCULO DE FRETE
if (cliente.estado === 'AGUARDANDO_CEP') {
    const cepLimpo = mensagem.replace(/\D/g, '');
    
    if (cepLimpo.length !== 8) {
        await enviarMensagemWA(numero, "⚠️ CEP inválido. Por favor, digite os 8 números do seu CEP.");
        return res.status(200).json({ ok: true });
    }

    await enviarMensagemWA(numero, "🔍 Calculando rota e frete... Só um instante.");
    // Aqui ele chama a função que já configuramos com Mapbox na Parte 1
    const frete = await calcularFreteGoogle(cepLimpo);
    
    if (frete.erro) {
        await enviarMensagemWA(numero, frete.msg);
        return res.status(200).json({ ok: true });
    }

    cliente.endereco = `CEP: ${cepLimpo} (${frete.endereco})`; 
    
    const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
    // Preços Oficiais: 17.49 (Promo) ou 19.99 (Normal)
    const valorUnitario = totalMarmitas >= 5 ? 0.01 : 19.99;
    const subtotalMarmitas = totalMarmitas * valorUnitario;

    const totalComFrete = subtotalMarmitas + frete.valor;
    cliente.valorFrete = frete.valor; 
    cliente.totalFinal = totalComFrete;
    cliente.estado = 'CONFIRMANDO_ENDERECO_COMPLEMENTO';
    
    let resposta = `✅ *Localizado!*\n📍 ${frete.endereco}\n🚚 Frete: *${frete.texto}*\n\n${cliente.nome}, por favor digite o *NÚMERO DA CASA* e *COMPLEMENTO*:\n\n_(Ou digite *0* para corrigir o CEP)_`;
    cliente.ultimaMensagem = resposta;
    await enviarMensagemWA(numero, resposta); 
    return res.status(200).json({ ok: true });
}

// 🏠 CONFIRMAÇÃO DE ENDEREÇO E PAGAMENTO
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
    
    let resumoPgto = `📝 *Fechamento da Conta:*\n👤 Cliente: ${cliente.nome}\n💰 *TOTAL FINAL: R$ ${cliente.totalFinal.toFixed(2).replace('.', ',')}*\n\n💳 *Como deseja pagar?*\n1️⃣ PIX (Aprovação Imediata)\n2️⃣ Cartão de Crédito/Débito (Link)\n\n0️⃣ Voltar para o CEP`;
    
    cliente.ultimaMensagem = resumoPgto;
    await enviarMensagemWA(numero, resumoPgto);
    return res.status(200).json({ ok: true });
}

// 💳 GESTÃO DE PAGAMENTO
if (cliente.estado === 'ESCOLHENDO_PAGAMENTO' || cliente.estado === 'AGUARDANDO_PAGAMENTO') {
  
  if (mensagem === '0' || mensagem === 'mudar') {
      cliente.estado = 'ESCOLHENDO_PAGAMENTO';
      let msgMudar = `🔄 *Mudar forma de pagamento:*\n\n1️⃣ PIX (Aprovação Imediata)\n2️⃣ Cartão de Crédito/Débito (Link)`;
      await enviarMensagemWA(numero, msgMudar);
      return res.status(200).json({ ok: true });
  }

  if (mensagem === '1' || mensagem.includes('pix')) {
     await enviarMensagemWA(numero, "💠 *Gerando PIX Copia e Cola...*");
     const dadosPix = await gerarPix(cliente.totalFinal, cliente.nome, numero);
     
     if (dadosPix) {
         await enviarMensagemWA(numero, `Aqui está seu código PIX:`);
         await enviarMensagemWA(numero, dadosPix.copiaCola); 
         await enviarMensagemWA(numero, `✅ *Copie o código acima e cole no aplicativo do seu banco.*\n\n_(Se quiser mudar para cartão, digite *0*)_`);
         cliente.estado = 'AGUARDANDO_PAGAMENTO';
     } else {
         await enviarMensagemWA(numero, "⚠️ Ocorreu uma instabilidade ao gerar o PIX. Tente novamente em instantes.");
     }
  } 
  else if (mensagem === '2' || mensagem.includes('cartao') || mensagem.includes('cartão')) {
     await enviarMensagemWA(numero, "💳 *Gerando link de pagamento seguro...*");
     const link = await gerarLinkPagamento(cliente.pedido, cliente.valorFrete, numero);
     
     if (link) {
         await enviarMensagemWA(numero, `✅ *Link gerado! Clique abaixo para pagar:*\n\n${link}\n\n_(Se quiser mudar para PIX, digite *0*)_`);
         cliente.estado = 'AGUARDANDO_PAGAMENTO';
     } else {
         await enviarMensagemWA(numero, "⚠️ Não conseguimos gerar o link de cartão. Tente a opção PIX.");
     }
  }
  else if (cliente.estado === 'ESCOLHENDO_PAGAMENTO') {
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
  }
  return res.status(200).json({ ok: true });
}

// 🏁 STATUS FINAL E FEEDBACK (COM ENVIO PRO DONO)
if (cliente.estado === 'FINALIZADO') {
   if (mensagem === 'menu' || mensagem === '0') {
       estadoClientes.resetarCliente(numero);
       await enviarMensagemWA(numero, menuPrincipal());
       return res.status(200).json({ ok: true });
   }
   await enviarMensagemWA(numero, `👋 Olá, ${cliente.nome}! Seu pedido já está na cozinha.\n\nPara um *novo pedido*, digite *MENU*.`);
   return res.status(200).json({ ok: true });
}

// 👇 LÓGICA DO DEDO DURO (Aqui o bot manda a mensagem pra você!)
if (cliente.estado === 'ELOGIOS') {
  
  if (mensagem === '0') {
      cliente.estado = 'MENU';
      await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
      return res.status(200).json({ ok: true });
  }

  // 1. Avisa o Admin (VOCÊ)
  const alertaAdmin = `🚨 *NOVO FEEDBACK/CONTATO* 🚨\n\n` +
                      `👤 *Nome:* ${cliente.nome}\n` +
                      `📱 *Tel:* ${numero}\n` +
                      `💬 *Mensagem:* ${texto}`;
  
  await enviarMensagemWA(NUMERO_ADMIN, alertaAdmin);

  // 2. Responde o Cliente
  cliente.estado = 'MENU';
  await enviarMensagemWA(numero, `✅ Mensagem enviada! Muito obrigado pelo contato, ${cliente.nome}. Logo responderemos.\n\n` + menuPrincipal(cliente.nome));
  return res.status(200).json({ ok: true });
}

// 🔄 SAUDAÇÃO GLOBAL (CASO O BOT SE PERCA)
    await enviarMensagemWA(numero, `👋 Olá! Bem-vindo de volta!\n\n` + menuPrincipal(cliente.nome));
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('❌ [ERRO CRÍTICO]:', error.message);
    return res.status(200).json({ ok: true }); // Mantém o status 200 para não travar o webhook
  }
});

// 🚀 LIGANDO O MOTOR!
app.listen(PORT, () => { 
  console.log(`🚀 Servidor "Melhor Marmita" rodando na porta ${PORT}`); 
});
