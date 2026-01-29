const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const axios = require('axios');
// Importando SDK do Mercado Pago
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
const estadoClientes = require('./estadoClientes'); 

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações do Servidor
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ==============================================================================
// ⚙️ CONFIGURAÇÕES PESSOAIS (PREENCHA AQUI!)
// ==============================================================================

// 1. SEU NÚMERO (Para receber o "Dedo-Duro" dos pedidos)
const NUMERO_ADMIN = '5551984050946'; 

// 2. SEU TOKEN DO MERCADO PAGO (Produção)
// Copie do site developers.mercadopago.com.br -> Credenciais de Produção
const MP_ACCESS_TOKEN = 'APP_USR-3976540518966482-012110-64c2873d7929c168846b389d4f6c311e-281673709';

const WASENDER_TOKEN = process.env.WASENDER_TOKEN || 'SUA_CHAVE_WASENDER_AQUI'; 

// ==============================================================================

const TEMPO_INATIVO = 10 * 60 * 1000; // 10 minutos
const timersClientes = {};

// Inicializa o Mercado Pago
const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN, options: { timeout: 5000 } });


// ==============================================================================
// 💰 FUNÇÕES DE PAGAMENTO (MERCADO PAGO)
// ==============================================================================

// 1. GERAR PIX (Copia e Cola)
async function gerarPix(valor, clienteNome, clienteTelefone) {
  try {
    const payment = new Payment(client);
    
    // Cria e-mail fictício
    const emailCliente = `cliente${clienteTelefone}@marmita.com`;

    const body = {
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: 'Pedido Marmita Delivery',
      payment_method_id: 'pix',
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

// 2. GERAR LINK DE CARTÃO
async function gerarLinkPagamento(itens, frete) {
  try {
    const preference = new Preference(client);

    // Mapeia os itens do pedido
    const itemsPreference = itens.map(item => ({
      title: `${item.prato} (${item.arroz || ''} ${item.strogonoff || ''})`.trim(),
      quantity: item.quantidade,
      currency_id: 'BRL',
      unit_price: item.quantidade >= 5 ? 17.49 : 19.99 
    }));

    // Adiciona o Frete como item extra
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
      back_urls: {
        success: 'https://www.google.com', 
        failure: 'https://www.google.com',
        pending: 'https://www.google.com'
      },
      auto_return: 'approved'
    };

    const response = await preference.create({ body });
    return response.init_point; // Retorna o Link
  } catch (error) {
    console.error('Erro ao gerar Link:', error);
    return null;
  }
}

// ==============================================================================
// 🧠 LÓGICA DO NEGÓCIO
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
  } catch (error) {
    console.error("ERRO: menu.xlsx não encontrado.");
    return [];
  }
}

// Timer de Inatividade
function iniciarTimerInatividade(numero) {
  if (timersClientes[numero]) clearTimeout(timersClientes[numero]);

  timersClientes[numero] = setTimeout(async () => {
    const cliente = estadoClientes.getEstado(numero);
    if (cliente.estado !== 'INICIAL' && cliente.estado !== 'MENU') {
      console.log(`[TIMEOUT] Encerrando ${numero} por inatividade.`);
      estadoClientes.limparPedido(numero);
      const novoEstado = estadoClientes.getEstado(numero);
      novoEstado.recebeuSaudacao = false; 
      await enviarMensagemWA(numero, `💤 *Atendimento encerrado por falta de interação.*\nSeu pedido temporário foi limpo. Quando quiser retomar, é só dar um Oi! 👋`);
    }
    delete timersClientes[numero];
  }, TEMPO_INATIVO);
}

// Cálculo de Frete Inteligente 
function calcularFrete(textoEndereco) {
  const endereco = textoEndereco.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "");

  const contem = (lista) => lista.some(termo => endereco.includes(termo));

  // ZONA BLOQUEADA
  const zonaBloqueada = [
    'hipica', 'belem novo', 'lami', 'sarandi', 'humaita', 'navegantes', 
    'centro historico', 'rubem berta', 'ruben berta', 'centro', 'viamao', 'viamo', 
    'restinga nova', 'restinga velha', 'ponta grossa', 'belem velho', 'chapreu do sol', 'lageado'
  ];
  if (contem(zonaBloqueada) && !endereco.includes('restinga')) { 
    return { erro: true, msg: "🚫 Desculpe, ainda não realizamos entregas nesta região (muito distante da nossa cozinha)." };
  }

  // ZONA LOCAL (R$ 8,00)
  const zonaLocal = [
    'lomba do pinheiro', 'lomba pinheiro', 'lomba', 'agronomia', 
    'parada', 'pda', 'joao de oliveira', 'j oliveira', 
    'sao pedro', 's pedro', 'vilela', 'mapa', 'bonsucesso'
  ];
  if (contem(zonaLocal)) return { valor: 8.00, texto: "R$ 8,00" };

  // ZONA ALVO (R$ 20,00)
  const zonaAlvo = [
    'bela vista', 'belavista', 'b vista', 'moinhos', 'muinhos', 'moinho', 
    'mont serrat', 'montserrat', 'auxiliadora', 'rio branco', 'r branco', 
    'petropolis', 'petropoles', 'tres figueiras', '3 figueiras', 'chacara das pedras'
  ];
  if (contem(zonaAlvo)) return { valor: 20.00, texto: "R$ 20,00" };

  // ZONA INTERMEDIÁRIA (R$ 15,00)
  const zonaMedia = [
    'restinga', 'partenon', 'parthenon', 'bento', 'intercap', 
    'jardim botanico', 'j botanico', 'jd botanico', 'santana', 
    'sao jose', 's jose', 'santa maria', 'sta maria', 'ipiranga', 'jardim carvalho'
  ];
  if (contem(zonaMedia)) return { valor: 15.00, texto: "R$ 15,00" };

  return null; 
}

// Envio de Mensagem (WaSender)
async function enviarMensagemWA(numero, texto) {
  const numeroLimpo = String(numero).replace(/\D/g, '');
  try {
    await axios.post('https://www.wasenderapi.com/api/send-message', 
      { to: numeroLimpo, text: texto }, 
      { headers: { Authorization: `Bearer ${WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) { console.error(`Erro envio msg ${numeroLimpo}:`, err.message); }
}

// ==============================================================================
// 🚀 ROTAS E FLUXO PRINCIPAL
// ==============================================================================

app.get('/', (req, res) => { res.send('🤖 Bot Marmita V-Final ON!'); });

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

    // --- 1. SAUDAÇÃO INICIAL ---
    if (!cliente.recebeuSaudacao) {
      cliente.recebeuSaudacao = true;
      cliente.estado = 'MENU';
      resposta = saudacaoTexto() + `\n\n` + menuPrincipal();
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }
    
    // --- 2. COMANDO CANCELAR ---
    if (mensagem === 'cancelar') {
      cliente.estadoAnterior = cliente.estado;
      cliente.mensagemAntesDoCancelar = cliente.ultimaMensagem;
      cliente.estado = 'CONFIRMAR_CANCELAMENTO';
      await enviarMensagemWA(numero, `⚠️ Tem certeza que deseja cancelar o pedido?\n\n1️⃣ Sim, cancelar\n2️⃣ Não, continuar`); 
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'CONFIRMAR_CANCELAMENTO') {
      if (mensagem === '1') {
        estadoClientes.limparPedido(numero);
        const reset = estadoClientes.getEstado(numero);
        reset.recebeuSaudacao = true; 
        reset.estado = 'MENU'; 
        await enviarMensagemWA(numero, `❌ Pedido cancelado.\n\n` + menuPrincipal());
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2') {
        cliente.estado = cliente.estadoAnterior || 'MENU';
        await enviarMensagemWA(numero, cliente.mensagemAntesDoCancelar || menuPrincipal()); 
        return res.status(200).json({ ok: true });
      }
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
      return res.status(200).json({ ok: true });
    }

    // --- 3. MENU PRINCIPAL ---
    if (cliente.estado === 'MENU') {
      if (mensagem === '1') { 
        const dados = carregarMenu();
        if(dados.length === 0) { await enviarMensagemWA(numero, "⚠️ Cardápio indisponível no momento."); return res.status(200).json({ok:true}); }
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
        if(dados.length === 0) { await enviarMensagemWA(numero, "⚠️ Cardápio indisponível."); return res.status(200).json({ok:true}); }
        let lista = `🍽️ *Vamos montar seu pedido!*\n🔥 *PROMOÇÃO:* Acima de 5 unid = *R$ 17,49/un*\n\nDigite o NÚMERO do prato que deseja:\n\n`;
        dados.forEach((item, i) => { lista += `${i + 1}️⃣  ${item.PRATO}\n`; });
        lista += `\n0️⃣ Voltar ao menu`;
        cliente.estado = 'ESCOLHENDO_PRATO';
        cliente.opcoesPrato = dados;
        cliente.ultimaMensagem = lista;
        await enviarMensagemWA(numero, lista);
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '3') { 
        cliente.estado = 'ELOGIOS';
        resposta = `💬 *Espaço do Cliente*\nEscreva abaixo seu elogio, sugestão ou reclamação:\n\n(Digite 0 para voltar)`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '0') { await enviarMensagemWA(numero, menuPrincipal()); return res.status(200).json({ ok: true }); }
      await enviarMensagemWA(numero, msgNaoEntendi(menuPrincipal()));
      return res.status(200).json({ ok: true });
    }

    // --- 3.1 VENDO CARDÁPIO ---
    if (cliente.estado === 'VENDO_CARDAPIO') {
       if (mensagem === '2') {
         const dados = carregarMenu();
         let lista = `🍽️ *Vamos montar seu pedido!*\nDigite o NÚMERO do prato:\n\n`;
         dados.forEach((item, i) => { lista += `${i + 1}️⃣  ${item.PRATO}\n`; });
         lista += `\n0️⃣ Voltar ao menu`;
         cliente.estado = 'ESCOLHENDO_PRATO';
         cliente.opcoesPrato = dados;
         cliente.ultimaMensagem = lista;
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

    // --- 4. FLUXO DO PEDIDO ---
    if (cliente.estado === 'ESCOLHENDO_PRATO') {
      if (mensagem === '0') { cliente.estado = 'MENU'; await enviarMensagemWA(numero, menuPrincipal()); return res.status(200).json({ ok: true }); }
      const escolha = parseInt(mensagem);
      if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }
      
      const prato = cliente.opcoesPrato[escolha - 1];
      const nomePrato = prato.PRATO.toLowerCase();
      cliente.pedido.push({ prato: prato.PRATO, valor: prato.VALOR, arroz: null, strogonoff: null, quantidade: 0 });
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
        cliente.ultimaMensagem = lista;
        await enviarMensagemWA(numero, lista);
        return res.status(200).json({ ok: true });
      }

      if (mensagem === '2' || mensagem.includes('nao') || mensagem.includes('não')) {
        const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
        let valorUnitario = 19.99;
        let resumoPreco = `R$ 19,99/un`;
        let msgPromo = "";
        
        if (totalMarmitas >= 5) {
          valorUnitario = 17.49;
          resumoPreco = `~R$ 19,99~ por *R$ 17,49* a unidade`;
          msgPromo = `🎉 *Parabéns! Promoção Aplicada!*\n`;
        }
        const subtotal = (totalMarmitas * valorUnitario).toFixed(2);
        
        cliente.estado = 'AGUARDANDO_ENDERECO';
        resposta = msgPromo + `------------------------------\n🥡 *Resumo do Pedido:*\nMarmitas: ${totalMarmitas}\nValor: ${resumoPreco}\n💰 *Subtotal: R$ ${subtotal}* (Sem frete)\n------------------------------\n\n📍 Agora, digite seu *ENDEREÇO COMPLETO* (Rua, Número e Bairro):`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
      return res.status(200).json({ ok: true });
    }

    // --- 5. ENDEREÇO E FRETE ---
    if (cliente.estado === 'AGUARDANDO_ENDERECO') {
      cliente.endereco = texto; 
      const frete = calcularFrete(texto);
      
      if (frete && frete.erro) { await enviarMensagemWA(numero, frete.msg); return res.status(200).json({ ok: true }); }

      const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
      const valorUnitario = totalMarmitas >= 5 ? 17.49 : 19.99;
      const subtotalMarmitas = totalMarmitas * valorUnitario;

      let totalComFrete = 0;
      let textoFrete = "";

      if (frete && !frete.erro) {
         totalComFrete = subtotalMarmitas + frete.valor;
         textoFrete = frete.texto;
         cliente.valorFrete = frete.valor; 
      } else {
         totalComFrete = subtotalMarmitas; 
         textoFrete = "A calcular (Atendente irá informar)";
         cliente.valorFrete = 0;
      }

      cliente.totalFinal = totalComFrete;
      cliente.estado = 'ESCOLHENDO_PAGAMENTO';
      
      resposta = `✅ *Endereço Recebido!*\n\n📝 *Fechamento da Conta:*\nSubtotal Comida: R$ ${subtotalMarmitas.toFixed(2)}\nFrete: ${textoFrete}\n💰 *TOTAL: R$ ${totalComFrete.toFixed(2)}*\n\n🚚 *Entrega prevista: de 3 a 5 dias* (Sob encomenda)\n\n💳 *Como deseja pagar?*\n1️⃣ PIX (Chave Copia e Cola)\n2️⃣ Dinheiro (Na entrega)\n3️⃣ Cartão (Link de Pagamento)`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // --- 6. PAGAMENTO (O Mágico!) ---
    if (cliente.estado === 'ESCOLHENDO_PAGAMENTO') {
      cliente.pagamento = texto; 
      let infoPagamento = "";

      // ---> OPÇÃO PIX
      if (mensagem === '1' || mensagem.includes('pix')) {
         await enviarMensagemWA(numero, "💠 *Gerando PIX Copia e Cola...* Aguarde um instante.");
         
         const dadosPix = await gerarPix(cliente.totalFinal, "Cliente Marmita", numero);
         
         if (dadosPix) {
             infoPagamento = "PIX (Código Gerado)";
             await enviarMensagemWA(numero, `Aqui está seu código PIX:`);
             await enviarMensagemWA(numero, dadosPix.copiaCola); 
             await enviarMensagemWA(numero, `✅ *Copie e cole no seu banco.*\nAssim que pagar, seu pedido será processado automaticamente!`);
         } else {
             infoPagamento = "PIX (Falha Técnica - Enviar Manual)";
             await enviarMensagemWA(numero, "⚠️ O sistema do banco demorou para responder. Não se preocupe, um atendente enviará a chave manualmente em instantes.");
         }
      } 
      // ---> OPÇÃO DINHEIRO
      else if (mensagem === '2' || mensagem.includes('dinheiro')) {
         infoPagamento = "Dinheiro (Na Entrega)";
         await enviarMensagemWA(numero, "💵 Combinado! O pagamento será feito em dinheiro na entrega.");
      }
      // ---> OPÇÃO CARTÃO
      else if (mensagem === '3' || mensagem.includes('cartao') || mensagem.includes('cartão')) {
         await enviarMensagemWA(numero, "💳 *Gerando Link Seguro...* Aguarde.");
         
         const link = await gerarLinkPagamento(cliente.pedido, cliente.valorFrete);
         
         if (link) {
             infoPagamento = "Cartão (Link Gerado)";
             await enviarMensagemWA(numero, `✅ Clique abaixo para pagar com Cartão de Crédito/Débito:\n\n${link}`);
         } else {
             infoPagamento = "Cartão (Falha Link - Levar Maq.)";
             await enviarMensagemWA(numero, "⚠️ Não consegui gerar o link agora. O motoboy levará a maquininha!");
         }
      }
      else {
         await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
         return res.status(200).json({ ok: true });
      }

      if (timersClientes[numero]) clearTimeout(timersClientes[numero]);
      cliente.estado = 'FINALIZADO';

      const msgFinal = `✅ *Pedido Confirmado com Sucesso!*\n\nRecebemos seu pedido.\nEm breve entraremos em contato para combinar a entrega.\n\nMuito obrigado pela preferência! 😋🍱`;
      await enviarMensagemWA(numero, msgFinal);

      console.log(`Enviando alerta para ADMIN: ${NUMERO_ADMIN}`);
      let resumoDono = `🔔 *NOVO PEDIDO (V-Final)!* 🔔\n\n`;
      resumoDono += `👤 Cliente: https://wa.me/${numero}\n`;
      resumoDono += `📍 Endereço: *${cliente.endereco}*\n`;
      resumoDono += `💳 Pagamento: *${infoPagamento}*\n`; 
      resumoDono += `💰 Total: R$ ${cliente.totalFinal.toFixed(2)}\n\n`;
      resumoDono += `📝 *Itens:*\n`;
      cliente.pedido.forEach(item => {
          resumoDono += `- ${item.quantidade}x ${item.prato} (${item.arroz || '-'} / ${item.strogonoff || '-'})\n`;
      });
      
      if (NUMERO_ADMIN !== '5551999999999') await enviarMensagemWA(NUMERO_ADMIN, resumoDono);

      return res.status(200).json({ ok: true });
    }

    // --- 7. ELOGIOS ---
    if (cliente.estado === 'ELOGIOS') {
      if (mensagem === '0') { cliente.estado = 'MENU'; await enviarMensagemWA(numero, menuPrincipal()); return res.status(200).json({ ok: true }); }
      console.log(`[FEEDBACK] Cliente ${numero}: ${texto}`);
      cliente.estado = 'MENU';
      await enviarMensagemWA(numero, `✅ Obrigado! Sua mensagem foi registrada e entraremos em contato caso seja necessário.\n\n` + menuPrincipal());
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
