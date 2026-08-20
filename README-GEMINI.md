# Agente Gemini para consultas DOMO

Esta entrega substitui o planejador baseado em regras por um agente Gemini com ferramentas controladas.

## Arquitetura

- O Gemini interpreta a pergunta e decide quais ferramentas usar.
- `describe_database` expõe somente o catálogo permitido e as chaves estrangeiras reais.
- `search_entities` resolve nomes para identificadores reais antes de montar filtros.
- `execute_readonly_query` passa obrigatoriamente pelo validador SQL existente.
- O usuário MariaDB continua somente leitura.
- Senhas, tokens e credenciais não são apresentados ao modelo nem permitidos em consultas.
- O agente pode corrigir uma consulta recusada, limitado a oito etapas.
- Nenhuma resposta baseada em dados é aceita antes de uma consulta bem-sucedida.

## 1. Instalação

Extraia o ZIP na raiz do projeto:

```bash
cd ~/domo-platform
unzip -o ~/Downloads/domo-agente-gemini.zip
```

No WSL, caso o arquivo esteja nos Downloads do Windows:

```bash
cd ~/domo-platform
unzip -o /mnt/c/Users/Moraws/Downloads/domo-agente-gemini.zip
```

## 2. Configuração secreta

Adicione ao arquivo `.env` local. Não grave a chave no Git:

```dotenv
GEMINI_API_KEY=COLE_AQUI_A_CHAVE_DO_GEMINI
GEMINI_MODEL=gemini-2.5-flash
GEMINI_PLANNER_MODEL=gemini-2.5-flash
DATABASE_QUERY_MAX_ROWS=100
OLLAMA_PLANNER_FALLBACK=false
```

O `compose.override.yaml` é carregado automaticamente pelo Docker Compose e injeta essas variáveis apenas na API.

## 3. Validação

```bash
cd ~/domo-platform/apps/api

npm run typecheck
npm run build
npm test

cd ~/domo-platform

docker compose config --quiet &&
echo "Compose validado"

docker compose up -d --build api

curl --retry 8 \
  --retry-delay 2 \
  --retry-connrefused \
  -fSs \
  http://127.0.0.1:3001/health
```

## 4. Teste do agente

```bash
cd ~/domo-platform

set -a
source .env
set +a

curl -fSs \
  -H "Authorization: Bearer ${API_INTERNAL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"question":"Qual é o nome do pastor do bloco Alagoinhas?"}' \
  http://127.0.0.1:3001/internal/assistant/query

echo
```

Outras verificações recomendadas:

```text
Quantas pessoas existem no bloco Dois Leões?
Qual é a igreja de Jesse Benigno Lisboa?
Quais são as igrejas da região Alto de Coutos?
Quais são os dias de visita do Presídio de Salvador?
Liste as igrejas e regiões do bloco Teixeira de Freitas, organizadas por região.
```

## 5. WhatsApp e n8n

O endpoint e o contrato foram preservados:

```text
POST http://api:3001/internal/assistant/query
```

O workflow atual pode continuar enviando:

```json
{
  "question": "texto extraído do WhatsApp"
}
```

A resposta para o WhatsApp continua em:

```text
assistant.answer
```

Não use o antigo nó `Google Gemini Chat Model` do workflow `evo-go` para acessar diretamente o MariaDB. A API Node deve permanecer como fronteira de segurança.

## 6. Auditoria

A resposta da API contém metadados técnicos para diagnóstico:

- provedor e modelo;
- quantidade de iterações;
- ferramentas utilizadas e resultado de cada chamada;
- SQL validada e executada;
- resultado retornado pelo gateway seguro.

Esses campos não precisam ser enviados ao WhatsApp.

## Limites do plano gratuito

Uma pergunta pode exigir mais de uma chamada ao modelo porque o agente pesquisa entidades, consulta o esquema, executa e eventualmente corrige a consulta. Esta versão reduz essas chamadas fornecendo o catálogo de tabelas desde o início e devolvendo o esquema relacionado junto com a busca de entidades.

O modo híbrido utiliza somente uma chamada ao Gemini por pergunta. O Gemini gera a consulta, o gateway Node valida e executa, e o Ollama local redige a resposta.

Por segurança semântica, o Ollama de 4 bilhões de parâmetros não assume o planejamento quando a cota Gemini termina. Nesse caso a API informa indisponibilidade imediatamente, sem esperar e sem executar uma consulta potencialmente incorreta. O fallback pode ser habilitado conscientemente com `OLLAMA_PLANNER_FALLBACK=true`, mas não é recomendado para respostas que exigem precisão.

O modelo padrão do planejador é `gemini-2.5-flash`, já validado com esta conta. Ele pode ser alterado por `GEMINI_PLANNER_MODEL`. Se o modelo configurado não estiver disponível, a API utiliza imediatamente o Ollama local.

O limite padrão de uma listagem é 100 registros. Ele pode ser configurado entre 1 e 500 com `DATABASE_QUERY_MAX_ROWS`. Para respostas pelo WhatsApp, valores muito altos podem ultrapassar o tamanho confortável de uma mensagem.

## 7. Limpeza posterior

Após validar o Gemini em produção local, os arquivos do planejador antigo deixam de participar da execução:

```text
apps/api/src/ollama.ts
apps/api/src/database-query-planner.ts
apps/api/src/database-query-planner.test.ts
```

Remova-os somente depois de confirmar que nenhuma outra rota os importa.
