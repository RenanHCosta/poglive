# Poglive

Desktop de salas privadas para Windows 10/11 x64. Milestones 1 e 2 implementados:
identidade local persistente, criação de sala, convite, entrada autenticada,
participantes e detecção de saída/desconexão. Milestone 3 implementado: seleção de
monitor/janela e preview local.
Milestone 4 implementado: signaling pelo host e conexão WebRTC direta com DataChannel.
Milestone 5 confirmado pelo usuário: anúncio de transmissão, Assistir e vídeo P2P.
Milestone 6: 720p/1080p e áudio do sistema opcional validados inicialmente pelo usuário.
Agora também há seleção 30/60 FPS, aguardando teste manual. Sem dependências novas.

[Arquitetura, segurança, protocolo e roadmap](docs/architecture.md).

## Instalar e executar

Node.js 22.12+ e npm (Node 24 recomendado).

```powershell
npm ci
npm run dev
```

React/CSS têm HMR. Alterações em main/preload exigem reiniciar.
Vite escuta somente em 127.0.0.1:5173; não abra dois servidores dev nessa porta.
Fechar a janela encerra o servidor dev.

Para executar o build local sem Vite:

```powershell
npm run build
npm start
```

Para levar a outro PC, gere o executável portátil abaixo. Quem recebe não precisa
de Node.js, npm ou dos arquivos do projeto.

## Executável portátil Windows x64

Na máquina de desenvolvimento, com as dependências instaladas:

```powershell
npm run dist:win
```

Em uma cópia nova do projeto, execute `npm ci` antes. O comando compila e usa
electron-builder para gerar `release/Poglive-0.1.0-win-x64-portable.exe`.
A versão no nome acompanha package.json. O primeiro empacotamento requer internet
para baixar Electron e ferramentas de empacotamento; não publica nem faz upload.

Envie **somente o arquivo terminado em -portable.exe** aos amigos, não o executável
interno de win-unpacked. Ele contém Electron e a aplicação, extrai arquivos temporários
ao abrir e não instala atalhos nem solicita administração. Não é um instalador.
Mantenha espaço livre para extração; a primeira abertura pode demorar.

Portátil aqui significa **sem instalação**, não “sem deixar dados no computador”:
o perfil e cache continuam em AppData do usuário do Windows. O executável não leva
sua identidade, credenciais ou sessões. Apagar o .exe não apaga os dados locais.
Não envie pastas de perfis junto; distribuir o mesmo UUID causaria conflitos na sala.

O pacote inicial usa ícone padrão do Electron e não possui assinatura digital.
Windows/SmartScreen ou antivírus podem apresentar aviso; não desative proteções.
Compartilhe apenas por um canal confiável. Assinatura e ícone próprios ficam para
uma versão posterior. Não há atualização automática: distribua um novo .exe.

### Teste manual do portátil

1. Feche as instâncias antigas e abra o .exe com duplo clique.
2. Defina o nome, crie sala e selecione a interface LAN (não 127.0.0.1 para outro PC).
3. O amigo abre o mesmo .exe e entra com o convite. Permita acesso à rede privada
   no firewall se solicitado, sem desativá-lo.
4. Teste captura de janela/monitor, Assistir, áudio opcional e 30/60 FPS.
5. Feche e reabra: o perfil deve persistir. Fechar o host encerra a sala.

Para duas instâncias locais, em terminais separados dentro da pasta release:

```powershell
.\Poglive-0.1.0-win-x64-portable.exe --profile=renan
.\Poglive-0.1.0-win-x64-portable.exe --profile=vitoria
```

Confira o hash do arquivo recebido se o remetente fornecer SHA-256:

```powershell
Get-FileHash .\Poglive-0.1.0-win-x64-portable.exe -Algorithm SHA256
```

Empacotar não resolve NAT: continua sendo um MVP LAN. Áudio isolado por aplicativo
também permanece pendente. Não foram executados testes automatizados do pacote.

## Como usar

Na primeira execução, informe seu nome e clique Continuar. O app gera um UUID
aleatório e salva identidade no perfil local. O nome pode ser alterado em Seu perfil
quando estiver fora de uma sala; o peerId permanece o mesmo.

Para criar: selecione Criar sala, nome e interface IPv4. O host abre uma porta TCP
disponível naquela interface e mostra um convite. Copiar código copia o convite
completo. Compartilhe somente com quem pode entrar: ele contém o segredo da sala.

Para entrar: selecione Entrar em sala, cole o convite e confirme. O host aceita
automaticamente um segredo válido, salvo sala cheia ou peerId já conectado.
Todos veem a lista de participantes; Host identifica o criador.
O host não precisa aprovar cada entrada manualmente.

Sair da sala desconecta o participante. Encerrar sala para todos ou fechar o host
desconecta todos. Criar outra sala gera novo segredo, ID e certificado; convites
anteriores deixam de funcionar. Não há restauração da sala ao reiniciar.

## Duas instâncias no mesmo computador

Gere o build uma vez:

```powershell
npm run build
```

Terminal A:

```powershell
npm start -- --profile=renan
```

Terminal B, na mesma pasta:

```powershell
npm start -- --profile=vitoria
```

1. Escolha nomes diferentes. Cada perfil tem arquivos e peerId independentes.
2. No A, crie a sala com “Somente este computador · 127.0.0.1”.
3. Copie o convite no A e cole em Entrar em sala no B.
4. Verifique os dois participantes nas duas janelas.
5. Saia pelo B: a lista no A deve voltar a um participante.
6. Entre novamente e feche o A: B deve informar desconexão.
7. Reabra um perfil: o nome deve persistir. Altere-o fora da sala e reabra novamente.

Uma instância por perfil é permitida; abrir o mesmo perfil foca a janela existente.
Use somente letras, números, hífen e underscore no nome do perfil (até 24 caracteres).
O uso sem --profile mantém o perfil padrão.
Não copie o arquivo identity.json de um perfil para outro PC.

## Dois PCs na LAN

1. Instale/execute em ambos e defina um nome em cada PC.
2. No host, selecione o IPv4 do Wi-Fi/Ethernet compartilhado, por exemplo 192.168.1.x.
   **Não selecione 127.0.0.1**, pois ele aponta para o próprio computador de quem entra.
3. Crie a sala e envie o convite completo ao segundo PC por um meio confiável.
4. No segundo PC, entre com esse convite e confira a lista nos dois.
5. Se o Windows solicitar acesso de rede, permita o aplicativo na rede privada
   apropriada. O app não cria regras nem desativa firewall.
6. Teste saída voluntária, fechamento do participante e encerramento do host.
7. Para perda silenciosa de rede, espere até aproximadamente 20 segundos.

Se a conexão falhar: verifique se o host ainda está aberto, se escolheu a interface
correta, se estão na mesma LAN com rota entre si e se o firewall permite o listener.
Redes guest/isolamento Wi-Fi/VPN podem impedir acesso mesmo com o mesmo nome de rede.
Mudar de interface/endereço exige recriar a sala e compartilhar novo convite.

## Teste manual da captura local (Milestone 3)

Execute `npm run dev` ou `npm run build` seguido de `npm start`.
Não é necessário instalar dependências novas ou abrir outro participante.

1. Crie ou entre em uma sala.
2. Clique em Compartilhar tela.
3. Na aba Monitores, clique em uma miniatura para iniciar o preview.
4. Confira que o vídeo acompanha as mudanças na tela. Capturar o próprio aplicativo
   dentro do monitor produz o efeito esperado de imagens repetidas.
5. Clique Encerrar compartilhamento e repita usando a aba Janelas com outra aplicação aberta.
6. Teste Cancelar, Atualizar lista e encerrar a janela capturada.
7. Saia da sala durante o preview: a captura deve ser liberada.

Desde o M5, selecionar a fonte também anuncia a transmissão aos peers conectados.
Para testar somente preview, crie uma sala sem convidados. O preview fica sempre mudo.
O app solicita 30 ou 60 FPS; a taxa efetiva depende do sistema. Selecione 720p/1080p
antes da captura. Algumas janelas minimizadas/protegidas podem congelar ou ficar
pretas; restaure a janela ou escolha outra fonte. Eventos de encerramento dependem
do Chromium/Windows: se uma fonte ficar congelada sem evento, encerre manualmente.
Nesta etapa não foram criados nem executados testes automatizados; a validação
de captura será manual, além de compilação e lint.

## Teste manual da conexão WebRTC (Milestone 4)

Reinicie todos os participantes com a mesma versão do app. Para duas instâncias:

```powershell
npm run build
```

Em dois terminais separados:

```powershell
npm start -- --profile=renan
npm start -- --profile=vitoria
```

Crie a sala no primeiro perfil e entre pelo segundo usando o convite.
No painel Transmissões e conexões, aguarde WebRTC conectado em ambos.
Esse estado exige troca HELLO/ACK pelo DataChannel direto, não apenas presença
no signaling. Não é necessário iniciar captura para verificar a conexão.
Se desejar, entre com um terceiro perfil: cada participante deve conectar aos outros,
inclusive os dois convidados entre si, enquanto o host encaminha apenas signaling.

Repita em dois PCs da LAN usando o IPv4 Wi-Fi/Ethernet no convite. O firewall pode
permitir entrada na sala por TCP e bloquear WebRTC separadamente. O host fornece
STUN somente dentro da LAN; não há STUN público nem TURN. Erros ou timeout (25–30 s)
aparecem no painel. Para repetir, saia e
entre novamente; se for o host, crie outra sala e distribua o novo convite.
Evite recarregar a janela no meio de uma negociação. Saída fecha PeerConnections,
DataChannels e timers. Nenhum teste automatizado foi criado/executado nesta etapa.

## Teste manual de streaming (Milestone 5)

Feche e reabra **todas** as instâncias após `npm run build`; não misture builds de milestones diferentes.
Use os dois perfis e o convite descritos acima; nenhuma instalação adicional.

1. Espere WebRTC conectado nos dois participantes.
2. No A, clique Compartilhar tela e selecione um monitor ou uma janela.
   Selecionar autoriza disponibilizar essa fonte para qualquer participante da sala.
3. No B, deve aparecer “Renan está compartilhando a tela”. Clique Assistir.
4. Mova uma janela/role um texto no A: o B deve acompanhar dentro do app.
5. Teste Tela cheia (Esc para voltar) e Sair da transmissão no B. A continua
   compartilhando, mas deixa de enviar vídeo para B. Clique Assistir novamente.
6. Encerre o compartilhamento no A: anúncio e player devem desaparecer no B.
7. Repita invertendo A/B. Teste fechar a fonte, sair da sala e fechar o host.
8. Opcional: entre com um terceiro perfil durante a transmissão, confira o anúncio
   e assista. Teste também transmissão entre dois convidados, sem o host assistir.

Em dois PCs, repita usando IPv4 Wi-Fi/Ethernet no convite e rede privada permitida
no firewall, sem desativá-lo. Capturar o monitor que contém o player gera recursão
visual; prefira outra janela/monitor para avaliar movimento.

Anúncios e pedidos Assistir/Sair usam o DataChannel P2P; o host continua com
admissão, presença e offer/answer/ICE. Cada espectador recebe uma cópia direta do
vídeo; não há relay de mídia. Novos peers recebem o anúncio ao conectar.
Uma fonte por participante e uma transmissão assistida por vez; compartilhar e
assistir simultaneamente é permitido. Até 7 espectadores por transmissor (limite
da sala), sem garantia de desempenho: upload e processamento crescem por espectador.
Timeout de início do vídeo: 15 s. Falha de conexão exige sair e entrar novamente.
O M6 acrescenta áudio opcional e presets; não há medição de latência ou bitrate editável.
Build/lint não comprovam captura ou streaming entre PCs; esse teste é manual.

## Teste manual de áudio e qualidade (Milestone 6)

Sem dependências novas. Execute `npm run build`, reabra os perfis renan/vitoria
em terminais separados com `npm start -- --profile=renan` e
`npm start -- --profile=vitoria`. Ambos devem usar este build (agora negociamos
vídeo e áudio mesmo quando a captura não contém som).

1. Entre na mesma sala. Compartilhe primeiro em 720p com áudio desmarcado.
   Confira vídeo no outro perfil e dimensões/FPS da captura abaixo do preview.
2. Encerre e repita com 1080p. Monitores/janelas menores ou de outra proporção
   podem produzir dimensões menores; os presets são limites, não upscale obrigatório.
3. Encerre, marque Compartilhar áudio do sistema e selecione a fonte novamente.
   Reproduza um som conhecido no PC transmissor. Confira “Com áudio do sistema”.
4. No receptor, clique Assistir e depois Ativar áudio. Teste Silenciar e Sair.
5. Encerre a transmissão: vídeo e áudio devem parar. Repita com áudio desmarcado
   e confirme que não há som recebido. Teste também compartilhar uma janela.
6. Repita em dois PCs na LAN para validar áudio de verdade: duas instâncias no
   mesmo PC compartilham a saída de som e podem gerar realimentação.

**Privacidade:** loopback captura o áudio do sistema, incluindo notificações e
outros aplicativos, não somente a janela escolhida. Microfone/câmera não são
autorizados. Som local do transmissor continua tocando. O preview não reproduz
áudio; o receptor inicia mudo. Se compartilhar enquanto assiste, silencie o player
para não recapturar o áudio recebido — fones não impedem essa recaptura por software.

Se o Windows não fornecer track de áudio, aparece aviso e o vídeo continua. Se
o pedido inteiro falhar, desligue áudio e tente novamente; não há nova tentativa
silenciosa nem captura de microfone como fallback. Áudio que termina gera aviso.
Compatibilidade de dispositivos, conteúdos protegidos e latência exigem teste real.

Resolução, áudio e FPS são aplicados ao iniciar; alterações exigem nova captura.
WebRTC recebe limites por espectador: vídeo 2,5 Mbps até 720 linhas / 5 Mbps acima
disso e áudio 128 kbps. Não são garantias de tráfego ou qualidade: overhead se soma,
e Chromium pode reduzir a taxa. Em 60 FPS o orçamento de vídeo dobra para 5/10 Mbps
por espectador. Áudio permanece 128 kbps. FPS configurado não mede frames recebidos.

### Testar 60 FPS

Após `npm run build`, reabra ambos os perfis. Antes de selecionar a fonte, escolha
Taxa de quadros → 60 FPS. Teste uma animação/vídeo com movimento e compare com 30 FPS,
encerrando a captura para alterar o preset. Repita em 720p e 1080p. A captura e o
sender recebem o limite escolhido; fonte, monitor, carga e rede podem reduzir o FPS.

### Áudio filtrado por aplicativo

O seletor oferece Sem áudio, Somente a janela escolhida, Tudo menos o Discord e
Todo o áudio do sistema.
Somente a janela exige escolher uma fonte do tipo Janela e captura a árvore de processos
associada ao HWND dessa fonte. Assim, compartilhar League of Legends não inclui Discord,
navegador ou notificações. Tudo menos o Discord faz o inverso: transmite o áudio do
sistema, mas exclui a árvore do Discord detectada (Stable, Canary, PTB ou Development).
Se o Discord não estiver aberto, os demais sons do sistema continuam sendo capturados.

A [API documentada do Electron](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts)
continua fornecendo apenas loopback global. Para o modo isolado, o executável inclui um
helper C++ x64 que usa a API Application Loopback do Windows em modo
`INCLUDE_TARGET_PROCESS_TREE` para uma janela ou `EXCLUDE_TARGET_PROCESS_TREE` para o
Discord. O Electron documenta que o identificador da fonte contém o HWND no Windows;
o helper resolve esse HWND para PID sem comparar títulos.

A [API Application Loopback do Windows](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
produz PCM estéreo 48 kHz/16-bit. O main encaminha blocos limitados pelo IPC; um
AudioWorklet converte para uma track Web Audio usada pelo WebRTC. Não usa driver,
injeção, leitura de memória, token ou modificação do aplicativo capturado.

A amostra oficial exige build 20348+, portanto não podemos prometer suporte ao
Windows 10 comum build 19045 por essa rota. Em sistema incompatível, fonte encerrada
ou helper indisponível, o áudio isolado termina e nunca volta silenciosamente à captura
global. O vídeo pode continuar. Esta primeira versão precisa de validação manual real
de áudio e latência antes de ser considerada concluída.

## Diagnóstico WebRTC em LAN virtual

Se os participantes aparecem na sala, mas a conexão fica Conectando e falha,
abra **Diagnóstico de conexão** abaixo do painel de transmissões. Envie a linha
dos dois PCs: motivo, estados ICE/coleta, tipos SDP local/remoto, quantidades de
candidatos e de nomes mDNS local/remoto, e estado do canal. Não contém endereços,
convite, credenciais ou SDP completo. O diagnóstico é local e não é enviado a serviço externo.

TIMEOUT_25S indica expiração, não prova bloqueio de firewall. NO_REMOTE_OFFER indica
ausência de oferta; SDP_EXCHANGE_FAILED e REMOTE_ICE_FAILED identificam outras
etapas. Contagens mDNS não comprovam resolução de nomes. Usar a interface Radmin
para a sala TCP não força o Chromium a usar a mesma interface para WebRTC.
Execute a mesma versão nos dois PCs e abra a VPN antes do app.

No Windows, o app configura o WebRTC para enumerar todas as interfaces e desativa
a substituição dos candidatos locais por nomes mDNS. Isso permite que uma LAN virtual
como o Radmin encaminhe candidatos IP diretamente. O diagnóstico mostra apenas as
contagens `mDNS` e `IP`; nunca mostra os endereços. Os IPs locais/VPN ainda fazem parte
do signaling WebRTC e, portanto, ficam visíveis aos participantes autenticados da sala.
Trate o convite como credencial e compartilhe-o somente com pessoas confiáveis.

Essa compatibilidade usa a política documentada de interfaces do Electron e uma
feature flag do Chromium. A flag deve ser revalidada ao atualizar Electron/Chromium.
Se o novo diagnóstico ainda mostrar `mDNS` igual ao total de candidatos, confirme que
os dois PCs realmente executam a mesma versão nova. Se mostrar candidatos `IP`, mas
falhar, o próximo suspeito passa a ser firewall/UDP ou a rota da interface Radmin.

O WebRTC usa a faixa UDP fixa `52000-52100`. O host também inicia um servidor STUN
local no mesmo IP/porta TCP do convite, usando UDP. Isso força a descoberta de um
candidato pela rota escolhida para a sala, inclusive Radmin, sem backend, deploy,
terminal ou relay de mídia. A resposta é limitada por endereço e por segundo; não
registra IPs e não fornece TURN.

O diagnóstico informa `UDP`, `Radmin` e `STUN` como contagens local/remoto, sem expor
endereços. `Radmin=1/1` e `STUN=1/1` confirmam que ambos descobriram um candidato pela
interface virtual. Só depois dessa confirmação uma nova falha aponta para firewall UDP
ou política de segurança de terceiros.

## Publicar uma versão

Com a árvore Git limpa, GitHub CLI instalado e autenticado, execute no Windows:

```powershell
npm run release -- patch
```

Também é possível usar `minor`, `major` ou uma versão exata, como `0.2.0`. O comando
atualiza `package.json` e `package-lock.json`, executa check/test/build nativo, gera o
executável portátil e seu SHA-256, cria commit e tag, envia ambos atomicamente e publica
os arquivos no GitHub Release. Se alguma validação ou build falhar antes do commit,
revise o erro e restaure manualmente os arquivos de versão antes de tentar novamente.

## Formato do convite

Formato: `VS1.<JSON codificado em base64url>`.
O formato compacto `PL1.` contém, em binário codificado como base64url, `host`
(IPv4), `port`, `secret` (32 bytes aleatórios) e `fingerprint` (SHA-256 do
certificado). O `roomId` é derivado do segredo e não precisa ser repetido no código.
Convites legados no formato `VS1.` continuam aceitos.
O código é longo por conter todos os dados sem depender de um serviço de lookup.
Base64url não cifra o convite: trate o código inteiro como uma credencial.
Ele não é uma URL aberta pelo navegador e não precisa de associação de protocolo do SO.

## Verificação

```powershell
npm run check
npm test
npm run build
npm run smoke
npm run dev -- --smoke-test
```

- check: TypeScript strict, ESLint e Prettier.
- test: sockets TLS reais em loopback, persistência, pin incorreto sem vazamento
  de dados, segredo incorreto, IDs duplicados, limite de sala, payloads inválidos,
  saída e heartbeat.
- smoke: Electron real, renderer, estilos, preload/IPC, isolamento Node, CSP,
  criação de sala e conexão de um segundo cliente no runtime Electron.
  Usa perfil de teste isolado e fecha a sala; não altera o perfil padrão.
  Gera .artifacts/milestone-2.png com uma sala de teste já encerrada.
- Os testes automatizados usam sockets locais; não substituem validação visual
  nem um teste em dois PCs físicos.
- Formatação: npm run format.

## Limitações deste marco

Até 8 participantes, uma sala por instância, IPv4 e host acessível diretamente.
Sem descoberta global, UDP/mDNS, reconexão automática, migração de host ou kick
individual. Para revogar um convite, encerre e recrie a sala.
Sem contas: nomes não são verificados; o UUID não prova a identidade de uma pessoa.
O convite concede acesso a quem o possuir. O certificado temporário vale por 7 dias;
recrie a sala para permitir novas conexões após esse prazo.
Há captura, preview, streaming P2P, áudio opcional Windows e STUN embutido para a LAN;
ainda não há STUN público ou TURN.
A internet será tratada no Milestone 7; este convite LAN não atravessa NAT sozinho.

## Arquivos e dependências

main/room contém domínio local e coordenação; main/transport contém TLS/framing.
shared/schemas e shared/protocols validam IPC e rede. React usa componentes de perfil,
entrada e sessão. A UI consulta snapshots a cada 750 ms.
O renderer continua sem APIs Node arbitrárias.

Electron, React, Vite, TypeScript, esbuild, Zod, ESLint e Prettier foram preservados.
Foi adicionada selfsigned para gerar certificados X.509 temporários usando crypto
nativo; isso evita implementar ASN.1/certificados manualmente. TLS é fornecido pelo
Node integrado ao Electron. Versões e dependências estão travadas no lockfile.
