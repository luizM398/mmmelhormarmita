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
// 📄 GERADOR DE PDF (COM PROMOÇÃO E LOGO)
// ----------------------------------------------------------------------
async function gerarPDFGratis(cliente) {
    try {
        console.log("⏳ Gerando PDF Inteligente com Logo...");

        // Configurações Visuais
        const urlLogo = "https://i.postimg.cc/R0J0ccxD/Chat-GPT-Image-8-de-fev-de-2026-08-07-06.png"; 
        const corPrincipal = "#ff6b00"; // Laranja
        const corPrecoNovo = "#009e2a"; // Verde (Dinheiro/Economia)

        // Verifica Promoção (5 ou mais marmitas)
        const qtdTotal = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
        const ehPromo = qtdTotal >= 5;

        const precoNormal = 19.99;
        const precoPromo = 17.49;

        // Monta as linhas da tabela
        const linhasTabela = cliente.pedido.map(item => {
            const totalItemNormal = item.quantidade * precoNormal;
            const totalItemPromo = item.quantidade * precoPromo;

            let colunaPreco = "";
            
            if (ehPromo) {
                // Efeito "DE / POR"
                colunaPreco = `
                    <div style="font-size: 11px; color: #999; text-decoration: line-through;">
                        de R$ ${totalItemNormal.toFixed(2).replace('.', ',')}
                    </div>
                    <div style="font-size: 14px; color: ${corPrecoNovo}; font-weight: bold;">
                        por R$ ${totalItemPromo.toFixed(2).replace('.', ',')}
                    </div>
                `;
            } else {
                colunaPreco = `R$ ${totalItemNormal.toFixed(2).replace('.', ',')}`;
            }

            // Formata nome do prato (Tira vírgulas extras para caber)
            let nomePrato = item.prato.replace(/, /g, ' ').substring(0, 35);

            return `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                    <span style="font-weight:bold;">${item.quantidade}x</span> ${nomePrato}
                </td>
                <td style="text-align: right; padding: 10px; border-bottom: 1px solid #eee;">
                    ${colunaPreco}
                </td>
            </tr>`;
        }).join('');

        // Cálculos Totais
        const subtotalSemDesconto = qtdTotal * precoNormal;
        const subtotalComDesconto = qtdTotal * precoPromo;
        
        let htmlSubtotal = "";
        if (ehPromo) {
             htmlSubtotal = `
                <p>Subtotal: <span style="text-decoration: line-through; color: #999;">R$ ${subtotalSemDesconto.toFixed(2).replace('.', ',')}</span> 
                   <strong style="color: ${corPrecoNovo};"> R$ ${subtotalComDesconto.toFixed(2).replace('.', ',')}</strong>
                </p>
                <p style="font-size: 10px; color: ${corPrecoNovo}; margin-top: -5px;">(Desconto aplicado! 🎉)</p>
             `;
        } else {
             htmlSubtotal = `<p>Subtotal: R$ ${subtotalSemDesconto.toFixed(2).replace('.', ',')}</p>`;
        }

        const totalFinalCalculado = ehPromo ? subtotalComDesconto + cliente.valorFrete : subtotalSemDesconto + cliente.valorFrete;

        // HTML COMPLETO
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Helvetica', sans-serif; color: #333; }
            .container { max-width: 100%; padding: 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { max-width: 100px; margin-bottom: 10px; }
            .titulo { color: ${corPrincipal}; font-size: 22px; font-weight: bold; margin: 0; }
            
            .info-box { background: #fdfdfd; padding: 15px; border-radius: 8px; font-size: 14px; margin-bottom: 20px; border: 1px solid #eee; border-left: 5px solid ${corPrincipal}; }
            
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th { text-align: left; color: #555; font-size: 12px; text-transform: uppercase; border-bottom: 2px solid #ddd; padding: 5px; }
            
            .totais { text-align: right; margin-top: 20px; font-size: 14px; }
            .total-final { font-size: 20px; font-weight: bold; color: ${corPrincipal}; margin-top: 10px; border-top: 1px solid #ddd; padding-top: 10px; display: inline-block;}
            
            .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #aaa; }
        </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <img src="${urlLogo}" class="logo">
                    <div class="titulo">MELHOR MARMITA</div>
                    <div style="color: #777; font-size: 12px;">Pedido #${Math.floor(Math.random() * 8999) + 1000}</div>
                </div>

                <div class="info-box">
                    <strong>Cliente:</strong> ${cliente.nome}<br>
                    <strong>Entrega em:</strong> ${cliente.endereco}
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Itens</th>
                            <th style="text-align: right;">Valor</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${linhasTabela}
                    </tbody>
                </table>

                <div class="totais">
                    ${htmlSubtotal}
                    <p>Taxa de Entrega: R$ ${cliente.valorFrete.toFixed(2).replace('.', ',')}</p>
                    <div class="total-final">TOTAL: R$ ${totalFinalCalculado.toFixed(2).replace('.', ',')}</div>
                    <br>
                    <span style="font-size: 12px; background: #eee; padding: 5px 10px; border-radius: 20px;">
                        Pagamento: ${cliente.pagamentoConfirmado ? 'CONFIRMADO ✅' : 'Pendente'}
                    </span>
                </div>

                <div class="footer">
                    <p>Obrigado pela preferência! 😋</p>
                    <p>Gerado em ${new Date().toLocaleString('pt-BR')}</p>
                </div>
            </div>
        </body>
        </html>
        `;

        // Chamada à API QuickChart
        const urlAPI = `https://quickchart.io/pdf?html=${encodeURIComponent(html)}`;
        const response = await axios.get(urlAPI, { responseType: 'arraybuffer' });
        
        // Converte para Base64 (O WhatsApp precisa disso)
        const base64PDF = Buffer.from(response.data, 'binary').toString('base64');
        return base64PDF;

    } catch (error) {
        console.error("❌ Erro ao gerar PDF:", error);
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

    if (distanciaKm <= 3.0) { valor = 5.00; texto = "R$ 5,00"; } 
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

async function gerarLinkPagamento(itens, frete, clienteTelefone) {
  try {
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
        back_urls: {
          success: `https://wa.me/${NUMERO_ADMIN ? NUMERO_ADMIN.replace('@c.us','') : ''}?text=Oi!%20Pagamento%20concluido!`,
          failure: `https://wa.me/${NUMERO_ADMIN ? NUMERO_ADMIN.replace('@c.us','') : ''}`,
          pending: `https://wa.me/${NUMERO_ADMIN ? NUMERO_ADMIN.replace('@c.us','') : ''}`
        },
        auto_return: "approved"
      }
    });
    return response.init_point;
  } catch (error) { return null; }
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

              // 4. MENSAGEM FINAL E AVISO AO ADMIN
              const msgAdmin = `🔔 *NOVO PEDIDO PAGO!* 👨‍🍳🔥\n👤 *CLIENTE:* ${memoria.nome}\n📍 *ENTREGA:* ${memoria.endereco}\n💰 *TOTAL: R$ ${valorPago.toFixed(2)}*`;
              
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
  return `🔻 *Menu Principal para${nomeDisplay}*\n\n1️⃣  Ver Cardápio 🍱\n2️⃣  Fazer Pedido 🛒\n3️⃣  Falar com Atendente (Sugestões/Críticas) 💬\n\n_Escolha uma opção digitando o número._`;
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

// 🆕 Envia PDF (Base64)
async function enviarPDFWA(numero, base64, nomeArquivo) {
    const numeroLimpo = String(numero).replace(/\D/g, '');
    try {
      // Tenta enviar usando o formato padrão de Base64
      // Se sua API usar outro endpoint (ex: /send-file), mude a URL abaixo
      await axios.post('https://www.wasenderapi.com/api/send-message', 
        { 
            to: numeroLimpo, 
            text: "Aqui está seu comprovante! 👇",
            mediaMessage: {
                mediatype: "document",
                fileName: nomeArquivo,
                media: base64
            }
        }, 
        { headers: { Authorization: `Bearer ${process.env.WASENDER_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      console.log("📄 PDF enviado com sucesso!");
    } catch (err) { 
      console.error(`Erro envio PDF:`, err.message); 
      // Fallback: Se der erro no PDF, avisa no console
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

    const isFinalDeSemana = (diaSemana === 0 || diaSemana === 6);
    const isForaDoHorario = (horaAtual < 8 || horaAtual >= 18);

    if (isFinalDeSemana || isForaDoHorario) {
        if (numero !== process.env.NUMERO_ADMIN && numero !== NUMERO_ADMIN.replace('@c.us', '')) {
            const avisoFechado = `🍱 *Olá! A Melhor Marmita agradece seu contato.*\n\n🚫 No momento estamos *FECHADOS*.\n\n⏰ Horário: Seg a Sex, das 08h às 18h.`;
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
    let cardapio = `🍱 *Cardápio do Dia para ${cliente.nome}*\n🔥 *PROMOÇÃO:* Acima de 5 unid = *R$ 17,49/un*!\n⚖️ Peso: 400g\n\n`;
    dados.forEach(item => { cardapio += `🔹 ${item.PRATO} – R$ 19,99\n`; });
    cardapio += `\nDigite *2* para pedir.`;
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
    await enviarMensagemWA(numero, `💬 *Fale com o Atendente*\nEscreva sua mensagem abaixo (0 para voltar):`); 
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
         cliente.estado = 'AGUARDANDO_PAGAMENTO';
     } else { await enviarMensagemWA(numero, "⚠️ Erro no PIX. Tente novamente."); }
  } 
  else if (mensagem === '2' || mensagem.includes('cartao')) {
     await enviarMensagemWA(numero, "💳 *Gerando link...*");
     const link = await gerarLinkPagamento(cliente.pedido, cliente.valorFrete, numero);
     if (link) {
         await enviarMensagemWA(numero, `✅ *Clique para pagar:*\n${link}`);
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
  await enviarMensagemWA(numero, `✅ Obrigado! Mensagem enviada.\n\n` + menuPrincipal(cliente.nome));
  return res.status(200).json({ ok: true });
}

    await enviarMensagemWA(numero, `👋 Olá! Bem-vindo de volta!\n\n` + menuPrincipal(cliente.nome));
    return res.status(200).json({ ok: true });

  } catch (error) { console.error('❌ ERRO GERAL:', error.message); return res.status(200).json({ ok: true }); }
});

app.listen(PORT, () => { console.log(`🚀 Servidor Melhor Marmita rodando na porta ${PORT}`); });
