const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const axios = require('axios');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

// ==============================================================================
// 🧠 MEMÓRIA DO ROBÔ (Gerenciamento de Estado)
// ==============================================================================
const clientes = {};

const estadoClientes = {
  getEstado: (numero) => {
    if (!clientes[numero]) {
      clientes[numero] = { 
        estado: 'INICIAL', 
        pedido: [], 
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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ==============================================================================
// ⚙️ ÁREA DE CONFIGURAÇÃO (SEUS DADOS REAIS MANTIDOS ✅)
// ==============================================================================

const NUMERO_ADMIN = '5551984050946'; 

// SEU TOKEN DO MERCADO PAGO (Original do arquivo)
const MP_ACCESS_TOKEN = 'APP_USR-3976540518966482-012110-64c2873d7929c168846b389d4f6c311e-281673709'; 

// SEU TOKEN DO WASENDER (Original do arquivo)
const WASENDER_TOKEN = process.env.WASENDER_TOKEN || '399f73920f6d3300e39fc9f8f0e34eb40510a8a14847e288580d5d10e40cdae4'; 

// SEU LINK DO RENDER (Original do arquivo)
const URL_DO_SEU_SITE = 'https://mmmelhormarmita.onrender.com'; 

// 🔑 SUA CHAVE DO GOOGLE MAPS (Inserida aqui!)
const GOOGLE_API_KEY = 'AIzaSyAc6xZjyQRgBS52UfOKc93PthX9HlMMqHw'; 

// SEU ENDEREÇO DE ORIGEM (COZINHA) - Baseado na Parada 11
const ORIGEM_COZINHA = 'Rua Guaíba, 10 - CEP 91560-640, Lomba do Pinheiro, Porto Alegre, RS';

// ==============================================================================

const TEMPO_INATIVO = 10 * 60 * 1000; 
const timersClientes = {};

const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN, options: { timeout: 5000 } });

// ==============================================================================
// 🗺️ INTELIGÊNCIA DE FRETE (GOOGLE MAPS V11)
// ==============================================================================

async function calcularFreteGoogle(cepDestino) {
  try {
    // Limpa o CEP (deixa só números)
    const cepLimpo = String(cepDestino).replace(/\D/g, '');

    // Validação básica de CEP (8 dígitos)
    if (cepLimpo.length !== 8) {
      return { erro: true, msg: "⚠️ CEP inválido. Por favor, digite apenas os 8 números do CEP (Ex: 91550100)." };
    }

    console.log(`🗺️ Calculando rota: ${ORIGEM_COZINHA} -> CEP ${cepLimpo}`);

    // Chama o Google Distance Matrix
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGEM_COZINHA)}&destinations=cep+${cepLimpo}&mode=driving&language=pt-BR&key=${GOOGLE_API_KEY}`;
    
    const response = await axios.get(url);
    const data = response.data;

    if (data.status !== 'OK' || !data.rows[0].elements[0].distance) {
      console.error('Erro Google:', JSON.stringify(data));
      return { erro: true, msg: "❌ Não consegui localizar este CEP. Tente novamente." };
    }

    const elemento = data.rows[0].elements[0];
    
    if (elemento.status !== 'OK') {
       return { erro: true, msg: "🚫 Não encontramos rota para este CEP. Verifique se digitou corretamente." };
    }

    const distanciaMetros = elemento.distance.value;
    const distanciaKm = distanciaMetros / 1000;
    const enderecoGoogle = data.destination_addresses[0]; // Endereço que o Google achou

    console.log(`📏 Distância encontrada: ${distanciaKm.toFixed(2)} km`);

    // =======================================================================
    // 💲 TABELA DE PREÇOS POR KM
    // =======================================================================
    
    // Até 3km -> R$ 5,00 (Local / Vizinhos)
    if (distanciaKm <= 3.0) {
      return { valor: 5.00, texto: "R$ 5,00", endereco: enderecoGoogle, km: distanciaKm };
    }

    // De 3km até 6km -> R$ 8,00 (Agronomia, Pontas da Lomba)
    if (distanciaKm <= 6.0) {
      return { valor: 8.00, texto: "R$ 8,00", endereco: enderecoGoogle, km: distanciaKm };
    }

    // De 6km até 15km -> R$ 15,00 (Partenon, Restinga, São José)
    if (distanciaKm <= 15.0) {
      return { valor: 15.00, texto: "R$ 15,00", endereco: enderecoGoogle, km: distanciaKm };
    }

    // De 15km até 20km -> R$ 20,00 (Zona Nobre / Longe)
    if (distanciaKm <= 20.0) {
      return { valor: 20.00, texto: "R$ 20,00", endereco: enderecoGoogle, km: distanciaKm };
    }

    // Acima de 20km -> BLOQUEADO 🚫
    return { erro: true, msg: "🚫 Desculpe, mas este endereço fica muito longe da nossa área de entrega no momento." };

  } catch (error) {
    console.error('Erro fatal no Maps:', error);
    return { erro: true, msg: "⚠️ Erro ao calcular frete. Tente novamente mais tarde." };
  }
}

// ==============================================================================
// 💰 FUNÇÕES DE PAGAMENTO (ORIGINAIS MANTIDAS)
// ==============================================================================

async function gerarPix(valor, clienteNome, clienteTelefone) {
  try {
    const payment = new Payment(client);
    const emailAleatorio = `comprador.marmita.${Date.now()}@gmail.com`;
    const telefoneLimpo = String(clienteTelefone).replace(/\D/g, '');

    const body = {
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: 'Pedido Marmita Delivery',
      payment_method_id: 'pix',
      notification_url: `${URL_DO_SEU_SITE}/webhook`, 
      external_reference: telefoneLimpo, 
      payer: {
        email: emailAleatorio, 
        first_name: 'Comprador',
        last_name: 'Marmita' 
      }
    };

    const response = await payment.create({ body });
    return {
      copiaCola: response.point_of_interaction.transaction_data.qr_code,
      idPagamento: response.id
    };
  } catch (error) {
    console.error('❌ ERRO PIX:', JSON.stringify(error, null, 2));
    return null;
  }
}

async function gerarLinkPagamento(itens, frete, clienteTelefone) {
  try {
    const preference = new Preference(client);
    const emailAleatorio = `comprador.marmita.${Date.now()}@gmail.com`;
    const telefoneLimpo = String(clienteTelefone).replace(/\D/g, '');

    const itemsPreference = itens.map(item => ({
      title: `${item.prato} (Delivery)`,
      quantity: parseInt(item.quantidade),
      currency_id: 'BRL',
      unit_price: item.quantidade >= 5 ? 17.49 : 19.99 
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
      binary_mode: true, 
      payment_methods: {
        excluded_payment_types: [{ id: "ticket" }], 
        installments: 1
      },
      notification_url: `${URL_DO_SEU_SITE}/webhook`,
      external_reference: telefoneLimpo,
      payer: {
          email: emailAleatorio,
          name: "Comprador",
          surname: "Marmita"
      },
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
    console.error('❌ ERRO LINK:', error);
    return null;
  }
}

// ==============================================================================
// 🔔 WEBHOOK
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
         
         console.log(`✅ Pagamento Aprovado! Cliente: ${numeroCliente}`);
         const comprovante = `🧾 *COMPROVANTE DE PAGAMENTO*\n✅ *Status:* APROVADO\n💰 *Valor:* R$ ${valorPago.toFixed(2)}\n\nSeu pedido foi confirmado e enviado para a cozinha! 👨‍🍳🔥\nEm breve entraremos em contato para avisar sobre a entrega.`;

         await enviarMensagemWA(numeroCliente, comprovante);
         await enviarMensagemWA(NUMERO_ADMIN, `🔔 *NOVO PAGAMENTO (Google Maps)*\nCliente: ${numeroCliente}\nValor: R$ ${valorPago.toFixed(2)}`);
       }
     } catch (error) {
       console.error("Erro Webhook:", error);
     }
  }
  res.status(200).send('OK');
});

// ==============================================================================
// 🧠 LÓGICA DO ROBÔ
// ==============================================================================

function saudacaoTexto() {
  return `👋 Olá! Seja muito bem-vindo(a) à *Melhor Marmita* 🍱\nComida caseira, saborosa e feita com carinho! 😋`;
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
// 🚀 ROTAS (LÓGICA PRINCIPAL)
// ==============================================================================

app.get('/', (req, res) => { res.send('🤖 Bot V11 (GOOGLE MAPS ATIVO) ON 🚀'); });

app.post('/mensagem', async (req, res) => {
  try {
    const body = req.body;
    if (body.event !== 'messages.received') return res.status(200).json({ ok: true });
    
    const dadosMensagem = body?.data?.messages;
    if (!dadosMensagem) return res.status(200).json({ ok: true });

    const remoteJid = dadosMensagem.key?.remoteJid || "";
    const fromMe = dadosMensagem.key?.fromMe;
    
    if (remoteJid.includes('status') || remoteJid.includes('@g.us') || fromMe === true) {
      return res.status(200).json({ ok: true });
    }

    let numeroRaw = dadosMensagem.key?.cleanedSenderPn || dadosMensagem.key?.senderPn || remoteJid;
    const numero = String(numeroRaw).split('@')[0].replace(/\D/g, '');
    const texto = dadosMensagem.messageBody || dadosMensagem.message?.conversation || dadosMensagem.message?.extendedTextMessage?.text || "";

    if (!texto || !numero) return res.status(200).json({ ok: true });
    const mensagem = texto.trim().toLowerCase();
    iniciarTimerInatividade(numero);
    
    const cliente = estadoClientes.getEstado(numero);
    cliente.ultimoContato = Date.now();
    let resposta = '';

    console.log(`📩 Cliente ${numero}: "${mensagem}"`);

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
      estadoClientes.resetarCliente(numero); 
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
        if(dados.length === 0) { await enviarMensagemWA(numero, "⚠️ Cardápio indisponível."); return res.status(200).json({ok:true}); }
        let cardapio = `🍱 *Cardápio do Dia*\n🔥 *PROMOÇÃO:* Acima de 5 unid = *R$ 17,49/un*!\n\n`;
        dados.forEach(item => { cardapio += `🔹 ${item.PRATO} – R$ ${item.VALOR}\n`; });
        cardapio += `\nPara fazer seu pedido, digite *2*.\nOu digite *0* para voltar.`;
        cliente.estado = 'VENDO_CARDAPIO';
        cliente.ultimaMensagem = cardapio; 
        await enviarMensagemWA(numero, cardapio);
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2') {
        const dados = carregarMenu();
        let lista = `🍽️ *Vamos montar seu pedido!*\n🔥 *PROMOÇÃO:* Acima de 5 unid = *R$ 17,49/un*\n\nDigite o NÚMERO do prato que deseja:\n\n`;
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
        await enviarMensagemWA(numero, `💬 *Espaço do Cliente*\nEscreva abaixo seu elogio, sugestão ou reclamação:\n\n(Digite 0 para voltar)`); 
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '0') { await enviarMensagemWA(numero, menuPrincipal()); return res.status(200).json({ ok: true }); }
      
      await enviarMensagemWA(numero, msgNaoEntendi(menuPrincipal()));
      return res.status(200).json({ ok: true });
    }

    // 4. LEITURA
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

    // 5. PEDIDO
    if (cliente.estado === 'ESCOLHENDO_PRATO') {
      if (mensagem === '0') { 
          estadoClientes.limparCarrinhoManterMenu(numero);
          await enviarMensagemWA(numero, menuPrincipal()); 
          return res.status(200).json({ ok: true }); 
      }
      
      const escolha = parseInt(mensagem);
      if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }
      
      const prato = cliente.opcoesPrato[escolha - 1];
      const nomePrato = prato.PRATO.toLowerCase();
      
      cliente.pedido.push({ prato: prato.PRATO, valor: 19.99, arroz: null, strogonoff: null, quantidade: 0 });
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
        resposta = `🔢 Digite a *quantidade* para ${prato.PRATO}:`;
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
      if (mensagem === '1' || mensagem.includes('tradicional')) itemAtual.strogonoff = 'Tradicional';
      else if (mensagem === '2' || mensagem.includes('light')) itemAtual.strogonoff = 'Light';
      else { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }
      cliente.estado = 'QUANTIDADE';
      resposta = `🔢 Digite a *quantidade*:`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'QUANTIDADE') {
      const qtd = parseInt(mensagem);
      if (isNaN(qtd) || qtd < 1) { await enviarMensagemWA(numero, "❌ Por favor, digite um número válido (ex: 1, 2, 3)."); return res.status(200).json({ ok: true }); }
      cliente.pedido[cliente.pedido.length - 1].quantidade = qtd;
      cliente.estado = 'ADICIONAR_OUTRO';
      resposta = `✅ *Adicionado!*\n\nDeseja pedir mais alguma coisa?\n\n1️⃣ Sim, escolher outro prato\n2️⃣ Não, fechar pedido`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }

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
        let valorUnitario = 19.99;
        let textoPreco = "R$ 19,99/un";
        let msgPromo = "";

        if (totalMarmitas >= 5) {
          valorUnitario = 17.49;
          textoPreco = "~R$ 19,99~ por *R$ 17,49* a unidade";
          msgPromo = "🎉 *PARABÉNS! PROMOÇÃO APLICADA!* (Acima de 5 un)\n";
        }

        const subtotal = (totalMarmitas * valorUnitario).toFixed(2);
        
        // MUDANÇA V11: Agora pede o CEP, não mais o bairro escrito
        cliente.estado = 'AGUARDANDO_CEP'; 
        resposta = `${msgPromo}🥡 *Resumo do Pedido:*\nMarmitas: ${totalMarmitas}\nValor: ${textoPreco}\n💰 *Subtotal: R$ ${subtotal}* (Sem frete)\n------------------------------\n\n📍 Para calcular a entrega, digite seu *CEP* (apenas números):`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      
      if (mensagem === '0') {
         estadoClientes.limparCarrinhoManterMenu(numero);
         await enviarMensagemWA(numero, menuPrincipal());
         return res.status(200).json({ ok: true });
      }
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
      return res.status(200).json({ ok: true });
    }

    // 6. CÁLCULO DE FRETE VIA GOOGLE MAPS (CEP) - NOVO!
    if (cliente.estado === 'AGUARDANDO_CEP') {
      
      await enviarMensagemWA(numero, "🔍 Calculando rota no Google Maps... Só um instante.");

      // CHAMA A FUNÇÃO NOVA
      const frete = await calcularFreteGoogle(texto);
      
      if (frete.erro) {
          await enviarMensagemWA(numero, frete.msg);
          // Mantém no estado CEP para ele tentar de novo
          return res.status(200).json({ ok: true });
      }

      // SUCESSO NO FRETE
      cliente.endereco = `CEP: ${texto} (${frete.endereco})`; 
      
      const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
      const valorUnitario = totalMarmitas >= 5 ? 17.49 : 19.99;
      const subtotalMarmitas = totalMarmitas * valorUnitario;

      const totalComFrete = subtotalMarmitas + frete.valor;
      const textoFrete = frete.texto;
      cliente.valorFrete = frete.valor; 

      cliente.totalFinal = totalComFrete;
      cliente.estado = 'CONFIRMANDO_ENDERECO_COMPLEMENTO';
      
      resposta = `✅ *Localizado!*\n📍 ${frete.endereco}\n📏 Distância: ${frete.km.toFixed(1)}km\n🚚 Frete: *${textoFrete}*\n\nPor favor, digite o *NÚMERO DA CASA* e *COMPLEMENTO* (Ex: Casa rosa, portão preto):`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'CONFIRMANDO_ENDERECO_COMPLEMENTO') {
        cliente.endereco += ` - Compl: ${texto}`;
        cliente.estado = 'ESCOLHENDO_PAGAMENTO';
        
        resposta = `📝 *Fechamento da Conta:*\n💰 *TOTAL FINAL: R$ ${cliente.totalFinal.toFixed(2)}*\n\n🚚 *Entrega prevista: de 3 a 5 dias* (Sob encomenda)\n\n💳 *Como deseja pagar?*\n1️⃣ PIX (Aprovação Imediata)\n2️⃣ Cartão de Crédito/Débito (Link)`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
        return res.status(200).json({ ok: true });
    }

    // 7. PAGAMENTO ONLINE
    if (cliente.estado === 'ESCOLHENDO_PAGAMENTO') {
      cliente.pagamento = texto; 

      if (mensagem === '1' || mensagem.includes('pix')) {
         await enviarMensagemWA(numero, "💠 *Gerando PIX Copia e Cola...* Aguarde um instante.");
         const dadosPix = await gerarPix(cliente.totalFinal, "Cliente Marmita", numero);
         
         if (dadosPix) {
             await enviarMensagemWA(numero, `Aqui está seu código PIX:`);
             await enviarMensagemWA(numero, dadosPix.copiaCola); 
             await enviarMensagemWA(numero, `✅ *Copie e cole no seu banco.*\nAssim que pagar, seu pedido será processado automaticamente!`);
         } else {
             await enviarMensagemWA(numero, "⚠️ O sistema do banco demorou. Tente novamente em alguns segundos.");
         }
      } 
      else if (mensagem === '2' || mensagem.includes('cartao') || mensagem.includes('cartão')) {
         await enviarMensagemWA(numero, "💳 *Gerando Link Seguro...* Aguarde.");
         const link = await gerarLinkPagamento(cliente.pedido, cliente.valorFrete, numero);
         
         if (link) {
             await enviarMensagemWA(numero, `✅ Clique abaixo para pagar com Cartão:\n\n${link}`);
         } else {
             await enviarMensagemWA(numero, "⚠️ Não consegui gerar o link agora. Tente novamente.");
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
      await enviarMensagemWA(numero, `✅ Obrigado! Sua mensagem foi registrada.\n\n` + menuPrincipal());
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
