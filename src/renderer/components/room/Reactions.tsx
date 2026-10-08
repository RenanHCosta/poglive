import type { CSSProperties } from 'react';
import { REACTIONS } from '../../../shared/schemas/chat';
import type { Reaction } from '../../../shared/schemas/chat';
import type { RoomSession } from '../../services/RoomSession';
import { useStore } from '../../services/store';

/** Emojis floating up over a stream; everyone watching sees the same ones. */
export function ReactionLayer({
  session,
  targetPeerId,
}: {
  session: RoomSession;
  targetPeerId: string;
}) {
  const reactions = useStore(session.reactions).filter(
    (reaction) => reaction.targetPeerId === targetPeerId,
  );
  return (
    <div className="reaction-layer" aria-hidden="true">
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          className="reaction-float"
          style={
            {
              // Spread and sway derived from the ID so each one differs.
              '--x': `${10 + ((reaction.id * 37) % 80)}%`,
              '--sway': `${((reaction.id * 53) % 40) - 20}px`,
            } as CSSProperties
          }
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}

export function ReactionBar({
  onReact,
}: {
  onReact: (emoji: Reaction) => void;
}) {
  return (
    <div
      className="reaction-bar"
      role="toolbar"
      aria-label="Reagir à transmissão"
    >
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`Reagir com ${emoji}`}
          onClick={(event) => {
            event.stopPropagation();
            onReact(emoji);
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
