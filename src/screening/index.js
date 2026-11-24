import { createHash, randomInt } from 'node:crypto';
import questions from './questions.json' with { type: 'json' };

export const UTILITY_BANK_VERSION = 'u100-v9-gentler';
export const GRADING_VERSION = 'last-nonempty-line-v1';
export const utilityQuestions = Object.freeze(questions);
const byId = new Map(questions.map(item => [item.id, item]));

// Keep the original six-category draw order while balancing Chinese and English.
const pattern = [['arithmetic','zh'],['logic','en'],['science','zh'],['everyday','en'],['text','zh'],['arithmetic','en'],['logic','zh'],['science','en'],['everyday','zh'],['codec','en']];
const slot = (position, flip = 0) => {
  const [category, language] = pattern[position % 10];
  return [category, ['text','codec'].includes(category) && (Math.floor(position / 10) + flip) % 2 ? (language === 'zh' ? 'en' : 'zh') : language];
};

export function question(index, seed) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= questions.length) throw new RangeError('Invalid question index');
  const flip = createHash('sha256').update(String(seed)).digest()[0] % 2;
  const position = index % 100, cycle = Math.floor(index / 100), [category, language] = slot(position, flip);
  const pool = questions.filter(item => item.category === category && item.language === language)
    .map(item => ({ item, key: createHash('sha256').update(`${UTILITY_BANK_VERSION}:${seed}:${cycle}:${item.id}`).digest('hex') }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const before = Array.from({ length: position }, (_, i) => slot(i, flip)).filter(([c, l]) => c === category && l === language).length;
  return pool[before].item;
}

export function drawQuestions(count = 10, seed = randomInt(1, 1_000_000_000)) {
  if (!Number.isInteger(count) || count < 1 || count > questions.length || count % 2) throw new RangeError('抽题数量须为不超过题库大小的偶数');
  const remaining = { zh: count / 2, en: count / 2 }, drawn = [];
  for (let index = 0; index < questions.length && drawn.length < count; index++) {
    const item = question(index, seed);
    if (remaining[item.language] > 0) {
      drawn.push(item);
      remaining[item.language]--;
    }
  }
  return drawn;
}

export function questionText(item) {
  const numeric = item.kind === 'number';
  const instruction = item.language === 'zh'
    ? '可以解释。最后一个非空行只写' + (numeric ? '数字，不带单位。' : '答案本身，保留题目要求的格式。')
    : 'You may explain. On the last non-empty line write only ' + (numeric ? 'the number, without units.' : 'the answer in the requested format.');
  return item.text + '\n' + instruction;
}

export function grade(item, response) {
  if (typeof response !== 'string' || !response.trim()) return false;
  const last = response.trimEnd().split(/\r?\n/).at(-1).trim();
  if (item.kind === 'number') {
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(last) && Number(last) === Number(item.answer);
  }
  if (item.kind === 'exact') return last === item.answer;
  return [item.answer, ...(item.answers || [])].some(value => value.toLowerCase() === last.toLowerCase());
}

export const gradeAnswer = grade;
export const screeningQuestionText = questionText;

export function demoAnswer(text) {
  return questions.find(item => questionText(item) === text)?.answer ?? questions.find(item => item.text === text)?.answer ?? '演示：未知题目';
}

export function questionById(id) {
  return byId.get(id) || null;
}
