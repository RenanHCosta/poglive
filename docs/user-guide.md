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

## Criar uma sala

1. Selecione **Criar sala**.
2. Informe o nome da sala.
3. Escolha o IPv4 da rede pela qual os convidados alcançarão o host:
   - Wi-Fi ou Ethernet para computadores na mesma LAN;
   - Radmin ou outra VPN para uma LAN virtual;
   - `127.0.0.1` somente para testes no mesmo computador.
4. Copie e envie o convite completo por um canal confiável.

O host abre uma porta disponível na interface selecionada. Encerrar a sala ou fechar o
host desconecta todos. Uma sala nova gera outro segredo, identificador e certificado;
convites antigos deixam de funcionar.

## Entrar em uma sala

Selecione **Entrar em sala**, cole o convite e confirme. Um convite válido permite a
entrada automática enquanto houver espaço e o mesmo identificador não estiver conectado.
O limite atual é de oito participantes.

O convite é uma credencial temporária. Base64url não é criptografia: quem tiver o código
completo poderá tentar entrar enquanto a sala existir. Nomes e identificadores são
declarados pelos participantes e não comprovam a identidade de uma pessoa.

## Compartilhar e assistir

Dentro da sala:

1. Clique em **Compartilhar tela**.
2. Escolha 720p ou 1080p e 30 ou 60 FPS.
3. Mantenha a qualidade automática ativada ou escolha parâmetros fixos.
4. Selecione o modo de áudio.
5. Escolha uma janela ou monitor e confirme o preview.

Os demais participantes recebem o anúncio e decidem se querem assistir. É possível
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

## Modos de áudio

| Modo                 | Conteúdo enviado                                              |
| -------------------- | ------------------------------------------------------------- |
| Sem áudio            | Somente vídeo                                                 |
| Somente a janela     | Áudio da árvore de processos associada à janela escolhida     |
| Tudo menos o Discord | Sistema, excluindo Discord Stable, Canary, PTB ou Development |
| Todo o sistema       | Tudo reproduzido pelo loopback global do Windows              |

O áudio seletivo usa um helper nativo e requer Windows build 20348 ou superior. Uma
falha nesse helper encerra somente o áudio e nunca muda silenciosamente para captura
global. O microfone não é usado.

Compartilhar o sistema enquanto assiste a outra live pode recapturar o player. Coloque
o volume recebido em zero para evitar esse ciclo; fones de ouvido não impedem a
recaptura feita por software.

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

Se a entrada na sala funciona, mas o WebRTC não conecta, abra **Diagnóstico de conexão**
e compare a linha dos dois computadores.

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
- Sem reconexão automática após perda da sala.
- Certificados temporários da sala expiram; recrie a sala quando necessário.
- Qualidade real depende de captura, encoder, decoder, CPU/GPU, rede e número de viewers.

Detalhes dos protocolos e do modelo de segurança estão em [architecture.md](architecture.md).
