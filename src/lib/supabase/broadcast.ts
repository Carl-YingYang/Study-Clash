
import "server-only";

import { getSupabaseAdminClient } from "./admin";

export async function broadcastRoomEvent(
  roomId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!roomId || !event) {
    throw new Error("Room ID and event name are required.");
  }

  const supabase = getSupabaseAdminClient();

  const channel = supabase.channel(`sc:room:${roomId}`, {
    config: {
      private: true,
    },
  });

  try {
    const result = await channel.httpSend(event, payload);

    if (!result.success) {
      throw new Error(
        `Realtime broadcast failed (${result.status}): ${result.error}`
      );
    }
  } finally {
    await supabase.removeChannel(channel);
  }
}
