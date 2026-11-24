import test from 'node:test';
import assert from 'node:assert/strict';
import { drawQuestions, gradeAnswer, questionText, utilityQuestions } from '../src/screening/index.js';

const item = (kind, answer, answers = []) => ({ kind, answer, answers, text: 'synthetic', language: 'zh' });

test('最终题库保留 100 道独立题目及中英文分布', () => {
  assert.equal(utilityQuestions.length, 100);
  assert.equal(new Set(utilityQuestions.map(row => row.id)).size, 100);
  assert.equal(utilityQuestions.filter(row => row.language === 'zh').length, 50);
  assert.equal(utilityQuestions.filter(row => row.language === 'en').length, 50);
  for (const row of utilityQuestions) {
    assert.ok(row.text.trim());
    assert.ok(typeof row.answer === 'string' && row.answer.length);
    assert.ok(['number', 'exact', 'word'].includes(row.kind));
    assert.ok(['arithmetic', 'logic', 'science', 'everyday', 'text', 'codec'].includes(row.category));
  }
});

test('任意偶数抽题保持中英文各半且不重复', () => {
  for (const count of [2, 6, 10, 20, 100]) {
    for (const seed of [1, 2, 3, 4]) {
      const drawn = drawQuestions(count, seed);
      assert.equal(drawn.length, count);
      assert.equal(drawn.filter(row => row.language === 'zh').length, count / 2);
      assert.equal(drawn.filter(row => row.language === 'en').length, count / 2);
      assert.equal(new Set(drawn.map(row => row.id)).size, count);
    }
  }
  assert.throws(() => drawQuestions(9), /偶数/);
});

test('题面明确最后非空行该写数字还是答案本身', () => {
  assert.match(questionText(item('number', '42')), /最后一个非空行只写数字，不带单位/);
  assert.match(questionText(item('exact', 'yes')), /最后一个非空行只写答案本身/);
  assert.match(questionText({ ...item('word', 'yes'), language: 'en' }), /last non-empty line write only the answer/);
});

test('数字题只取最后非空行，允许前文解释和十进制表示', () => {
  const number = item('number', '42');
  assert.equal(gradeAnswer(number, '先计算。\n答案是：\n42\n\n'), true);
  assert.equal(gradeAnswer(number, '+42.0'), true);
  assert.equal(gradeAnswer(number, '42\n43'), false);
  for (const reply of ['Answer: 42', '42 个', '四十二', '```\n42\n```', '0x2a', '', '42\n']) {
    assert.equal(gradeAnswer(number, reply), reply === '42\n');
  }
});

test('精确字符串原样匹配，别名仅忽略大小写', () => {
  const exact = item('exact', 'Access Denied');
  assert.equal(gradeAnswer(exact, 'Access Denied'), true);
  assert.equal(gradeAnswer(exact, 'access denied'), false);
  assert.equal(gradeAnswer(exact, 'Answer: Access Denied'), false);
  const word = item('word', 'Paris', ['The City of Light']);
  assert.equal(gradeAnswer(word, 'pArIs'), true);
  assert.equal(gradeAnswer(word, 'the city of light'), true);
  assert.equal(gradeAnswer(word, 'Paris.'), false);
  assert.equal(gradeAnswer(word, 'Paris\nLondon'), false);
});
