const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const axios = require('axios');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

// 🧠 MEMÓRIA DO SISTEMA
const clientes = {};

// 🛡️ CONTROLE DE SEGURANÇA E COTAS
const CONTROLE_MAPS = {
  dia: new Date().getDate(),
  consultas: 0,
  LIMITE_DIARIO: 50 
};

// ⚙️ GESTÃO DE ESTADOS DO CLIENTE
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

// 🧹 MANUTENÇÃO DO SISTEMA E COTAS
setInterval(() => {
  const agora = Date.now();
  const tempoLimite = 12 * 60 * 60 * 1000;
  
  const diaHoje = new Date().getDate();
  if (CONTROLE_MAPS.dia !== diaHoje) {
      console.log('🔄 Novo dia: Resetando contador do Google Maps.');
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

// 🚀 INICIALIZAÇÃO DO SERVIDOR EXPRESS
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ⚙️ CONFIGURAÇÕES DO SISTEMA
const NUMERO_ADMIN = process.env.NUMERO_ADMIN;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN; 
const WASENDER_TOKEN = process.env.WASENDER_TOKEN; 
const URL_DO_SEU_SITE = 'https://mmmelhormarmita.onrender.com';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; 
const ORIGEM_COZINHA = process.env.ORIGEM_COZINHA;

// ⏱️ GESTÃO DE TIMERS E PAGAMENTO
const TEMPO_INATIVO = 10 * 60 * 1000; 
const timersClientes = {};
const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN, options: { timeout: 5000 } });

// 🗺️ CÁLCULO DE FRETE AUTOMÁTICO
async function calcularFreteGoogle(cepDestino) {
  try {
    if (CONTROLE_MAPS.consultas >= CONTROLE_MAPS.LIMITE_DIARIO) {
        return { erro: true, msg: "⚠️ O sistema automático de frete está indisponível. Envie seu endereço por escrito." };
    }

    const cepLimpo = String(cepDestino).replace(/\D/g, '');
    if (cepLimpo.length !== 8) return { erro: true, msg: "⚠️ CEP inválido. Digite os 8 números." };

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGEM_COZINHA)}&destinations=cep+${cepLimpo}&mode=driving&language=pt-BR&key=${GOOGLE_API_KEY}`;
    
    // 🔍 LOG DE DEBUG: Para você ver a URL no terminal se precisar testar no navegador
    console.log(`🔗 Consultando Google: ${url}`);
    
    const response = await axios.get(url);
    const data = response.data;

    // Verifica se a chave ou a conta do Google tem algum problema
    if (data.status !== 'OK') {
        console.error("❌ Erro na API do Google:", data.error_message || data.status);
        return { erro: true, msg: `❌ Erro na localização (${data.status}). Verifique o CEP.` };
    }

    const elemento = data.rows[0].elements[0];
    
    // Verifica se o CEP existe mas não tem rota de carro até ele
    if (elemento.status === 'ZERO_RESULTS' || elemento.status === 'NOT_FOUND') {
        console.warn(`⚠️ CEP ${cepLimpo} localizado, mas sem rota encontrada.`);
        return { erro: true, msg: "❌ Não encontramos rota para este CEP. Verifique se ele é da nossa região." };
    }

    if (elemento.status !== 'OK') {
        console.error("❌ Status do elemento Google:", elemento.status);
        return { erro: true, msg: "🚫 Erro ao calcular distância. Tente novamente." };
    }

    // Só conta a consulta se deu tudo certo
    CONTROLE_MAPS.consultas++;

    const distanciaKm = elemento.distance.value / 1000;
    const enderecoGoogle = data.destination_addresses[0]; 

    console.log(`📏 Sucesso! Distância: ${distanciaKm.toFixed(2)}km para ${enderecoGoogle}`);

    // Ajuste de valores (Corrigi o de 2km para R$ 5,00)
    if (distanciaKm <= 2.0) return { valor: 5.00, texto: "R$ 5,00", endereco: enderecoGoogle };
    if (distanciaKm <= 5.0) return { valor: 8.00, texto: "R$ 8,00", endereco: enderecoGoogle };
    if (distanciaKm <= 10.0) return { valor: 15.00, texto: "R$ 15,00", endereco: enderecoGoogle };
    if (distanciaKm <= 20.0) return { valor: 20.00, texto: "R$ 20,00", endereco: enderecoGoogle };

    return { erro: true, msg: "🚫 Endereço fora da área de entrega (limite 20km)." };
  } catch (error) {
    console.error("⚠️ Erro Crítico no Frete:", error.message);
    return { erro: true, msg: "⚠️ Erro técnico no cálculo de frete." };
  }
}
// 💰 PROCESSAMENTO DE PAGAMENTOS
async function gerarPix(valor, clienteNome, clienteTelefone) {
  try {
    const payment = new Payment(client);
    const body = {
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: `Marmita - ${clienteNome}`, 
      payment_method_id: 'pix',
      notification_url: `${URL_DO_SEU_SITE}/webhook`, 
      external_reference: String(clienteTelefone).replace(/\D/g, ''), 
      payer: { email: `vendas.${Date.now()}@marmitaria.com` }
    };

    const response = await payment.create({ body });
    return { 
      copiaCola: response.point_of_interaction.transaction_data.qr_code, 
      idPagamento: response.id 
    };
  } catch (error) { 
    return null; 
  }
}

async function gerarLinkPagamento(itens, frete, clienteTelefone) {
  try {
    const preference = new Preference(client);
    
    const items = itens.map(item => ({
      title: item.prato,
      quantity: Number(item.quantidade),
      unit_price: Number(item.quantidade >= 5 ? 0.01 : 19.99),
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
        external_reference: String(clienteTelefone),
        back_urls: {
         success: "https://wa.me/5551985013496?text=Oi!%20Já%20concluí%20meu%20pagamento%20pelo%20cartão!%20🍱",
  failure: "https://wa.me/5551985013496?text=Ops...%20Tive%20um%20problema%20no%20pagamento.%20Pode%20me%20ajudar?",
  pending: "https://wa.me/5551985013496"
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

// 🖨️ AUXILIARES DE FORMATAÇÃO
function pad(str, length) { return (str + '                          ').substring(0, length); }
function padL(str, length) { return ('                          ' + str).slice(-length); }

// 🔔 RECEBIMENTO DE PEDIDOS (WEBHOOK)
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
              // A CHAVE DO PROBLEMA: Só confirma o pagamento aqui!
              memoria.pagamentoConfirmado = true;
              memoria.estado = 'FINALIZADO';
              
              let resumoItens = "";     
              let resumoItensAdmin = ""; 
              let subtotalVal = 0;

              memoria.pedido.forEach(item => {
                let nomeExibicao = item.prato;

                if (item.arroz === 'Integral') {
                    nomeExibicao = nomeExibicao.replace(/arroz/gi, 'Arroz Integral');
                }
                if (item.strogonoff === 'Light') {
                    nomeExibicao = nomeExibicao.replace(/strogonoff/gi, 'Strogonoff Light');
                }

                nomeExibicao = nomeExibicao.replace(/cnoura/gi, 'cenoura');
                nomeExibicao = nomeExibicao.charAt(0).toUpperCase() + nomeExibicao.slice(1);

                const precoItem = item.quantidade >= 5 ? 0.01 : 19.99;
                const totalItem = item.quantidade * precoItem;
                subtotalVal += totalItem;
                const totalStr = 'R$ ' + totalItem.toFixed(2).replace('.', ',');

                let partes = nomeExibicao.split(',');
                let linha1 = (partes[0] || '').trim();
                let linha2 = (partes[1] || '').trim();
                let linha3 = (partes[2] || '').trim();

                resumoItens += `${item.quantidade}x ${linha1}\n`;
                
                if (linha2) {
                    resumoItens += `   ${linha2}\n`;
                }
                
                if (linha3) {
                    let l3 = linha3.toLowerCase().startsWith('e ') ? linha3 : `e ${linha3}`;
                    resumoItens += `   ${l3}\n`;
                }

                resumoItens += `${totalStr.padStart(32)}\n\n`;
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
ITEM                     QTD    VALOR
--------------------------------------
${resumoItens}
--------------------------------------
SUBTOTAL:                   R$ ${subtotalVal.toFixed(2)}
FRETE:                      R$ ${memoria.valorFrete.toFixed(2)}
--------------------------------------
TOTAL PAGO:                 R$ ${valorPago.toFixed(2)}
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
      } catch (error) { 
        console.error("Erro Webhook:", error); 
      }
  }
  res.sendStatus(200);
});

// 🧠 LÓGICA DE INTERAÇÃO
function menuPrincipal(nomeCliente) {
  const nomeDisplay = nomeCliente ? ` ${nomeCliente}` : '';
  return `🔻 *Menu Principal para${nomeDisplay}*\n\n1️⃣  Ver Cardápio do Dia\n2️⃣  Fazer Pedido\n3️⃣  Elogios ou Reclamações\n\n_Digite o número da opção desejada._`;
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
    return []; 
  }
}

// ⏱️ CONTROLE DE INATIVIDADE
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

// 📲 INTEGRAÇÃO WHATSAPP (API)
async function enviarMensagemWA(numero, texto) {
  const numeroLimpo = String(numero).replace(/\D/g, '');
  try {
    await axios.post('https://www.wasenderapi.com/api/send-message', 
      { to: numeroLimpo, text: texto }, 
      { headers: { Authorization: `Bearer ${WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) { 
    console.error(`Erro envio msg:`, err.message); 
  }
}

// 🚀 ROTAS DE EXECUÇÃO
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
    
    // 🛡️ FILTRO DE SEGURANÇA
    if (remoteJid.includes('status') || remoteJid.includes('@g.us') || fromMe === true) {
        return res.status(200).json({ ok: true });
    }

    let numeroRaw = dadosMensagem.key?.cleanedSenderPn || dadosMensagem.key?.senderPn || remoteJid;
    const numero = String(numeroRaw).split('@')[0].replace(/\D/g, '');
    const texto = dadosMensagem.messageBody || dadosMensagem.message?.conversation || dadosMensagem.message?.extendedTextMessage?.text || "";

    if (!texto || !numero) return res.status(200).json({ ok: true });
    const mensagem = texto.trim().toLowerCase();
    
    // ⏰ CONTROLE DE HORÁRIO
    const dataBrasil = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const diaSemana = dataBrasil.getDay(); 
    const horaAtual = dataBrasil.getHours();

    const isFinalDeSemana = (diaSemana === 0 || diaSemana === 6);
    const isForaDoHorario = (horaAtual < 8 || horaAtual >= 18);

    if (isFinalDeSemana || isForaDoHorario) {
        if (numero !== NUMERO_ADMIN) {
            const avisoFechado = `🍱 *Olá! A Melhor Marmita agradece seu contato.*\n\n` +
                                 `🚫 No momento estamos *FECHADOS*.\n\n` +
                                 `⏰ *Nosso horário de atendimento:*\n` +
                                 `🗓️ Segunda a Sexta\n` +
                                 `🕒 Das 08h às 18h\n\n` +
                                 `Sua mensagem foi recebida e responderemos assim que iniciarmos nosso expediente! 👋`;

            await enviarMensagemWA(numero, avisoFechado);
            return res.status(200).json({ ok: true });
        }
    }

    // 🧠 GESTÃO DE MEMÓRIA E COMANDO GLOBAL
    const memoria = estadoClientes.getEstado(numero);
    iniciarTimerInatividade(numero);
    memoria.ultimoContato = Date.now();

    // 🚩 LÓGICA DE CANCELAMENTO (Resolve o bug do "Já Pago")
    if (mensagem === 'cancelar' || mensagem === 'desistir') {
        if (memoria.pagamentoConfirmado === true) {
            await enviarMensagemWA(numero, "❌ *Pedido em produção!*\nSeu pagamento já foi confirmado e o pedido enviado para a cozinha. Para alterações, fale com o suporte.");
        } else {
            estadoClientes.resetarCliente(numero);
            await enviarMensagemWA(numero, "✅ *Pedido cancelado com sucesso!*\nSua lista foi limpa. Se quiser começar de novo, basta digitar 'Oi'.");
        }
        return res.status(200).json({ ok: true });
    }

// ⚙️ PROCESSAMENTO DO CLIENTE
const cliente = estadoClientes.getEstado(numero);
cliente.ultimoContato = Date.now();
iniciarTimerInatividade(numero);

console.log(`📩 Cliente ${numero}: "${mensagem}"`);

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

// 📋 NAVEGAÇÃO DO MENU
if (cliente.estado === 'MENU') {
  if (mensagem === '1') { 
    const dados = carregarMenu();
    if(dados.length === 0) { 
        await enviarMensagemWA(numero, "⚠️ Cardápio indisponível no momento."); 
        return res.status(200).json({ok:true}); 
    }

    let cardapio = `🍱 *Cardápio do Dia para ${cliente.nome}*\n🔥 *PROMOÇÃO:* Acima de 5 unid o preço *CAI* de ~~19,99~~ para *R$ 17,49/un*!\n\n`;
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

  if (mensagem === '3') { 
    cliente.estado = 'ELOGIOS';
    await enviarMensagemWA(numero, `💬 *Espaço do Cliente*\n${cliente.nome}, escreva abaixo seu elogio, sugestão ou reclamação:\n\n(Digite 0 para voltar)`); 
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
  
  // Adiciona o item ao carrinho (quantidade começa em 0 para ser definida no próximo passo)
  cliente.pedido.push({ prato: prato.PRATO, valor: 19.99, arroz: null, strogonoff: null, quantidade: 0 });
  
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

// 🌾 VARIAÇÕES (ARROZ)
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
    
    // Regra de Negócio: Promoção acima de 5 marmitas
    let valorUnitario = totalMarmitas >= 5 ? 0.01 : 19.99; // Mantendo 0.01 para seus testes
    let textoPreco = totalMarmitas >= 5 ? "R$ 17,49 (Promoção)" : "R$ 19,99/un";
    let msgPromo = totalMarmitas >= 5 ? "🎉 *PROMOÇÃO APLICADA!* (Acima de 5 un)\n" : "";

    const subtotal = (totalMarmitas * valorUnitario).toFixed(2);
    cliente.estado = 'AGUARDANDO_CEP'; 

    let resposta = `📝 *Resumo do Pedido de ${cliente.nome}:*\n\n${msgPromo}Marmitas: ${totalMarmitas}\nValor: ${textoPreco}\n💰 *Subtotal: R$ ${subtotal.replace('.', ',')}* (Sem frete)\n------------------------------\n\n📍 Para calcular a entrega, digite seu *CEP* (apenas números):`;
    
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

// 📍 CÁLCULO DE FRETE (GOOGLE MAPS)
if (cliente.estado === 'AGUARDANDO_CEP') {
    const cepLimpo = mensagem.replace(/\D/g, '');
    
    if (cepLimpo.length !== 8) {
        await enviarMensagemWA(numero, "⚠️ CEP inválido. Por favor, digite os 8 números do seu CEP.");
        return res.status(200).json({ ok: true });
    }

    await enviarMensagemWA(numero, "🔍 Calculando rota no Google Maps... Só um instante.");
    const frete = await calcularFreteGoogle(cepLimpo);
    
    if (frete.erro) {
        await enviarMensagemWA(numero, frete.msg);
        return res.status(200).json({ ok: true });
    }

    cliente.endereco = `CEP: ${cepLimpo} (${frete.endereco})`; 
    
    const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
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
    
    let resumoPgto = `📝 *Fechamento da Conta:*\n👤 Cliente: ${cliente.nome}\n💰 *TOTAL FINAL: R$ ${cliente.totalFinal.toFixed(2).replace('.', ',')}*\n\n🚚 *Entrega prevista: de 3 a 5 dias*\n\n💳 *Como deseja pagar?*\n1️⃣ PIX (Aprovação Imediata)\n2️⃣ Cartão de Crédito/Débito (Link)\n\n0️⃣ Voltar para o CEP`;
    
    cliente.ultimaMensagem = resumoPgto;
    await enviarMensagemWA(numero, resumoPgto);
    return res.status(200).json({ ok: true });
}

// 💳 GESTÃO DE PAGAMENTO (PERMITE MUDAR)
if (cliente.estado === 'ESCOLHENDO_PAGAMENTO' || cliente.estado === 'AGUARDANDO_PAGAMENTO') {
  
  // Opção para MUDAR a forma de pagamento ou voltar
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
         cliente.estado = 'AGUARDANDO_PAGAMENTO'; // Fica aguardando o webhook
     } else {
         await enviarMensagemWA(numero, "⚠️ Ocorreu uma instabilidade ao gerar o PIX. Tente novamente em instantes.");
     }
  } 
  else if (mensagem === '2' || mensagem.includes('cartao') || mensagem.includes('cartão')) {
     await enviarMensagemWA(numero, "💳 *Gerando link de pagamento seguro...*");
     const link = await gerarLinkPagamento(cliente.pedido, cliente.valorFrete, numero);
     
     if (link) {
         await enviarMensagemWA(numero, `✅ *Link gerado! Clique abaixo para pagar:*\n\n${link}\n\n_(Se quiser mudar para PIX, digite *0*)_`);
         cliente.estado = 'AGUARDANDO_PAGAMENTO'; // Fica aguardando o webhook
     } else {
         await enviarMensagemWA(numero, "⚠️ Não conseguimos gerar o link de cartão. Tente a opção PIX.");
     }
  }
  else if (cliente.estado === 'ESCOLHENDO_PAGAMENTO') {
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
  }
  return res.status(200).json({ ok: true });
}

// 🏁 STATUS: PEDIDO PAGO E FINALIZADO
if (cliente.estado === 'FINALIZADO') {
   if (mensagem === 'menu' || mensagem === '0') {
       estadoClientes.resetarCliente(numero);
       await enviarMensagemWA(numero, menuPrincipal());
       return res.status(200).json({ ok: true });
   }
   await enviarMensagemWA(numero, `👋 Olá, ${cliente.nome}! Seu pedido já está na nossa lista de produção.\n\nPara iniciar um *novo pedido*, basta digitar *MENU*.`);
   return res.status(200).json({ ok: true });
}

// 💬 FEEDBACK DO CLIENTE
if (cliente.estado === 'ELOGIOS') {
  console.log(`[FEEDBACK] Cliente ${numero}: ${texto}`);
  cliente.estado = 'MENU';
  await enviarMensagemWA(numero, `✅ Muito obrigado! Seu feedback foi registrado. Se necessário, um atende dará retorno em breve. \n\n` + menuPrincipal(cliente.nome));
  return res.status(200).json({ ok: true });
}

// 🔄 TRATAMENTO GLOBAL E FINALIZAÇÃO
    await enviarMensagemWA(numero, `👋 Olá! Bem-vindo de volta, ${cliente.nome || 'Visitante'}!\n\n` + menuPrincipal(cliente.nome));
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('❌ [ERRO CRÍTICO]:', error.message);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.listen(PORT, () => { 
  console.log(`🚀 Servidor "Melhor Marmita" rodando na porta ${PORT}`); 
});
