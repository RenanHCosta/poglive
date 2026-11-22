import { z } from 'zod';
import { displayNameSchema } from './common';

/** UDP port for LAN room discovery, outside the WebRTC range 52000-52100. */
export const DISCOVERY_PORT = 52110;
export const DISCOVERY_MAGIC = 'poglive-discovery';
/** Discovery packets are tiny; anything larger is ignored unparsed. */
export const MAX_DISCOVERY_BYTES = 1024;

const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

// Objects strip unknown keys (not strict) so a newer build can add fields and
// still be listed, as "different version", by older ones.
export const discoveryProbeSchema = z.object({
  magic: z.literal(DISCOVERY_MAGIC),
  v: z.literal(1),
  type: z.literal('PROBE'),
  nonce: nonceSchema,
});
export type DiscoveryProbe = z.infer<typeof discoveryProbeSchema>;

export const discoveryAnnouncementSchema = z.object({
  magic: z.literal(DISCOVERY_MAGIC),
  v: z.literal(1),
  type: z.literal('ROOM'),
  nonce: nonceSchema,
  protocol: z.number().int().min(1).max(1000),
  roomId: z.uuid(),
  name: displayNameSchema,
  hostName: displayNameSchema,
  members: z.number().int().min(1).max(64),
  max: z.number().int().min(1).max(64),
  invite: z.string().min(1).max(256),
});
export type DiscoveryAnnouncement = z.infer<typeof discoveryAnnouncementSchema>;

export const discoveredRoomSchema = z
  .object({
    roomId: z.uuid(),
    name: displayNameSchema,
    hostName: displayNameSchema,
    members: z.number().int().min(1).max(64),
    max: z.number().int().min(1).max(64),
    /** Same room protocol as this build; only compatible rooms carry an invite. */
    compatible: z.boolean(),
    invite: z.string().max(256),
  })
  .strict();
export type DiscoveredRoom = z.infer<typeof discoveredRoomSchema>;
export const discoveredRoomsSchema = z.array(discoveredRoomSchema).max(64);
