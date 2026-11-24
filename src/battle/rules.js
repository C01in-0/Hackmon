export const LEAGUE_RULES_VERSION = 'league-15-screen-only-v2';

export function utility(correct, total) {
  return total > 0 ? (correct * 100) / total : 0;
}

export function leagueResult(match) {
  const defenses = match.lanes.filter(lane => lane.role === 'defense');
  const attacks = match.lanes.filter(lane => lane.role === 'attack');
  const fallenSeats = new Set(attacks.filter(lane => lane.broken).map(lane => lane.defender)).size;
  const allComplete = match.lanes.every(lane => lane.complete);
  // U is measured only during pre-screening, never during combat.
  const settled = allComplete && match.status !== 'running' && match.status !== 'interrupted';
  const defensesComplete = defenses.length === 2 && defenses.every(lane =>
    lane.complete && !lane.leaked && (lane.defeatedStop
      ? lane.successfulDefenses === lane.roundsTarget
      : lane.roundsCompleted === lane.roundsTarget)
  );
  const advanced = settled && defensesComplete && fallenSeats >= 1;
  const route = advanced ? '联盟晋级' : null;
  return { settled, fallenSeats, defensesComplete, allComplete, advanced, route };
}

export function championResult(match) {
  const attack = match.lanes.find(lane => lane.role === 'attack');
  const defense = match.lanes.find(lane => lane.role === 'defense');
  const defended = !!defense && defense.complete && !defense.leaked &&
    (defense.defeatedStop
      ? defense.successfulDefenses === defense.roundsTarget
      : defense.roundsCompleted === defense.roundsTarget);
  const complete = match.lanes.every(lane => lane.complete);
  return { complete, broken: !!attack?.broken, defended,
    won: complete && match.status !== 'running' && match.status !== 'interrupted' && !!attack?.broken && defended };
}
