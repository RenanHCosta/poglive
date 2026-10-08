import type { ChatMessage, ChatRejection } from '../../shared/schemas/chat';

/** Optional observers shared by RoomHost and RoomClient. */
export interface RoomEvents {
  onChange?: () => void;
  onChat?: (message: ChatMessage) => void;
  onChatRejected?: (id: string, reason: ChatRejection) => void;
}
