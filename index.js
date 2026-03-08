require('dotenv').config(); 
const express = require('express');
const path = require('path');
const axios = require('axios');
const xlsx = require('xlsx'); // Mantido apenas por segurança

// 👇 IMPORTANDO NOSSOS ARQUIVOS MODULARES (O Maestro chamando os músicos)
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
        // Usa a função limpa do novo arquivo pagamentos.js
        const pagamentoInfo = await consultarPagamento(data.id);
        
        if (pagamentoInfo && pagamentoInfo.status === 'approved') {
          const numeroCliente = pagamentoInfo.external_reference; 
          const valorPago = pagamentoInfo.transaction_amount;
          
          // Puxa a memória usando a nova estrutura de estado
          const memoria = estadoClientes.getEstado(numeroCliente);
          
          // Confere se existe um pedido para evitar PDFs vazios
          if (memoria && memoria.pedido.length > 0 && !memoria.pagamentoConfirmado) {
              memoria.pagamentoConfirmado = true;
              memoria.estado = 'FINALIZADO';
              
              await enviarMensagemWA(numeroCliente, "✅ Pagamento recebido! Estou gerando sua Nota Fiscal... 📄");

              // O Maestro pede para o gerador_pdf trabalhar
              const pdfBase64 = await gerarPDFGratis(memoria);
              if (pdfBase64) {
                  await enviarPDFWA(numeroCliente, pdfBase64, `Nota_Fiscal_${data.id}.pdf`);
              } else {
                  await enviarMensagemWA(numeroCliente, "🧾 Segue comprovante simples (PDF indisponível no momento).");
              }

              const resumoItens = memoria.pedido.map(item => {
                  let nomePrato = item.prato;
                  if (item.arroz === 'Integral') nomePrato = nomePrato.replace(/Arroz/i, 'Arroz integral');
                  if (item.strogonoff === 'Light') nomePrato = nomePrato.replace(/strogonoff/i, 'strogonoff light');
                  return `▪️ *${item.quantidade}x* ${nomePrato}`;
              }).join('\n');

              const msgAdmin = `🔔 *NOVO PEDIDO PAGO!* 👨‍🍳🔥\n\n👤 *Cliente:* ${memoria.nome}\n📱 *Zap:* ${numeroCliente}\n📍 *Endereço:* ${memoria.endereco}\n📝 *Compl:* ${memoria.complemento || 'Sem compl.'}\n\n🍲 *PEDIDO:*\n${resumoItens}\n\n🚚 *Frete:* R$ ${memoria.valorFrete.toFixed(2)}\n💰 *TOTAL PAGO: R$ ${valorPago.toFixed(2)}*`;
              
              await enviarMensagemWA(numeroCliente, `Muito obrigado, ${memoria.nome}! Seu pedido já foi para a cozinha. 🍱🔥`);
              if(NUMERO_ADMIN) await enviarMensagemWA(NUMERO_ADMIN, msgAdmin); 
          }
        }
      } catch (error) { console.error("Erro Webhook:", error); }
  }
  res.sendStatus(200);
});

// ----------------------------------------------------------------------
// 🏠 FUNÇÕES DO MENU E SISTEMA 
// ----------------------------------------------------------------------
function menuPrincipal(nomeCliente) {
  const nomeDisplay = nomeCliente ? ` ${nomeCliente}` : '';
  return `🔻 *Menu Principal para${nomeDisplay}*\n\n1️⃣  Ver Cardápio 🍱\n2️⃣  Fazer Pedido 🛒\n3️⃣  Elogios e reclamações 💬\n\n_Escolha uma opção digitando o número._`;
}

function msgNaoEntendi(textoAnterior) {
  return `🤔 *Não entendi sua resposta.*\nPor favor, escolha uma das opções abaixo:\n\n-----------------------------\n${textoAnterior}`;
}

function carregarMenu() {
    return cardapioLocal.map(item => ({
        PRATO: item.prato,
        preco: item.preco
    }));
}

const timersClientes = {};
function iniciarTimerInatividade(numero) {
  if (timersClientes[numero]) clearTimeout(timersClientes[numero]);
  timersClientes[numero] = setTimeout(async () => {
    const cliente = estadoClientes.getEstado(numero);
    if (cliente.estado !== 'INICIAL' && cliente.estado !== 'MENU' && cliente.estado !== 'FINALIZADO') {
      estadoClientes.resetarCliente(numero); 
      await enviarMensagemWA(numero, `💤 *Atendimento encerrado por inatividade.* Para recomeçar, basta dizer "Oi".`);
    }
    delete timersClientes[numero];
  }, 10 * 60 * 1000);
}

// ----------------------------------------------------------------------
// 📲 INTEGRAÇÃO WHATSAPP (TEXTO E ARQUIVO)
// ----------------------------------------------------------------------
async function enviarMensagemWA(numero, texto) {
  const numeroLimpo = String(numero).replace(/\D/g, '');
  try {
    await axios.post('https://www.wasenderapi.com/api/send-message', 
      { to: numeroLimpo, text: texto }, 
      { headers: { Authorization: `Bearer ${process.env.WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) { console.error(`Erro msg:`, err.message); }
}

async function enviarPDFWA(numero, base64, nomeArquivo) {
    const numeroLimpo = String(numero).replace(/\D/g, '');
    try {
        const base64ComPrefixo = base64.startsWith('data:') ? base64 : `data:application/pdf;base64,${base64}`;
        const uploadRes = await axios.post('https://www.wasenderapi.com/api/upload', 
            { base64: base64ComPrefixo, fileName: nomeArquivo }, 
            { headers: { Authorization: `Bearer ${process.env.WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        if (!uploadRes.data.success) throw new Error("Falha Upload");

        await axios.post('https://www.wasenderapi.com/api/send-message', 
            { to: numeroLimpo, text: "Aqui está seu comprovante! 👇", documentUrl: uploadRes.data.publicUrl, fileName: nomeArquivo }, 
            { headers: { Authorization: `Bearer ${process.env.WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
        );
    } catch (err) { console.error(`❌ Erro WaSender PDF:`, err.message); }
}

// ----------------------------------------------------------------------
// 🚀 ROTAS DE EXECUÇÃO (MENSAGENS DO CLIENTE)
// ----------------------------------------------------------------------
app.get('/', (req, res) => { res.send('🍱 A Melhor Marmita - Servidor Online 🚀'); });

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
    const texto = (dadosMensagem.messageBody || "").trim();

    if (!texto || !numero) return res.status(200).json({ ok: true });
    const mensagem = texto.toLowerCase();
    
    const dataBrasil = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const diaSemana = dataBrasil.getDay(); 
    const horaAtual = dataBrasil.getHours();
    const isFinalDeSemana = (diaSemana === 0 || diaSemana === 6);
    const isForaDoHorario = (horaAtual < 8 || horaAtual >= 18);

    if (isFinalDeSemana || isForaDoHorario) {
        if (numero !== process.env.NUMERO_ADMIN && numero !== (NUMERO_ADMIN ? NUMERO_ADMIN.replace('@c.us', '') : '')) {
            await enviarMensagemWA(numero, `🍱 *Olá! A Melhor Marmita agradece seu contato.*\n\n🚫 No momento estamos *FECHADOS*.\n\n⏰ Horário: Seg a Sex, das 08h às 18h.\n\nTente o contato novamente no nosso horário de expediente! 👋`);
            return res.status(200).json({ ok: true });
        }
    }

    const cliente = estadoClientes.getEstado(numero);
    iniciarTimerInatividade(numero);
    cliente.ultimoContato = Date.now();

    if (mensagem === 'cancelar' || mensagem === 'desistir') {
        if (cliente.pagamentoConfirmado) {
            await enviarMensagemWA(numero, "❌ *Pedido em produção!* Para alterações, fale com o suporte.");
        } else {
            estadoClientes.limparCarrinhoManterMenu(numero);
            await enviarMensagemWA(numero, "✅ Pedido cancelado.\n" + menuPrincipal(cliente.nome));
        }
        return res.status(200).json({ ok: true });
    }

if (!cliente.recebeuSaudacao) {
  cliente.recebeuSaudacao = true;
  cliente.estado = 'PERGUNTANDO_NOME_INICIO';
  await enviarMensagemWA(numero, `👋 Olá! Bem-vindo(a) à *Melhor Marmita* 🍱\n\nComo gostaria de ser chamado(a)?`);
  return res.status(200).json({ ok: true });
}

if (cliente.estado === 'PERGUNTANDO_NOME_INICIO') {
    if (texto.length < 2) { await enviarMensagemWA(numero, "❌ Nome muito curto."); return res.status(200).json({ ok: true }); }
    cliente.nome = texto;
    cliente.estado = 'MENU';
    await enviarMensagemWA(numero, `Prazer, ${cliente.nome}! 🤝\n\n` + menuPrincipal(cliente.nome));
    return res.status(200).json({ ok: true });
}

if (cliente.estado === 'MENU') {
  if (mensagem === '1') { 
    const dados = carregarMenu();
    if(dados.length === 0) { await enviarMensagemWA(numero, "⚠️ Cardápio indisponível."); return res.status(200).json({ok:true}); }
    
    let cardapio = `🍱 *Cardápio do Dia para ${cliente.nome}*\n🔥 *PROMOÇÃO:* Acima de 5 unid \n o valor cai para *R$ 17,49/un*!\n⚖️ Peso: 400g\n\n`;
    
    dados.forEach(item => { 
        let textoPreco = item.preco < 19.99 ? `*R$ ${item.preco.toFixed(2).replace('.', ',')} 🔥*` : `R$ ${item.preco.toFixed(2).replace('.', ',')}`;
        cardapio += `🔹 ${item.PRATO} – ${textoPreco}\n`; 
    });
    
    cardapio += `\nDigite *2* para pedir.\nDigite *0* para voltar ao Menu principal`;
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
    await enviarMensagemWA(numero, `💬 Escreva sua mensagem abaixo (0 para voltar):`); 
    return res.status(200).json({ ok: true });
  }
  if (mensagem === '0') { await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); return res.status(200).json({ ok: true }); }
  await enviarMensagemWA(numero, msgNaoEntendi(menuPrincipal(cliente.nome)));
  return res.status(200).json({ ok: true });
}

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
  if (mensagem === '0') { cliente.estado = 'MENU'; await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); return res.status(200).json({ ok: true }); }
  await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
  return res.status(200).json({ ok: true });
}

if (cliente.estado === 'ESCOLHENDO_PRATO') {
  if (mensagem === '0') { estadoClientes.limparCarrinhoManterMenu(numero); await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); return res.status(200).json({ ok: true }); }
  const escolha = parseInt(mensagem);
  if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }
  
  const prato = cliente.opcoesPrato[escolha - 1];
  cliente.pedido.push({ 
      prato: prato.PRATO, 
      valorAplicado: 0, // Será calculado no Caixa
      arroz: null, 
      strogonoff: null, 
      quantidade: 0 
  });
  cliente.precisaArroz = prato.PRATO.toLowerCase().includes('arroz');
  cliente.precisaStrogonoff = prato.PRATO.toLowerCase().includes('strogonoff');

  if (cliente.precisaArroz) {
    cliente.estado = 'VARIACAO_ARROZ';
    await enviarMensagemWA(numero, `🍚 *Qual tipo de arroz?*\n1️⃣ Branco\n2️⃣ Integral`);
  } else if (cliente.precisaStrogonoff) {
    cliente.estado = 'VARIACAO_STROGONOFF';
    await enviarMensagemWA(numero, `🍛 *Qual tipo de strogonoff?*\n1️⃣ Tradicional\n2️⃣ Light`);
  } else {
    cliente.estado = 'QUANTIDADE';
    await enviarMensagemWA(numero, `🔢 *Quantas marmitas deste prato deseja?*`);
  }
  return res.status(200).json({ ok: true });
}

if (cliente.estado === 'VARIACAO_ARROZ') {
  const item = cliente.pedido[cliente.pedido.length - 1];
  if (mensagem === '1' || mensagem.includes('branco')) item.arroz = 'Branco';
  else if (mensagem === '2' || mensagem.includes('integral')) item.arroz = 'Integral';
  else { await enviarMensagemWA(numero, msgNaoEntendi("1- Branco\n2- Integral")); return res.status(200).json({ ok: true }); }

  if (cliente.precisaStrogonoff) {
    cliente.estado = 'VARIACAO_STROGONOFF';
    await enviarMensagemWA(numero, `🍛 *Qual tipo de strogonoff?*\n1️⃣ Tradicional\n2️⃣ Light`);
  } else {
    cliente.estado = 'QUANTIDADE';
    await enviarMensagemWA(numero, `🔢 *Quantas marmitas deste prato deseja?*`);
  }
  return res.status(200).json({ ok: true });
}

if (cliente.estado === 'VARIACAO_STROGONOFF') {
  const item = cliente.pedido[cliente.pedido.length - 1];
  if (mensagem === '1' || mensagem.includes('tradicional')) item.strogonoff = 'Tradicional';
  else if (mensagem === '2' || mensagem.includes('light')) item.strogonoff = 'Light';
  else { await enviarMensagemWA(numero, msgNaoEntendi("1- Tradicional\n2- Light")); return res.status(200).json({ ok: true }); }
  cliente.estado = 'QUANTIDADE';
  await enviarMensagemWA(numero, `🔢 *Quantas marmitas deste prato deseja?*`); 
  return res.status(200).json({ ok: true });
}
    
if (cliente.estado === 'QUANTIDADE') {
  const qtd = parseInt(mensagem);
  if (isNaN(qtd) || qtd < 1) { await enviarMensagemWA(numero, "❌ Digite um número válido."); return res.status(200).json({ ok: true }); }
  
  cliente.pedido[cliente.pedido.length - 1].quantidade = qtd;
  cliente.estado = 'ADICIONAR_OUTRO';
  await enviarMensagemWA(numero, `✅ *Adicionado!*\nDeseja mais algo?\n1️⃣ Sim\n2️⃣ Não, fechar pedido`);
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

 if (mensagem === '2' || mensagem.includes('nao')) {
    // 🚀 LÓGICA DE PRECIFICAÇÃO (A REGRA DE OURO)
    const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
    let subtotalCalculado = 0;
    let tevePromoVolume = false;

    cliente.pedido.forEach(item => {
        // Busca o preço no arquivo cardapio_data.js
        const pratoBase = cardapioLocal.find(p => item.prato.includes(p.prato) || p.prato.includes(item.prato));
        let precoCadastrado = pratoBase ? pratoBase.preco : 19.99; 

        // Aplica desconto de volume (5 ou mais)
        let precoFinal = precoCadastrado;
        if (totalMarmitas >= 5) {
            // Só cai para 17.49 se o valor original for maior que isso!
            if (precoCadastrado > 17.49) {
                precoFinal = 17.49; 
                tevePromoVolume = true;
            }
        }

        item.valorAplicado = precoFinal; 
        subtotalCalculado += (precoFinal * item.quantidade);
    });

    let msgPromo = tevePromoVolume ? "🎉 *PROMOÇÃO ATIVA!* (Acima de 5 un)\n" : "";
    
    cliente.totalMarmitas = totalMarmitas; 
    cliente.subtotal = subtotalCalculado;
    cliente.estado = 'AGUARDANDO_CEP'; 
    
    let resposta = `📝 *Resumo do Pedido:*\n${msgPromo}📦 Itens: ${totalMarmitas} marmitas\n💰 *Subtotal: R$ ${subtotalCalculado.toFixed(2).replace('.', ',')}*\n----------------\n📍 Digite seu *CEP* para calcular o frete:`;
    await enviarMensagemWA(numero, resposta); 
    return res.status(200).json({ ok: true });
  }
  if (mensagem === '0') { estadoClientes.limparCarrinhoManterMenu(numero); await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); return res.status(200).json({ ok: true }); }
  await enviarMensagemWA(numero, msgNaoEntendi("1- Sim\n2- Não"));
  return res.status(200).json({ ok: true });
}
    
if (cliente.estado === 'AGUARDANDO_CEP') {
    const cepLimpo = mensagem.replace(/\D/g, '');
    if (cepLimpo.length !== 8) { await enviarMensagemWA(numero, "⚠️ CEP inválido (digite 8 números)."); return res.status(200).json({ ok: true }); }
    await enviarMensagemWA(numero, "🔍 Calculando frete...");
    // O Maestro chama a calculadora de frete externa
    const frete = await calcularFreteGoogle(cepLimpo);
    if (frete.erro) { await enviarMensagemWA(numero, frete.msg); return res.status(200).json({ ok: true }); }
    cliente.endereco = `CEP: ${cepLimpo} (${frete.endereco})`; 
    
    cliente.valorFrete = frete.valor; 
    cliente.totalFinal = cliente.subtotal + frete.valor; 
    cliente.estado = 'CONFIRMANDO_ENDERECO_COMPLEMENTO';
    await enviarMensagemWA(numero, `✅ *Localizado!*\n📍 ${frete.endereco}\n🚚 Frete: *${frete.texto}*\n\nPor favor digite o *NÚMERO DA CASA* e *COMPLEMENTO*:`); 
    return res.status(200).json({ ok: true });
}

if (cliente.estado === 'CONFIRMANDO_ENDERECO_COMPLEMENTO') {
    if (mensagem === '0') { cliente.estado = 'AGUARDANDO_CEP'; await enviarMensagemWA(numero, `🔄 Digite o *CEP correto*:`); return res.status(200).json({ ok: true }); }
    cliente.endereco += ` - Compl: ${texto}`;
    cliente.estado = 'ESCOLHENDO_PAGAMENTO';
    let resumoPgto = `📝 *Fechamento:*\n💰 *TOTAL FINAL: R$ ${cliente.totalFinal.toFixed(2).replace('.', ',')}*\n\n💳 *Como deseja pagar?*\n1️⃣ PIX\n2️⃣ Cartão (Link)`;
    await enviarMensagemWA(numero, resumoPgto);
    return res.status(200).json({ ok: true });
}

if (cliente.estado === 'ESCOLHENDO_PAGAMENTO' || cliente.estado === 'AGUARDANDO_PAGAMENTO') {
  if (mensagem === '0') { cliente.estado = 'ESCOLHENDO_PAGAMENTO'; await enviarMensagemWA(numero, "🔄 Escolha: 1- PIX, 2- Cartão"); return res.status(200).json({ ok: true }); }
  if (mensagem === '1' || mensagem.includes('pix')) {
     await enviarMensagemWA(numero, "💠 *Gerando PIX...*");
     // O Maestro pede pro arquivo de pagamentos gerar o Pix
     const dadosPix = await gerarPix(cliente.totalFinal, cliente.nome, numero);
     if (dadosPix) {
         await enviarMensagemWA(numero, `Aqui está seu código PIX:`);
         await enviarMensagemWA(numero, dadosPix.copiaCola); 
         await enviarMensagemWA(numero, `✅ Copie e cole no seu banco. Aguardando pagamento...`);
         await enviarMensagemWA(numero, `🔄 Se quiser trocar a forma de pagamento, digite *0*.`);
         cliente.estado = 'AGUARDANDO_PAGAMENTO';
     } else { await enviarMensagemWA(numero, "⚠️ Erro no PIX. Tente novamente."); }
  } 
  else if (mensagem === '2' || mensagem.includes('cartao')) {
     await enviarMensagemWA(numero, "💳 *Gerando link...*");
     // O Maestro pede pro arquivo de pagamentos gerar o Link
     const link = await gerarLinkPagamento(cliente.pedido, cliente.valorFrete, numero);
     if (link) {
         await enviarMensagemWA(numero, `✅ *Clique para pagar:*\n${link}`);
         await enviarMensagemWA(numero, `🔄 Se quiser trocar a forma de pagamento, digite *0*.`);
         cliente.estado = 'AGUARDANDO_PAGAMENTO';
     } else { await enviarMensagemWA(numero, "⚠️ Erro no link. Tente PIX."); }
  }
  return res.status(200).json({ ok: true });
}

if (cliente.estado === 'FINALIZADO') {
   if (mensagem === 'menu' || mensagem === '0') { estadoClientes.resetarCliente(numero); await enviarMensagemWA(numero, menuPrincipal()); return res.status(200).json({ ok: true }); }
   await enviarMensagemWA(numero, `👋 Seu pedido está sendo preparado! Digite *MENU* para novo pedido.`);
   return res.status(200).json({ ok: true });
}

if (cliente.estado === 'ELOGIOS') {
  if (mensagem === '0') { cliente.estado = 'MENU'; await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); return res.status(200).json({ ok: true }); }
  if (NUMERO_ADMIN) await enviarMensagemWA(NUMERO_ADMIN, `🚨 *FEEDBACK:* ${cliente.nome} (${numero}): ${texto}`);
  cliente.estado = 'MENU';
  await enviarMensagemWA(numero, `✅ Obrigado! Se necessário, um atendente entrará em contato.\n\n` + menuPrincipal(cliente.nome));
  return res.status(200).json({ ok: true });
}

    await enviarMensagemWA(numero, `👋 Olá! Bem-vindo de volta!\n\n` + menuPrincipal(cliente.nome));
    return res.status(200).json({ ok: true });

  } catch (error) { console.error('❌ ERRO GERAL:', error.message); return res.status(200).json({ ok: true }); }
});

app.listen(PORT, () => { console.log(`🚀 Servidor Melhor Marmita rodando na porta ${PORT}`); });
