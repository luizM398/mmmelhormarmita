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

const NUMERO_ADMIN = process.env.NUMERO_ADMIN; 
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN; 
const COORD_COZINHA = "-51.11161606538164,-30.109913348576296"; 

// 🔗 LINKS DA PLANILHA (CÓDIGO NOVO)
const URL_CSV_PRECIFICACAO = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT5Ro_cegBVlpImDmp37z4C8GCmJyxaf72_t_mjguoJDxPEa0uUh7Jc8N6N2QLE0vlbY_rmkhBXhIz9/pub?gid=2145088419&single=true&output=csv";
const URL_WEBHOOK_PLANILHA = "COLE_AQUI_A_URL_DO_WEBHOOK_DA_PLANILHA"; // <-- Cole o link do Apps Script aqui!

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'SEU_TOKEN_MP_AQUI'
});

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
    clientes[numero] = { estado: 'INICIAL', pedido: [], nome: '', recebeuSaudacao: false, pagamentoConfirmado: false, ultimoContato: Date.now() };
  },
  limparCarrinhoManterMenu: (numero) => {
    if (clientes[numero]) {
      clientes[numero].pedido = []; 
      clientes[numero].estado = 'MENU';
      clientes[numero].pagamentoConfirmado = false;
    }
  }
};

setInterval(() => {
  const agora = Date.now();
  for (const numero in clientes) {
    if (agora - clientes[numero].ultimoContato > 60 * 60 * 1000) delete clientes[numero];
  }
}, 60000);

// ----------------------------------------------------------------------
// 📄 GERADOR DE PDF PROFISSIONAL (ATUALIZADO PARA PREÇOS DINÂMICOS)
// ----------------------------------------------------------------------
async function gerarPDFGratis(cliente) {
    try {
        console.log("⏳ Gerando PDF Profissional...");
        const MINHA_API_KEY = "9409e59e-8602-4930-8c1e-bcf796639659"; 

        const urlLogo = "https://i.postimg.cc/R0J0ccxD/Chat-GPT-Image-8-de-fev-de-2026-08-07-06.png"; 
        const corDestaque = "#ff6b00"; 
        const corTitulo = "#000000";   
        const corVerde = "#009e2a";    

        const dataPedido = new Date().toLocaleDateString('pt-BR');
        const horaPedido = new Date().toLocaleTimeString('pt-BR').substring(0,5);

        let subtotalCalculado = 0;

        const linhasTabela = cliente.pedido.map(item => {
            const vlUnitario = item.valorAplicado; // Puxa o valor dinâmico exato do item
            const vlTotal = item.quantidade * vlUnitario;
            subtotalCalculado += vlTotal;
            
            let nomeCompleto = item.prato;
            if (item.arroz === 'Integral') nomeCompleto = nomeCompleto.replace(/Arroz/i, 'Arroz integral');
            if (item.strogonoff === 'Light') nomeCompleto = nomeCompleto.replace(/strogonoff/i, 'strogonoff light');

            const ehPromo = item.valorAplicado < 19.99; // Se foi aplicado qualquer desconto
            
            let htmlUnitario = ehPromo ? 
                `<div style="font-size:10px; color:#999; text-decoration:line-through;">R$ 19,99</div>
                 <div style="font-size:12px; color:${corVerde}; font-weight:bold;">R$ ${vlUnitario.toFixed(2).replace('.', ',')}</div>` 
                 : `<div style="font-size:12px;">R$ ${vlUnitario.toFixed(2).replace('.', ',')}</div>`;

            let htmlTotalLinha = ehPromo ? 
                `<div style="font-size:10px; color:#999; text-decoration:line-through;">R$ ${(item.quantidade * 19.99).toFixed(2).replace('.', ',')}</div>
                 <div style="font-size:13px; color:${corVerde}; font-weight:bold;">R$ ${vlTotal.toFixed(2).replace('.', ',')}</div>` 
                 : `<div style="font-size:13px; font-weight:bold;">R$ ${vlTotal.toFixed(2).replace('.', ',')}</div>`;

            return `
            <tr>
                <td style="padding:10px 5px; border-bottom:1px solid #eee; text-align:center; font-weight:bold;">${item.quantidade}</td>
                <td style="padding:10px 5px; border-bottom:1px solid #eee; text-align:left;">${nomeCompleto}</td>
                <td style="padding:10px 5px; border-bottom:1px solid #eee; text-align:right;">${htmlUnitario}</td>
                <td style="padding:10px 5px; border-bottom:1px solid #eee; text-align:right;">${htmlTotalLinha}</td>
            </tr>`;
        }).join('');

        const totalFinal = subtotalCalculado + cliente.valorFrete;
        
        let htmlSubtotal = `<div style="margin-bottom:5px;">Subtotal: <strong>R$ ${subtotalCalculado.toFixed(2).replace('.', ',')}</strong></div>`;

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='UTF-8'>
            <style>
                body { font-family: 'Helvetica', sans-serif; color: #333; margin: 0; padding: 20px; font-size: 14px; }
                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
                .logo { max-width: 120px; margin-bottom: 10px; }
                .titulo { color: ${corTitulo}; font-size: 24px; font-weight: bold; text-transform: uppercase; margin: 5px 0; }
                .subtitulo { color: #777; font-size: 12px; }
                .info-box { background: #f9f9f9; padding: 15px; border-radius: 8px; border: 1px solid #eee; margin-bottom: 25px; }
                .info-linha { margin-bottom: 5px; }
                .prazo { color: ${corDestaque}; font-weight: bold; margin-top: 10px; font-size: 12px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                th { background: #f0f0f0; color: #555; font-size: 11px; text-transform: uppercase; padding: 10px 5px; border-bottom: 2px solid #ddd; }
                .totais-box { float: right; width: 50%; text-align: right; padding-top: 10px; }
                .linha-total { margin-bottom: 8px; font-size: 14px; }
                .total-final { font-size: 22px; font-weight: bold; color: ${corTitulo}; border-top: 2px solid #ddd; padding-top: 10px; margin-top: 10px; }
                .footer { clear: both; text-align: center; margin-top: 60px; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 20px; }
            </style>
        </head>
        <body>
            <div class="header">
                <img src="${urlLogo}" class="logo">
                <div class="titulo">MELHOR MARMITA</div>
                <div class="subtitulo">Pedido #${Math.floor(Math.random()*8999)+1000} • ${dataPedido} às ${horaPedido}</div>
            </div>
            <div class="info-box">
                <div class="info-linha"><strong>Cliente:</strong> ${cliente.nome}</div>
                <div class="info-linha"><strong>Endereço:</strong> ${cliente.endereco}</div>
                <div class="prazo">🚚 Previsão de entrega: 3 a 5 dias úteis após o pedido</div>
            </div>
            <table>
                <thead>
                    <tr><th style="width: 10%;">QTD</th><th style="width: 50%; text-align: left;">DESCRIÇÃO</th><th style="width: 20%; text-align: right;">UNITÁRIO</th><th style="width: 20%; text-align: right;">TOTAL</th></tr>
                </thead>
                <tbody>${linhasTabela}</tbody>
            </table>
            <div class="totais-box">
                ${htmlSubtotal}
                <div class="linha-total">Taxa de Entrega: R$ ${cliente.valorFrete.toFixed(2).replace('.', ',')}</div>
                <div class="total-final">TOTAL: R$ ${totalFinal.toFixed(2).replace('.', ',')}</div>
                <div style="margin-top:10px; font-size:12px; background:#eaffea; display:inline-block; padding:5px 10px; border-radius:15px; color:#007a1e;">
                    Pagamento: CONFIRMADO ✅
                </div>
            </div>
            <div class="footer"><p>Obrigado pela preferência! 🍱</p><p>Este documento não possui valor fiscal.</p></div>
        </body>
        </html>`;

        const response = await axios.post('https://v2.api2pdf.com/chrome/pdf/html', 
            { html: html, inlinePdf: true, fileName: 'nota_fiscal.pdf', options: { printBackground: true, pageSize: 'A4' } },
            { headers: { 'Authorization': MINHA_API_KEY } }
        );
        const pdfUrl = response.data.FileUrl;
        if (!pdfUrl) return null;
        const fileResponse = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        return Buffer.from(fileResponse.data, 'binary').toString('base64');
    } catch (error) { console.error("❌ Erro API2PDF:", error.message); return null; }
}

// ----------------------------------------------------------------------
// 🚚 MOTOR DE FRETE
// ----------------------------------------------------------------------
async function calcularFreteGoogle(cepDestino) {
  if (!MAPBOX_ACCESS_TOKEN) return { erro: true, msg: "Erro interno (Token Mapbox ausente)." };
  try {
    const cepLimpo = String(cepDestino).replace(/\D/g, '');
    if (cepLimpo.length !== 8) return { erro: true, msg: "⚠️ CEP inválido. Digite os 8 números." };
    const urlViaCep = `https://viacep.com.br/ws/${cepLimpo}/json/`;
    const viaCepRes = await axios.get(urlViaCep);
    if (viaCepRes.data.erro) return { erro: true, msg: "❌ CEP não encontrado na base dos Correios." };
    const enderecoTexto = `${viaCepRes.data.logradouro}, ${viaCepRes.data.localidade}, ${viaCepRes.data.uf}, Brasil`;
    const urlGeo = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(enderecoTexto)}.json?country=br&limit=1&proximity=${COORD_COZINHA}&access_token=${MAPBOX_ACCESS_TOKEN}`;
    const geoRes = await axios.get(urlGeo);
    if (!geoRes.data.features || geoRes.data.features.length === 0) return { erro: true, msg: "❌ O mapa não conseguiu localizar a rua." };
    const destino = geoRes.data.features[0];
    const coordsDestino = destino.center.join(','); 
    const urlDist = `https://api.mapbox.com/directions/v5/mapbox/driving/${COORD_COZINHA};${coordsDestino}?access_token=${MAPBOX_ACCESS_TOKEN}`;
    const distRes = await axios.get(urlDist);
    if (!distRes.data.routes || distRes.data.routes.length === 0) return { erro: true, msg: "🚫 Rota não encontrada." };
    const distanciaKm = distRes.data.routes[0].distance / 1000;
    
    let valor = 0, texto = "";
    if (distanciaKm <= 3.0) { valor = 0.00; texto = "R$ 0,00"; } 
    else if (distanciaKm <= 8.0) { valor = 10.00; texto = "R$ 10,00"; }
    else if (distanciaKm <= 14.0) { valor = 15.00; texto = "R$ 15,00"; }
    else if (distanciaKm <= 20.0) { valor = 20.00; texto = "R$ 20,00"; }
    else { return { erro: true, msg: "🚫 Muito distante (fora da área de entrega)." }; }
    return { valor, texto, endereco: enderecoTexto };
  } catch (error) { return { valor: 15.00, texto: "R$ 15,00 (Contingência)", endereco: "Endereço via CEP" }; }
}

// ----------------------------------------------------------------------
// 💰 PROCESSAMENTO DE PAGAMENTOS E LINKS
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
    return { copiaCola: response.point_of_interaction.transaction_data.qr_code, idPagamento: response.id };
  } catch (error) { return null; }
}

async function gerarLinkPagamento(itens, frete, clienteTelefone) {
  try {
    const SEU_NUMERO_LOJA = "5551984050946"; 
    const preference = new Preference(client);

    // Usa o valorAplicado individual de cada prato
    const items = itens.map(item => ({
      title: item.prato,
      quantity: Number(item.quantidade),
      unit_price: Number(item.valorAplicado), 
      currency_id: 'BRL'
    }));

    if (frete > 0) items.push({ title: 'Taxa de Entrega', quantity: 1, unit_price: Number(frete), currency_id: 'BRL' });

    const response = await preference.create({
      body: {
        items: items,
        external_reference: String(clienteTelefone).replace(/\D/g, ''),
        back_urls: { success: `https://wa.me/${SEU_NUMERO_LOJA}`, failure: `https://wa.me/${SEU_NUMERO_LOJA}`, pending: `https://wa.me/${SEU_NUMERO_LOJA}` },
        auto_return: "approved"
      }
    });
    return response.init_point;
  } catch (error) { return null; }
}

// ----------------------------------------------------------------------
// 🔔 WEBHOOK DO MERCADO PAGO E DO GOOGLE SHEETS
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
          
          if (memoria && !memoria.pagamentoConfirmado) { // Evita duplicidade
              memoria.pagamentoConfirmado = true;
              memoria.estado = 'FINALIZADO';
              
              await enviarMensagemWA(numeroCliente, "✅ Pagamento recebido! Estou gerando sua Nota Fiscal... 📄");

              const pdfBase64 = await gerarPDFGratis(memoria);
              if (pdfBase64) {
                  await enviarPDFWA(numeroCliente, pdfBase64, `Nota_Fiscal_${data.id}.pdf`);
              } else {
                  await enviarMensagemWA(numeroCliente, "🧾 Segue comprovante simples (PDF indisponível).");
              }

              // 🚀🚀 DISPARO PARA A PLANILHA DO GOOGLE 🚀🚀
              for (const item of memoria.pedido) {
                  try {
                      await axios.post(URL_WEBHOOK_PLANILHA, {
                          cliente: memoria.nome,
                          telefone: numeroCliente,
                          prato: item.prato,
                          quantidade: item.quantidade,
                          valorCobrado: item.valorAplicado * item.quantidade
                      });
                      console.log(`✅ ${item.prato} enviado para a Planilha!`);
                  } catch (errSheet) {
                      console.error("❌ Erro ao enviar para o Google Sheets:", errSheet.message);
                  }
              }

              const resumoItens = memoria.pedido.map(item => {
                  let nomePrato = item.prato;
                  if (item.arroz === 'Integral') nomePrato = nomePrato.replace(/Arroz/i, 'Arroz integral');
                  if (item.strogonoff === 'Light') nomePrato = nomePrato.replace(/strogonoff/i, 'strogonoff light');
                  return `▪️ *${item.quantidade}x* ${nomePrato} (R$ ${item.valorAplicado.toFixed(2)})`;
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
// 🏠 FUNÇÕES DO MENU E SISTEMA (CSV NOVO)
// ----------------------------------------------------------------------
function menuPrincipal(nomeCliente) {
  const nomeDisplay = nomeCliente ? ` ${nomeCliente}` : '';
  return `🔻 *Menu Principal para${nomeDisplay}*\n\n1️⃣  Ver Cardápio 🍱\n2️⃣  Fazer Pedido 🛒\n3️⃣  Elogios e reclamações 💬\n\n_Escolha uma opção digitando o número._`;
}

function msgNaoEntendi(textoAnterior) {
  return `🤔 *Não entendi sua resposta.*\nPor favor, escolha uma das opções abaixo:\n\n-----------------------------\n${textoAnterior}`;
}

// LÊ O ARQUIVO CSV DA NUVEM (GOOGLE SHEETS)
async function obterMenuDaPlanilha() {
    try {
        const response = await axios.get(URL_CSV_PRECIFICACAO, { responseType: 'arraybuffer' });
        const workbook = xlsx.read(response.data, { type: 'buffer' });
        const aba = workbook.Sheets[workbook.SheetNames[0]];
        const dados = xlsx.utils.sheet_to_json(aba);
        
        return dados.map(item => {
            // Busca a chave que contenha a palavra "Prato" para não ter erro de formatação
            const nomeKey = Object.keys(item).find(k => k.toLowerCase().includes('prato'));
            // Busca a chave promocional
            const promoKey = Object.keys(item).find(k => k.toLowerCase().includes('promocional') || k.toLowerCase().includes('promo'));
            
            return {
                PRATO: item[nomeKey],
                precoNormal: 19.99,
                precoVolume: 17.49,
                precoPromo: promoKey ? parseFloat(String(item[promoKey]).replace(',', '.')) || 0 : 0
            };
        }).filter(p => p.PRATO);
    } catch (error) { 
        console.error("❌ Erro CSV:", error.message); 
        return []; 
    }
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
    const isFinalDeSemana = (diaSemana === 0);
    const isForaDoHorario = (horaAtual < 8 || horaAtual >= 18);

    if (isFinalDeSemana || isForaDoHorario) {
        if (numero !== process.env.NUMERO_ADMIN && numero !== NUMERO_ADMIN.replace('@c.us', '')) {
            await enviarMensagemWA(numero, `🍱 *Olá! A Melhor Marmita agradece seu contato.*\n\n🚫 No momento estamos *FECHADOS*.\n\n⏰ Horário: Seg a Sáb, das 08h às 18h.\n\nResponderemos assim que iniciarmos nosso expediente! 👋`);
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

// 👋 INICIO
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
    const dados = await obterMenuDaPlanilha();
    if(dados.length === 0) { await enviarMensagemWA(numero, "⚠️ Cardápio indisponível."); return res.status(200).json({ok:true}); }
    let cardapio = `🍱 *Cardápio do Dia para ${cliente.nome}*\n🔥 *PROMOÇÃO:* Acima de 5 unid \n o valor cai de ~~19,99~~ para *R$ 17,49/un*!\n⚖️ Peso: 400g\n\n`;
    dados.forEach(item => { 
        let textoPreco = item.precoPromo > 0 ? `*R$ ${item.precoPromo.toFixed(2)} 🔥*` : `R$ 19,99`;
        cardapio += `🔹 ${item.PRATO} – ${textoPreco}\n`; 
    });
    cardapio += `\nDigite *2* para pedir.\nDigite *0* para voltar ao Menu principal`;
    cliente.estado = 'VENDO_CARDAPIO';
    cliente.ultimaMensagem = cardapio; 
    await enviarMensagemWA(numero, cardapio);
    return res.status(200).json({ ok: true });
  }
  if (mensagem === '2') {
    const dados = await obterMenuDaPlanilha();
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
    const dados = await obterMenuDaPlanilha();
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
      precoNormal: prato.precoNormal,
      precoVolume: prato.precoVolume,
      precoPromo: prato.precoPromo,
      valorAplicado: 0,
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
    const dados = await obterMenuDaPlanilha();
    let lista = `🍽️ *Escolha mais um prato:*\n\n`;
    dados.forEach((item, i) => { lista += `${i + 1}️⃣  ${item.PRATO}\n`; });
    lista += `\n0️⃣ Cancelar tudo`;
    cliente.opcoesPrato = dados;
    await enviarMensagemWA(numero, lista);
    return res.status(200).json({ ok: true });
  }

  if (mensagem === '2' || mensagem.includes('nao')) {
    // 🚀 LÓGICA DE PREÇOS NOVA E INTELIGENTE AQUI
    const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
    let subtotalCalculado = 0;
    let tevePromoVolume = false;

    cliente.pedido.forEach(item => {
        if (item.precoPromo > 0) {
            item.valorAplicado = item.precoPromo; // Prioridade MÁXIMA para o preço da planilha
        } else {
            if (totalMarmitas >= 5) {
                item.valorAplicado = item.precoVolume;
                tevePromoVolume = true;
            } else {
                item.valorAplicado = item.precoNormal;
            }
        }
        subtotalCalculado += (item.valorAplicado * item.quantidade);
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
