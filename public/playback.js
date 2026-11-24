// Network state and displayed state advance separately. A hit is committed only
// after its animation, including a lethal hit's finisher, has completed.
export function commitEvent(displayed, event) {
  if (displayed.events.some(item => item.id === event.id)) return displayed;
  return { ...displayed, ...(event.progress || {}), events: [...displayed.events, event] };
}

export function attackStyle(match, lane) {
  if (lane.attacker === 'A') return match.snapshot.creatureKind || 'fire';
  if (match.stage === 'champion') return 'boss';
  return match.seats[lane.attacker]?.creatureKind || (lane.attacker === 'B' ? 'grass' : 'spark');
}
