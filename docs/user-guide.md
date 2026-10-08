# Guia do usuário

Este guia cobre a versão instalada e a edição portátil do Poglive no Windows x64.

## Instalação e perfil

Baixe os arquivos somente nas
[Releases oficiais](https://github.com/RenanHCosta/poglive/releases):

- `Poglive-*-setup.exe`: instala por usuário, cria atalhos e recebe atualizações.
- `Poglive-*-portable.exe`: executa sem instalação e precisa ser atualizado manualmente.

“Portátil” significa sem instalação. O perfil e o cache ainda ficam no AppData do
Windows. Apagar o executável portátil não remove esses dados. Para apagar o perfil,
feche o aplicativo e remova `%APPDATA%\poglive`.

Na primeira execução, informe um nome. O Poglive gera um identificador aleatório e
mantém ambos no perfil local. O nome pode ser alterado fora de uma sala; o identificador
permanece. Não copie `identity.json` ou uma pasta de perfil para outro computador.

## Visão geral da interface

A janela segue o layout de aplicativos de voz conhecidos:

- **Barra de salas**, à esquerda: Início, a sala atual, criar (+) e entrar por convite.
- **Barra da sala**: nome da sala com menu (convidar, configurações, sair), o canal de
  texto `#chat`, a **Sala de voz** com quem está conectado e o painel da conexão de voz.
- **Painel do usuário**, no rodapé: seu nome, silenciar microfone, desativar áudio e
  configurações.
- **Área principal**: o chat ou o palco da voz, com blocos dos participantes e das
  transmissões. Na voz, o botão de mensagem no topo abre o chat ao lado.
- **Participantes**, à direita do chat: quem está na voz e quem está só na sala.

Clique em um participante (ou use o botão direito) para ver o estado da conexão direta,
ajustar o volume dele só para você, silenciá-lo localmente e abrir o diagnóstico.

## Criar uma sala

1. Selecione **Criar uma sala** (ou o **+** da barra de salas).
2. Informe o nome da sala.
3. Escolha o IPv4 da rede pela qual os convidados alcançarão o host:
   - Wi-Fi ou Ethernet para computadores na mesma LAN;
   - Radmin ou outra VPN para uma LAN virtual;
   - `127.0.0.1` somente para testes no mesmo computador.
4. Abra **Convidar pessoas** no menu da sala, copie e envie o convite completo por um
   canal confiável.

O host abre uma porta disponível na interface selecionada. Encerrar a sala ou fechar o
host desconecta todos. Uma sala nova gera outro segredo, identificador e certificado;
convites antigos deixam de funcionar.

## Entrar em uma sala

Selecione **Entrar com convite**, cole o convite e confirme. Um convite válido permite a
entrada automática enquanto houver espaço e o mesmo identificador não estiver conectado.
O limite atual é de oito participantes.

Convites começam com `PL2.`. Um convite `PL1.` vem de uma versão anterior: quem criou
a sala precisa atualizar o Poglive e gerar um convite novo. Todos os participantes devem
usar a mesma versão.

O convite é uma credencial temporária. Base64url não é criptografia: quem tiver o código
completo poderá tentar entrar enquanto a sala existir. Nomes e identificadores são
declarados pelos participantes e não comprovam a identidade de uma pessoa.

## Voz

Clique em **Sala de voz** na barra da sala, ou em **Entrar na voz** no palco. A voz é
enviada diretamente a cada participante que também estiver no canal de voz.

- **Silenciar** (microfone) e **Desativar áudio** ficam no painel do usuário e nos
  controles do palco. Desativar o áudio também silencia o microfone; ativar o microfone
  de novo reativa o áudio.
- Um contorno verde indica quem está falando.
- Sem microfone disponível, você entra só para ouvir; conecte o dispositivo e use
  **Tentar de novo**.
- Para sair só da voz, use o botão vermelho. Você continua na sala e no chat.

O Windows pode pedir permissão de microfone na primeira vez. Se o acesso for negado,
libere em **Configurações do Windows > Privacidade > Microfone**.

### Sensibilidade e processamento

Em **Configurações > Voz e áudio**:

- Escolha os dispositivos de entrada e saída e os volumes (até 200%).
- **Determinar automaticamente a sensibilidade** acompanha o ruído do ambiente. Sem
  ela, ajuste o limite manual; o teste de microfone mostra o nível e o ponto de corte
  (verde quando sua voz seria transmitida).
- Supressão de ruído, cancelamento de eco e controle automático de ganho usam o
  processamento nativo do Chromium.

### Atalhos globais

Por padrão, `Ctrl + Shift + M` silencia o microfone e `Ctrl + Shift + D` desativa o
áudio, mesmo com um jogo em foco. Altere em **Configurações > Atalhos**. Atalhos
precisam de uma tecla modificadora (Ctrl, Alt, Shift) ou de F13–F24. Se outro
aplicativo já usar a combinação, o Poglive avisa na mesma tela.

Push-to-talk global não está disponível: o Windows não informa ao Electron quando uma
tecla global é solta.

## Chat de texto

O canal `#chat` aceita mensagens de até 2.000 caracteres. `Enter` envia e
`Shift + Enter` quebra a linha.

- Formatação: `**negrito**`, `*itálico*`, `__sublinhado__`, `~~riscado~~`,
  `||spoiler||`, código entre crases e blocos com três crases.
- Digite `@` para mencionar alguém da sala. Menções a você ficam destacadas e tocam um
  som.
- Links `http`/`https` abrem no navegador padrão.
- Mensagens ainda não confirmadas pelo anfitrião aparecem em cinza; se falharem, use
  **Reenviar**. O anfitrião aceita até cinco mensagens a cada cinco segundos por pessoa.

O histórico fica somente na memória do anfitrião (até 200 mensagens) e quem entra
recebe as últimas 100. Encerrar a sala apaga tudo; nada é gravado em disco.

## Transmitir e assistir

1. Clique em **Transmitir** no painel de voz, ou no botão de tela nos controles do
   palco.
2. Escolha uma janela em **Aplicativos** ou um monitor em **Telas**.
3. Ajuste resolução, taxa de quadros e áudio. A escolha fica salva para a próxima vez.
4. Clique em **Transmitir** (ou dê um duplo clique na fonte).

Seu nome ganha a marca **AO VIVO** e um bloco com a prévia da transmissão aparece no
palco, com o número de pessoas assistindo. Clique de novo no botão de tela para parar.

Os demais participantes veem o bloco da transmissão e decidem se querem assistir.
Clique em um bloco para destacá-lo; duplo clique abre tela cheia. Passe o mouse para
ver o volume, o mini player (picture-in-picture), tela cheia e **Parar de assistir**. É possível
assistir a várias transmissões ao mesmo tempo, usar tela cheia ou picture-in-picture e
ajustar o volume de cada player. Sair de um player não encerra a transmissão na origem.

Uma fonte pode apresentar imagem preta ou congelada quando está minimizada ou protegida
pelo sistema. Restaure a janela ou compartilhe o monitor correspondente.

Cada espectador recebe mídia diretamente do transmissor. Mais espectadores aumentam o
upload e a carga de codificação. Em caso de stuttering, teste primeiro 720p a 30 FPS com
apenas um espectador.

## Qualidade adaptativa

A resolução e o FPS escolhidos pelo transmissor funcionam como limite máximo. No modo
automático, cada conexão percorre sua própria escada de qualidade, sem reduzir os demais
espectadores:

```text
1080p60 → 1080p30 → 720p30 → 540p30 → 540p15
```

Uma origem limitada a 720p ou 30 FPS começa no degrau correspondente. O Poglive mede a
cada dois segundos perda, jitter, atraso do jitter buffer, round-trip time, frames
descartados, congelamentos e limitações de CPU/banda informadas pelo WebRTC. Dois
intervalos ruins reduzem um degrau; a recuperação exige cerca de dez amostras estáveis e
usa cooldown para evitar alternância constante.

O player mostra resolução/FPS observados, modo automático ou fixo e o motivo da redução.
Desativar o automático mantém os limites escolhidos no sender, embora o próprio WebRTC
ainda possa reduzir bitrate quando a rede não comportar a transmissão.

## Modos de áudio da transmissão

| Modo                 | Conteúdo enviado                                          |
| -------------------- | --------------------------------------------------------- |
| Áudio do computador  | Todo o som do Windows, exceto o próprio Poglive           |
| Somente o aplicativo | Áudio da árvore de processos associada à janela escolhida |
| Sem áudio            | Somente vídeo                                             |

“Áudio do computador” exclui a árvore de processos do Poglive: a voz da sala, os sons
do aplicativo e as transmissões que você está assistindo nunca voltam pela sua
transmissão. Por isso não há eco nem recaptura, mesmo assistindo e transmitindo ao
mesmo tempo.

Os dois modos com áudio usam um helper nativo e requerem Windows build 20348 ou
superior. Se o áudio não puder ser capturado, a transmissão continua somente com vídeo
e o aviso aparece no palco. O áudio da transmissão é estéreo; a voz usa o microfone e é
enviada separadamente.

## Rede e Radmin VPN

Em uma LAN física, ambos os computadores precisam ter rota direta e o firewall deve
permitir o Poglive na rede privada apropriada. Redes guest ou com isolamento de clientes
podem impedir a conexão.

Em uma LAN virtual:

1. Abra o Radmin antes do Poglive nos dois computadores.
2. O host deve escolher o IPv4 exibido para a interface Radmin.
3. Use a mesma versão do Poglive nos dois lados.
4. Não desative o firewall; permita somente o aplicativo e a rede necessários.

O WebRTC usa UDP na faixa `52000–52100`. O host executa também um STUN local na
interface escolhida. Não existe STUN público, TURN ou relay de mídia operado pelo
projeto.

## Diagnóstico de conexão

Se a entrada na sala funciona, mas a conexão direta não, o participante aparece com um
alerta. Abra o perfil dele: o Poglive tenta reconectar sozinho em intervalos crescentes,
e **Tentar de novo** força uma nova tentativa. **Diagnóstico da conexão** mostra a linha
a comparar entre os dois computadores.

- `ICE=connected`: o transporte WebRTC chegou a conectar.
- `Radmin` e `STUN`: mostram quantos candidatos foram encontrados por essa rota.
- `canal=-`: o DataChannel ainda não abriu.
- `TIMEOUT_25S`: houve expiração; sozinho, não prova bloqueio de firewall.

O diagnóstico não inclui o convite, SDP completo ou os endereços dos candidatos. Ainda
assim, remova qualquer informação adicional sensível antes de publicar uma issue.

## Limitações atuais

- Uma sala por instância e até oito participantes.
- IPv4 e conectividade direta por LAN ou VPN; sem travessia geral de NAT ou TURN.
- Sem contas, verificação de identidade, banimento persistente, kick ou migração de host.
- Sem reconexão automática após perda da sala. Conexões diretas entre participantes
  são refeitas automaticamente enquanto a sala existir.
- Sem push-to-talk global, edição ou exclusão de mensagens e anexos no chat.
- Certificados temporários da sala expiram; recrie a sala quando necessário.
- Qualidade real depende de captura, encoder, decoder, CPU/GPU, rede e número de viewers.

Detalhes dos protocolos e do modelo de segurança estão em [architecture.md](architecture.md).
