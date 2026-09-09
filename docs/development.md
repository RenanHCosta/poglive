# Desenvolvimento

## Requisitos

- Windows x64;
- Node.js 22.12 ou superior, com Node.js 24 recomendado;
- npm;
- CMake, Windows SDK e MSVC para compilar o helper nativo de áudio.

Instale exatamente as dependências travadas no repositório:

```powershell
npm ci
```

## Ambiente de desenvolvimento

```powershell
npm run dev
```

React e CSS recebem HMR. Mudanças no processo principal ou preload exigem reiniciar o
aplicativo. O Vite escuta somente em `127.0.0.1:5173`; não abra dois servidores dev na
mesma porta. Fechar a janela encerra o servidor iniciado pelo script.

Para compilar e abrir sem Vite:

```powershell
npm run build
npm start
```

## Duas instâncias locais

O argumento `--profile` isola identidade e diretório de dados:

```powershell
npm run build
npm start -- --profile=renan
npm start -- --profile=vitoria
```

Use nomes de perfil com letras, números, hífen ou underscore, no máximo 24 caracteres.
Uma instância por perfil é permitida; abrir o mesmo perfil foca a janela existente.

Para testar no mesmo computador, o primeiro perfil pode criar uma sala usando
`127.0.0.1`. Nunca use loopback quando o convidado está em outro computador.

## Verificação

```powershell
npm run check
npm test
npm run build
npm run smoke
npm run dev -- --smoke-test
```

- `check`: TypeScript strict, ESLint e Prettier.
- `test`: protocolos, identidade e sockets TLS reais em loopback.
- `build`: bundles main, preload e renderer, além dos avisos de terceiros.
- `smoke`: Electron real, renderer, preload/IPC, CSP e uma sala isolada de teste.
- `format`: aplica a formatação do projeto.

Os testes automatizados não comprovam captura, áudio, desempenho ou streaming entre
dois computadores. Execute também os roteiros de [testing.md](testing.md).

## Estrutura resumida

```text
src/
  main/        ciclo do Electron, salas, transporte, signaling e captura
  preload/     ponte IPC restrita
  renderer/    interface React, WebRTC e reprodução de mídia
  shared/      schemas, contratos e protocolos validados
native/
  process-audio/  helper C++ de Application Loopback
scripts/       build, testes, release e geração de metadados
tests/         testes automatizados
```

Leia [architecture.md](architecture.md) antes de alterar protocolos, convites, captura,
rede, IPC ou limites de segurança.

## Pull requests

Não inclua artefatos gerados, perfis, convites, certificados, tokens ou executáveis no
commit. Mudanças em release, `.signpath`, rede, captura, atualização ou código nativo
fazem parte da fronteira de confiança e precisam de revisão adicional.

Veja também [CONTRIBUTING.md](../CONTRIBUTING.md).
