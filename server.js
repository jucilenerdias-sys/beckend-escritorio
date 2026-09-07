require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { OpenAI } = require('openai');
const fs = require('fs');
const pdfParse = require('pdf-parse'); // Motor de extração local
const { SYSTEM_PROMPT } = require('./prompts');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, AlignmentType } = require('docx'); 

const app = express();
const port = process.env.PORT || 3001;

// Configuração do OpenAI ancorada no cofre pago
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: "org-jkBWr7J6EU0luUlAk3Ts2SVQ",
  project: "proj_exTfoAO6PlzNGv6RmfKY4uDw",
});

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });

app.get('/', (req, res) => {
  res.send('O Motor Jurídico está rodando perfeitamente na Arquitetura V2 (Chat API)!');
});

// =========================================================================
// ROTA PRINCIPAL (Processamento de Petições e Resumos)
// =========================================================================
app.post('/api/processar', upload.single('documento'), async (req, res) => {
  console.log(`\n🛎️ [MOTOR] Nova requisição recebida - Modo: ${req.body.modo || 'NENHUM'}`);

  try {
    const modo = req.body.modo;
    
    // ROTA 1: TEXTO MANUAL
    if (modo === 'texto' && req.body.texto) {
      console.log("🟢 ROTA 1: Leitura de texto manual...");
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

    // ROTA 2: LEITURA DE PDF (RESUMO PJE)
    if (modo === 'pdf' && req.file) {
      console.log("🟢 ROTA 2: Extração local de PDF e Análise Neural...");
      const pdfData = await pdfParse(req.file.buffer);
      const textoDoPDF = pdfData.text;
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Atue como um Analista Jurídico Sênior. Abaixo está a transcrição integral de um PDF processual. Busque o cabeçalho e título. Busque por Acordo, Conciliação e Litisconsórcio. Busque os pedidos e conclusão. Retorne EXCLUSIVAMENTE o JSON puro.\n\nDOCUMENTO:\n${textoDoPDF}` }
        ],
        temperature: 0.1,
      });

      const jsonResposta = response.choices[0].message.content;
      return res.status(200).json(JSON.parse(jsonResposta));
    }

    // ROTA 3: MÁQUINA DE PETIÇÕES
    if (modo === 'gerar_peticao' && req.file && req.body.promptMestre) {
      console.log("🟢 ROTA 3: Máquina de Petições Acionada...");
      const pdfData = await pdfParse(req.file.buffer);
      const textoDoPDF = pdfData.text;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Você é um redator jurídico rigoroso e Advogado Sênior. Extraia os fatos solicitados. NUNCA resuma de forma genérica. NUNCA utilize marcações de citação como 【4:11 source】. Produza um texto denso, exaustivo e implacável." },
          { role: "user", content: `${req.body.promptMestre}\n\nFatos e Provas extraídos do PDF (Transcrição local):\n${textoDoPDF}` }
        ],
        temperature: 0.1,
      });

      let peticaoLimpa = response.choices[0].message.content;
      
      // Filtros Exterminadores
      peticaoLimpa = peticaoLimpa.replace(/[【\[]?\s*\d+:\d+\s*.*?source.*?\]?】?/gi, '');
      peticaoLimpa = peticaoLimpa.replace(/[【\[]?\s*\d+:\d+\s*.*?†.*?\]?】?/gi, '');
      peticaoLimpa = peticaoLimpa.replace(/[【\[]?provas_cliente\.pdf[】\]]?/gi, '');
      peticaoLimpa = peticaoLimpa.replace(/【.*?】/g, '').replace(/【/g, '').replace(/】/g, '');

      // Calador de Gritos 4.0
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
    }

    return res.status(400).json({ error: "Requisição inválida. Verifique os parâmetros." });

  } catch (error) {
    console.error("🔴 ERRO NO SERVIDOR:", error.message);
    res.status(500).json({ error: "Erro interno no servidor ao processar a requisição." });
  }
});

// =========================================================================
// ROTA 6: VISÃO COMPUTACIONAL (Análise de múltiplos laudos/CNIS)
// =========================================================================
app.post('/api/visao-computacional', upload.array('documentos', 10), async (req, res) => {
  console.log(`\n👁️‍🗨️ [VISÃO COMPUTACIONAL] Lendo ${req.files ? req.files.length : 0} documento(s)...`);

  if (!req.files || req.files.length === 0) return res.status(400).json({ error: "Nenhum arquivo enviado." });

  try {
    let textoCompleto = "";
    for (const file of req.files) {
      const pdfData = await pdfParse(file.buffer);
      textoCompleto += `\n--- DOCUMENTO: ${file.originalname} ---\n${pdfData.text}\n`;
    }

    console.log("🧠 Dados extraídos. Acionando IA...");
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Você é um robô de auditoria médica e previdenciária. Extraia os dados no formato JSON puro: { "tipoDocumento": "...", "dadosMedicos": [ { "cid": "...", "descricao": "...", "data_diagnostico": "...", "medico": "...", "crm": "..." } ], "dadosCNIS": { "tempoTotalContribuicao": "...", "qualidadeSegurado": "...", "ultimaContribuicao": "...", "carenciaAtingida": true/false, "alertas": ["..."] } }` },
        { role: "user", content: `Analise as transcrições abaixo e extraia os dados matemáticos e médicos com rigor absoluto.\n\n${textoCompleto}` }
      ],
      temperature: 0.1
    });

    console.log("✅ Análise estruturada concluída!");
    res.status(200).json(JSON.parse(response.choices[0].message.content));

  } catch (error) {
    console.error("🔴 ERRO NA VISÃO COMPUTACIONAL:", error.message);
    res.status(500).json({ error: "Erro interno ao processar laudos e CNIS." });
  }
});

// =========================================================================
// ROTA 4: FÁBRICA DE PDF PROFISSIONAL (Padrão PJe)
// =========================================================================
app.post('/api/gerar-pdf', (req, res) => {
  try {
    console.log("🟢 ROTA 4: FÁBRICA DE PDF ACIONADA.");
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
            .replace(/\*\*/g, '').replace(/[^\x00-\xFF]/g, '');  

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
        console.log("🟢 ROTA 5: FÁBRICA DE WORD ACIONADA.");
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