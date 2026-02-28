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

// 👇 SEU NÚMERO PARA RECEBER OS FEEDBACKS (Pega do Render)
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
// 📄 GERADOR DE PDF PROFISSIONAL (VISUAL LIMPO E INTEGRADO)
// ----------------------------------------------------------------------
async function gerarPDFGratis(cliente) {
    try {
        console.log("⏳ Gerando PDF Profissional (API2PDF)...");

        // 👇 SUA CHAVE DO SITE AQUI
        const MINHA_API_KEY = "9409e59e-8602-4930-8c1e-bcf796639659"; 

        if (MINHA_API_KEY === "COLE_SUA_API_KEY_AQUI") {
            console.log("⚠️ ERRO: API KEY não configurada!");
            return null;
        }

        // 1. Configurações Visuais
        const urlLogo = "https://i.postimg.cc/R0J0ccxD/Chat-GPT-Image-8-de-fev-de-2026-08-07-06.png"; 
        const corDestaque = "#ff6b00"; // Laranja do Logo
        const corTitulo = "#000000";   // Preto
        const corVerde = "#009e2a";    // Verde Promoção

        // 2. Lógica de Promoção e Data
        const qtdTotal = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
        const ehPromo = qtdTotal >= 5;
        
        const dataPedido = new Date().toLocaleDateString('pt-BR');
        const horaPedido = new Date().toLocaleTimeString('pt-BR').substring(0,5);

        const precoNormal = 19.99; 
        const precoPromo = 17.49; 

        // 3. Monta as Linhas da Tabela (AGORA COM NOMES INTELIGENTES)
        const linhasTabela = cliente.pedido.map(item => {
            // Cálculos
            const vlUnitario = ehPromo ? precoPromo : precoNormal;
            const vlTotal = item.quantidade * vlUnitario;
            
            // 🔥 LÓGICA NOVA DE NOME (INTEGRADO)
            let nomeCompleto = item.prato;

            // Regra do ARROZ (Só muda se for Integral)
            if (item.arroz === 'Integral') {
                // Procura 'Arroz' (maiúsculo ou minúsculo) e troca por 'Arroz integral'
                nomeCompleto = nomeCompleto.replace(/Arroz/i, 'Arroz integral');
            }
            // Se for 'Branco', não faz nada (fica só "Arroz")

            // Regra do STROGONOFF (Só muda se for Light)
            if (item.strogonoff === 'Light') {
                // Procura 'strogonoff' e troca por 'strogonoff light'
                nomeCompleto = nomeCompleto.replace(/strogonoff/i, 'strogonoff light');
            }
            // Se for 'Tradicional', não faz nada

            // HTML do Preço Unitário
            let htmlUnitario = "";
            if (ehPromo) {
                htmlUnitario = `
                <div style="font-size:10px; color:#999; text-decoration:line-through;">R$ ${precoNormal.toFixed(2).replace('.', ',')}</div>
                <div style="font-size:12px; color:${corVerde}; font-weight:bold;">R$ ${precoPromo.toFixed(2).replace('.', ',')}</div>`;
            } else {
                htmlUnitario = `<div style="font-size:12px;">R$ ${precoNormal.toFixed(2).replace('.', ',')}</div>`;
            }

            // HTML do Preço Total da Linha
            let htmlTotalLinha = "";
            if (ehPromo) {
                const totalSemDesc = item.quantidade * precoNormal;
                htmlTotalLinha = `
                <div style="font-size:10px; color:#999; text-decoration:line-through;">R$ ${totalSemDesc.toFixed(2).replace('.', ',')}</div>
                <div style="font-size:13px; color:${corVerde}; font-weight:bold;">R$ ${vlTotal.toFixed(2).replace('.', ',')}</div>`;
            } else {
                htmlTotalLinha = `<div style="font-size:13px; font-weight:bold;">R$ ${vlTotal.toFixed(2).replace('.', ',')}</div>`;
            }

            // Retorna a linha da tabela
            return `
            <tr>
                <td style="padding:10px 5px; border-bottom:1px solid #eee; text-align:center; font-weight:bold;">${item.quantidade}</td>
                <td style="padding:10px 5px; border-bottom:1px solid #eee; text-align:left;">${nomeCompleto}</td>
                <td style="padding:10px 5px; border-bottom:1px solid #eee; text-align:right;">${htmlUnitario}</td>
                <td style="padding:10px 5px; border-bottom:1px solid #eee; text-align:right;">${htmlTotalLinha}</td>
            </tr>`;
        }).join('');

        // 4. Totais Finais
        const subtotalSem = qtdTotal * precoNormal;
        const subtotalCom = qtdTotal * precoPromo;
        const totalFinal = ehPromo ? subtotalCom + cliente.valorFrete : subtotalSem + cliente.valorFrete;
        
        let htmlSubtotal = ehPromo 
            ? `<div style="margin-bottom:5px;">Subtotal: <span style="text-decoration:line-through; color:#999;">R$ ${subtotalSem.toFixed(2).replace('.', ',')}</span> <strong style="color:${corVerde}">R$ ${subtotalCom.toFixed(2).replace('.', ',')}</strong></div>`
            : `<div style="margin-bottom:5px;">Subtotal: <strong>R$ ${subtotalSem.toFixed(2).replace('.', ',')}</strong></div>`;

        // 5. HTML COMPLETO
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
                    <tr>
                        <th style="width: 10%;">QTD</th>
                        <th style="width: 50%; text-align: left;">DESCRIÇÃO</th>
                        <th style="width: 20%; text-align: right;">UNITÁRIO</th>
                        <th style="width: 20%; text-align: right;">TOTAL</th>
                    </tr>
                </thead>
                <tbody>
                    ${linhasTabela}
                </tbody>
            </table>

            <div class="totais-box">
                ${htmlSubtotal}
                <div class="linha-total">Taxa de Entrega: R$ ${cliente.valorFrete.toFixed(2).replace('.', ',')}</div>
                <div class="total-final">TOTAL: R$ ${totalFinal.toFixed(2).replace('.', ',')}</div>
                <div style="margin-top:10px; font-size:12px; background:#eaffea; display:inline-block; padding:5px 10px; border-radius:15px; color:#007a1e;">
                    Pagamento: CONFIRMADO ✅
                </div>
            </div>

            <div class="footer">
                <p>Obrigado pela preferência! 🍱</p>
                <p>Este documento não possui valor fiscal.</p>
            </div>
        </body>
        </html>
        `;

        // 6. GERAÇÃO (API2PDF)
        const response = await axios.post('https://v2.api2pdf.com/chrome/pdf/html', 
            {
                html: html,
                inlinePdf: true,
                fileName: 'nota_fiscal.pdf',
                options: { printBackground: true, pageSize: 'A4' } 
            },
            { headers: { 'Authorization': MINHA_API_KEY } }
        );

        const pdfUrl = response.data.FileUrl;
        if (!pdfUrl) return null;

        const fileResponse = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        const base64PDF = Buffer.from(fileResponse.data, 'binary').toString('base64');
        
        return base64PDF;

    } catch (error) {
        console.error("❌ Erro API2PDF:", error.message);
        return null;
    }
}

// ----------------------------------------------------------------------
// 🚚 MOTOR DE FRETE
// ----------------------------------------------------------------------
async function calcularFreteGoogle(cepDestino) {
  console.log(`🔎 [DEBUG] Iniciando cálculo para o CEP: ${cepDestino}`);
  
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
    
    let valor = 0;
    let texto = "";

    if (distanciaKm <= 3.0) { valor = 0.00; texto = "R$ 0,00"; } 
    else if (distanciaKm <= 8.0) { valor = 10.00; texto = "R$ 10,00"; }
    else if (distanciaKm <= 14.0) { valor = 15.00; texto = "R$ 15,00"; }
    else if (distanciaKm <= 20.0) { valor = 20.00; texto = "R$ 20,00"; }
    else { return { erro: true, msg: "🚫 Muito distante (fora da área de entrega de 20km)." }; }

    return { valor, texto, endereco: enderecoTexto };

  } catch (error) {
    console.error("🔥 [ERRO FRETE]:", error.message);
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
    return { copiaCola: response.point_of_interaction.transaction_data.qr_code, idPagamento: response.id };
  } catch (error) { 
    console.error("Erro Pix:", error.message);
    return null; 
  }
}

// ----------------------------------------------------------------------
// 🔗 GERAR LINK (CORRIGIDO PARA VOLTAR PRO ROBÔ)
// ----------------------------------------------------------------------
async function gerarLinkPagamento(itens, frete, clienteTelefone) {
  try {
    // 👇👇👇 COLOQUE O NÚMERO DA MARMITARIA AQUI (Com 55 + DDD) 👇👇👇
    const SEU_NUMERO_LOJA = "5551984050946"; 

    const preference = new Preference(client);
    const totalMarmitas = itens.reduce((acc, i) => acc + i.quantidade, 0);
    

    const precoUnitario = totalMarmitas >= 5 ? 17.49 : 19.99; 

    const items = itens.map(item => ({
      title: item.prato,
      quantity: Number(item.quantidade),
      unit_price: Number(precoUnitario),
      currency_id: 'BRL'
    }));

    if (frete > 0) {
      items.push({ title: 'Taxa de Entrega', quantity: 1, unit_price: Number(frete), currency_id: 'BRL' });
    }

    const response = await preference.create({
      body: {
        items: items,
        external_reference: String(clienteTelefone).replace(/\D/g, ''),
        // Aqui está a correção: agora volta para a LOJA
        back_urls: {
          success: `https://wa.me/${SEU_NUMERO_LOJA}`,
          failure: `https://wa.me/${SEU_NUMERO_LOJA}`,
          pending: `https://wa.me/${SEU_NUMERO_LOJA}`
        },
        auto_return: "approved"
      }
    });
    return response.init_point;
  } catch (error) { 
      console.error("Erro Link:", error);
      return null; 
  }
}

// ----------------------------------------------------------------------
// 🔔 WEBHOOK (AQUI É ONDE O PDF É GERADO E ENVIADO)
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
              
              // 1. Avisa que está fazendo a nota
              await enviarMensagemWA(numeroCliente, "✅ Pagamento recebido! Estou gerando sua Nota Fiscal... 📄");

              // 2. GERA O PDF
              const pdfBase64 = await gerarPDFGratis(memoria);

              // 3. ENVIA O PDF (Se deu certo)
              if (pdfBase64) {
                  await enviarPDFWA(numeroCliente, pdfBase64, `Nota_Fiscal_${data.id}.pdf`);
              } else {
                  await enviarMensagemWA(numeroCliente, "🧾 Segue comprovante simples (PDF indisponível no momento).");
              }

              // 4. MENSAGEM FINAL E AVISO AO ADMIN (DETALHADO)
              
              // A) Monta a lista de itens igual ao PDF
              const resumoItens = memoria.pedido.map(item => {
                  let nomePrato = item.prato;
                  // Ajusta nome se for Integral ou Light
                  if (item.arroz === 'Integral') nomePrato = nomePrato.replace(/Arroz/i, 'Arroz integral');
                  if (item.strogonoff === 'Light') nomePrato = nomePrato.replace(/strogonoff/i, 'strogonoff light');
                  
                  return `▪️ *${item.quantidade}x* ${nomePrato}`;
              }).join('\n');

              // B) Mensagem para o DONO (Você)
              const msgAdmin = `🔔 *NOVO PEDIDO PAGO!* 👨‍🍳🔥\n\n` +
                  `👤 *Cliente:* ${memoria.nome}\n` +
                  `📱 *Zap:* ${numeroCliente}\n` +
                  `📍 *Endereço:* ${memoria.endereco}\n` +
                  `📝 *Compl:* ${memoria.complemento || 'Sem compl.'}\n\n` +
                  `🍲 *PEDIDO:*\n${resumoItens}\n\n` +
                  `🚚 *Frete:* R$ ${memoria.valorFrete.toFixed(2)}\n` +
                  `💰 *TOTAL PAGO: R$ ${valorPago.toFixed(2)}*`;
              
              // C) Envia para o Cliente
              await enviarMensagemWA(numeroCliente, `Muito obrigado, ${memoria.nome}! Seu pedido já foi para a cozinha. 🍱🔥`);
              
              // D) Envia para o Admin
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
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');
    const workbook = xlsx.readFile(arquivo);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return xlsx.utils.sheet_to_json(sheet);
  } catch (error) { return []; }
}

// ⏱️ TIMER
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

// Envia Texto Simples
async function enviarMensagemWA(numero, texto) {
  const numeroLimpo = String(numero).replace(/\D/g, '');
  try {
    await axios.post('https://www.wasenderapi.com/api/send-message', 
      { to: numeroLimpo, text: texto }, 
      { headers: { Authorization: `Bearer ${process.env.WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) { console.error(`Erro envio msg:`, err.message); }
}

// Função NOVA: Upload + Envio (Seguindo o suporte do WaSender)
async function enviarPDFWA(numero, base64, nomeArquivo) {
    const numeroLimpo = String(numero).replace(/\D/g, '');
    try {
        console.log(`☁️ Fazendo Upload do PDF para o WaSender...`);

        // PASSO 1: Fazer Upload para pegar URL pública deles
        // Eles pediram o prefixo "data:application/pdf;base64,"
        const base64ComPrefixo = base64.startsWith('data:') 
            ? base64 
            : `data:application/pdf;base64,${base64}`;

        const uploadBody = {
            base64: base64ComPrefixo,
            fileName: nomeArquivo
        };

        const uploadRes = await axios.post('https://www.wasenderapi.com/api/upload', 
            uploadBody, 
            { headers: { Authorization: `Bearer ${process.env.WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
        );

        if (!uploadRes.data.success || !uploadRes.data.publicUrl) {
            throw new Error("Falha no Upload: " + JSON.stringify(uploadRes.data));
        }

        const urlSegura = uploadRes.data.publicUrl;
        console.log(`✅ Upload feito! URL Segura: ${urlSegura}`);

        // PASSO 2: Enviar a mensagem usando a URL deles
        console.log(`📤 Enviando mensagem final...`);
        
        const sendBody = {
            to: numeroLimpo,
            text: "Aqui está seu comprovante! 👇",
            documentUrl: urlSegura, // A chave mágica que eles pediram
            fileName: nomeArquivo
        };

        const sendRes = await axios.post('https://www.wasenderapi.com/api/send-message', 
            sendBody, 
            { headers: { Authorization: `Bearer ${process.env.WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
        );

        console.log("📡 Resposta Final:", JSON.stringify(sendRes.data));

    } catch (err) { 
        console.error(`❌ Erro no fluxo WaSender:`, err.message); 
        if (err.response) console.error("Detalhes:", err.response.data);
    }
}

// ----------------------------------------------------------------------
// 🚀 ROTAS DE EXECUÇÃO
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
    
    // Horário e FDS
    const dataBrasil = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const diaSemana = dataBrasil.getDay(); 
    const horaAtual = dataBrasil.getHours();

    const isFinalDeSemana = (diaSemana === 0);
    const isForaDoHorario = (horaAtual < 8 || horaAtual >= 18);

    if (isFinalDeSemana || isForaDoHorario) {
        if (numero !== process.env.NUMERO_ADMIN && numero !== NUMERO_ADMIN.replace('@c.us', '')) {
            const avisoFechado = `🍱 *Olá! A Melhor Marmita agradece seu contato.*\n\n🚫 No momento estamos *FECHADOS*.\n\n⏰ Horário: Seg a Sáb, das 08h às 18h.\n\nResponderemos assim que iniciarmos nosso expediente! 👋`;
            await enviarMensagemWA(numero, avisoFechado);
            return res.status(200).json({ ok: true });
        }
    }

    const cliente = estadoClientes.getEstado(numero);
    iniciarTimerInatividade(numero);
    cliente.ultimoContato = Date.now();

    if (mensagem === 'cancelar' || mensagem === 'desistir') {
        if (cliente.pagamentoConfirmado) {
            await enviarMensagemWA(numero, "❌ *Pedido em produção!* O pagamento já foi aprovado. Para alterações, fale com o suporte.");
        } else {
            estadoClientes.limparCarrinhoManterMenu(numero);
            await enviarMensagemWA(numero, "✅ Pedido cancelado.");
            await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
        }
        return res.status(200).json({ ok: true });
    }
    console.log(`📩 Cliente ${numero} (${cliente.estado}): "${mensagem}"`);

// 👋 INICIO E FLUXO DE PEDIDOS (MANTIDO IGUAL)
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
    let cardapio = `🍱 *Cardápio do Dia para ${cliente.nome}*\n🔥 *PROMOÇÃO:* Acima de 5 unid \n o valor cai de ~~19,99~~ para *R$ 17,49/un*!\n⚖️ Peso: 400g\n\n`;
    dados.forEach(item => { cardapio += `🔹 ${item.PRATO} – R$ 19,99\n`; });
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
  if (mensagem === '0') {
    cliente.estado = 'MENU';
    await enviarMensagemWA(numero, menuPrincipal(cliente.nome));
    return res.status(200).json({ ok: true });
  }
  await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
  return res.status(200).json({ ok: true });
}

if (cliente.estado === 'ESCOLHENDO_PRATO') {
  if (mensagem === '0') { estadoClientes.limparCarrinhoManterMenu(numero); await enviarMensagemWA(numero, menuPrincipal(cliente.nome)); return res.status(200).json({ ok: true }); }
  const escolha = parseInt(mensagem);
  if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) { await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); return res.status(200).json({ ok: true }); }
  
  const prato = cliente.opcoesPrato[escolha - 1];
  cliente.pedido.push({ prato: prato.PRATO, valor: 19.99, arroz: null, strogonoff: null, quantidade: 0 });
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
    const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
    let valorUnitario = totalMarmitas >= 5 ? 17.49 : 19.99; 
    let msgPromo = totalMarmitas >= 5 ? "🎉 *PROMOÇÃO ATIVA!* (Acima de 5 un)\n" : "";
    const subtotal = (totalMarmitas * valorUnitario).toFixed(2);
    cliente.totalMarmitas = totalMarmitas; 
    cliente.subtotal = parseFloat(subtotal);
    cliente.estado = 'AGUARDANDO_CEP'; 
    let resposta = `📝 *Resumo do Pedido:*\n${msgPromo}📦 Itens: ${totalMarmitas} marmitas\n💰 *Subtotal: R$ ${subtotal.replace('.', ',')}*\n----------------\n📍 Digite seu *CEP* para calcular o frete:`;
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
    const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
    const valorUnitario = totalMarmitas >= 5 ? 17.49 : 19.99;
    cliente.valorFrete = frete.valor; 
    cliente.totalFinal = (totalMarmitas * valorUnitario) + frete.valor;
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
  await enviarMensagemWA(NUMERO_ADMIN, `🚨 *FEEDBACK:* ${cliente.nome} (${numero}): ${texto}`);
  cliente.estado = 'MENU';
  await enviarMensagemWA(numero, `✅ Obrigado! Se necessário, um atendente entrará em contato.\n\n` + menuPrincipal(cliente.nome));
  return res.status(200).json({ ok: true });
}

    await enviarMensagemWA(numero, `👋 Olá! Bem-vindo de volta!\n\n` + menuPrincipal(cliente.nome));
    return res.status(200).json({ ok: true });

  } catch (error) { console.error('❌ ERRO GERAL:', error.message); return res.status(200).json({ ok: true }); }
});

app.listen(PORT, () => { console.log(`🚀 Servidor Melhor Marmita rodando na porta ${PORT}`); });
