require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { OpenAI, toFile } = require("openai");
const { SYSTEM_PROMPT } = require("./prompts");
const PDFDocument = require("pdfkit");

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
} = require("docx");


// ================================================================
// CONFIGURAÇÃO PRINCIPAL
// ================================================================

const app = express();

const port = process.env.PORT || 3001;


// ================================================================
// VALIDAÇÃO DA CHAVE DA OPENAI
// ================================================================

if (!process.env.OPENAI_API_KEY) {
  console.error(
    "❌ ERRO: A variável OPENAI_API_KEY não foi encontrada no arquivo .env"
  );
}


// ================================================================
// CLIENTE OPENAI
// ================================================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


// ================================================================
// MIDDLEWARES
// ================================================================

app.use(
  cors({
    origin: "*",

    methods: [
      "GET",
      "POST",
      "OPTIONS",
      "PUT",
      "PATCH",
      "DELETE",
    ],

    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
    ],
  })
);

app.use(
  express.json({
    limit: "50mb",
  })
);


// ================================================================
// MULTER
// Arquivos recebidos temporariamente na memória
// ================================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});


// ================================================================
// CONFIGURAÇÃO DOS MODELOS
// ================================================================

const MODELO_IA = "gpt-4o";


// ================================================================
// LIMITES DE SAÍDA
//
// Evitam que a OpenAI reserve tokens excessivos.
// ================================================================

const LIMITE_SAIDA_JSON = 5000;

const LIMITE_SAIDA_PETICAO = 7000;


// ================================================================
// FUNÇÃO AUXILIAR
// REMOVE MARKDOWN E EXTRAI JSON
// ================================================================

function limparJSON(texto) {

  if (!texto) {
    throw new Error(
      "A IA não retornou nenhum conteúdo."
    );
  }

  let resposta =
    String(texto)
      .trim();

  resposta =
    resposta
      .replace(/```json/gi, "")
      .replace(/```/gi, "")
      .trim();

  const primeiroObjeto =
    resposta.indexOf("{");

  const ultimoObjeto =
    resposta.lastIndexOf("}");

  if (
    primeiroObjeto !== -1 &&
    ultimoObjeto !== -1 &&
    ultimoObjeto > primeiroObjeto
  ) {

    resposta =
      resposta.substring(
        primeiroObjeto,
        ultimoObjeto + 1
      );

  }

  return resposta.trim();

}


// ================================================================
// FUNÇÃO AUXILIAR
// EXCLUI ARQUIVOS TEMPORÁRIOS DA OPENAI
// ================================================================

async function limparArquivosOpenAI(fileIds) {

  if (!Array.isArray(fileIds)) {
    return;
  }

  for (const fileId of fileIds) {

    if (!fileId) {
      continue;
    }

    try {

      await openai.files.delete(fileId);

      console.log(
        `🧹 Arquivo temporário removido da OpenAI: ${fileId}`
      );

    } catch (erro) {

      console.warn(
        `⚠️ Não foi possível remover o arquivo ${fileId}:`,
        erro.message
      );

    }

  }

}


// ================================================================
// FUNÇÃO AUXILIAR
// REMOVE VECTOR STORE TEMPORÁRIO
// ================================================================

async function limparVectorStore(vectorStoreId) {

  if (!vectorStoreId) {
    return;
  }

  try {

    await openai.vectorStores.delete(
      vectorStoreId
    );

    console.log(
      `🧹 Vector Store temporário removido: ${vectorStoreId}`
    );

  } catch (erro) {

    console.warn(
      "⚠️ Não foi possível remover o Vector Store:",
      erro.message
    );

  }

}


// ================================================================
// FUNÇÃO AUXILIAR
// ENVIA UM PDF PARA A OPENAI
// ================================================================

async function enviarArquivoParaOpenAI(file) {

  if (
    !file ||
    !file.buffer
  ) {

    throw new Error(
      "Arquivo inválido ou não recebido pelo servidor."
    );

  }

  console.log(
    `⏳ Enviando arquivo para OpenAI: ${file.originalname}`
  );

  const arquivoOpenAI =
    await openai.files.create({

      file: await toFile(

        file.buffer,

        file.originalname ||
          "documento.pdf",

        {
          type:
            file.mimetype ||
            "application/pdf",
        }

      ),

      purpose: "user_data",

    });

  console.log(
    `✅ Arquivo enviado com sucesso. ID: ${arquivoOpenAI.id}`
  );

  return arquivoOpenAI.id;

}


// ================================================================
// FUNÇÃO AUXILIAR
// CRIA VECTOR STORE PARA FILE SEARCH
// ================================================================

async function criarVectorStoreComArquivo(
  fileId,
  nome = "Processo Jurídico"
) {

  console.log(
    "⏳ Criando base de conhecimento temporária..."
  );

  const vectorStore =
    await openai.vectorStores.create({

      name: nome,

    });

  console.log(
    `✅ Vector Store criado: ${vectorStore.id}`
  );


  console.log(
    "⏳ Indexando documento..."
  );

  const vectorStoreFile =
    await openai.vectorStores.files.create(
      vectorStore.id,
      {
        file_id: fileId,
      }
    );


  let status =
    vectorStoreFile.status;

  let tentativas = 0;

  const MAX_TENTATIVAS = 120;


  while (
    status === "in_progress" &&
    tentativas < MAX_TENTATIVAS
  ) {

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          1000
        )
    );

    const arquivoAtualizado =
      await openai.vectorStores.files.retrieve(
        vectorStore.id,
        fileId
      );

    status =
      arquivoAtualizado.status;

    tentativas++;

    console.log(
      `⏳ Indexando documento... Status: ${status}`
    );

  }


  if (status !== "completed") {

    throw new Error(
      `Não foi possível indexar o documento. Status final: ${status}`
    );

  }


  console.log(
    "🏆 Documento indexado com sucesso."
  );


  return vectorStore.id;

}


// ================================================================
// ROTA DE TESTE
// ================================================================

app.get("/", (req, res) => {

  res.send(
    "O Motor Jurídico está rodando perfeitamente!"
  );

});


// ================================================================
// ROTA DE DIAGNÓSTICO DA OPENAI
// ================================================================

app.get(
  "/api/status-openai",
  async (req, res) => {

    try {

      if (!process.env.OPENAI_API_KEY) {

        return res
          .status(500)
          .json({

            status: "ERRO",

            error:
              "OPENAI_API_KEY não encontrada.",

          });

      }


      return res
        .status(200)
        .json({

          status:
            "OK",

          mensagem:
            "Configuração básica da OpenAI encontrada.",

        });


    } catch (error) {

      return res
        .status(500)
        .json({

          status:
            "ERRO",

          error:
            error.message,

        });

    }

  }
);


// ================================================================
// ROTA PRINCIPAL
// ================================================================

app.post(

  "/api/processar",

  upload.single(
    "documento"
  ),

  async (
    req,
    res
  ) => {


    console.log(
      "\n🛎️ [RAIO-X] Nova requisição recebida na rota /api/processar"
    );


    console.log(
      `👉 Modo Solicitado: ${
        req.body.modo ||
        "NENHUM"
      }`
    );


    console.log(
      `👉 Arquivo PDF Anexado?: ${
        req.file
          ? "SIM ✅"
          : "NÃO ❌"
      }`
    );


    console.log(
      `👉 Prompt Recebido?: ${
        req.body.promptMestre
          ? "SIM ✅"
          : "NÃO ❌"
      }`
    );


    try {


      const modo =
        req.body.modo;


      // ============================================================
      // ROTA 1
      // LEITURA DE TEXTO MANUAL
      // ============================================================

      if (
        modo === "texto" &&
        req.body.texto
      ) {

        console.log(
          "🟢 Iniciando ROTA 1: Leitura de texto manual..."
        );


        try {


          const response =
            await openai.responses.create({

              model:
                MODELO_IA,

              max_output_tokens:
                LIMITE_SAIDA_JSON,

              instructions:

                (
                  SYSTEM_PROMPT ||
                  "Você é um analista jurídico."
                )

                +

                `

RETORNE OBRIGATORIAMENTE UM JSON PURO.

Não utilize Markdown.

Não utilize blocos de código.

Não escreva qualquer texto antes ou depois do JSON.

O JSON precisa ser válido e processável por JSON.parse().

`,

              input: [

                {

                  role:
                    "user",

                  content: [

                    {

                      type:
                        "input_text",

                      text:

                        `Analise este texto rigorosamente:

${req.body.texto}`,

                    },

                  ],

                },

              ],

            });


          let respostaCrua =
            response.output_text;


          console.log(
            "🤖 [DEBUG IA] Resposta recebida da OpenAI com sucesso."
          );


          respostaCrua =
            limparJSON(
              respostaCrua
            );


          const respostaJSON =
            JSON.parse(
              respostaCrua
            );


          return res
            .status(200)
            .json(
              respostaJSON
            );


        } catch (
          erroDaOpenAI
        ) {

          console.error(
            "🔴 ERRO EXCLUSIVO DA ROTA 1:",
            erroDaOpenAI
          );


          return res
            .status(500)
            .json({

              error:

                `[DIAGNÓSTICO ROTA 1]: ${
                  erroDaOpenAI.message ||
                  "Erro desconhecido."
                }`,

            });

        }

      }


      // ============================================================
      // ROTA 2
      // LEITURA DE PDF / RESUMO PJE
      // ============================================================

      if (
        modo === "pdf" &&
        req.file
      ) {

        console.log(
          "🟢 Iniciando ROTA 2: Analisador Neural (Resumo PJe)..."
        );


        let fileId =
          null;


        try {


          console.log(
            "⏳ [ETAPA 1] Enviando PDF para a OpenAI..."
          );


          fileId =
            await enviarArquivoParaOpenAI(
              req.file
            );


          console.log(
            "⏳ [ETAPA 2] Iniciando análise jurídica..."
          );


          const response =
            await openai.responses.create({

              model:
                MODELO_IA,

              max_output_tokens:
                LIMITE_SAIDA_JSON,

              instructions:

                (
                  SYSTEM_PROMPT ||
                  "Você é um analista jurídico sênior."
                )

                +

                `

Analise rigorosamente o documento PDF fornecido.

Leia o documento de forma integral.

Localize, quando existentes:

- cabeçalho;
- título;
- identificação das partes;
- número do processo;
- tribunal;
- tipo de ação;
- pedidos;
- decisões;
- acordos;
- conciliações;
- litisconsórcio;
- fundamentos relevantes;
- conclusão;
- informações juridicamente importantes.

RETORNE EXCLUSIVAMENTE UM JSON VÁLIDO.

Não utilize Markdown.

Não utilize blocos de código.

Não escreva explicações antes ou depois do JSON.

`,

              input: [

                {

                  role:
                    "user",

                  content: [

                    {

                      type:
                        "input_file",

                      file_id:
                        fileId,

                    },

                    {

                      type:
                        "input_text",

                      text:

                        `Analise integralmente o PDF anexado.

Busque informações importantes como cabeçalho, título, partes, pedidos, decisões, acordos, conciliações, litisconsórcio e conclusão.

Retorne o resultado estruturado conforme as instruções do sistema.`,

                    },

                  ],

                },

              ],

            });


          console.log(
            "⏳ [ETAPA 3] Processando resposta da IA..."
          );


          let respostaCrua =
            response.output_text;


          respostaCrua =
            limparJSON(
              respostaCrua
            );


          const respostaJSON =
            JSON.parse(
              respostaCrua
            );


          console.log(
            "🏆 [SUCESSO] PDF analisado com sucesso."
          );


          return res
            .status(200)
            .json(
              respostaJSON
            );


        } catch (
          erroGeral
        ) {

          console.error(
            "🔴 ERRO CRÍTICO NA ROTA 2:",
            erroGeral
          );


          return res
            .status(500)
            .json({

              error:

                `[DIAGNÓSTICO ROTA 2]: ${
                  erroGeral.message ||
                  "Erro desconhecido durante a análise do PDF."
                }`,

            });


        } finally {


          if (fileId) {

            await limparArquivosOpenAI([
              fileId,
            ]);

          }

        }

      }


      // ============================================================
      // ROTA 3
      // GERAÇÃO DE PETIÇÃO JURÍDICA
      //
      // NOVA ARQUITETURA:
      //
      // PDF -> FILE
      // FILE -> VECTOR STORE
      // IA -> FILE SEARCH
      //
      // EVITA ENVIAR O PDF INTEIRO COMO INPUT.
      // ============================================================

      if (
        modo === "gerar_peticao" &&
        req.file &&
        req.body.promptMestre
      ) {

        console.log(
          "🟢 ROTA 3: MÁQUINA DE PETIÇÕES ATIVADA."
        );


        let fileId =
          null;

        let vectorStoreId =
          null;


        try {


          // --------------------------------------------------------
          // ETAPA 1
          // ENVIA O PDF
          // --------------------------------------------------------

          console.log(
            "⏳ [ROTA 3 - ETAPA 1] Enviando processo..."
          );


          fileId =
            await enviarArquivoParaOpenAI(
              req.file
            );


          // --------------------------------------------------------
          // ETAPA 2
          // INDEXA O PROCESSO
          // --------------------------------------------------------

          console.log(
            "⏳ [ROTA 3 - ETAPA 2] Preparando leitura inteligente..."
          );


          vectorStoreId =
            await criarVectorStoreComArquivo(
              fileId,
              "Processo Jurídico Temporário"
            );


          // --------------------------------------------------------
          // ETAPA 3
          // GERA A PETIÇÃO COM FILE SEARCH
          // --------------------------------------------------------

          console.log(
            "⏳ [ROTA 3 - ETAPA 3] Redigindo peça jurídica..."
          );


          const response =
            await openai.responses.create({

              model:
                MODELO_IA,


              max_output_tokens:
                LIMITE_SAIDA_PETICAO,


              tools: [

                {

                  type:
                    "file_search",

                  vector_store_ids: [
                    vectorStoreId,
                  ],

                },

              ],


              instructions:

                `Você é um redator jurídico rigoroso e Advogado Sênior.

Você possui acesso ao processo completo através da ferramenta de busca de documentos.

Utilize a ferramenta file_search sempre que precisar consultar fatos, datas, documentos, decisões, perícias, laudos, petições, argumentos ou provas existentes no processo.

Não tente reproduzir todo o processo.

Busque somente as informações necessárias para elaborar a peça solicitada.

Leia e localize cuidadosamente as informações relevantes.

Extraia todos os fatos juridicamente relevantes solicitados pelo usuário.

NUNCA invente fatos que não estejam no documento ou no prompt.

NUNCA faça uma leitura superficial.

NUNCA utilize citações técnicas como:

【4:11 source】

【source】

ou qualquer marcação semelhante.

Produza uma peça jurídica densa, tecnicamente fundamentada e coerente.

Utilize linguagem jurídica profissional.

Respeite integralmente o pedido feito pelo usuário.

IMPORTANTE:

Antes de redigir a peça, pesquise no processo:

- fatos relevantes;
- datas;
- decisões;
- laudos;
- provas;
- argumentos;
- pedidos anteriores;
- documentos importantes.

Depois elabore a peça com base nessas informações.`,


              input:

                `PEDIDO DO ADVOGADO:

${req.body.promptMestre}

Utilize o File Search para pesquisar no processo todos os documentos e informações necessárias.

Não responda com um resumo.

Redija diretamente a peça jurídica solicitada.`,

            });


          let peticaoGerada =
            response.output_text;


          if (
            !peticaoGerada
          ) {

            throw new Error(
              "A IA não retornou o texto da petição."
            );

          }


          // ========================================================
          // HIGIENIZAÇÃO DA PETIÇÃO
          // ========================================================

          let peticaoLimpa =
            String(
              peticaoGerada
            );


          // Remove citações entre 【...】

          peticaoLimpa =
            peticaoLimpa.replace(
              /【[^】]*】/g,
              ""
            );


          // Remove citações do formato [source]

          peticaoLimpa =
            peticaoLimpa.replace(
              /\[[^\]]*(source|citation|citação)[^\]]*\]/gi,
              ""
            );


          // Remove referências a arquivos PDF

          peticaoLimpa =
            peticaoLimpa.replace(
              /\[[^\]]*\.pdf[^\]]*\]/gi,
              ""
            );


          // Remove caracteres residuais

          peticaoLimpa =
            peticaoLimpa
              .replace(/【/g, "")
              .replace(/】/g, "");


          // ========================================================
          // CALADOR DE GRITOS
          // ========================================================

          peticaoLimpa =
            peticaoLimpa
              .split("\n")
              .map(
                (linha) => {

                  const limpa =
                    linha.trim();


                  if (!limpa) {
                    return linha;
                  }


                  const textoUpper =
                    limpa.toUpperCase();


                  const isTituloRomano =
                    /^(I|II|III|IV|V|VI|VII|VIII|IX|X)\.\s/.test(
                      textoUpper
                    );


                  const isEnderecamento =

                    textoUpper.startsWith(
                      "EXCELENTÍSSIMO"
                    )

                    ||

                    textoUpper.startsWith(
                      "EXCELENTISSIMO"
                    )

                    ||

                    textoUpper.startsWith(
                      "AÇÃO DE"
                    )

                    ||

                    textoUpper.startsWith(
                      "ACAO DE"
                    );


                  if (

                    limpa.length > 15 &&

                    !isTituloRomano &&

                    !isEnderecamento

                  ) {

                    const apenasLetras =
                      limpa.replace(
                        /[^a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]/g,
                        ""
                      );


                    if (

                      apenasLetras.length > 10 &&

                      apenasLetras ===
                        apenasLetras.toUpperCase()

                    ) {

                      return (

                        limpa.charAt(0).toUpperCase() +

                        limpa
                          .slice(1)
                          .toLowerCase()

                      );

                    }

                  }


                  return linha;

                }
              )
              .join("\n");


          console.log(
            "✅ Peça redigida e higienizada com sucesso!"
          );


          return res
            .status(200)
            .json({

              respostaTexto:
                peticaoLimpa.trim(),

            });


        } catch (
          erroRota3
        ) {

          console.error(
            "🔴 ERRO NA ROTA 3:",
            erroRota3
          );


          return res
            .status(500)
            .json({

              error:

                `[DIAGNÓSTICO ROTA 3]: ${
                  erroRota3.message ||
                  "Erro ao gerar a petição."
                }`,

            });


        } finally {


          // Remove Vector Store

          if (vectorStoreId) {

            await limparVectorStore(
              vectorStoreId
            );

          }


          // Remove arquivo original

          if (fileId) {

            await limparArquivosOpenAI([
              fileId,
            ]);

          }

        }

      }


      // ============================================================
      // NENHUM MODO CORRESPONDEU
      // ============================================================

      console.log(
        "🔴 ERRO DE ROTEAMENTO: Nenhum modo correspondeu."
      );


      return res
        .status(400)
        .json({

          error:
            "Requisição inválida. Verifique o modo e os arquivos enviados.",

        });


    } catch (
      error
    ) {

      console.error(
        "🔴 ERRO NO SERVIDOR:",
        error
      );


      return res
        .status(500)
        .json({

          error:

            error.message ||

            "Erro interno no servidor.",

        });

    }

  }

);


// ================================================================
// ROTA 6
// MOTOR DE LEITURA ESTRUTURADA
// CNIS E LAUDOS
// ================================================================

app.post(

  "/api/visao-computacional",

  upload.array(
    "documentos",
    10
  ),

  async (
    req,
    res
  ) => {


    console.log(
      `\n👁️‍🗨️ [EXTRAÇÃO NEURAL] Recebendo ${
        req.files
          ? req.files.length
          : 0
      } documento(s)...`
    );


    if (
      !req.files ||
      req.files.length === 0
    ) {

      return res
        .status(400)
        .json({

          error:
            "Nenhum arquivo enviado para análise.",

        });

    }


    let fileIds =
      [];


    try {


      for (
        const file of req.files
      ) {

        console.log(
          `⏳ Preparando documento: ${file.originalname}`
        );


        if (
          file.mimetype !==
          "application/pdf"
        ) {

          console.warn(
            `⚠️ Arquivo ignorado: ${file.originalname}`
          );

          continue;

        }


        const fileId =
          await enviarArquivoParaOpenAI(
            file
          );


        fileIds.push(
          fileId
        );

      }


      if (
        fileIds.length === 0
      ) {

        throw new Error(
          "Nenhum PDF válido foi enviado."
        );

      }


      const conteudoDocumentos =
        [];


      for (
        let i = 0;
        i < fileIds.length;
        i++
      ) {

        conteudoDocumentos.push({

          type:
            "input_file",

          file_id:
            fileIds[i],

        });

      }


      conteudoDocumentos.push({

        type:
          "input_text",

        text:

          `Analise todos os documentos enviados.

Eles podem conter CNIS, laudos médicos, relatórios, atestados ou documentos previdenciários.

Cruze as informações quando houver mais de um documento.`,

      });


      console.log(
        "⏳ [ETAPA 2] Enviando documentos para análise neural..."
      );


      const response =
        await openai.responses.create({

          model:
            MODELO_IA,

          max_output_tokens:
            LIMITE_SAIDA_JSON,


          instructions:

            `Você é um robô de auditoria médica e previdenciária.

Sua missão é ler rigorosamente os documentos enviados e extrair os dados.

Se houver CNIS, analise vínculos, contribuições e informações previdenciárias.

Se houver documentos médicos, extraia CIDs, diagnósticos, médicos e demais informações relevantes.

Se uma informação não existir, retorne null ou array vazio.

ESTRUTURA OBRIGATÓRIA DE RETORNO:

{
  "tipoDocumento": "String",
  "dadosMedicos": [
    {
      "cid": "String",
      "descricao": "String",
      "data_diagnostico": "String",
      "medico": "String",
      "crm": "String"
    }
  ],
  "dadosCNIS": {
    "tempoTotalContribuicao": "String",
    "qualidadeSegurado": "String",
    "ultimaContribuicao": "String",
    "carenciaAtingida": true,
    "alertas": [
      "String"
    ]
  }
}

RETORNE APENAS JSON VÁLIDO.

Não utilize Markdown.

Não escreva explicações fora do JSON.`,


          input: [

            {

              role:
                "user",

              content:
                conteudoDocumentos,

            },

          ],

        });


      console.log(
        "⏳ [ETAPA 3] Análise finalizada."
      );


      let respostaCrua =
        response.output_text;


      respostaCrua =
        limparJSON(
          respostaCrua
        );


      const respostaJSON =
        JSON.parse(
          respostaCrua
        );


      console.log(
        "🏆 Sucesso! JSON gerado pela IA."
      );


      return res
        .status(200)
        .json(
          respostaJSON
        );


    } catch (
      error
    ) {

      console.error(
        "🔴 ERRO NA EXTRAÇÃO:",
        error
      );


      return res
        .status(500)
        .json({

          error:

            error.message ||

            "Erro interno ao processar documentos.",

        });


    } finally {


      await limparArquivosOpenAI(
        fileIds
      );

    }

  }

);


// ================================================================
// ROTA 4
// FÁBRICA DE PDF PROFISSIONAL
// ================================================================

app.post(

  "/api/gerar-pdf",

  (
    req,
    res
  ) => {

    try {


      console.log(
        "🟢 ROTA 4: FÁBRICA DE PDF ACIONADA."
      );


      const {
        texto
      } =
        req.body;


      if (!texto) {

        return res
          .status(400)
          .json({

            error:
              "Nenhum texto fornecido.",

          });

      }


      const doc =
        new PDFDocument({

          size:
            "A4",

          margins: {

            top: 71,
            bottom: 71,
            left: 57,
            right: 57,

          },

        });


      res.setHeader(
        "Content-Type",
        "application/pdf"
      );


      res.setHeader(
        "Content-Disposition",
        'attachment; filename="Peticao.pdf"'
      );


      doc.pipe(
        res
      );


      const linhas =
        texto.split(
          "\n"
        );


      linhas.forEach(
        (linha) => {


          let txt =
            linha
              .trim()
              .replace(/[\u2018\u2019]/g, "'")
              .replace(/[\u201C\u201D]/g, '"')
              .replace(/[\u2013\u2014]/g, "-")
              .replace(/[\u2026]/g, "...")
              .replace(/\*\*/g, "")
              .replace(/[【】]/g, "");


          if (
            txt === ""
          ) {

            doc.moveDown(
              0.5
            );

            return;

          }


          const textoUpper =
            txt.toUpperCase();


          const isEnderecamento =

            textoUpper.startsWith(
              "EXCELENTÍSSIMO"
            )

            ||

            textoUpper.startsWith(
              "EXCELENTISSIMO"
            )

            ||

            textoUpper.startsWith(
              "AÇÃO DE"
            )

            ||

            textoUpper.startsWith(
              "ACAO DE"
            );


          const isTituloRomano =
            /^(I|II|III|IV|V|VI|VII|VIII|IX|X)\.\s/.test(
              textoUpper
            );


          const isEncerramento =

            textoUpper.includes(
              "OAB/PA"
            )

            ||

            textoUpper.includes(
              "TERMOS EM QUE"
            )

            ||

            textoUpper.includes(
              "PEDE DEFERIMENTO"
            )

            ||

            textoUpper.includes(
              "/PA,"
            )

            ||

            textoUpper.includes(
              "JUCILENE"
            )

            ||

            textoUpper.includes(
              "LARISSA"
            );


          if (
            isEnderecamento
          ) {

            doc
              .font(
                "Times-Bold"
              )
              .fontSize(
                12
              )
              .text(
                textoUpper,
                {
                  align:
                    "center",
                }
              );


            doc.moveDown(
              0.5
            );


          } else if (
            isTituloRomano
          ) {

            doc
              .font(
                "Times-Bold"
              )
              .fontSize(
                12
              )
              .text(
                textoUpper,
                {
                  align:
                    "left",
                }
              );


            doc.moveDown(
              0.5
            );


          } else if (
            isEncerramento
          ) {

            doc
              .font(
                "Times-Roman"
              )
              .fontSize(
                12
              )
              .text(
                txt,
                {
                  align:
                    "center",
                }
              );


          } else {

            doc
              .font(
                "Times-Roman"
              )
              .fontSize(
                12
              )
              .text(
                txt,
                {

                  align:
                    "justify",

                  indent:
                    40,

                  lineGap:
                    6,

                }
              );

          }

        }
      );


      doc.end();


    } catch (
      error
    ) {

      console.error(
        "Erro na geração do PDF:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            "Falha ao gerar o arquivo PDF.",

        });

    }

  }

);


// ================================================================
// ROTA 5
// FÁBRICA DE WORD
// ================================================================

app.post(

  "/api/gerar-word",

  async (
    req,
    res
  ) => {

    try {


      console.log(
        "🟢 ROTA 5: FÁBRICA DE WORD ACIONADA."
      );


      const {
        texto
      } =
        req.body;


      if (!texto) {

        return res
          .status(400)
          .json({

            error:
              "Nenhum texto fornecido.",

          });

      }


      const linhas =
        texto.split(
          "\n"
        );


      const paragraphs =
        linhas.map(
          (linha) => {


            let txt =
              linha
                .trim()
                .replace(
                  /\*\*/g,
                  ""
                )
                .replace(
                  /[【】]/g,
                  ""
                );


            if (
              txt === ""
            ) {

              return new Paragraph({

                text:
                  "",

              });

            }


            const txtUpper =
              txt.toUpperCase();


            const isEnderecamento =

              txtUpper.startsWith(
                "EXCELENTÍSSIMO"
              )

              ||

              txtUpper.startsWith(
                "EXCELENTISSIMO"
              )

              ||

              txtUpper.startsWith(
                "AÇÃO DE"
              )

              ||

              txtUpper.startsWith(
                "ACAO DE"
              );


            const isTituloRomano =
              /^(I|II|III|IV|V|VI|VII|VIII|IX|X)\.\s/.test(
                txtUpper
              );


            const isEncerramento =

              txtUpper.includes(
                "OAB/PA"
              )

              ||

              txtUpper.includes(
                "TERMOS EM QUE"
              )

              ||

              txtUpper.includes(
                "PEDE DEFERIMENTO"
              )

              ||

              txtUpper.includes(
                "BELÉM/PA"
              )

              ||

              txtUpper.includes(
                "BELEM/PA"
              )

              ||

              txtUpper.includes(
                "JUCILENE"
              )

              ||

              txtUpper.includes(
                "LARISSA"
              );


            let alinhamento =
              AlignmentType.JUSTIFIED;


            if (
              isEnderecamento ||
              isEncerramento
            ) {

              alinhamento =
                AlignmentType.CENTER;

            }


            if (
              isTituloRomano
            ) {

              alinhamento =
                AlignmentType.LEFT;

            }


            return new Paragraph({

              alignment:
                alinhamento,


              indent:

                (
                  isEnderecamento ||
                  isEncerramento ||
                  isTituloRomano
                )

                  ? {}

                  : {

                      firstLine:
                        708,

                    },


              spacing: {

                line:
                  360,

                lineRule:
                  "auto",

              },


              children: [

                new TextRun({

                  text:
                    txt,

                  font:
                    "Times New Roman",

                  size:
                    24,

                  bold:

                    (
                      isEnderecamento ||
                      isTituloRomano
                    ),

                }),

              ],

            });

          }
        );


      const doc =
        new Document({

          sections: [

            {

              properties:
                {},

              children:
                paragraphs,

            },

          ],

        });


      const b64string =
        await Packer.toBase64String(
          doc
        );


      const buffer =
        Buffer.from(
          b64string,
          "base64"
        );


      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );


      res.setHeader(
        "Content-Disposition",
        'attachment; filename="Peticao_Editavel.docx"'
      );


      return res.send(
        buffer
      );


    } catch (
      error
    ) {

      console.error(
        "Erro na geração do Word:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            "Falha ao gerar o arquivo Word.",

        });

    }

  }

);


// ================================================================
// TRATAMENTO GLOBAL DE ERROS
// ================================================================

app.use(

  (
    error,
    req,
    res,
    next
  ) => {


    if (
      error instanceof
      multer.MulterError
    ) {

      return res
        .status(400)
        .json({

          error:
            `Erro no upload: ${error.message}`,

        });

    }


    console.error(
      "🔴 ERRO GLOBAL:",
      error
    );


    return res
      .status(500)
      .json({

        error:

          error.message ||

          "Erro interno no servidor.",

      });

  }

);


// ================================================================
// INICIA O SERVIDOR
// ================================================================

app.listen(

  port,

  () => {

    console.log(
      `🚀 Motor Jurídico rodando na porta http://localhost:${port}`
    );


    console.log(
      `🤖 Modelo configurado: ${MODELO_IA}`
    );


    console.log(
      "🧠 Integração configurada com a Responses API."
    );


    console.log(
      "📚 Rota de petições configurada com File Search."
    );

  }

);