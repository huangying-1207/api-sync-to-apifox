const { expect } = require('chai');
const { buildApiMapKey } = require('../dist/utils/openapi/apiKey');
const { computeApiDiff } = require('../dist/utils/openapi/apiDiff');
const ApiComparer = require('../dist/modules/comparer').default;

describe('apiKey', () => {
  it('buildApiMapKey 统一 method 为小写', () => {
    expect(buildApiMapKey('GET', '/api/users')).to.equal('get:/api/users');
    expect(buildApiMapKey('get', '/api/users/')).to.equal('get:/api/users');
  });
});

describe('computeApiDiff', () => {
  it('相同接口无差异', () => {
    const api = { path: '/api/users', method: 'get', parameters: [{ name: 'id', type: 'query' }] };
    const result = computeApiDiff(api, { ...api });
    expect(result.hasChanges).to.equal(false);
  });

  it('检测参数变更', () => {
    const detected = {
      path: '/api/users',
      method: 'get',
      parameters: [
        { name: 'id', type: 'query' },
        { name: 'name', type: 'query' },
      ],
    };
    const existing = {
      path: '/api/users',
      method: 'get',
      parameters: [{ name: 'id', type: 'query' }],
    };
    const result = computeApiDiff(detected, existing, true);
    expect(result.hasChanges).to.equal(true);
    expect(result.descriptions.some((d) => d.includes('name'))).to.equal(true);
  });
});

describe('ApiComparer', () => {
  it('method 大小写不一致时仍能识别为已存在接口', () => {
    const comparer = new ApiComparer();
    const detected = [{ path: '/api/users', method: 'GET', controller: 'UserController.java' }];
    const existing = [{ path: '/api/users', method: 'get' }];

    const result = comparer.compareApiChanges(detected, existing, false);
    expect(result.added).to.have.length(0);
    expect(result.removed).to.have.length(0);
  });

  it('识别新增接口', () => {
    const comparer = new ApiComparer();
    const detected = [{ path: '/api/new', method: 'post', controller: 'NewController.java' }];
    const existing = [{ path: '/api/users', method: 'get' }];

    const result = comparer.compareApiChanges(detected, existing, false);
    expect(result.added).to.have.length(1);
    expect(result.added[0].path).to.equal('/api/new');
  });
});
