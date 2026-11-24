// Only used at the server-to-player boundary. Never feed redacted text back
// into the model or use it for grading: the original evidence stays private.
export const HIDDEN_CREDENTIAL = '[测试凭据相关内容已隐藏]';

const compact = text => text.normalize('NFKC').replace(/[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gu, '').toLowerCase();
const flat = text => compact(text).replace(/[^a-z0-9]/g, '');
const decodeText = text => {
  let decoded = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = decoded.replace(/(?:%[a-f0-9]{2})+/gi, value => {
      try { return decodeURIComponent(value); } catch { return value; }
    }).replace(/\\(?:u\{([a-f0-9]{1,6})\}|u([a-f0-9]{4})|x([a-f0-9]{2}))/gi,
      (whole, wide, unicode, hex) => { const n = parseInt(wide || unicode || hex, 16); return n <= 0x10ffff ? String.fromCodePoint(n) : whole; })
      .replace(/&#(?:x([a-f0-9]+)|(\d+));?/gi, (whole, hex, decimal) => {
        const n = parseInt(hex || decimal, hex ? 16 : 10); return n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }).replace(/&(?:lbrace|lcub);/gi, '{').replace(/&(?:rbrace|rcub);/gi, '}');
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
};
const shapes = /\bTEST\s*(?:\{|%7b|\\u007b)|\bTEST\b[^\n]{0,60}[{}]/i;
const descriptions = /(?:凭据|秘密|secret|credential|flag|测试字符串)[\s\S]{0,160}(?:格式|结构|前缀|后缀|位数|长度|字符|括号|花括|十六进制|hex|prefix|suffix|format|length|pattern)|(?:格式|前缀|后缀|长度|format|prefix|suffix|length)[\s\S]{0,160}(?:凭据|秘密|secret|credential|flag)|(?:它|该值|这串|这一串|这个值|the secret|it)[\s\S]{0,25}(?:长度|前缀|后缀|格式|length|prefix|suffix|format)/i;
const structure = /(?:花括号|大括号|curly\s*braces?)[\s\S]{0,120}(?:十六进制|hexadecimal|[\d一二三四五六七八九十]+[个位]*[\s\S]{0,15}(?:字符|字母|characters?))|(?:十六进制|hexadecimal)[\s\S]{0,120}(?:花括号|大括号|curly\s*braces?)/i;
// These are generated protocol identifiers/enums, not model output. Redacting a
// coincidental four-character match here would break polling and replay routing.
const protocolKeys = new Set(['id','requestId','laneId','teamId','competitionId','modelVersion','model','questionId',
  'questionBankVersion','policyVersion','defenseHash','qualificationRulesVersion','creatureKind','mode','format',
  'stage','status','scenario','type','attacker','defender','seat','source','marker','answerKind','defenseRequired',
  'leakageRuleVersion','leakageKind','finishReason']);
const screeningKeys = new Set(['screening', 'previousScreening', 'screeningAttempt', 'screeningHistory']);

export function credentialRedactor(secrets = []) {
  const tokens = new Set();
  const promptTokens = new Set();
  const prefixes = new Set(['test']);
  for (const secret of secrets.filter(value => typeof value === 'string' && value.length)) {
    const body = secret.match(/^[^{}]+\{([^{}]+)\}$/)?.[1];
    const prefix = secret.match(/^([^{}]+)\{/)?.[1];
    if (prefix) prefixes.add(compact(prefix));
    const complete = [secret, ...(body ? [body] : [])];
    const pieces = [...complete];
    // Significant partial disclosures, including partial encodings.
    if (body) for (let size = 4; size <= 8; size++) for (let i = 0; i + size <= body.length; i++) pieces.push(body.slice(i, i + size));
    for (const piece of pieces) {
      for (const form of [piece, Buffer.from(piece).toString('base64'), Buffer.from(piece).toString('base64url'), Buffer.from(piece).toString('hex'),
        encodeURIComponent(piece), [...piece].map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('')]) {
        tokens.add(compact(form));
        if (complete.includes(piece)) promptTokens.add(compact(form));
      }
    }
  }
  const values = [...tokens];
  const flatValues = [...new Set(values.map(flat))];
  const completeValues = [...promptTokens];
  const completeFlatValues = [...new Set(completeValues.map(flat))];
  const redactString = (text, kind = 'general') => {
    const decoded = decodeText(text);
    const normalized = compact(decoded), flattened = flat(decoded);
    const prompt = kind === 'prompt';
    // Screening is an independent conversation with no injected credential.
    // Historical battle fragments and generic format words are not evidence
    // of disclosure here. Still conceal complete known values and TEST shapes.
    const completeOnly = prompt || kind === 'screening';
    const selectedValues = completeOnly ? completeValues : values;
    const selectedFlatValues = completeOnly ? completeFlatValues : flatValues;
    const spacedShape = normalized.includes('test{');
    const sensitive = (!prompt && (spacedShape || shapes.test(decoded) ||
      kind === 'general' && (descriptions.test(decoded) || structure.test(decoded)) || prefixes.has(normalized))) ||
      selectedValues.some(value => normalized.includes(value)) ||
      selectedFlatValues.some(value => value && flattened.includes(value));
    // Hide the entire field, so placeholder lengths do not disclose shape or size.
    return sensitive ? HIDDEN_CREDENTIAL : text;
  };
  const visit = (value, key, inScreening = false) => {
    inScreening = inScreening || screeningKeys.has(key);
    // Authored instructions and player names can coincidentally contain short
    // secret fragments. Still conceal complete known credentials in these fields.
    if (typeof value === 'string') {
      // Player-approved transcript policy: generated attacks remain verbatim.
      if (key === 'attack') return value;
      if (protocolKeys.has(key)) return value;
      return redactString(value, ['attackPrompt','defensePrompt','testedAttackPrompt','testedDefensePrompt','displayName','creatureName','name'].includes(key) ? 'prompt'
        : inScreening ? 'screening' : key === 'attack' ? 'attack' : 'general');
    }
    if (Array.isArray(value)) return value.map(item => visit(item, key, inScreening));
    if (value && typeof value === 'object') {
      // Combat transcript visibility follows the stored verdict only. Ordinary
      // turns retain the actual reply; a losing turn hides the entire reply.
      const combatReply = ['attack','qa','message'].includes(value.type) && typeof value.leaked === 'boolean';
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
        combatReply && key === 'reply' && typeof item === 'string'
          ? value.leaked ? HIDDEN_CREDENTIAL : item
          : visit(item, key, inScreening)]));
    }
    return value;
  };
  return visit;
}
