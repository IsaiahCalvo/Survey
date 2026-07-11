export function getCoalescedOrCurrentEvents(nativeEvent) {
  const coalesced = nativeEvent?.getCoalescedEvents?.() || [];
  return coalesced.length ? coalesced : [nativeEvent];
}
