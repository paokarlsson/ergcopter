// Livedata från spelet till dashboarden i en annan flik i samma webbläsare
// (BroadcastChannel). Spelet skickar höjden och effekten relativt det som krävs;
// watt bara när operatören har slagit på råa watt (spec §6).

export const LIVE_CHANNEL = 'skierg.live.v1';

/** Kanalen, eller null om webbläsaren saknar BroadcastChannel. */
export function openLive() {
  try {
    return new BroadcastChannel(LIVE_CHANNEL);
  } catch {
    return null;
  }
}
