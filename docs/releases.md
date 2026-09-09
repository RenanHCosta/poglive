# Releases

## Pacotes Windows

Com as dependências instaladas:

```powershell
npm run dist:win
```

O comando compila o helper nativo, a aplicação e os seguintes arquivos em `release/`:

- `Poglive-<versão>-win-x64-setup.exe`;
- `Poglive-<versão>-win-x64-setup.exe.blockmap`;
- `Poglive-<versão>-win-x64-portable.exe`;
- `latest.yml`.

`dist:win` não publica ou envia arquivos. O primeiro empacotamento pode precisar de
internet para baixar Electron e ferramentas do electron-builder. Não distribua
`release/win-unpacked/Poglive.exe`; somente os pacotes finais são destinados ao usuário.

## Instalador e portátil

O NSIS `-setup.exe` instala por usuário, cria atalhos e habilita atualizações automáticas.
O aplicativo consulta as Releases cerca de cinco segundos após abrir e a cada seis
horas, baixa o instalador em segundo plano e aplica ao fechar ou após confirmação. O
reinício é bloqueado enquanto houver uma sala ativa.

O `-portable.exe` executa sem instalação, mas não recebe atualizações automáticas. Ele
ainda usa AppData para perfil e cache e extrai componentes temporários durante a
execução.

## Integridade e assinatura

As releases atuais não possuem Authenticode. O workflow temporário:

1. compila somente a partir de uma tag estável contida em `main`;
2. executa checks e testes;
3. confirma que aplicativo, helper nativo, instalador e portátil estão sem assinatura;
4. não inclui um `publisherName` obrigatório no canal de atualização;
5. gera blockmap, SHA-512 do atualizador e checksums SHA-256;
6. publica aviso explícito na GitHub Release.

A candidatura gratuita à SignPath Foundation, enviada em setembro de 2026, não foi
aceita porque o projeto ainda não possui a visibilidade pública exigida pelo programa.
Não foi apontada falha técnica, de segurança ou licenciamento. O Poglive poderá reaplicar
quando houver adoção pública verificável. Consulte
[CODE_SIGNING_POLICY.md](../CODE_SIGNING_POLICY.md).

## Publicar uma versão

Antes de começar, a árvore deve estar limpa e `main` precisa conter todas as alterações.
No Windows:

```powershell
npm run release -- patch
```

Também são aceitos `minor`, `major` ou uma versão explícita como `0.3.0`. O script:

1. valida a versão e a branch;
2. executa checks e testes;
3. atualiza `package.json` e `package-lock.json`;
4. cria commit e tag anotada;
5. envia commit e tag atomicamente;
6. deixa o GitHub Actions criar a release.

Se uma validação falhar antes do commit, revise o erro e reverta manualmente apenas os
arquivos de versão alterados antes de tentar novamente.

Enquanto a variável de repositório `SIGNPATH_ENABLED` não for exatamente `true`, a tag
usa o job não assinado. Não configure essa variável durante o período atual.

## Ativar assinatura no futuro

Após uma eventual aprovação:

1. conclua a configuração descrita em [signpath-application.md](signpath-application.md);
2. crie o ambiente protegido `signpath-release`;
3. adicione nele `SIGNPATH_API_TOKEN` e `SIGNPATH_ORGANIZATION_ID`;
4. importe e valide as configurações de artefato do repositório;
5. defina `SIGNPATH_ENABLED=true`;
6. publique uma versão de teste e aprove as duas solicitações de assinatura;
7. confirme Authenticode e atualização entre duas versões assinadas.

Os jobs assinado e não assinado são mutuamente exclusivos. A variável só deve ser
ativada quando toda a configuração existir.
