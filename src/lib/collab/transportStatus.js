export function isTransportChannelJoined(providerHandle) {
  try {
    return providerHandle?.getChannel?.()?.state === 'joined';
  } catch {
    return false;
  }
}
