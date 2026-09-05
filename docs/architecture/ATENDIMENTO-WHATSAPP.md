# Arquitetura — Atendimento WhatsApp

## Administrativo

domo-assistente
→ workflow 10
→ /internal/assistant/query
→ Gemini
→ MariaDB somente leitura

## Público

domo-atendimento
→ workflow 20
→ /internal/customer-service/query
→ regras determinísticas
→ Gemini para perguntas abertas

O atendimento público não possui ferramentas SQL.

## Workflow 20

Webhook
→ Preparar atendimento
→ Responder?
→ Consultar atendimento
→ Registrar contexto
→ Preparar resposta
→ Responder WhatsApp

O ramo sem resposta cobre:

- fromMe
- grupos
- mídia
- janela 21h–22h
- evento duplicado
- instância incorreta

## Estado temporário

O workflow usa static data para:

- contexto recente
- processedMessages

Deduplicação: TTL de 15 minutos.

Static data não é armazenamento permanente.
