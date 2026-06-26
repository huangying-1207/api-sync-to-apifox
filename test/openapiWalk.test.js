const { expect } = require('chai');
const { matchApiByMethodPath, parseApisParam } = require('../dist/utils/openapi/apiMatch');
const { extractApisFromOpenApiDoc } = require('../dist/utils/openapi/openapiWalk');

describe('apiMatch', () => {
  const apis = [
    { path: '/api/users', method: 'get' },
    { path: '/api/users/', method: 'post' },
  ];

  it('matchApiByMethodPath 兼容末尾斜杠', () => {
    expect(matchApiByMethodPath(apis, 'GET', '/api/users')?.method).to.equal('get');
    expect(matchApiByMethodPath(apis, 'post', '/api/users')?.method).to.equal('post');
  });

  it('parseApisParam 解析接口列表', () => {
    const list = parseApisParam('GET:/api/users,POST:/api/orders');
    expect(list).to.deep.equal([
      { method: 'GET', path: '/api/users' },
      { method: 'POST', path: '/api/orders' },
    ]);
  });
});

describe('openapiWalk', () => {
  it('extractApisFromOpenApiDoc 提取基础接口信息', () => {
    const doc = {
      paths: {
        '/api/users': {
          get: { summary: '用户列表' },
        },
      },
    };
    const apis = extractApisFromOpenApiDoc(doc, false);
    expect(apis).to.have.length(1);
    expect(apis[0].method).to.equal('get');
    expect(apis[0].summary).to.equal('用户列表');
  });
});
