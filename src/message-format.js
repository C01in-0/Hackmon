// Remove only a leading transcript label, never words inside the message,
// quoted content, code blocks, or other formatting chosen by the player.
export function stripTurnLabel(message) {
  if(typeof message!=='string')return message;
  const label=/^\s*(?:(?:第\s*[0-9０-９一二三四五六七八九十百零〇两]+\s*(?:招|轮|回合|次)\s*)?攻击\s*[:：]|(?:Round\s+\d+\s*[-:：]?\s*)?Attack\s*[:：])\s*/iu;
  const match=message.match(label);
  if(!match)return message;
  const body=message.slice(match[0].length);
  // Preserve a label-only response rather than silently send an empty input.
  return body.trim()?body:message;
}
