# Como contribuir

Obrigado pelo interesse em contribuir com o Volt.

## Preparar o ambiente

1. Faça um fork e clone o repositório.
2. Utilize Node.js 24 ou superior.
3. Crie uma branch para sua alteração:

   ```sh
   git switch -c feat/descricao-da-alteracao
   ```

4. Execute `npm test` antes de começar e após suas mudanças.

Não é necessário instalar dependências. Os testes de integração usam um servidor HTTP simulado e bancos temporários, sem exigir acesso à rede industrial.

Os testes de fluxo são ignorados quando `fluxo.json` não está disponível. Não adicione esse arquivo ao Git para habilitá-los: os fluxos locais não fazem parte da distribuição pública.

## Propor alterações

- Mantenha cada alteração focada em um objetivo e inclua testes quando aplicável.
- Preserve o estilo existente e as configurações do `.editorconfig`.
- Atualize o README quando alterar configuração, contratos da API ou comportamento de coleta.
- Descreva no pull request o problema, a solução e os comandos usados para validar.
- Para alterações visuais, inclua capturas sem credenciais ou informações da instalação.

Sugestões de prefixos de commit: `feat`, `fix`, `test`, `docs` e `chore`. Prefira commits pequenos que representem mudanças reais e independentes.

## Checklist antes de enviar

```sh
npm test
git diff --check
git status --short
git diff --cached
```

- [ ] Testes passam no ambiente suportado.
- [ ] Documentação reflete o comportamento implementado.
- [ ] Nenhum banco, `.env`, fluxo local, token ou senha foi incluído.
- [ ] Não há endereços ou informações sensíveis da rede industrial nos exemplos.
- [ ] Mudanças elétricas respeitam as unidades e não apresentam potência estimada como medição de potência ativa.

## Relatar problemas

Inclua a versão do Node.js, o sistema operacional, passos para reproduzir e o comportamento esperado. Remova dados sensíveis dos logs e use medições fictícias em exemplos.

Não publique credenciais em issues. Em caso de exposição, revogue ou troque a credencial imediatamente; remover o texto em um novo commit não elimina versões anteriores.

## Licença

O projeto ainda não declara uma licença. Este guia não concede direitos de uso, redistribuição ou relicenciamento do código; consulte a seção de licença do README.
