# DOMO Platform

Plataforma de automação e inteligência artificial com atendimento público do Momento do Presidiário e agente administrativo separado.

## Documentação principal

Antes de dar manutenção ou implementar melhorias, leia:

- `HANDOFF-DOMO-PLATFORM.md` — handoff técnico canônico e estado operacional.
- `docs/architecture/ATENDIMENTO-WHATSAPP.md` — atendimento público via WhatsApp.
- `docs/architecture/ATENDIMENTO-TELEGRAM.md` — atendimento público via Telegram.
- `docs/OPERACAO-MOMENTO-PRESIDIARIO.md` — regras operacionais do programa.

Não crie handoffs datados novos. Atualize sempre `HANDOFF-DOMO-PLATFORM.md`; o histórico do Git preserva as versões anteriores.

## Componentes

- Node.js + TypeScript
- n8n
- Evolution API
- Telegram Bot API via nós nativos do n8n
- PostgreSQL
- MariaDB réplica somente leitura
- Redis
- Gemini
- Ollama
- Docker Compose

## Canais

- WhatsApp administrativo: workflow 10, isolado e com consultas seguras à réplica.
- WhatsApp público: workflow 20, sem acesso ao banco.
- Telegram público: workflow 30, usando o mesmo agente público do WhatsApp e sem acesso ao banco.

## Ambientes

- Desenvolvimento: WSL2 com Docker Desktop.
- Produção: stack Docker da DOMO Platform.
