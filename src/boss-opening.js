// New matches use the frontend cinematic only; no extra opening model call is made.
// Ordinary dialogue only: no lane, secret, match or combat history is accepted.
export function openingMessages(defensePrompt, text) {
  return [{ role: 'system', content: defensePrompt }, { role: 'user', content: text }];
}

// The same public conversation, viewed from the current speaker's side.
// Kept separately from numbered exchanges so trimming them cannot erase it.
export function openingMemory(dialogue, seat) {
  if (dialogue?.status !== 'completed' || !dialogue.reply) return [];
  return [
    { role: seat === 'B' ? 'assistant' : 'user', content: dialogue.text },
    { role: seat === 'B' ? 'user' : 'assistant', content: dialogue.reply }
  ];
}
