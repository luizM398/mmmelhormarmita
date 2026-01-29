const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes'); // Garanta que este arquivo existe
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração para processar JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const TEMPO_INATIVO = 10 * 60 * 1000; // 10 minutos

// ⚠️⚠️ COLOQUE SEU NÚMERO AQUI (Com 55 e DDD) ⚠️⚠️
const NUMERO_ADMIN = '5551984050946'; 

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

function carregarMenu() {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');
    const workbook = xlsx.readFile(arquivo);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return xlsx.utils.sheet_to_json(sheet);
  } catch (error) {
    console.error("ERRO AO LER MENU.XLSX: Verifique se o arquivo está na raiz.");
    return [];
  }
}

function encerrouPorInatividade(cliente) {
  if (!cliente.ultimoContato) return false;
  return Date.now() - cliente.ultimoContato > TEMPO_INATIVO;
}

function erroComUltimaMensagem(cliente) {
  return (
    `❌ Não entendi.\n` +
    `Por favor, digite apenas o número da opção.\n\n` +
    (cliente.ultimaMensagem || menuPrincipal())
  );
}

// --- FUNÇÃO DE FRETE ---
function calcularFrete(textoEndereco) {
  const endereco = textoEndereco.toLowerCase();

  // 1. ZONA LOCAL (Perto) - R$ 8,00
  const zonaLocal = ['lomba do pinheiro', 'agronomia', 'parada', 'pda', 'joão de oliveira', 'são pedro'];
  if (zonaLocal.some(bairro => endereco.includes(bairro))) {
    return { valor: 8.00, texto: "R$ 8,00" };
  }

  // 2. ZONA ALVO (Bairros Nobres) - R$ 20,00
  const zonaAlvo = ['bela vista', 'moinhos', 'mont serrat', 'auxiliadora', 'rio branco', 'petropolis', 'petrópolis', 'três figueiras', 'chácara das pedras'];
  if (zonaAlvo.some(bairro => endereco.includes(bairro))) {
    return { valor: 20.00, texto: "R$ 20,00" };
  }

  // 3. ZONA INTERMEDIÁRIA (Caminho/Regional) - R$ 15,00
  const zonaMedia = [
    'restinga', 'partenon', 'bento', 'intercap', 'jardim botânico', 'jardim botanico', 
    'santana', 'são josé', 'sao jose', 'santa maria'
  ];
  if (zonaMedia.some(bairro => endereco.includes(bairro))) {
    return { valor: 15.00, texto: "R$ 15,00" };
  }

  // 4. ZONA BLOQUEADA (Muito Longe)
  const zonaBloqueada = ['hípica', 'belém novo', 'lami', 'sarandi', 'humaitá', 'navegantes', 'centro histórico', 'rubem berta', 'centro', 'viamão', 'viamao'];
  if (zonaBloqueada.some(bairro => endereco.includes(bairro))) {
    return { erro: true, msg: "🚫 Desculpe, ainda não realizamos entregas nesta região (muito distante da nossa cozinha)." };
  }

  // 5. NÃO IDENTIFICADO
  return null; 
}

// Função para enviar MENSAGEM DE TEXTO
async function enviarMensagemWA(numero, texto) {
  const token = process.env.WASENDER_TOKEN || 'SUA_CHAVE_AQUI';
  const numeroLimpo = String(numero).replace(/\D/g, '');

  try {
    await axios.post(
      'https://www.wasenderapi.com/api/send-message',
      {
        to: numeroLimpo,
        text: texto
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Mensagem enviada para ${numeroLimpo}`);
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err.response?.data || err.message);
  }
}

// ================= ROTAS =================

app.get('/', (req, res) => {
  res.send('Servidor da Marmita ON! 🚀');
});

app.post('/mensagem', async (req, res) => {
  try {
    const body = req.body;
    
    // 1. Validação
    if (body.event !== 'messages.received') return res.status(200).json({ ok: true });
    const dadosMensagem = body?.data?.messages;
    if (!dadosMensagem) return res.status(200).json({ ok: true });

    // 2. Identificação
    const remoteJid = dadosMensagem.key?.remoteJid || "";
    const fromMe = dadosMensagem.key?.fromMe;
    if (remoteJid.includes('status@broadcast')) return res.status(200).json({ ok: true });
    if (remoteJid.includes('@g.us')) return res.status(200).json({ ok: true });
    if (fromMe === true) return res.status(200).json({ ok: true });

    let numeroRaw = dadosMensagem.key?.cleanedSenderPn || dadosMensagem.key?.senderPn || remoteJid;
    const numero = String(numeroRaw).split('@')[0].replace(/\D/g, '');

    // 3. Extração Texto
    const texto = 
      dadosMensagem.messageBody || 
      dadosMensagem.message?.conversation || 
      dadosMensagem.message?.extendedTextMessage?.text || 
      "";

    if (!texto || !numero) return res.status(200).json({ ok: true });

    const mensagem = texto.trim().toLowerCase();
    
    // --- LÓGICA DO BOT ---
    
    const cliente = estadoClientes.getEstado(numero);
    let resposta = '';

    // Verifica Inatividade
    if (encerrouPorInatividade(cliente) && cliente.estado !== 'INICIAL') {
      estadoClientes.limparPedido(numero);
      const msgReiniciar = `⏰ *Atendimento encerrado por inatividade.*\n\n` + saudacaoTexto() + `\n\n` + menuPrincipal();
      await enviarMensagemWA(numero, msgReiniciar);
      cliente.ultimoContato = Date.now();
      cliente.estado = 'MENU';
      return res.status(200).json({ ok: true });
    }

    cliente.ultimoContato = Date.now();

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
        cliente.estado = 'MENU'; 
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
      await enviarMensagemWA(numero, erroComUltimaMensagem(cliente));
      return res.status(200).json({ ok: true });
    }

    // ================= MENU PRINCIPAL =================
    if (cliente.estado === 'MENU') {
      if (mensagem === '1') { // Ver Cardápio
        const dados = carregarMenu();
        if(dados.length === 0) { await enviarMensagemWA(numero, "Cardápio indisponível."); return res.status(200).json({ok:true}); }
        let cardapio = `🍱 *Cardápio do Dia*\n\n`;
        dados.forEach(item => { cardapio += `🔹 ${item.PRATO} – R$ ${item.VALOR}\n`; });
        cardapio += `\nPara fazer seu pedido, digite *2*.\nOu digite *0* para voltar.`;
        await enviarMensagemWA(numero, cardapio);
        return res.status(200).json({ ok: true });
      }

      if (mensagem === '2') { // Fazer Pedido
        const dados = carregarMenu();
        if(dados.length === 0) { await enviarMensagemWA(numero, "Cardápio indisponível."); return res.status(200).json({ok:true}); }
        let lista = `🍽️ *Digite o NÚMERO do prato que deseja:*\n\n`;
        dados.forEach((item, i) => { lista += `${i + 1}️⃣  ${item.PRATO}\n`; });
        lista += `\n0️⃣ Voltar ao menu`;
        cliente.estado = 'ESCOLHENDO_PRATO';
        cliente.opcoesPrato = dados;
        cliente.ultimaMensagem = lista;
        await enviarMensagemWA(numero, lista);
        return res.status(200).json({ ok: true });
      }

      if (mensagem === '3') { // Elogios
        cliente.estado = 'ELOGIOS';
        resposta = `💬 *Espaço do Cliente*\nEscreva abaixo seu elogio, sugestão ou reclamação:\n\n(Digite 0 para voltar)`;
        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      
      if (mensagem === '0') { await enviarMensagemWA(numero, menuPrincipal()); return res.status(200).json({ ok: true }); }
      await enviarMensagemWA(numero, `🤷‍♂️ Opção inválida.\n\n` + menuPrincipal());
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
        await enviarMensagemWA(numero, "❌ Número inválido. Digite o número que aparece ao lado do prato.");
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
        await enviarMensagemWA(numero, resposta);
      }
      return res.status(200).json({ ok: true });
    }

    // ================= VARIAÇÃO ARROZ =================
    if (cliente.estado === 'VARIACAO_ARROZ') {
      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      if (mensagem === '1' || mensagem.includes('branco')) itemAtual.arroz = 'Branco';
      else if (mensagem === '2' || mensagem.includes('integral')) itemAtual.arroz = 'Integral';
      else { await enviarMensagemWA(numero, "❌ Opção inválida. Digite 1 ou 2."); return res.status(200).json({ ok: true }); }

      if (cliente.precisaStrogonoff) {
        cliente.estado = 'VARIACAO_STROGONOFF';
        resposta = `🍛 *Qual tipo de strogonoff?*\n\n1️⃣ Tradicional\n2️⃣ Light`;
        await enviarMensagemWA(numero, resposta);
      } else {
        cliente.estado = 'QUANTIDADE';
        resposta = `🔢 Digite a *quantidade*:`;
        await enviarMensagemWA(numero, resposta);
      }
      return res.status(200).json({ ok: true });
    }

    // ================= VARIAÇÃO STROGONOFF =================
    if (cliente.estado === 'VARIACAO_STROGONOFF') {
      const itemAtual = cliente.pedido[cliente.pedido.length - 1];
      if (mensagem === '1' || mensagem.includes('tradicional')) itemAtual.strogonoff = 'Tradicional';
      else if (mensagem === '2' || mensagem.includes('light')) itemAtual.strogonoff = 'Light';
      else { await enviarMensagemWA(numero, "❌ Opção inválida. Digite 1 ou 2."); return res.status(200).json({ ok: true }); }
      cliente.estado = 'QUANTIDADE';
      resposta = `🔢 Digite a *quantidade*:`;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ================= QUANTIDADE =================
    if (cliente.estado === 'QUANTIDADE') {
      const qtd = parseInt(mensagem);
      if (isNaN(qtd) || qtd < 1) { await enviarMensagemWA(numero, "❌ Digite um número válido maior que 0."); return res.status(200).json({ ok: true }); }
      cliente.pedido[cliente.pedido.length - 1].quantidade = qtd;
      cliente.estado = 'ADICIONAR_OUTRO';
      resposta = `✅ *Adicionado!*\n\nDeseja pedir mais alguma coisa?\n\n1️⃣ Sim, escolher outro prato\n2️⃣ Não, fechar pedido`;
      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta);
      return res.status(200).json({ ok: true });
    }

    // ================= FECHAR PEDIDO (Onde a mágica da Promoção acontece) =================
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
        // CÁLCULO DE PROMOÇÃO
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
          `📍 Agora, por favor, digite seu *ENDEREÇO COMPLETO* (Rua, Número e Bairro):`;

        cliente.ultimaMensagem = resposta;
        await enviarMensagemWA(numero, resposta); 
        return res.status(200).json({ ok: true });
      }
      await enviarMensagemWA(numero, "❌ Opção inválida. Digite 1 ou 2.");
      return res.status(200).json({ ok: true });
    }

    // ================= ENDEREÇO & FRETE (Aqui ele soma o frete) =================
    if (cliente.estado === 'AGUARDANDO_ENDERECO') {
      cliente.endereco = texto; 
      const frete = calcularFrete(texto);
      
      // Bloqueio
      if (frete && frete.erro) {
         await enviarMensagemWA(numero, frete.msg);
         return res.status(200).json({ ok: true });
      }

      // Recálculo (Garantia)
      const totalMarmitas = cliente.pedido.reduce((acc, item) => acc + item.quantidade, 0);
      const valorUnitario = totalMarmitas >= 5 ? 17.49 : 19.99;
      const subtotalMarmitas = totalMarmitas * valorUnitario;

      let totalComFrete = 0;
      let textoFrete = "";

      // Cálculo Final
      if (frete && !frete.erro) {
         totalComFrete = subtotalMarmitas + frete.valor;
         textoFrete = frete.texto;
      } else {
         totalComFrete = subtotalMarmitas; // Valor parcial
         textoFrete = "A calcular (Atendente irá informar)";
      }

      cliente.totalFinal = totalComFrete;
      
      // MUDANÇA: Agora pergunta o pagamento
      cliente.estado = 'ESCOLHENDO_PAGAMENTO';
      
      resposta = 
        `✅ *Endereço Recebido!*\n\n` +
        `📝 *Fechamento da Conta:*\n` +
        `Subtotal Comida: R$ ${subtotalMarmitas.toFixed(2)}\n` +
        `Frete: ${textoFrete}\n` +
        `💰 *TOTAL: R$ ${totalComFrete.toFixed(2)}*\n\n` +
        `💳 *Qual a forma de pagamento?*\n` +
        `1️⃣ PIX (Chave Copia e Cola)\n` +
        `2️⃣ Dinheiro (Na entrega)\n` +
        `3️⃣ Cartão (Maquininha na entrega)`;

      cliente.ultimaMensagem = resposta;
      await enviarMensagemWA(numero, resposta); 
      return res.status(200).json({ ok: true });
    }

    // ================= FORMA DE PAGAMENTO (Novo Passo Final) =================
    if (cliente.estado === 'ESCOLHENDO_PAGAMENTO') {
      cliente.pagamento = texto; // Salva o que o cliente digitou (Ex: "1", "Pix", "Dinheiro")
      
      cliente.estado = 'FINALIZADO';

      // Resposta ao Cliente
      resposta = 
        `✅ *Pedido Confirmado com Sucesso!*\n\n` +
        `Recebemos seu pedido e sua forma de pagamento.\n` +
        `Em instantes, um de nossos atendentes entrará em contato para confirmar e enviar a chave Pix (se for o caso).\n\n` +
        `Muito obrigado pela preferência! 😋🍱`;
      
      await enviarMensagemWA(numero, resposta);

      // AVISO AO DONO (VOCÊ)
      let resumoDono = `🔔 *NOVO PEDIDO FINALIZADO!* 🔔\n\n`;
      resumoDono += `👤 Cliente: https://wa.me/${numero}\n`;
      resumoDono += `📍 Endereço: *${cliente.endereco}*\n`;
      resumoDono += `💳 Pagamento: *${cliente.pagamento}*\n`; // Mostra o que ele escolheu
      resumoDono += `💰 Total: R$ ${cliente.totalFinal.toFixed(2)}\n\n`;
      resumoDono += `📝 *Itens:*\n`;
      
      cliente.pedido.forEach(item => {
          resumoDono += `- ${item.quantidade}x ${item.prato} (${item.arroz || '-'} / ${item.strogonoff || '-'})\n`;
      });

      if (NUMERO_ADMIN !== '5551999999999') {
          await enviarMensagemWA(NUMERO_ADMIN, resumoDono);
      } else {
        console.log("⚠️ Configure o NUMERO_ADMIN para receber o alerta.");
      }

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
      
      await enviarMensagemWA(numero, `✅ Obrigado! Sua mensagem foi registrada.\n\n` + menuPrincipal());
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
