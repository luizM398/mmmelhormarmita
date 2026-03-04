// ARQUIVO: gerador_pdf.js
// Este arquivo cuida exclusivamente de desenhar e gerar a Nota Fiscal em PDF.

const axios = require('axios');

async function gerarPDFGratis(cliente) {
    try {
        console.log("⏳ Gerando PDF Profissional (API2PDF)...");
        const MINHA_API_KEY = "9409e59e-8602-4930-8c1e-bcf796639659"; 

        if (MINHA_API_KEY === "COLE_SUA_API_KEY_AQUI") return null;

        const urlLogo = "https://i.postimg.cc/R0J0ccxD/Chat-GPT-Image-8-de-fev-de-2026-08-07-06.png"; 
        const corDestaque = "#ff6b00"; 
        const corTitulo = "#000000";   
        const corVerde = "#009e2a";    

        const dataPedido = new Date().toLocaleDateString('pt-BR');
        const horaPedido = new Date().toLocaleTimeString('pt-BR').substring(0,5);

        let subtotalCalculado = 0;
        let subtotalSemDesconto = 0;
        let teveAlgumDesconto = false;

        const linhasTabela = cliente.pedido.map(item => {
            const vlUnitario = item.valorAplicado;
            const vlTotal = item.quantidade * vlUnitario;
            
            subtotalCalculado += vlTotal;
            subtotalSemDesconto += (item.quantidade * 19.99); // Usa 19.99 como base de comparação
            
            const ehPromo = vlUnitario < 19.99;
            if (ehPromo) teveAlgumDesconto = true;

            let nomeCompleto = item.prato;
            if (item.arroz === 'Integral') nomeCompleto = nomeCompleto.replace(/Arroz/i, 'Arroz integral');
            if (item.strogonoff === 'Light') nomeCompleto = nomeCompleto.replace(/strogonoff/i, 'strogonoff light');

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
        
        let htmlSubtotal = teveAlgumDesconto 
            ? `<div style="margin-bottom:5px;">Subtotal: <span style="text-decoration:line-through; color:#999;">R$ ${subtotalSemDesconto.toFixed(2).replace('.', ',')}</span> <strong style="color:${corVerde}">R$ ${subtotalCalculado.toFixed(2).replace('.', ',')}</strong></div>`
            : `<div style="margin-bottom:5px;">Subtotal: <strong>R$ ${subtotalCalculado.toFixed(2).replace('.', ',')}</strong></div>`;

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

// Exporta a função para o index.js usar depois
module.exports = gerarPDFGratis;
