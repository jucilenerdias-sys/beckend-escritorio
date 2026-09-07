// arquivo: server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { OpenAI, toFile } = require('openai'); // 🚀 IMPORTAÇÃO OBRIGATÓRIA DA V2 (Blindagem 404)
const fs = require('fs');
const { SYSTEM_PROMPT } = require('./prompts');
const PDFDocument = require('pdfkit');
// IMPORTAÇÃO DA NOVA FÁBRICA DE WORD
const { Document, Packer, Paragraph, TextRun, AlignmentType } = require('docx'); 

const app = express();
const port = process.env.PORT || 3001;

// Configuração Nativa do OpenAI com injeção global do cabeçalho V2
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultHeaders: { "OpenAI-Beta": "assistants=v2" }
});

// Middlewares no server.js
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));

// Configuração do Multer para receber arquivos (PDFs) em memória
const upload = multer({ storage: multer.memoryStorage() });

// --- ROTA DE TESTE ---
app.get('/', (req, res) => {
  res.send('O Motor Jurídico está rodando perfeitamente!');
});

// --- ROTA PRINCIPAL DA IA (Petições e PJe) ---
app.post('/api/processar', upload.single('documento'), async (req, res) => {
  
  // 🚨 RAIO-X INJETADO: O terminal sempre vai avisar o que chegou!
  console.log(`\n🛎️ [RAIO-X] Nova requisição recebida na rota /api/processar`);
  console.log(`👉 Modo Solicitado: ${req.body.modo || 'NENHUM'}`);
  console.log(`👉 Arquivo PDF Anexado?: ${req.file ? 'SIM ✅' : 'NÃO ❌'}`);
  console.log(`👉 Prompt Recebido?: ${req.body.promptMestre ? 'SIM ✅' : 'NÃO ❌'}`);

  try {
    const modo = req.body.modo;
    
    // =========================================================================
    // ROTA 1: SE O USUÁRIO MANDOU SÓ TEXTO MANUAL
    // =========================================================================
    if (modo === 'texto' && req.body.texto) {
      console.log("🟢 Iniciando ROTA 1: Leitura de texto manual...");
      const response = await openai.chat.completions.create({
        model: "gpt-4o", 
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Analise este texto:\n\n${req.body.texto}` }
        ],
        temperature: 0.1, 
      });
      return res.status(200).json(JSON.parse(response.choices[0].message.content));
    }

    // =========================================================================
    // ROTA 2: LEITURA DE PDF (RESUMO PJE)
    // =========================================================================
    if (modo === 'pdf' && req.file) {
      console.log("🟢 Iniciando ROTA 2: Assistant API (Resumo PJe)...");
      
      const fileStream = await openai.files.create({
          file: await toFile(req.file.buffer, "documento_pje.pdf"), // 🛡️ BLINDAGEM DA API V2
          purpose: "assistants",
      });
      const fileId = fileStream.id;

      const assistant = await openai.beta.assistants.create({
        name: "Analista PJe",
        instructions: SYSTEM_PROMPT,
        model: "gpt-4-turbo", // 🚀 Rotação estratégica de motor
        temperature: 0.1, 
        tools: [{ type: "file_search" }],
        response_format: { type: "json_object" }
      });

      const thread = await openai.beta.threads.create({
        messages: [{
            role: "user",
            content: "USE A FERRAMENTA DE BUSCA AGORA. 1º passo: Busque o cabeçalho e título na Página 1. 2º passo: Busque pelas palavras exatas 'Acordo', 'Conciliação' e 'Litisconsórcio'. 3º passo: Busque a conclusão ou pedidos. Após encontrar esses dados exatos, gere o JSON com resumos BEM LONGOS, obedecendo cegamente o SYSTEM_PROMPT.",
            attachments: [{ file_id: fileId, tools: [{ type: "file_search" }] }]
        }],
      });

      let run = await openai.beta.threads.runs.createAndPoll(thread.id, { assistant_id: assistant.id });

      if (run.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(thread.id);
        const respostaTexto = messages.data[0].content[0].text.value;
        
        try {
            await openai.files.delete(fileId);
            await openai.beta.assistants.delete(assistant.id);
            console.log("✅ Limpeza de segurança (Rota 2) concluída.");
        } catch (cleanupError) {
            console.error("Aviso: Falha na limpeza da lixeira, mas o processo finalizou.", cleanupError.message);
        }

        try {
            const regex = /{[\s\S]*}/;
            const match = respostaTexto.match(regex);
            if (match) {
                return res.status(200).json(JSON.parse(match[0].trim()));
            } else { 
                throw new Error("Nenhum formato de dados encontrado na resposta."); 
            }
        } catch (erroParse) {
            console.error("⚠️ IA tagarelou ou falhou na leitura.", erroParse.message);
            return res.status(200).json({
                resumo: "⚠️ A IA não conseguiu extrair os dados processuais. Revisão manual necessária.",
                precisaPeticao: true,
                prazoDias: 0,
                rascunho: "Não foi possível gerar um rascunho.",
                tipoTarefa: "Intimação do Painel PJE"
            });
        }
      } else { 
        throw new Error(`O assistente falhou com status: ${run.status}`); 
      }
    }

    // =========================================================================
    // ROTA 3: GERAÇÃO DE PEÇA JURÍDICA (MÁQUINA UNIVERSAL)
    // =========================================================================
    if (modo === 'gerar_peticao' && req.file && req.body.promptMestre) {
      console.log("🟢 ROTA 3: MÁQUINA DE PETIÇÕES ATIVADA. Lendo Processo/Provas...");
      
      const fileStream = await openai.files.create({
          file: await toFile(req.file.buffer, "provas_cliente.pdf"), // 🛡️ BLINDAGEM DA API V2
          purpose: "assistants",
      });
      const fileId = fileStream.id;

      const assistant = await openai.beta.assistants.create({
        name: "Redator Jurídico",
        instructions: "Você é um redator jurídico rigoroso e Advogado Sênior. Leia o PDF inteiro anexado. EXTRAIA TODOS os fatos vitais solicitados no prompt. NUNCA resuma de forma genérica. NUNCA utilize marcações de citação como 【4:11 source】 ou similares. Produza um texto denso, exaustivo e implacável.",
        model: "gpt-4-turbo", // 🚀 Rotação estratégica de motor
        temperature: 0.1, 
        tools: [{ type: "file_search" }]
      });

      const thread = await openai.beta.threads.create({
        messages: [{
            role: "user",
            content: req.body.promptMestre,
            attachments: [{ file_id: fileId, tools: [{ type: "file_search" }] }]
        }]
      });

      let run = await openai.beta.threads.runs.createAndPoll(thread.id, { assistant_id: assistant.id });
      
      if (run.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(thread.id);
        const peticaoGerada = messages.data[0].content[0].text.value;
        
        try {
            await openai.files.delete(fileId);
            await openai.beta.assistants.delete(assistant.id);
            console.log("✅ Limpeza de segurança (Rota 3) concluída.");
        } catch (e) { 
            console.error("Aviso: Falha na limpeza da lixeira (Rota 3).", e.message);
        }

        // 🚀 FILTRO EXTERMINADOR (Antivírus de Citações e Lixo)
        let peticaoLimpa = peticaoGerada;
        peticaoLimpa = peticaoLimpa.replace(/[【\[]?\s*\d+:\d+\s*.*?source.*?\]?】?/gi, '');
        peticaoLimpa = peticaoLimpa.replace(/[【\[]?\s*\d+:\d+\s*.*?†.*?\]?】?/gi, '');
        peticaoLimpa = peticaoLimpa.replace(/[【\[]?provas_cliente\.pdf[】\]]?/gi, '');
        peticaoLimpa = peticaoLimpa.replace(/【.*?】/g, '').replace(/【/g, '').replace(/】/g, '');

        // 🧠 CALADOR DE GRITOS 4.0 (Blindagem Máxima PJe)
        peticaoLimpa = peticaoLimpa.split('\n').map(linha => {
             let limpa = linha.trim();
             const isTituloRomano = /^(I|II|III|IV|V|VI)\.\s/.test(limpa.toUpperCase());
             const isEnderecamento = limpa.toUpperCase().startsWith('EXCELENTÍSSIMO') || limpa.toUpperCase().startsWith('AÇÃO DE');
             
             if (limpa.length > 15 && !isTituloRomano && !isEnderecamento) {
                 const apenasLetras = limpa.replace(/[^a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]/g, '');
                 if (apenasLetras.length > 10 && apenasLetras === apenasLetras.toUpperCase()) {
                     return limpa.charAt(0).toUpperCase() + limpa.slice(1).toLowerCase();
                 }
             }
             return linha;
        }).join('\n');

        console.log("✅ Peça redigida e higienizada com sucesso!");
        return res.status(200).json({ respostaTexto: peticaoLimpa.trim() });
      } else { 
        throw new Error(`A IA não conseguiu redigir a peça. Status: ${run.status}`); 
      }
    }
    
    console.log("🔴 ERRO DE ROTEAMENTO: Nenhum 'modo' correspondeu aos parâmetros enviados.");
    return res.status(400).json({ error: "Requisição inválida. Verifique o 'modo' e os arquivos enviados." });

  } catch (error) {
    console.error("🔴 ERRO NO SERVIDOR:", error.message || error);
    res.status(500).json({ error: error.message || "Erro interno no servidor." });
  }
});

// =========================================================================
// ROTA 6: MOTOR DE VISÃO COMPUTACIONAL (OCR + VLM ESTRUTURADO)
// =========================================================================
app.post('/api/visao-computacional', upload.array('documentos', 10), async (req, res) => {
  console.log(`\n👁️‍🗨️ [VISÃO COMPUTACIONAL] Recebendo ${req.files ? req.files.length : 0} documento(s) para análise neural...`);

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Nenhum arquivo enviado para análise." });
  }

  const fileIds = [];
  let assistantId = null;

  try {
    for (const file of req.files) {
      const fileStream = await openai.files.create({
        file: await toFile(file.buffer, file.originalname), // 🛡️ BLINDAGEM DA API V2
        purpose: "assistants",
      });
      fileIds.push(fileStream.id);
      console.log(`✅ Arquivo carregado na memória da IA: ${file.originalname}`);
    }

    console.log(`⏳ Criando Assistente Neural...`);
    const assistant = await openai.beta.assistants.create({
      name: "Auditor VLM",
      instructions: `Você é um robô de auditoria médica e previdenciária. 
      Sua única missão é ler os documentos anexados (CNIS, laudos, atestados, receitas) e extrair os dados OBRIGATORIAMENTE no formato JSON puro.
      Seja implacável na matemática do CNIS e preciso na extração dos CIDs. Se uma informação não existir, retorne null ou array vazio.
      
      ESTRUTURA OBRIGATÓRIA DE RETORNO:
      {
        "tipoDocumento": "String (Ex: 'Apenas Laudos', 'Apenas CNIS', 'Misto')",
        "dadosMedicos": [
          { "cid": "String", "descricao": "String", "data_diagnostico": "String", "medico": "String", "crm": "String" }
        ],
        "dadosCNIS": {
          "tempoTotalContribuicao": "String (Ex: 14 anos, 5 meses e 12 dias)",
          "qualidadeSegurado": "String (Ativa, Período de Graça, ou Perdida)",
          "ultimaContribuicao": "String (MM/AAAA)",
          "carenciaAtingida": true/false,
          "alertas": ["String (Alertas sobre indicadores PEXT, pendências, etc)"]
        }
      }`,
      model: "gpt-4-turbo", // 🚀 Rotação estratégica de motor
      temperature: 0.1,
      tools: [{ type: "file_search" }] // Removido o response_format para blindar contas contra bloqueios 404
    });
    assistantId = assistant.id;

    console.log(`✅ Assistente criado com sucesso: ${assistantId}`);

    const attachments = fileIds.map(id => ({ file_id: id, tools: [{ type: "file_search" }] }));
    
    const thread = await openai.beta.threads.create({
      messages: [{
        role: "user",
        content: "Analise os documentos em anexo e extraia os dados rigorosamente no formato JSON solicitado.",
        attachments: attachments
      }]
    });

    console.log(`🧠 Processando rede neural (Isso pode levar alguns segundos)...`);
    let run = await openai.beta.threads.runs.createAndPoll(thread.id, { assistant_id: assistant.id });

    if (run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(thread.id);
      let respostaTexto = messages.data[0].content[0].text.value;
      
      // Limpeza de possíveis marcações Markdown da resposta da IA
      respostaTexto = respostaTexto.replace(/```json/gi, '').replace(/```/gi, '').trim();
      
      console.log("✅ Análise estruturada concluída com sucesso!");
      res.status(200).json(JSON.parse(respostaTexto));
    } else {
      throw new Error(`Falha no processamento. Status: ${run.status}`);
    }

  } catch (error) {
    console.error("🔴 ERRO NA VISÃO COMPUTACIONAL:", error.message || error);
    res.status(500).json({ error: error.message || "Erro interno ao processar documentos." });
  } finally {
    // 4. LIMPEZA DE SEGURANÇA IMPIEDOSA
    for (const id of fileIds) {
      try { await openai.files.delete(id); } catch (e) {}
    }
    if (assistantId) {
      try { await openai.beta.assistants.delete(assistantId); } catch (e) {}
    }
    console.log("🧹 Memória e arquivos da OpenAI deletados com segurança.");
  }
});

// =========================================================================
// ROTA 4: FÁBRICA DE PDF PROFISSIONAL (Padrão PJe)
// =========================================================================
app.post('/api/gerar-pdf', (req, res) => {
  try {
    console.log("🟢 ROTA 4: FÁBRICA DE PDF ACIONADA. Montando documento blindado...");
    const { texto } = req.body;
    if (!texto) return res.status(400).json({ error: "Nenhum texto fornecido." });

    const doc = new PDFDocument({ size: 'A4', margins: { top: 71, bottom: 71, left: 57, right: 57 } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Peticao.pdf"');
    doc.pipe(res);

    const linhas = texto.split('\n');
    linhas.forEach(linha => {
        let txt = linha.trim()
            .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2013\u2014]/g, '-').replace(/[\u2026]/g, '...')
            .replace(/\*\*/g, '') 
            .replace(/[^\x00-\xFF]/g, '');  

        if (txt === '') { doc.moveDown(0.5); return; }

        const textoUpper = txt.toUpperCase();
        const isEnderecamento = textoUpper.startsWith('EXCELENTÍSSIMO') || textoUpper.startsWith('AÇÃO DE');
        const isTituloRomano = textoUpper.startsWith('I. ') || textoUpper.startsWith('II. ') || textoUpper.startsWith('III. ') || textoUpper.startsWith('IV. ') || textoUpper.startsWith('V. ');
        const isEncerramento = textoUpper.includes('OAB/PA') || textoUpper.includes('TERMOS EM QUE') || textoUpper.includes('PEDE DEFERIMENTO') || textoUpper.includes('/PA,') || textoUpper.includes('JUCILENE') || textoUpper.includes('LARISSA');

        if (isEnderecamento) {
            doc.font('Times-Bold').fontSize(12).text(textoUpper, { align: 'center' });
            doc.moveDown(0.5);
        } else if (isTituloRomano) {
            doc.font('Times-Bold').fontSize(12).text(textoUpper, { align: 'left' });
            doc.moveDown(0.5);
        } else if (isEncerramento) {
            doc.font('Times-Roman').fontSize(12).text(txt, { align: 'center' });
        } else {
            doc.font('Times-Roman').fontSize(12).text(txt, { align: 'justify', indent: 40, lineGap: 6 });
        }
    });

    doc.end(); 
  } catch (error) {
    console.error("Erro na geração do PDF:", error);
    res.status(500).json({ error: "Falha ao gerar o arquivo PDF." });
  }
});

// =========================================================================
// ROTA 5: FÁBRICA DE WORD (.DOCX) - EDITÁVEL PARA O ADVOGADO
// =========================================================================
app.post('/api/gerar-word', async (req, res) => {
    try {
        console.log("🟢 ROTA 5: FÁBRICA DE WORD ACIONADA. Montando documento blindado...");
        const { texto } = req.body;
        if (!texto) return res.status(400).json({ error: "Nenhum texto fornecido." });

        const linhas = texto.split('\n');
        
        const paragraphs = linhas.map(linha => {
            let txt = linha.trim().replace(/\*\*/g, '');
            if (txt === '') return new Paragraph({ text: "" });

            const txtUpper = txt.toUpperCase();
            const isEnderecamento = txtUpper.startsWith('EXCELENTÍSSIMO') || txtUpper.startsWith('AÇÃO DE');
            const isTituloRomano = txtUpper.startsWith('I. ') || txtUpper.startsWith('II. ') || txtUpper.startsWith('III. ') || txtUpper.startsWith('IV. ') || txtUpper.startsWith('V. ');
            const isEncerramento = txtUpper.includes('OAB/PA') || txtUpper.includes('TERMOS EM QUE') || txtUpper.includes('PEDE DEFERIMENTO') || txtUpper.includes('BELÉM/PA') || txtUpper.includes('JUCILENE') || txtUpper.includes('LARISSA');

            let alinhamento = AlignmentType.JUSTIFIED;
            if (isEnderecamento || isEncerramento) alinhamento = AlignmentType.CENTER;
            if (isTituloRomano) alinhamento = AlignmentType.LEFT; 

            return new Paragraph({
                alignment: alinhamento,
                indent: (isEnderecamento || isEncerramento || isTituloRomano) ? {} : { firstLine: 708 },
                spacing: { line: 360, lineRule: "auto" }, 
                children: [
                    new TextRun({ text: txt, font: "Times New Roman", size: 24, bold: (isEnderecamento || isTituloRomano) })
                ]
            });
        });

        const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });

        const b64string = await Packer.toBase64String(doc);
        const buffer = Buffer.from(b64string, 'base64');
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="Peticao_Editavel.docx"');
        res.send(buffer);

    } catch (error) {
        console.error("Erro na geração do Word:", error);
        res.status(500).json({ error: "Falha ao gerar o arquivo Word." });
    }
});

// Inicia o servidor
app.listen(port, () => {
  console.log(`🚀 Motor Jurídico rodando na porta http://localhost:${port}`);
});