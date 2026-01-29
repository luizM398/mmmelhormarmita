const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes'); 
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const TEMPO_INATIVO = 10 * 60 * 1000; // 10 minutos

// ⚠️ SEU NÚMERO
const NUMERO_ADMIN = '5551999999999'; 

const timersClientes = {};

// ================= FUNÇÕES AUXILIARES =================

function saudacaoTexto() {
  return (
    `👋 Olá! Seja muito bem-vindo(a) à *Melhor Marmita* 🍱\n` +
    `Comida caseira, saborosa e feita com carinho! 😋`
  );
}

function menuPrincipal() {
  return (
    `🔻 *Menu Principal*\n\n` +
    `1️⃣  Ver Cardápio do Dia\n` +
    `2️⃣  Fazer Pedido\n` +
    `3️⃣  Elogios ou Reclamações\n\n` +
    `_Digite o número da opção desejada._`
  );
}

// (NOVA) Função Padronizada de Erro
function msgNaoEntendi(textoAnterior) {
  return (
    `🤔 *Não entendi sua resposta.*\n` +
    `Por favor, escolha uma das opções abaixo:\n\n` +
    `-----------------------------\n` +
    (textoAnterior || menuPrincipal())
  );
}

function carregarMenu() {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');
    const workbook = xlsx.readFile(arquivo);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return xlsx.utils.sheet_to_json(sheet);
  } catch (error) {
    console.error("ERRO MENU.XLSX: Verifique o arquivo.");
    return [];
  }
}

// --- TIMER DE INATIVIDADE ---
function iniciarTimerInatividade(numero) {
  if (timersClientes[numero]) clearTimeout(timersClientes[numero]);

  timersClientes[numero] = setTimeout(async () => {
    const cliente = estadoClientes.getEstado(numero);
    
    // Só encerra se não estiver no menu inicial
    if (cliente.estado !== 'INICIAL' && cliente.estado !== 'MENU') {
      console.log(`[TIMEOUT] Encerrando ${numero}.`);
      estadoClientes.limparPedido(numero);
      
      // Mantém false para ele receber saudação na proxima, ou true se preferir que vá direto ao menu
      // Vou deixar false para reiniciar o ciclo completo se ele voltar daqui a 3 dias
      const novoEstado = estadoClientes.getEstado(numero);
      novoEstado.recebeuSaudacao = false; 

      await enviarMensagemWA(numero, `💤 *Atendimento encerrado por falta de interação.*\nSeu pedido foi limpo. Quando quiser retomar, é só dar um Oi! 👋`);
    }
    delete timersClientes[numero];
  }, TEMPO_INATIVO);
}

// --- CÁLCULO DE FRETE (Corrigido Acentos) ---
function calcularFrete(textoEndereco) {
  const endereco = textoEndereco.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ""); // Remove acentos para facilitar a busca (hipica = hípica)

  // 1. ZONA LOCAL - R$ 8,00
  const zonaLocal = ['lomba do pinheiro', 'agronomia', 'parada', 'pda', 'joao de oliveira', 'sao pedro'];
  if (zonaLocal.some(bairro => endereco.includes(bairro))) {
    return { valor: 8.00, texto: "R$ 8,00" };
  }

  // 2. ZONA ALVO - R$ 20,00
  const zonaAlvo = ['bela vista', 'moinhos', 'mont serrat', 'auxiliadora', 'rio branco', 'petropolis', 'tres figueiras', 'chacara das pedras'];
  if (zonaAlvo.some(bairro => endereco.includes(bairro))) {
    return { valor: 20.00, texto: "R$ 20,00" };
  }

  // 3. ZONA INTERMEDIÁRIA - R$ 15,00
  const zonaMedia = [
    'restinga', 'partenon', 'bento', 'intercap', 'jardim botanico', 
    'santana', 'sao jose', 'santa maria'
  ];
  if (zonaMedia.some(bairro => endereco.includes(bairro))) {
    return { valor: 15.00, texto: "R$ 15,00" };
  }

  // 4. ZONA BLOQUEADA (Adicionado versões sem acento)
  const zonaBloqueada = [
    'hipica', 'belem novo', 'lami', 'sarandi', 'humaita', 'navegantes', 
    'centro historico', 'rubem berta', 'centro', 'viamao'
  ];
  if (zonaBloqueada.some(bairro => endereco.includes(bairro))) {
    return { erro: true, msg: "🚫 Desculpe, ainda não realizamos entregas nesta região (muito distante da nossa cozinha)." };
  }

  // 5. NÃO IDENTIFICADO
  return null; 
}

// Enviar Mensagem
async function enviarMensagemWA(numero, texto) {
  const token = process.env.WASENDER_TOKEN || 'SUA_CHAVE_AQUI';
  const numeroLimpo = String(numero).replace(/\D/g, '');

  try {
    await axios.post(
      'https://www.wasenderapi.com/api/send-message',
      { to: numeroLimpo, text: texto },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error(`Erro envio msg ${numeroLimpo}:`, err.message);
  }
}

// ================= ROTAS =================

app.get('/', (req, res) => { res.send('Servidor V4 ON! 🚀'); });

app.post('/mensagem', async (req, res) => {
  try {
    const body = req.body;
    if (body.event !== 'messages.received') return res.status(200).json({ ok: true });
    
    const dadosMensagem = body?.data?.messages;
    if (!dadosMensagem) return res.status(200).json({ ok: true });

    const remoteJid = dadosMensagem.key?.remoteJid || "";
    const fromMe = dadosMensagem.key?.fromMe;
    if (remoteJid.includes('status@broadcast') || remoteJid.includes('@g.us') || fromMe) return res.status(200).json({ ok: true });

    let numeroRaw = dadosMensagem.key?.cleanedSenderPn || dadosMensagem.key?.senderPn || remoteJid;
    const numero = String(numeroRaw).split('@')[0].replace(/\D/g, '');
    
    const texto = dadosMensagem.messageBody || dadosMensagem.message?.conversation || dadosMensagem.message?.extendedTextMessage?.text || "";
    if (!texto || !numero) return res.status(200).json({ ok: true });

    const mensagem = texto.trim().toLowerCase();

    iniciarTimerInatividade(numero);
    
    const cliente = estadoClientes.getEstado(numero);
    cliente.ultimoContato = Date.now();
    let resposta = '';

    // ===== PRIMEIRO CONTATO =====
    if (!cliente.recebeuSaudacao) {
      cliente.recebeuSaudacao = true;
      cliente.estado = 'MENU';
      resposta = saudacaoTexto() + `\n\n` + menuPrincipal();
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }
    
    // ===== CANCELAR GERAL =====
    if (mensagem === 'cancelar') {
      cliente.estadoAnterior = cliente.estado;
      cliente.mensagemAntesDoCancelar = cliente.ultimaMensagem;
      cliente.estado = 'CONFIRMAR_CANCELAMENTO';
      resposta = `⚠️ Tem certeza que deseja cancelar o pedido?\n\n1️⃣ Sim, cancelar\n2️⃣ Não, continuar`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    if (cliente.estado === 'CONFIRMAR_CANCELAMENTO') {
      if (mensagem === '1') {
        estadoClientes.limparPedido(numero);
        
        // (CORREÇÃO BUG 3) Força saudação true para não repetir o "Olá"
        const clienteResetado = estadoClientes.getEstado(numero);
        clienteResetado.recebeuSaudacao = true; 
        clienteResetado.estado = 'MENU'; 
        
        resposta = `❌ Pedido cancelado.\n\n` + menuPrincipal();
        await enviarMensagemWA(numero, resposta);
        return res.status(200).json({ ok: true });
      }
      if (mensagem === '2') {
        cliente.estado = cliente.estadoAnterior || 'MENU';
        resposta = cliente.mensagemAntesDoCancelar;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      // (CORREÇÃO BUG 2) Mensagem de erro padrão
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
      return res.status(200).json({ ok: true });
    }

    // ================= MENU PRINCIPAL =================
    if (cliente.estado === 'MENU') {
      if (mensagem === '1') { // Ver Cardápio
        const dados = carregarMenu();
        if(dados.length === 0) { await enviarMensagemWA(numero, "Cardápio indisponível."); return res.status(200).json({ok:true}); }
        
        let cardapio = `🍱 *Cardápio do Dia*\n`;
        cardapio += `🔥 *PROMOÇÃO:* Acima de 5 unid = *R$ 17,49/un*!\n\n`;
        dados.forEach(item => { cardapio += `🔹 ${item.PRATO} – R$ ${item.VALOR}\n`; });
        cardapio += `\nPara fazer seu pedido, digite *2*.\nOu digite *0* para voltar.`;
        
        // (CORREÇÃO 1) Muda estado para evitar loop se digitar 1 de novo
        cliente.estado = 'VENDO_CARDAPIO';
        cliente.ultimaMensagem = cardapio; 

        await enviarMensagemWA(numero, cardapio);
        return res.status(200).json({ ok: true });
      }

      if (mensagem === '2') { // Fazer Pedido
        const dados = carregarMenu();
        if(dados.length === 0) { await enviarMensagemWA(numero, "Cardápio indisponível."); return res.status(200).json({ok:true}); }
        
        let lista = `🍽️ *Vamos montar seu pedido!*\n`;
        lista += `🔥 *PROMOÇÃO:* Acima de 5 unid = *R$ 17,49/un*\n\n`;
        lista += `Digite o NÚMERO do prato que deseja:\n\n`;
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
      
      // Erro Padrão
      await enviarMensagemWA(numero, msgNaoEntendi(menuPrincipal()));
      return res.status(200).json({ ok: true });
    }

    // (NOVO ESTADO) VENDO CARDÁPIO
    if (cliente.estado === 'VENDO_CARDAPIO') {
       if (mensagem === '2') {
         // Vai pro pedido (reaproveita logica acima ou força o cliente a digitar 2 no menu)
         // Vamos redirecionar manualmente para o estado de escolha
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
       
       // Qualquer outra coisa (tipo '1') cai aqui
       await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
       return res.status(200).json({ ok: true });
    }

    // ================= ESCOLHENDO PRATO =================
    if (cliente.estado === 'ESCOLHENDO_PRATO') {
      if (mensagem === '0') {
        cliente.estado = 'MENU';
        await enviarMensagemWA(numero, menuPrincipal());
        return res.status(200).json({ ok: true });
      }
      const escolha = parseInt(mensagem);
      if (isNaN(escolha) || escolha < 1 || escolha > cliente.opcoesPrato.length) {
        await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); // Erro Padrão
        return res.status(200).json({ ok: true });
      }
      const prato = cliente.opcoesPrato[escolha - 1];
      const nomePrato = prato.PRATO.toLowerCase();
      cliente.pedido.push({ prato: prato.PRATO, valor: prato.VALOR, arroz: null, strogonoff: null, quantidade: 0 });
      cliente.precisaArroz = nomePrato.includes('arroz');
      cliente.precisaStrogonoff = nomePrato.includes('strogonoff');

      if (cliente.precisaArroz) {
        cliente.estado = 'VARIACAO_ARROZ';
        resposta = `🍚 *Qual tipo de arroz?*\n\n1️⃣ Branco\n2️⃣ Integral`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
      } else if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta = `🍛 *Qual tipo de strogonoff?*\n\n1️⃣ Tradicional\n2️⃣ Light`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `🔢 Digite a *quantidade* para ${prato.PRATO}:`;
        cliente.ultimaMensagem = resposta; // Salva para repetir se errar
        await enviarMensagemWA(numero, resposta);
      }
      return res.status(200).json({ ok: true });
    }

    // ================= VARIAÇÃO ARROZ =================
    if (cliente.estado === 'VARIACAO_ARROZ') {
      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      if (mensagem === '1' || mensagem.includes('branco')) itemAtual.arroz = 'Branco';
      else if (mensagem === '2' || mensagem.includes('integral')) itemAtual.arroz = 'Integral';
      else { 
        // (CORREÇÃO BUG 2) Erro Padrão
        await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); 
        return res.status(200).json({ ok: true }); 
      }

      if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta = `🍛 *Qual tipo de strogonoff?*\n\n1️⃣ Tradicional\n2️⃣ Light`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `🔢 Digite a *quantidade*:`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta);
      }
      return res.status(200).json({ ok: true });
    }

    // ================= VARIAÇÃO STROGONOFF =================
    if (cliente.estado === 'VARIACAO_STROGONOFF') {
      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      if (mensagem === '1' || mensagem.includes('tradicional')) itemAtual.strogonoff = 'Tradicional';
      else if (mensagem === '2' || mensagem.includes('light')) itemAtual.strogonoff = 'Light';
      else { 
         // (CORREÇÃO BUG 2) Erro Padrão
        await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem)); 
        return res.status(200).json({ ok: true }); 
      }
      cliente.estado = 'QUANTIDADE';
      resposta = `🔢 Digite a *quantidade*:`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ================= QUANTIDADE =================
    if (cliente.estado === 'QUANTIDADE') {
      const qtd = parseInt(mensagem);
      if (isNaN(qtd) || qtd < 1) { 
        await enviarMensagemWA(numero, "❌ Por favor, digite um número válido (ex: 1, 2, 3)."); 
        return res.status(200).json({ ok: true }); 
      }
      cliente.pedido[cliente.pedido.length - 1].quantidade = qtd;
      cliente.estado = 'ADICIONAR_OUTRO';
      resposta = `✅ *Adicionado!*\n\nDeseja pedir mais alguma coisa?\n\n1️⃣ Sim, escolher outro prato\n2️⃣ Não, fechar pedido`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }

    // ================= FECHAR PEDIDO =================
    if (cliente.estado === 'ADICIONAR_OUTRO') {
      if (mensagem === '1' || mensagem.includes('sim')) {
        cliente.estado = 'ESCOLHENDO_PRATO';
        const dados = carregarMenu();
        let lista = `🍽️ *Escolha mais um prato:*\n`;
        lista += `(Lembre-se: 5+ unidades sai por R$ 17,49/cada)\n\n`;
        dados.forEach((item, i) => { lista += `${i + 1}️⃣  ${item.PRATO}\n`; });
        lista += `\n0️⃣ Cancelar tudo`;
        cliente.opcoesPrato = dados;
        cliente.ultimaMensagem = lista; // Salva para erro
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
        resposta = 
          msgPromo +
          `------------------------------\n` +
          `🥡 *Resumo do Pedido:*\n` +
          `Marmitas: ${totalMarmitas}\n` +
          `Valor: ${resumoPreco}\n` +
          `💰 *Subtotal: R$ ${subtotal}* (Sem frete)\n` +
          `------------------------------\n\n` +
          `📍 Agora, digite seu *ENDEREÇO COMPLETO* (Rua, Número e Bairro):`;

        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      
      await enviarMensagemWA(numero, msgNaoEntendi(cliente.ultimaMensagem));
      return res.status(200).json({ ok: true });
    }

    // ================= ENDEREÇO & FRETE =================
    if (cliente.estado === 'AGUARDANDO_ENDERECO') {
      cliente.endereco = texto; 
      // (CORREÇÃO BUG 5) Função calcularFrete atualizada com normalização de acentos
      const frete = calcularFrete(texto);
      
      if (frete && frete.erro) {
         await enviarMensagemWA(numero, frete.msg);
         return res.status(200).json({ ok: true });
      }

      const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
      const valorUnitario = totalMarmitas >= 5 ? 17.49 : 19.99;
      const subtotalMarmitas = totalMarmitas * valorUnitario;

      let totalComFrete = 0;
      let textoFrete = "";

      if (frete && !frete.erro) {
         totalComFrete = subtotalMarmitas + frete.valor;
         textoFrete = frete.texto;
      } else {
         totalComFrete = subtotalMarmitas; 
         textoFrete = "A calcular (Atendente irá informar)";
      }

      cliente.totalFinal = totalComFrete;
      cliente.estado = 'ESCOLHENDO_PAGAMENTO';
      
      resposta = 
        `✅ *Endereço Recebido!*\n\n` +
        `📝 *Fechamento da Conta:*\n` +
        `Subtotal Comida: R$ ${subtotalMarmitas.toFixed(2)}\n` +
        `Frete: ${textoFrete}\n` +
        `💰 *TOTAL: R$ ${totalComFrete.toFixed(2)}*\n\n` +
        `🚚 *Entrega prevista: de 3 a 5 dias* (Sob encomenda)\n\n` +
        `💳 *Qual a forma de pagamento?*\n` +
        `1️⃣ PIX (Chave Copia e Cola)\n` +
        `2️⃣ Dinheiro (Na entrega)\n` +
        `3️⃣ Cartão (Maquininha na entrega)`;

      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ================= FORMA DE PAGAMENTO =================
    if (cliente.estado === 'ESCOLHENDO_PAGAMENTO') {
      cliente.pagamento = texto; 
      
      if (timersClientes[numero]) clearTimeout(timersClientes[numero]);

      cliente.estado = 'FINALIZADO';

      resposta = 
        `✅ *Pedido Confirmado com Sucesso!*\n\n` +
        `Recebemos seu pedido e sua forma de pagamento.\n` +
        `Em instantes, um de nossos atendentes entrará em contato para confirmar e enviar a chave Pix (se for o caso).\n\n` +
        `Muito obrigado pela preferência! 😋🍱`;
      
      await enviarMensagemWA(numero, resposta);

      // (DEDO DURO)
      console.log(`Enviando alerta para ADMIN: ${NUMERO_ADMIN}`);
      let resumoDono = `🔔 *NOVO PEDIDO FINALIZADO!* 🔔\n\n`;
      resumoDono += `👤 Cliente: https://wa.me/${numero}\n`;
      resumoDono += `📍 Endereço: *${cliente.endereco}*\n`;
      resumoDono += `💳 Pagamento: *${cliente.pagamento}*\n`; 
      resumoDono += `💰 Total: R$ ${cliente.totalFinal.toFixed(2)}\n\n`;
      resumoDono += `📝 *Itens:*\n`;
      cliente.pedido.forEach(item => {
          resumoDono += `- ${item.quantidade}x ${item.prato} (${item.arroz || '-'} / ${item.strogonoff || '-'})\n`;
      });

      if (NUMERO_ADMIN !== '5551999999999') await enviarMensagemWA(NUMERO_ADMIN, resumoDono);

      return res.status(200).json({ ok: true });
    }

    // ================= ELOGIOS =================
    if (cliente.estado === 'ELOGIOS') {
      if (mensagem === '0') {
        cliente.estado = 'MENU';
        await enviarMensagemWA(numero, menuPrincipal());
        return res.status(200).json({ ok: true });
      }
      console.log(`[FEEDBACK] Cliente ${numero}: ${texto}`);
      cliente.estado = 'MENU';
      await enviarMensagemWA(numero, `✅ Obrigado! Sua mensagem foi registrada e entraremos em contato caso seja necessário.\n\n` + menuPrincipal());
      return res.status(200).json({ ok: true });
    }

    // FALLBACK
    await enviarMensagemWA(numero, saudacaoTexto() + `\n\n` + menuPrincipal());
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Erro fatal:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
