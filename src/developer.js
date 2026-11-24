// Test controls belong to one account and never apply to a live adapter.
export function developerDefaults(config) {
  return { leagueRounds: config.leagueRounds, championRounds: config.championRounds,
    tickMs: config.tickMs, championBreakRound: Math.min(23, config.championRounds), utilityPercent: -1 };
}
export function validateDeveloperSettings(value) {
  const bounds = { leagueRounds: [10, 50], championRounds: [10, 30], tickMs: [80, 2000],
    championBreakRound: [1, 30], utilityPercent: [-1, 100] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('开发参数格式无效。');
  for (const [key, number] of Object.entries(value)) {
    if (!bounds[key] || !Number.isInteger(number) || number < bounds[key][0] || number > bounds[key][1]) {
      throw new Error(`开发参数 ${key} 无效。`);
    }
  }
  return { ...value };
}
