# Testes

## Verificação automatizada

Antes de um teste manual ou pull request:

```powershell
npm run check
npm test
npm run build
```

Quando o ambiente gráfico estiver disponível:

```powershell
npm run smoke
npm run dev -- --smoke-test
```

O smoke usa um perfil isolado e verifica ponte, CSP, entrada na sala, o estado
empurrado para a interface e uma mensagem de chat renderizada. Também grava capturas
em `.artifacts/`.

### Teste de ponta a ponta com duas instâncias

```powershell
npm run build
npm run e2e          # ou: node scripts/e2e.mjs --keep
```

Abre duas instâncias reais (anfitrião e convidado) com perfis temporários e o microfone
sintético do Chromium, e conduz a interface: criação e entrada na sala, conexão de voz,
detecção de fala nos dois sentidos, chat, transmissão de tela assistida pelo convidado
e propagação do silenciar. As janelas ficam fora da área visível. Com `--keep`, as
capturas `host.png` e `guest.png` permanecem na pasta temporária indicada.

O e2e roda em loopback com mídia sintética. Ele comprova o caminho de rede e a
interface, mas não substitui uma validação entre dois computadores físicos com
microfones reais.

## Sala em duas instâncias locais

Abra dois terminais:

```powershell
npm start -- --profile=renan
npm start -- --profile=vitoria
```

1. Escolha nomes diferentes.
2. No primeiro perfil, crie a sala usando `127.0.0.1`.
3. Entre pelo segundo perfil com o convite completo.
4. Confira participantes e estado WebRTC nos dois lados.
5. Saia e entre novamente pelo convidado.
6. Feche o host e confirme a desconexão do convidado.
7. Reabra os perfis e confirme a persistência dos nomes.

## Sala em dois computadores

1. Execute exatamente a mesma versão nos dois PCs.
2. Abra LAN/VPN antes do Poglive.
3. No host, escolha o IPv4 alcançável pelo convidado, nunca `127.0.0.1`.
4. Permita o Poglive na rede privada se o firewall solicitar.
5. Entre com o convite e aguarde **WebRTC conectado**.
6. Teste saída voluntária, encerramento do host e uma perda temporária de rede.

Se usar Radmin, confirme candidatos `Radmin` e `STUN` no diagnóstico dos dois lados.

## Voz

1. Entre na voz nos dois perfis e confirme o contorno verde ao falar.
2. Silencie e desative o áudio pelo painel do usuário e pelos atalhos globais com outro
   aplicativo em foco; confira os ícones no outro lado.
3. Ajuste o volume de uma pessoa pelo perfil dela e silencie-a localmente.
4. Troque o microfone em **Configurações > Voz e áudio** durante a chamada e confirme
   que a voz continua.
5. Desconecte o microfone durante a chamada e confirme o aviso e a recuperação.
6. Com caixas de som, confirme que o cancelamento de eco evita retorno.

## Chat

1. Envie mensagens com formatação, uma menção e um link nos dois sentidos.
2. Entre com um terceiro perfil e confirme o histórico recebido.
3. Envie mais de cinco mensagens em sequência e confirme o aviso de limite e o reenvio.

## Captura e streaming

1. Compartilhe primeiro uma janela em 720p e 30 FPS, sem áudio.
2. Confirme preview, anúncio remoto, reprodução, tela cheia e picture-in-picture.
3. Abra uma segunda transmissão e confirme que ambas continuam reproduzindo.
4. Saia de apenas uma transmissão; a outra deve permanecer.
5. Encerre a fonte na origem e confirme a remoção remota.
6. Repita com monitor, 1080p e 60 FPS.
7. Entre com um terceiro participante e confira envio e recepção entre convidados.
8. Confirme que cada player mostra resolução/FPS e modo automático ou fixo.

Monitores e janelas menores podem resultar em dimensões abaixo do preset. Os presets são
limites e não obrigam upscale. Evite capturar o monitor que exibe o próprio player ao
avaliar movimento.

## Áudio

Teste cada modo separadamente:

1. **Sem áudio:** nenhum som deve chegar ao receptor.
2. **Somente a janela:** reproduza som no processo selecionado e também fora dele; apenas
   a árvore escolhida deve ser enviada.
3. **Tudo menos o Discord:** reproduza Discord e outro aplicativo; somente o segundo deve
   chegar ao receptor.
4. **Todo o sistema:** sons e notificações do sistema fazem parte da captura.

Em cada caso, teste volume, mute, encerramento da fonte e fim da transmissão. Uma falha
do áudio seletivo nunca deve ativar silenciosamente o áudio global. Para evitar
recaptura ao transmitir e assistir simultaneamente, deixe o player recebido em volume
zero.

## Qualidade e desempenho

Compare 720p30, 1080p30, 720p60 e 1080p60 usando movimento conhecido. Observe no
Gerenciador de Tarefas:

- CPU e GPU/Video Encode no transmissor;
- CPU e GPU/Video Decode no receptor;
- upload do transmissor e download do receptor.

Repita com um e vários espectadores. O custo de upload e codificação cresce por
espectador. FPS solicitado não comprova FPS efetivamente recebido.

Com qualidade automática, limite temporariamente a conexão de um receptor ou gere carga
de rede controlada. Confirme que somente esse peer reduz a qualidade após duas amostras
ruins e que a recuperação é gradual depois de aproximadamente 20 segundos estáveis.
Repita com dois receptores para confirmar que o peer saudável mantém seu próprio nível.

Desative a qualidade automática, reinicie a captura e confirme que o indicador informa
**Qualidade fixa** e que o Poglive não percorre a escada de resolução/FPS. O controle de
congestionamento interno do WebRTC continua ativo mesmo nesse modo.

## Instalador, portátil e atualização

1. Instale pelo `-setup.exe` e abra o portátil separadamente.
2. Confirme criação de atalhos apenas no instalado.
3. Crie sala, capture mídia e feche/reabra para testar persistência.
4. Compare os arquivos com o SHA-256 publicado:

```powershell
$version = 'X.Y.Z'
Get-FileHash ".\Poglive-$version-win-x64-setup.exe" -Algorithm SHA256
Get-FileHash ".\Poglive-$version-win-x64-portable.exe" -Algorithm SHA256
```

5. Publique uma versão superior e confirme no instalado: detecção, download, bloqueio de
   reinício durante a sala e instalação ao encerrar.
6. Confirme que o portátil não tenta atualizar automaticamente.

Consulte [releases.md](releases.md) para gerar os pacotes.
