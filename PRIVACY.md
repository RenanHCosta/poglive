# Política de privacidade do Poglive

Última atualização: 7 de outubro de 2026.

O Poglive não possui conta, servidor central, publicidade, telemetria ou ferramenta
de análise. O projeto não vende nem recebe dados pessoais. As conexões de sala e a
mídia são diretas entre os participantes escolhidos pelo usuário.

## Dados armazenados no computador

O aplicativo salva no perfil local um identificador aleatório (`peerId`) e o nome de
exibição informado pelo usuário (`identity.json`), além das preferências do aplicativo
(`settings.json`): dispositivos de áudio escolhidos, volumes, sensibilidade do
microfone, atalhos, sons, opções de transmissão e, quando ajustados, o volume e o
silêncio local definidos para outros participantes, associados ao `peerId` deles.
Electron também pode manter dados técnicos de cache.
A desinstalação preserva esses dados para permitir uma reinstalação sem perder o
perfil. Eles podem ser apagados removendo a pasta `%APPDATA%\poglive` depois de fechar
o aplicativo.

Convites, certificados temporários, segredos de sala, descrições WebRTC, mídia e
mensagens do chat não são armazenados pelo Poglive após o encerramento da sala. O
histórico do chat existe apenas na memória do anfitrião e dos participantes enquanto a
sala está aberta. O certificado TLS temporário de
cada sala é gerado localmente e mantido apenas em memória.

## Dados compartilhados com participantes

Ao criar ou entrar em uma sala, o nome de exibição, o `peerId` e informações técnicas
necessárias à conexão são enviados aos demais participantes. Isso inclui endereços IP,
portas e candidatos ICE. O convite contém endereço do host, porta, identificador e
segredo da sala e impressão digital do certificado; quem recebe o convite pode tentar
entrar enquanto aquela sala existir.

O microfone só é aberto quando o usuário entra no canal de voz ou inicia o teste de
microfone nas configurações. A voz é enviada por WebRTC diretamente aos participantes
que também estão no canal de voz; enquanto o usuário fala abaixo da sensibilidade ou
está silenciado, nada além de silêncio é transmitido. A câmera nunca é solicitada.

O estado de voz (conectado, silenciado, áudio desativado e transmitindo) e as mensagens
do chat passam pelo anfitrião da sala, que os repassa aos demais participantes. O
anfitrião registra o nome do autor e o horário de cada mensagem.

A tela, janela e áudio só são capturados após seleção explícita no aplicativo. A mídia
selecionada é enviada por WebRTC somente aos participantes que solicitarem assisti-la.
O host transporta o signaling da sala, mas o fluxo de áudio e vídeo permanece direto
entre os participantes. O conteúdo não é enviado ao desenvolvedor do Poglive.

Durante uma transmissão com qualidade automática, o receptor envia diretamente ao
transmissor métricas técnicas limitadas: proporções de perda e frames descartados,
jitter, atraso do jitter buffer, round-trip time, FPS, dimensões do vídeo, congelamentos
e indicação de reprodução parada. O transmissor usa esses dados para adaptar somente
aquela conexão. Essas métricas não contêm conteúdo de áudio/vídeo, endereços IP ou
identidade adicional, não são persistidas e não são enviadas ao desenvolvedor. No modo
fixo, as métricas locais ainda alimentam o indicador do player, mas não são reportadas ao
transmissor para adaptação.

Radmin VPN ou outro software de rede usado para aproximar os computadores é um produto
independente e está sujeito à política de privacidade do respectivo fornecedor.

## Atualizações

A versão instalada verifica o repositório público `RenanHCosta/poglive` no GitHub cerca
de cinco segundos após abrir e, depois, a cada seis horas. Quando existe uma versão
nova, o instalador pode ser baixado automaticamente. Essas requisições revelam ao
GitHub dados normais de uma conexão de internet, como endereço IP, versão solicitada e
informações do cliente. Consulte a [política de privacidade do GitHub](https://docs.github.com/pt/site-policy/privacy-policies/github-general-privacy-statement).
A edição portátil e o ambiente de desenvolvimento não executam o atualizador.

## Diagnósticos

O diagnóstico de conexão exibido pelo aplicativo contém estados e contagens, sem
mostrar SDP, segredos ou endereços dos candidatos. Ele só sai do computador quando o
próprio usuário decide copiá-lo e compartilhá-lo.

## Alterações e contato

Mudanças nesta política serão publicadas neste arquivo. Dúvidas podem ser abertas nas
[issues do projeto](https://github.com/RenanHCosta/poglive/issues), sem incluir
convites, segredos de sala ou outros dados privados.
