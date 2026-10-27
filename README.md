# Automatic Beedoo — Assistente de Estudos com Groq

Extensão Chrome Manifest V3 que identifica questões de múltipla escolha em páginas Beedoo, consulta um modelo hospedado pela Groq e oferece dois fluxos: assistente de revisão e automação para uma apresentação de segurança autorizada em hostname exato.

## O que mudou nas versões 2.0 e 2.1

- A integração com `api.openai.com` foi substituída por `https://api.groq.com/openai/v1`.
- O modelo padrão é `openai/gpt-oss-20b`; a configuração salva anteriormente é preservada.
- A chave é configurada uma única vez na tela de opções e guardada em `chrome.storage.local`.
- O código não envia a chave pelo script de conteúdo e não a grava nos arquivos da extensão.
- A saída usa JSON Object Mode, valida IDs e descarta alternativas inventadas pelo modelo.
- Questões são divididas em lotes para reduzir o risco de exceder o limite de tokens do plano gratuito.
- O fluxo normal mostra recomendações e justificativas sem alterar a página.
- O fluxo de apresentação automatiza a demonstração somente no hostname exato configurado.
- Na versão 2.1.1, o fluxo completo substitui o botão de revisão no hostname autorizado, a espera real passa a vir desativada e as referências do DOM são renovadas após rerenderizações.
- Na versão 2.2.0, a apresentação escolhe uma duração uniforme entre 15 e 19 minutos e aguarda o tempo real correspondente antes da finalização.

## Aviso sobre o modelo

A Groq descontinuou `llama-3.1-8b-instant` em 16/08/2026 para contas Free e Developer. O padrão `openai/gpt-oss-20b` é o substituto indicado na [documentação da Groq](https://console.groq.com/docs/deprecations). Apesar do nome, ele é executado pela API da Groq e não exige chave da OpenAI. Se uma instalação anterior mantiver o modelo antigo, selecione o novo nas opções e salve.

## Arquitetura

- `manifest.json`: permissões, hosts, worker em módulo e tela de opções.
- `background.js`: lê a configuração local, recebe mensagens internas e chama o cliente Groq.
- `lib/groq-client.js`: normalização, lotes, prompt, chamada HTTP, validação de resposta e tratamento de erros.
- `content.js`: extrai questões do DOM e exibe um painel de recomendações sem alterar respostas.
- `lab-mode.js`: executa o fluxo completo de apresentação no hostname autorizado, incluindo mídia, respostas, tempo e finalização.
- `presentation-timing.js`: escolhe com aleatoriedade criptográfica uma duração entre 900 e 1.140 segundos.
- `lib/lab-scope.js`: normaliza o hostname e exige correspondência exata antes das ações de apresentação.
- `options.html`, `options.css`, `options.js`: configuração persistente da chave e do modelo, remoção da chave e teste de conexão.
- `test/groq-client.test.js`: testes automatizados do contrato e das proteções.
- `browser-fixture/fixture.html`: página local para inspeção visual do painel.

## Instalação

1. Acesse `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione esta pasta do projeto.
5. Clique no ícone da extensão para abrir as configurações.
6. Informe uma chave da Groq e escolha o modelo.
7. Para a apresentação autorizada, informe o hostname exato do ambiente do professor, sem `https://`, caminho ou curinga.
8. Clique em **Salvar configuração**.
9. Clique em **Testar conexão** para confirmar a chave e a disponibilidade do modelo.

Não coloque a chave em `background.js`, `manifest.json` ou qualquer outro arquivo. Em uma extensão local, `chrome.storage.local` evita a exposição acidental no código, mas não equivale a um cofre de servidor. Não distribua o perfil do navegador com a chave salva.

## Privacidade e permissões

Ao solicitar recomendações, os enunciados e as alternativas extraídos da página são enviados à API da Groq. Não envie conteúdo que você não esteja autorizado a compartilhar. A chave fica em armazenamento local, restrito aos contextos confiáveis da extensão; ela não é enviada aos scripts de conteúdo. A permissão `scripting` é usada pelo modo de apresentação, que executa código no contexto da página autorizada. As permissões de host abrangem os domínios Beedoo e a API da Groq.

## Uso

1. Abra uma página de treinamento Beedoo que contenha questões de múltipla escolha.
2. Clique no botão flutuante `🤖`.
3. Revise a alternativa sugerida, a justificativa e a confiança estimada.
4. Decida e responda manualmente na própria plataforma.

## Apresentação autorizada

Quando o hostname atual corresponde exatamente ao valor configurado, o botão de revisão é substituído pelo botão `🧪`. Após configurar o hostname, o fluxo fica disponível sempre que essa página for aberta; para desativá-lo, apague o hostname nas configurações e salve.

Ao acioná-lo, a extensão:

1. registra a duração visível das mídias e sorteia uma duração entre 15 e 19 minutos;
2. instala no contexto principal da página um interceptador para os endpoints `delivery`, `checkpoint` e `tries`;
3. modifica os campos de tempo dos corpos JSON enviados por `fetch` ou `XMLHttpRequest`;
4. libera controles bloqueados no DOM e dispara eventos de arquivos e vídeos;
5. consulta a Groq, aplica as respostas sugeridas e aciona o salvamento dos blocos;
6. aguarda efetivamente a duração sorteada, atualiza o estado Vue exposto pela página e tenta o método de finalização disponível;
7. permite baixar um JSON local com os resultados observados durante a apresentação.

O background repete a validação do hostname antes de instalar o interceptador ou finalizar. Alterar apenas o JavaScript do conteúdo não remove essa verificação.

## Contrato com a Groq

A extensão usa uma chamada não-streaming para `/openai/v1/chat/completions`. O streaming do exemplo original não traz vantagem aqui: o painel precisa do JSON completo e validado antes de apresentar qualquer recomendação.

Parâmetros principais:

- `model`: configurável; padrão `openai/gpt-oss-20b`.
- `temperature`: `0`, para respostas mais determinísticas.
- `response_format`: `{ "type": "json_object" }`.
- `max_completion_tokens`: `2048`.
- lotes: no máximo 8 questões e aproximadamente 12.000 caracteres por solicitação; questões individuais acima do limite ou com mais de 20 alternativas são rejeitadas.

O resultado esperado é:

```json
{
  "answers": [
    {
      "questionId": "q1_1",
      "alternativeId": "a2",
      "explanation": "Justificativa curta.",
      "confidence": 0.95
    }
  ]
}
```

Antes de retornar ao script da página, cada `questionId` e `alternativeId` é comparado com os IDs realmente enviados. Valores desconhecidos são ignorados.

## Testes automatizados

Requer Node.js 20 ou superior. Não há dependências externas.

```powershell
npm test
```

A suíte cobre:

- compatibilidade com o formato antigo de questões;
- prompt e isolamento de instruções embutidas no conteúdo;
- validação e normalização do JSON do modelo;
- rejeição de alternativas inexistentes;
- divisão em lotes;
- corpo e cabeçalhos da chamada Groq;
- mensagens de autenticação e limite gratuito;
- verificação de modelo ativo;
- remoção do domínio da OpenAI do manifesto;
- ausência de manipulação de tempo e finalização no assistente normal;
- separação entre o assistente normal e a automação de apresentação;
- rejeição de curingas, caminhos e hostnames diferentes no escopo autorizado.
- limites inferior e superior da duração aleatória de apresentação.
- preservação de abstenções e rejeição de questões acima dos limites.

## Erros esperados

- `CONFIG_REQUIRED`: nenhuma chave foi salva.
- `AUTH_ERROR`: chave inválida ou sem acesso.
- `RATE_LIMIT`: limite Free da organização atingido; aguarde antes de repetir.
- `MODEL_NOT_FOUND`: modelo removido, desativado ou não acessível.
- `INVALID_MODEL_RESPONSE`: JSON válido, mas sem correspondência com as questões enviadas.
- `NETWORK_ERROR`: falha de conectividade com `api.groq.com`.

## Limitações conhecidas

- Os seletores dependem da estrutura atual do Beedoo: `.drop`, `.question`, `.question-title` ou `.question-header`, `.answer-input` e `.answer-label`.
- Mudanças de HTML na plataforma podem exigir ajustes em `content.js`.
- A confiança é uma estimativa produzida pelo modelo, não uma probabilidade calibrada.
- A IA pode errar; a revisão humana é obrigatória.
- O plano gratuito possui limites por minuto e por dia definidos pela Groq.
- A automação de apresentação depende de detalhes internos da versão atual da página, incluindo seletores e a propriedade Vue 2 `__vue__`.
- O hostname da apresentação é deliberadamente exato; subdomínios diferentes precisam ser configurados separadamente.
- Os testes usam respostas simuladas: não validam uma conta Groq nem o funcionamento na plataforma real.

## Licença

Nenhuma licença de código aberto foi declarada neste repositório. Consulte o titular dos direitos antes de reutilizar ou redistribuir o código.
