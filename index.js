require('dotenv').config(); 
const express = require('express');
const path = require('path');
const axios = require('axios');
const xlsx = require('xlsx'); 

// 👇 IMPORTANDO NOSSOS ARQUIVOS MODULARES
const cardapioLocal = require('./cardapio_data');
const estadoClientes = require('./estado_cliente');
const gerarPDFGratis = require('./gerador_pdf');
const calcularFreteGoogle = require('./calculadora_frete');
const { gerarPix, gerarLinkPagamento, consultarPagamento } = require('./pagamentos');

// ----------------------------------------------------------------------
// ⚙️ CONFIGURAÇÕES GERAIS
// ----------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const NUMERO_ADMIN = process.env.NUMERO_ADMIN; 

// ----------------------------------------------------------------------
// 🔔 WEBHOOK DO MERCADO PAGO E AVISOS
// ----------------------------------------------------------------------
app.post('/webhook', async (req, res) => {
  const { action, data } = req.body;

  if (action === 'payment.created' || action === 'payment.updated') {
      try {
        const pagamentoInfo = await consultarPagamento(data.id);
        
        if (pagamentoInfo && pagamentoInfo.status === 'approved') {
          const numeroCliente = pagamentoInfo.external_reference; 
          const valorPago = pagamentoInfo.transaction_amount;
          
          let cliente = estadoClientes.buscarCliente(numeroCliente);
          if(!cliente) {
              console.log(`⚠️ Pagamento de R$${valorPago} aprovado, mas cliente não encontrado na memória temporária.`);
              return res.sendStatus(200);
          }
          
          cliente.pago = true;
          cliente.estado = 'FINALIZADO';
          
          let msgsAdmins = `✅ *NOVO PAGAMENTO APROVADO! (MERCADO PAGO)*\nCliente: ${cliente.nome}\nValor: R$ ${valorPago.toFixed(2)}\n\nO comprovante será enviado ao cliente, gerando PDF para a cozinha...`;
          if (NUMERO_ADMIN) await enviarMensagemWA(NUMERO_ADMIN, msgsAdmins);
          
          const pedidoData = new Date().toLocaleString('pt-BR');
          let itensCozinha = '';
          cliente.pedido.forEach(item => {
              itensCozinha += `- ${item.quantidade}x ${item.prato}\n`;
          });
          
          let resumoParaCliente = `🎉 *PAGAMENTO APROVADO!* 🎉\n\nRecebemos o seu pagamento de *R$ ${valorPago.toFixed(2)}* com sucesso.\n\nSeu pedido já foi enviado para a nossa cozinha e começará a ser preparado.\n\n📍 *Endereço de Entrega:*\n${cliente.endereco}\n\nMuito obrigado por escolher a Melhor Marmita! 🍱`;
          
          await enviarMensagemWA(numeroCliente, resumoParaCliente);
          
          try {
             const pdfBuffer = await gerarPDFGratis(cliente, pedidoData, itensCozinha);
             if (NUMERO_ADMIN) {
                 await enviarMediaWA(NUMERO_ADMIN, pdfBuffer, 'Comanda.pdf', `🖨️ *Comanda - ${cliente.nome}*`);
             }
             
             try {
                const WebhookURL = "https://script.google.com/macros/s/AKfycbyc9R1Tq5E6Z25D0XU0oD3a_pW6-o3l-GqD/exec";
                
                let stringPedido = "";
                cliente.pedido.forEach(i => { stringPedido += `${i.quantidade}x ${i.prato} | `; });
                
                await axios.post(WebhookURL, {
                    data: new Date().toLocaleDateString('pt-BR'),
                    nome: cliente.nome,
                    telefone: cliente.numero,
                    endereco: cliente.endereco,
                    pedido: stringPedido,
                    total: cliente.totalFinal,
                    status: "PAGO VIA MERCADO PAGO"
                });
             } catch (sheetErr) {
                 console.log("Erro ao salvar na planilha pós MP", sheetErr.message);
             }
             
          } catch (pdfErr) {
             console.error("Erro ao gerar PDF:", pdfErr);
             if (NUMERO_ADMIN) await enviarMensagemWA(NUMERO_ADMIN, `⚠️ Erro ao gerar o PDF da comanda do cliente ${cliente.nome}. O pedido está pago, veja o resumo no WhatsApp.`);
          }
          
          estadoClientes.limparCarrinhoTotalmente(numeroCliente);
        }
      } catch (err) { console.error("Erro no processamento do Webhook", err); }
  }
  res.sendStatus(200);
});

// ----------------------------------------------------------------------
// 📦 INTEGRAÇÃO COM A API DO WASENDER / MENSAGENS
// ----------------------------------------------------------------------
const WASENDER_TOKEN = process.env.WASENDER_TOKEN;
const WASENDER_DEVICE = process.env.WASENDER_DEVICE;
const WASENDER_URL = 'https://api.wasender.com/api/send'; 

async function enviarMensagemWA(numeroPara, texto) {
    if(!WASENDER_TOKEN || !WASENDER_DEVICE) return console.error('Falta Token ou Device do WaSender');
    let numeroFormatado = numeroPara.replace(/\D/g, '');
    if (!numeroFormatado.startsWith('55')) numeroFormatado = '55' + numeroFormatado;
    
    try {
        await axios.post(
            'https://api.wasender.com/send', 
            {
                number: numeroFormatado,
                type: 'text',
                message: texto,
                instance_id: WASENDER_DEVICE,
                access_token: WASENDER_TOKEN
            }
        );
    } catch (e) { console.error('Erro Wasender:', e.response?.data || e.message); }
}

async function enviarMediaWA(numeroPara, buffer, filename, caption) {
    if(!WASENDER_TOKEN || !WASENDER_DEVICE) return console.error('Falta Token ou Device do WaSender');
    let numeroFormatado = numeroPara.replace(/\D/g, '');
    if (!numeroFormatado.startsWith('55')) numeroFormatado = '55' + numeroFormatado;
    
    try {
        const formData = new FormData();
        formData.append('number', numeroFormatado);
        formData.append('type', 'media');
        formData.append('message', caption || '');
        formData.append('instance_id', WASENDER_DEVICE);
        formData.append('access_token', WASENDER_TOKEN);
        
        const blob = new Blob([buffer], { type: 'application/pdf' });
        formData.append('media_file', blob, filename);

        await axios.post('https://api.wasender.com/send', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    } catch (error) { console.error('Erro ao enviar mídia Wasender:', error.response?.data || error.message); }
}


// ----------------------------------------------------------------------
// 🗣️ RESPOSTAS PADRÃO E MENUS
// ----------------------------------------------------------------------

function menuPrincipal(nome) {
    return `Olá ${nome || ''}! 👋 Sou o assistente virtual da *Melhor Marmita*. Como posso te ajudar hoje?\n\n` +
           `1️⃣ *Fazer um pedido*\n` +
           `2️⃣ *Ver o Cardápio*\n` +
           `3️⃣ *Falar com um atendente*`;
}

function msgNaoEntendi(opcoes) {
    return `Desculpe, não entendi. 😔 Por favor, responda digitando o *NÚMERO* de uma das opções:\n\n${opcoes}\n\n[0] 🔙 Cancelar / Voltar ao Início`;
}

function mostrarCardapioSimples() {
    let msg = `📜 *Nosso Cardápio Saudável*\n\n`;
    cardapioLocal.forEach((item, index) => {
        let preco = item.preco.toFixed(2).replace('.', ',');
        msg += `${index + 1} - ${item.prato}\n💰 R$ ${preco}\n\n`;
    });
    msg += `----------------\nPromoção: Acima de 5 marmitas, o preço unitário de vários pratos cai para R$ 17,49!\n----------------\n\nDigite [1] para Fazer um Pedido ou [0] para Voltar.`;
    return msg;
}

function menuMarmitasParaComprar() {
    let msg = `😋 *Escolha suas marmitas:*\n\n`;
    cardapioLocal.forEach((item, index) => {
        let preco = item.preco.toFixed(2).replace('.', ',');
        msg += `${index + 1} - ${item.prato} (R$ ${preco})\n`;
    });
    msg += `\nDigite o número da marmita desejada:\n[0] 🔙 Cancelar Pedido`;
    return msg;
}

// ----------------------------------------------------------------------
// 🧠 CÉREBRO DO ROBÔ - RECEBE MENSAGENS E DECIDE O ESTADO
// ----------------------------------------------------------------------

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const dados = req.body;
    let numero = dados.from || dados.sender; 
    let mensagem = dados.message || dados.text || "";
    let nomeCliente = dados.pushname || "Cliente";

    if (!numero || !mensagem) return res.status(200).json({ ok: true });
    mensagem = mensagem.trim();

    let cliente = estadoClientes.buscarCliente(numero);
    
    if (!cliente || cliente.estado === 'INICIO') {
        if (!cliente) {
            estadoClientes.novoCliente(numero, nomeCliente);
            cliente = estadoClientes.buscarCliente(numero);
        }
        
        let saudacaoRegex = /^(oi|ola|olá|bom dia|boa tarde|boa noite|menu|iniciar|start)/i;
        if (saudacaoRegex.test(mensagem)) {
            await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
            cliente.estado = 'MENU_PRINCIPAL';
            return res.status(200).json({ ok: true });
        }
        
        if (mensagem === '1' || mensagem.toLowerCase().includes('pedido') || mensagem.toLowerCase().includes('comprar')) {
            cliente.estado = 'ESCOLHENDO_ITEM';
            await enviarMensagemWA(numero, menuMarmitasParaComprar());
            return res.status(200).json({ ok: true });
        }
        
        await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
        cliente.estado = 'MENU_PRINCIPAL';
        return res.status(200).json({ ok: true });
    }

// ----------------------------------------------------------------------
// TRATAMENTO DE ESTADOS (O QUE ELE ESTÁ FAZENDO AGORA)
// ----------------------------------------------------------------------

if (cliente.estado === 'MENU_PRINCIPAL') {
    if (mensagem === '1') {
        cliente.estado = 'ESCOLHENDO_ITEM';
        await enviarMensagemWA(numero, menuMarmitasParaComprar());
        return res.status(200).json({ ok: true });
    }
    if (mensagem === '2') {
        cliente.estado = 'VENDO_CARDAPIO';
        await enviarMensagemWA(numero, mostrarCardapioSimples());
        return res.status(200).json({ ok: true });
    }
    if (mensagem === '3') {
        cliente.estado = 'FALANDO_ATENDENTE';
        await enviarMensagemWA(numero, `👨‍💻 Um de nossos atendentes já vai falar com você. Aguarde um instante!`);
        if (NUMERO_ADMIN) await enviarMensagemWA(NUMERO_ADMIN, `🔔 *ATENDIMENTO HUMANO SOLICITADO*\nCliente: ${cliente.nome}\nTelefone: ${numero}`);
        return res.status(200).json({ ok: true });
    }
    
    await enviarMensagemWA(numero, msgNaoEntendi("1- Pedido\n2- Cardápio\n3- Atendente"));
    return res.status(200).json({ ok: true });
}

if (cliente.estado === 'VENDO_CARDAPIO') {
    if (mensagem === '1') {
        cliente.estado = 'ESCOLHENDO_ITEM';
        await enviarMensagemWA(numero, menuMarmitasParaComprar());
        return res.status(200).json({ ok: true });
    }
    if (mensagem === '0') {
        estadoClientes.limparCarrinhoManterMenu(numero);
        await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
        return res.status(200).json({ ok: true });
    }
    await enviarMensagemWA(numero, msgNaoEntendi("1- Fazer Pedido\n0- Voltar"));
    return res.status(200).json({ ok: true });
}

if (cliente.estado === 'ESCOLHENDO_ITEM') {
    if (mensagem === '0') {
        estadoClientes.limparCarrinhoManterMenu(numero);
        await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
        return res.status(200).json({ ok: true });
    }
    
    let escolhaNum = parseInt(mensagem);
    if (isNaN(escolhaNum) || escolhaNum < 1 || escolhaNum > cardapioLocal.length) {
        await enviarMensagemWA(numero, msgNaoEntendi("Digite o NÚMERO do prato correspondente no menu."));
        return res.status(200).json({ ok: true });
    }
    
    let pratoEscolhido = cardapioLocal[escolhaNum - 1];
    cliente.itemSendoAdicionado = pratoEscolhido;
    cliente.estado = 'ESCOLHENDO_QTD_ITEM';
    
    await enviarMensagemWA(numero, `Você escolheu:\n*${pratoEscolhido.prato}*\n\nQuantas unidades desse prato você deseja?\n(Digite apenas o número)\n\n[0] 🔙 Cancelar`);
    return res.status(200).json({ ok: true });
}

if (cliente.estado === 'ESCOLHENDO_QTD_ITEM') {
    if (mensagem === '0') {
        cliente.itemSendoAdicionado = null;
        cliente.estado = 'ESCOLHENDO_ITEM';
        await enviarMensagemWA(numero, `❌ Cancelado. Voltando ao menu:\n\n` + menuMarmitasParaComprar());
        return res.status(200).json({ ok: true });
    }
    
    let qtd = parseInt(mensagem);
    if (isNaN(qtd) || qtd < 1) {
        await enviarMensagemWA(numero, "⚠️ Por favor, digite uma quantidade válida (ex: 1, 2, 5).");
        return res.status(200).json({ ok: true });
    }
    
    let prato = cliente.itemSendoAdicionado;
    let jaExisteIndex = cliente.pedido.findIndex(p => p.prato === prato.prato);
    
    if (jaExisteIndex > -1) {
        cliente.pedido[jaExisteIndex].quantidade += qtd;
    } else {
        cliente.pedido.push({
            prato: prato.prato,
            precoBase: prato.preco, 
            quantidade: qtd,
            valorAplicado: prato.preco 
        });
    }
    
    cliente.itemSendoAdicionado = null;
    cliente.estado = 'MAIS_ALGUMA_COISA';
    
    await enviarMensagemWA(numero, `✅ Adicionado ao carrinho!\n\nDeseja adicionar mais alguma marmita ao seu pedido?\n1- Sim\n2- Não, fechar pedido`);
    return res.status(200).json({ ok: true });
}

if (cliente.estado === 'MAIS_ALGUMA_COISA') {
  if (mensagem === '1' || mensagem.toLowerCase() === 'sim') {
      cliente.estado = 'ESCOLHENDO_ITEM';
      await enviarMensagemWA(numero, menuMarmitasParaComprar());
      return res.status(200).json({ ok: true });
  }
  if (mensagem === '2' || mensagem.toLowerCase() === 'nao' || mensagem.toLowerCase() === 'não') {
    cliente.estado = 'MANDAR_CARRINHO';
    
    let totalMarmitas = 0;
    cliente.pedido.forEach(item => totalMarmitas += item.quantidade);
    
    let subtotalCalculado = 0;
    let tevePromoVolume = false;

    cliente.pedido.forEach(item => {
        const pratoBase = cardapioLocal.find(p => item.prato.includes(p.prato) || p.prato.includes(item.prato));
        
        let precoCadastrado = pratoBase ? pratoBase.preco : 19.99; 
        
        let isPremium = false;
        if (pratoBase && pratoBase.premium) isPremium = true;
        if (item.prato.toLowerCase().includes('premium')) isPremium = true; 

        let precoFinal = precoCadastrado;
        
        if (totalMarmitas >= 5 && !isPremium) {
            if (precoCadastrado > 17.49) {
                precoFinal = 17.49; 
                tevePromoVolume = true;
            }
        }

        item.valorAplicado = precoFinal; 
        subtotalCalculado += (precoFinal * item.quantidade);
    });

    let msgPromo = "";
    if (tevePromoVolume) {
        msgPromo = `🎉 *Desconto Ativado!* Pratos comuns saíram por R$ 17,49.\n`;
    }

    cliente.totalMarmitas = totalMarmitas; 
    cliente.subtotal = subtotalCalculado;
    cliente.estado = 'AGUARDANDO_CEP'; 
    
    let resposta = `📝 *Resumo do Pedido:*\n${msgPromo}📦 Itens: ${totalMarmitas} marmitas\n💰 *Subtotal: R$ ${subtotalCalculado.toFixed(2).replace('.', ',')}*\n----------------\n📍 Para calcularmos a entrega, por favor, digite o seu CEP, o Número da casa e o Complemento:`;
    await enviarMensagemWA(numero, resposta); 
    return res.status(200).json({ ok: true });
  }
  if (mensagem === '0') { estadoClientes.limparCarrinhoManterMenu(numero); await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); return res.status(200).json({ ok: true }); }
  await enviarMensagemWA(numero, msgNaoEntendi("1- Sim\n2- Não"));
  return res.status(200).json({ ok: true });
}
    
if (cliente.estado === 'AGUARDANDO_CEP') {
    if (mensagem === '0') { estadoClientes.limparCarrinhoManterMenu(numero); await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); return res.status(200).json({ ok: true }); }
    
    await enviarMensagemWA(numero, "🔍 Lendo endereço e calculando rota exata...");
    
    // Manda a mensagem INTEIRA do cliente para o calculador
    const frete = await calcularFreteGoogle(mensagem); 
    
    if (frete.erro) { 
        await enviarMensagemWA(numero, frete.msg); 
        return res.status(200).json({ ok: true }); 
    }
    
    // Salva o endereço completinho pra mandar pra planilha depois
    cliente.endereco = frete.endereco; 
    
    cliente.valorFrete = frete.valor; 
    cliente.totalFinal = cliente.subtotal + frete.valor; 
    
    // MÁGICA: Pula a etapa de confirmar endereço e vai direto pro pagamento!
    cliente.estado = 'ESCOLHENDO_PAGAMENTO';
    
    let resumoPgto = `✅ *Localizado!*\n📍 ${frete.endereco}\n🚚 Frete: *${frete.texto}*\n\n📝 *Fechamento:*\n💰 *TOTAL FINAL: R$ ${cliente.totalFinal.toFixed(2).replace('.', ',')}*\n\n💳 *Como deseja pagar?*\n1️⃣ PIX\n2️⃣ Cartão (Link)`;
    
    await enviarMensagemWA(numero, resumoPgto); 
    return res.status(200).json({ ok: true });
}

if (cliente.estado === 'ESCOLHENDO_PAGAMENTO' || cliente.estado === 'AGUARDANDO_PAGAMENTO') {
  if (mensagem === '0') { cliente.estado = 'ESCOLHENDO_PAGAMENTO'; await enviarMensagemWA(numero, "🔄 Escolha: 1- PIX, 2- Cartão"); return res.status(200).json({ ok: true }); }
  if (mensagem === '1' || mensagem.includes('pix')) {
     await enviarMensagemWA(numero, "💠 *Gerando PIX...*");
     const dadosPix = await gerarPix(cliente.totalFinal, cliente.nome, numero);
     if (dadosPix) {
         await enviarMensagemWA(numero, `Aqui está o código Copia e Cola do PIX (Válido por 30min):\n\n${dadosPix.copiaEcola}`);
         cliente.estado = 'AGUARDANDO_PAGAMENTO';
     } else {
         await enviarMensagemWA(numero, "⚠️ Tivemos um erro ao gerar o PIX. Avise o atendente.");
     }
     return res.status(200).json({ ok: true });
  }
  
  if (mensagem === '2' || mensagem.includes('cartao') || mensagem.includes('cartão')) {
     await enviarMensagemWA(numero, "💳 *Gerando Link de Pagamento...*");
     const dadosLink = await gerarLinkPagamento(cliente.totalFinal, cliente.nome, numero);
     if (dadosLink) {
         await enviarMensagemWA(numero, `Para pagar com cartão (Crédito ou Débito), acesse o link seguro do Mercado Pago:\n\n🔗 ${dadosLink.link}`);
         cliente.estado = 'AGUARDANDO_PAGAMENTO';
     } else {
         await enviarMensagemWA(numero, "⚠️ Tivemos um erro ao gerar o Link. Avise o atendente.");
     }
     return res.status(200).json({ ok: true });
  }

  if (cliente.estado === 'AGUARDANDO_PAGAMENTO' && mensagem.toLowerCase().includes('pago')) {
      await enviarMensagemWA(numero, "⏳ Certo! Estamos aguardando a aprovação do Mercado Pago. Assim que compensar, o seu pedido descerá para a cozinha automaticamente. Fique tranquilo!");
      return res.status(200).json({ ok: true });
  }

  await enviarMensagemWA(numero, "Escolha uma forma de pagamento para fechar o pedido:\n[1] PIX\n[2] Cartão\n[0] Voltar");
  return res.status(200).json({ ok: true });
}

if (cliente.estado === 'FALANDO_ATENDENTE') {
  if (mensagem === '0') {
      estadoClientes.limparCarrinhoManterMenu(numero);
      await enviarMensagemWA(numero, `Atendimento cancelado.\n\n` + menuPrincipal(cliente.nome));
      return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ ok: true });
}

if (cliente.estado === 'FINALIZADO') {
  estadoClientes.limparCarrinhoManterMenu(numero);
  await enviarMensagemWA(numero, `✅ Seu pedido anterior já foi pago e entregue/finalizado! Se necessário, um atendente entrará em contato.\n\n` + menuPrincipal(cliente.nome));
  return res.status(200).json({ ok: true });
}

    await enviarMensagemWA(numero, `👋 Olá! Bem-vindo de volta!\n\n` + menuPrincipal(cliente.nome));
    return res.status(200).json({ ok: true });

  } catch (error) { console.error('❌ ERRO GERAL:', error.message); return res.status(200).json({ ok: true }); }
});

app.listen(PORT, () => { console.log(`🚀 Servidor Melhor Marmita rodando na porta ${PORT}`); });
