import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_ADMIN_TOKEN, matchesAdminToken, validAdminToken } from '../src/admin-auth.js';
import { validateLiveDeployment } from '../src/config.js';

const valid = {
  mode: 'live',
  adminToken: 'local-test-admin-token-1234567890',
  testReward: 'AHUCTF{local_test_reward_only}'
};

test('live 部署拒绝缺省、示例管理令牌和占位 flag', () => {
  assert.equal(validAdminToken(EXAMPLE_ADMIN_TOKEN), false);
  assert.equal(matchesAdminToken(EXAMPLE_ADMIN_TOKEN, EXAMPLE_ADMIN_TOKEN), false);
  assert.throws(() => validateLiveDeployment({ ...valid, adminToken: undefined }), /T1_ADMIN_TOKEN/);
  assert.throws(() => validateLiveDeployment({ ...valid, adminToken: EXAMPLE_ADMIN_TOKEN }), /T1_ADMIN_TOKEN/);
  for (const testReward of ['', 'AHUCTF{replace_with_your_static_flag}', 'DEMO{local_champion_rehearsal}',
    ' AHUCTF{replace_with_your_static_flag} ', '\tDEMO{local_champion_rehearsal}\n']) {
    assert.throws(() => validateLiveDeployment({ ...valid, testReward }), /T1_TEST_REWARD/);
  }
  assert.doesNotThrow(() => validateLiveDeployment(valid));
  assert.doesNotThrow(() => validateLiveDeployment({ mode: 'demo' }));
});
