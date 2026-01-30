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
// ⚙️ ÁREA DE CONFIGURAÇÃO (PREENCHA AQUI!)
// ==============================================================================

const NUMERO_ADMIN = '5551984050946'; 

// 1. SEU TOKEN DO MERCADO PAGO
const MP_ACCESS_TOKEN = 'APP_USR-SEU-TOKEN-GIGANTE-AQUI'; 

// 2. SEU TOKEN DO WASENDER
const WASENDER_TOKEN = process.env.WASENDER_TOKEN || 'SUA_CHAVE_WASENDER_AQUI'; 

// 3. SEU LINK DO RENDER (SEM BARRA NO FINAL)
const URL_DO_SEU_SITE = 'https://SEU-APP.onrender.com'; 

// ==============================================================================

const TEMPO_INATIVO = 10 * 60 * 1000; 
const timersClientes = {};

const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN, options: { timeout: 5000 } });

// ==============================================================================
// 🚚 INTELIGÊNCIA DE FRETE (SUPER EXPANDIDA)
// ==============================================================================

function calcularFrete(textoEndereco) {
  // Limpeza: remove acentos, deixa minúsculo e remove caracteres especiais
  const endereco = textoEndereco.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "");
  
  const contem = (lista) => lista.some(termo => endereco.includes(termo));

  // ---------------------------------------------------------------------------
  // 🚫 ZONA BLOQUEADA (Longe demais / Fora de mão)
  // ---------------------------------------------------------------------------
  const zonaBloqueada = [
      // Zona Sul Profunda
      'belem novo', 'lami', 'ponta grossa', 'chapeu do sol', 'hipica', 'aberta dos morros', 
      'campo novo', 'belem velho', 'cascata', 'serraria', 'guaruja', 'espirito santo', 
      'ipanema', 'tristeza', 'cristal', 'cavalhada', 'nonoai', 'teresopolis', 'gloria', 
      'vila nova', 'vl nova',
      
      // Zona Norte Profunda / Industrial
      'sarandi', 'rubem berta', 'humaita', 'navegantes', 'farrapos', 'sao geraldo', 'anchieta',
      'passo d areia', 'passo da areia', 'cristo redentor', 'lindoia', 'sao sebastiao', 
      'jardim itu', 'jardim planalto', 'itu sabara',
      
      // Centro (Estacionamento difícil)
      'centro historico', 'centro', 'floresta', 'independencia', 'bom fim', 'bonfim',
      
      // Cidades Vizinhas
      'viamao', 'alvorada', 'canoas', 'cachoeirinha', 'gravatai', 'guaiba', 'eldorado'
  ];

  if (contem(zonaBloqueada) && !endereco.includes('restinga')) {
      return { erro: true, msg: "Desculpe mas infelizmente a Melhor Marmita, ainda não atende este bairro." };
  }

  // ---------------------------------------------------------------------------
  // 🟢 GRUPO 1: SUPER LOCAL - R$ 5,00
  // (Lomba "Raiz" e vizinhos diretos)
  // ---------------------------------------------------------------------------
  const zonaSuperLocal = [
      // Lomba Genérica
      'lomba do pinheiro', 'l pinheiro', 'l. pinheiro', 'lomba', 'pinheiro',
      
      // São Pedro
      'sao pedro', 's pedro', 's. pedro', 'vl sao pedro', 'vila sao pedro', 'sao. pedro',
      
      // Vilela
      'vilela', 'vilella', 'villela', 'vl vilela', 'parada 6', 'pda 6', 'parada 7', 'pda 7',
      
      // Bonsucesso
      'bonsucesso', 'b sucesso', 'b. sucesso', 'bom sucesso', 'bonsuceso', 
      'bonçucesso', 'bomçucesso', 'bonsuseço', 'bomsucesso', 'parada 5', 'pda 5',
      
      // Panorama
      'panorama', 'panorana', 'pamorana', 'pamorama', 'panaroma', 'parada 16', 'pda 16',
      
      // Vila Mapa
      'mapa', 'vila mapa', 'v mapa', 'v. mapa', 'vl mapa', 'parada 2', 'pda 2', 'parada 3', 'pda 3'
  ];
  if (contem(zonaSuperLocal)) return { valor: 5.00, texto: "R$ 5,00" };

  // ---------------------------------------------------------------------------
  // 🟡 GRUPO 2: VIZINHO - R$ 8,00
  // (Pontas da Lomba ou saída imediata)
  // ---------------------------------------------------------------------------
  const zonaVizinha = [
      // Quinta do Portal
      'quinta do portal', 'q portal', 'q. portal', 'q do portal', 'portal', 'parada 19', 'pda 19',
      
      // Agronomia
      'agronomia', 'agro', 'campus', 'ufrgs', 'unipampa'
  ];
  if (contem(zonaVizinha)) return { valor: 8.00, texto: "R$ 8,00" };

  // ---------------------------------------------------------------------------
  // 🔵 GRUPO 3: MÉDIA/CIDADE - R$ 15,00
  // (Rota Bento/Ipiranga e Restinga)
  // ---------------------------------------------------------------------------
  const zonaMedia = [
      'restinga', 'rest', // Você confirmou que atende
      'jardim carvalho', 'jd carvalho', 'carvalho',
      'jardim do salso', 'jd salso', 'salso',
      'partenon', 'partenom', 'partnon',
      'bento', 'av bento', 
      'sao jose', 'sao. jose', 's jose', 's. jose',
      'jardim botanico', 'jd botanico', 'botanico', 
      'santana', 'satana',
      'ipiranga', 'av ipiranga',
      'intercap', 
      'azenha', 
      'santo antonio', 'sto antonio',
      'vila jardim', 'vl jardim', 'bom jesus'
  ];
  if (contem(zonaMedia)) return { valor: 15.00, texto: "R$ 15,00" };

  // ---------------------------------------------------------------------------
  // 🟣 GRUPO 4: NOBRE - R$ 20,00
  // (Até 18km - Ticket alto)
  // ---------------------------------------------------------------------------
  const zonaNobre = [
      'bela vista', 'bella vista', 
      'moinhos de vento', 'moinhos', 
      'mont serrat', 'mon serrat', 'monserrat', 
      'auxiliadora', 
      'rio branco', 
      'petropolis', 
      'chacara das pedras', 'chacaras', 
      'tres figueiras', '3 figueiras', 
      'boa vista', 
      'higienopolis',
      'menino deus', 
      'cidade baixa', 'cb',
      'santa cecilia', 'sta cecilia', 
      'medianeira'
  ];
  if (contem(zonaNobre)) return { valor: 20.00, texto: "R$ 20,00" };

  // ---------------------------------------------------------------------------
  // 🔒 TRAVA DE SEGURANÇA (Retorna NULL se não achou nada conhecido)
  // ---------------------------------------------------------------------------
  return null; 
}

// ==============================================================================
// 💰 FUNÇÕES DE PAGAMENTO (V10.0 - Valores Reais)
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
      // PREÇO REAL APLICADO AQUI (PRODUÇÃO)
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
         await enviarMensagemWA(NUMERO_ADMIN, `🔔 *NOVO PAGAMENTO (V10)*\nCliente: ${numeroCliente}\nValor: R$ ${valorPago.toFixed(2)}`);
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

app.get('/', (req, res) => { res.send('🤖 Bot V10.0 (FINAL PRODUCTION) ON 🚀'); });

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
      // PREÇO BASE VISUAL (O real é calculado no final)
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
        let lista = `🍽️ *Escolha mais um prato:*\n(Lembre-se: 5+ unidades sai por R$ 17,49/cada)\n\n`;
        dados.forEach((item, i) => { lista += `${i + 1}️⃣  ${item.PRATO}\n`; });
        lista += `\n0️⃣ Cancelar tudo`;
        cliente.opcoesPrato = dados;
        await enviarMensagemWA(numero, lista);
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2' || mensagem.includes('nao') || mensagem.includes('não')) {
        const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
        
        // --- CÁLCULO DE VALOR REAL ---
        let valorUnitario = 19.99;
        let textoPreco = "R$ 19,99/un";
        let msgPromo = "";

        if (totalMarmitas >= 5) {
          valorUnitario = 17.49;
          textoPreco = "~R$ 19,99~ por *R$ 17,49* a unidade";
          msgPromo = "🎉 *PARABÉNS! PROMOÇÃO APLICADA!* (Acima de 5 un)\n";
        }
        // -----------------------------

        const subtotal = (totalMarmitas * valorUnitario).toFixed(2);
        
        cliente.estado = 'AGUARDANDO_ENDERECO';
        resposta = `${msgPromo}🥡 *Resumo do Pedido:*\nMarmitas: ${totalMarmitas}\nValor: ${textoPreco}\n💰 *Subtotal: R$ ${subtotal}* (Sem frete)\n------------------------------\n\n📍 Agora, digite seu *ENDEREÇO COMPLETO* (Rua, Número e Bairro):`;
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

    // 6. FRETE E FECHAMENTO (COM TRAVA DE SEGURANÇA 🔒)
    if (cliente.estado === 'AGUARDANDO_ENDERECO') {
      
      const frete = calcularFrete(texto);
      
      // CASO 1: É uma região bloqueada (Retorna texto específico)
      if (frete && frete.erro) { 
          await enviarMensagemWA(numero, frete.msg); 
          return res.status(200).json({ ok: true }); 
      }

      // CASO 2: NÃO ENTENDEU O BAIRRO (Retorna texto específico)
      if (!frete) {
          await enviarMensagemWA(numero, `Desculpe, mas infelizmente não reconheci o seu bairro, pode digitar novamente seu endereço?\n\n(Dica: Tente escrever o nome do bairro de forma simples, ex: 'São Pedro', 'Lomba', 'Bonsucesso')`);
          return res.status(200).json({ ok: true });
      }

      // CASO 3: DEU TUDO CERTO (Achou o bairro) ✅
      if (!cliente.endereco) cliente.endereco = texto; 
      else cliente.endereco += ` - ${texto}`; 

      const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
      const valorUnitario = totalMarmitas >= 5 ? 17.49 : 19.99;
      const subtotalMarmitas = totalMarmitas * valorUnitario;

      const totalComFrete = subtotalMarmitas + frete.valor;
      const textoFrete = frete.texto;
      cliente.valorFrete = frete.valor; 

      cliente.totalFinal = totalComFrete;
      cliente.estado = 'ESCOLHENDO_PAGAMENTO';
      
      resposta = `✅ *Bairro Identificado!*\n\n📝 *Fechamento da Conta:*\nSubtotal Comida: R$ ${subtotalMarmitas.toFixed(2)}\nFrete: ${textoFrete}\n💰 *TOTAL: R$ ${totalComFrete.toFixed(2)}*\n\n🚚 *Entrega prevista: de 3 a 5 dias* (Sob encomenda)\n\n💳 *Como deseja pagar?*\n1️⃣ PIX (Aprovação Imediata)\n2️⃣ Cartão de Crédito/Débito (Link)`;
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
