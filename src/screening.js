import { questionById, questionText, UTILITY_BANK_VERSION } from './screening/index.js';

export const SCREEN_POLICY_VERSION = 'submitted-prompts-last-nonempty-line-v1';

// The open-source edition starts a new database and enriches only current-bank records.
export function screeningFeedback(record) {
  if (!record) return null;
  return { ...record, questions: (record.questions || []).map(row => {
    const item = record.questionBankVersion === UTILITY_BANK_VERSION ? questionById(row.questionId) : null;
    const current = item && (item.text === row.question || questionText(item) === row.question) ? item : null;
    return { ...row, expectedAnswer: row.expectedAnswer ?? current?.answer ?? null,
      answerKind: row.answerKind ?? current?.kind ?? null };
  }) };
}
