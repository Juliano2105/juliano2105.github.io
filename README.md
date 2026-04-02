# 🎰 Gire & Ganhe — Sistema de Sorteio com Roleta para Lojas Físicas

Sistema completo de campanha promocional com roleta digital, integração com WhatsApp e controle inteligente de distribuição de prêmios.

---

## 🚀 Funcionalidades

- **Página pública da campanha** — responsiva, mobile-first, com design moderno
- **Integração real com WhatsApp** — a roleta só é liberada após confirmação de entrada no grupo
- **Controle por número de telefone** — 1 jogada a cada 24 horas por número
- **Roleta animada** com animação suave e resultado decidido 100% no backend
- **Contagem regressiva** 5, 4, 3, 2, 1 antes de girar
- **Painel administrativo completo** com gerenciamento de campanhas, prêmios e relatórios
- **Distribuição inteligente antifraude** — algoritmo variável, imprevisível, sem padrão fixo
- **QR Code automático** para impressão e uso na loja
- **Codes de resgate únicos** para cada prêmio
- **Relatórios detalhados** de participações, prêmios e resgates

---

## 📁 Estrutura de Arquivos

```
/
├── index.html                    # Página pública da campanha
├── admin.html                    # Painel administrativo
├── css/
│   └── style.css                 # Design completo do sistema
├── js/
│   ├── config.js                 # ⚠️ Configure aqui suas credenciais
│   ├── roulette.js               # Motor de animação da roleta
│   ├── app.js                    # Lógica do frontend público
│   └── admin.js                  # Lógica do painel admin
└── supabase/
    ├── schema.sql                # Estrutura do banco de dados
    └── functions/
        └── sorteio-api/
            └── index.ts          # Edge Function (backend completo)
```

---

## ⚙️ Configuração Passo a Passo

### 1. Supabase (Backend gratuito)

1. Crie uma conta em [supabase.com](https://supabase.com) (gratuito)
2. Crie um novo projeto
3. No menu lateral, vá em **SQL Editor** e execute todo o conteúdo de `supabase/schema.sql`
4. Vá em **Settings > API** e copie:
   - **Project URL** → ex: `https://abcdefgh.supabase.co`
   - **anon/public key** → string JWT longa

5. Edite `js/config.js` e coloque seus dados:
```js
window.SUPABASE_FUNCTIONS_URL = 'https://SEU-PROJETO.supabase.co/functions/v1/sorteio-api';
window.SUPABASE_ANON_KEY = 'SUA-CHAVE-ANON';
```

### 2. Deploy da Edge Function

1. Instale o Supabase CLI: `npm install -g supabase`
2. Na raiz do projeto, execute:
```bash
supabase login
supabase functions deploy sorteio-api --project-ref SEU-PROJECT-REF
```

### 3. Integração com Motor WhatsApp

Configure seu motor WhatsApp (Evolution API, Z-API, WPPConnect, etc.) para enviar webhooks de entrada no grupo para:

```
POST https://SEU-PROJETO.supabase.co/functions/v1/sorteio-api/webhook/whatsapp
```

O sistema já suporta os formatos de payload de:
- **Evolution API** (`group-participants.update`)
- **Z-API** (`ReceivedCallback`)
- **WPPConnect** (`onParticipantsChanged`)

### 4. Configurar o ID do Grupo no Painel Admin

No painel admin, ao criar/editar uma campanha, informe o link do grupo WhatsApp.
Após configurar o motor WA, atualize o campo `whatsapp_group_id` com o ID interno do grupo.

---

## 🔐 Primeiro Acesso ao Painel Admin

Acesse: `https://juliano2105.github.io/admin.html`

**Senha padrão:** `admin123`

> ⚠️ **ALTERE A SENHA IMEDIATAMENTE** após o primeiro login!
> No painel: Configurações > Segurança > Nova Senha

---

## 🎯 Fluxo do Cliente

1. **Cliente chega na loja** e escaneia o QR Code exibido no balcão
2. **Informa o número de celular** na página (com DDD)
3. O sistema **verifica o cooldown de 24h**
4. Cliente clica em **"Entrar no Grupo do WhatsApp"**
5. O sistema **aguarda confirmação real** de entrada via webhook
6. Ao confirmar entrada, inicia a **contagem regressiva 5, 4, 3, 2, 1**
7. **Roleta gira** com animação (resultado já decidido pelo backend)
8. **Resultado exibido** com código de resgate se for prêmio

---

## 🧠 Lógica de Distribuição Inteligente

O backend usa um algoritmo multi-fatorial para decidir quando um prêmio é elegível:

| Fator | Descrição |
|-------|-----------|
| **Estoque total** | Prêmio esgotado = indisponível |
| **Limite diário** | Ex: máx 2 garrafas/dia |
| **Faixa de horário** | Ex: prêmio raro só entre 14h–16h |
| **Intervalo mínimo** | Ex: mín 30min entre saídas |
| **Distribuição temporal** | Prêmios distribuídos ao longo do horário da loja |
| **Entropia antifraude** | Hash do telefone + segundos + milissegundos |
| **Score dinâmico** | Urgência aumenta conforme o dia avança para garantir cotas |

O resultado **nunca segue padrão previsível**, protegendo contra fraude interna e tentativas de "acertar o timing".

---

## 📊 Painel Administrativo

| Seção | O que faz |
|-------|-----------|
| **Dashboard** | Visão geral: giros, prêmios, campanhas ativas |
| **Campanhas** | Criar/editar campanhas, link do grupo WA, horários da loja |
| **Prêmios & Roleta** | Cadastrar segmentos da roleta com controle avançado |
| **Relatórios** | Histórico completo de participações e resgates |
| **Configurações** | Credenciais Supabase, motor WA, senha admin |

### Campos de controle de cada prêmio:

- **Nome/label** — texto exibido na roleta e na tela de resultado
- **Ícone e cor** — personalização visual do segmento
- **É prêmio real / É preenchimento** — controla o tipo
- **Gerar código único** — para prêmios que precisam de comprovante
- **Estoque total** — quantas unidades existem no total
- **Limite diário** — máximo que pode sair em um dia
- **Intervalo mínimo** — tempo mínimo entre saídas consecutivas (minutos)
- **Horário permitido** — faixa de horário em que pode sair
- **Peso** — tamanho visual na roleta (não afeta probabilidade real)
- **Instrução** — mensagem exibida ao cliente após ganhar

---

## 🔗 Links

| Recurso | URL |
|---------|-----|
| Site público | https://juliano2105.github.io |
| Painel admin | https://juliano2105.github.io/admin.html |
| Campanha com ID | https://juliano2105.github.io/?c=ID_DA_CAMPANHA |

---

## 📝 Tecnologias

- **Frontend:** HTML5, CSS3, JavaScript puro (sem frameworks, sem dependências)
- **Backend:** Supabase (PostgreSQL + Edge Functions Deno/TypeScript)
- **Hospedagem:** GitHub Pages (gratuito)
- **Animação da roleta:** Canvas API
- **Integração WA:** Webhook compatível com Evolution API, Z-API, WPPConnect

---

*Sistema desenvolvido para uso em lojas físicas com promoções baseadas em grupos de WhatsApp.*
