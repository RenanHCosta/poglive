import type {
  ChatMessage,
  ChatRejection,
  Reaction,
} from '../../shared/schemas/chat';

/** Optional observers shared by RoomHost and RoomClient. */
export interface RoomEvents {
  onChange?: () => void;
  onChat?: (message: ChatMessage) => void;
  onChatRejected?: (id: string, reason: ChatRejection) => void;
  /** History arrives after admission; observers should re-read it. */
  onHistory?: () => void;
  onTyping?: (peerId: string) => void;
  onChatUpdated?: (message: ChatMessage) => void;
  onChatDeleted?: (id: string) => void;
  onReaction?: (
    fromPeerId: string,
    targetPeerId: string,
    emoji: Reaction,
  ) => void;
  onPreview?: (peerId: string, image: string | null) => void;
}
