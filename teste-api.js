require('dotenv').config();

const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function testar() {
    try {

        console.log("Testando conexão com a OpenAI...");

        const response = await openai.responses.create({
            model: "gpt-5",
            input: "Responda apenas: CONEXÃO FUNCIONANDO"
        });

        console.log("STATUS: OK");
        console.log("RESPOSTA:");
        console.log(response.output_text);

    } catch (error) {

        console.log("STATUS:", error.status);
        console.log("ERRO COMPLETO:");

        console.dir({
            message: error.message,
            status: error.status,
            code: error.code,
            type: error.type,
            request_id: error.request_id
        }, { depth: null });

    }
}

testar();