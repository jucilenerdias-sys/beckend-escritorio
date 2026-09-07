require('dotenv').config();

async function testarMatriz() {
    console.log("Iniciando contato direto com o Gateway da OpenAI...");
    try {
        const response = await fetch("https://api.openai.com/v1/assistants", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
                "OpenAI-Beta": "assistants=v2"
            },
            body: JSON.stringify({
                name: "Auditor Teste",
                model: "gpt-4o",
                tools: [{ type: "file_search" }]
            })
        });

        console.log(`\nStatus HTTP: ${response.status}`);
        console.log(`Resposta Bruta:`, await response.text());
    } catch (error) {
        console.error("Falha na execução do teste:", error.message);
    }
}

testarMatriz();