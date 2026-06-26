const { expect } = require('chai');
const { diffParamNames, isIgnorableApiParam } = require('../dist/utils/openapi/apiParamFilter');

describe('apiParamFilter', () => {
  it('忽略常见 Header 鉴权参数', () => {
    expect(isIgnorableApiParam({ name: 'Authorization', type: 'header' })).to.equal(true);
    expect(isIgnorableApiParam({ name: 'userEmail', type: 'header' })).to.equal(true);
    expect(isIgnorableApiParam({ name: 'projectId', type: 'query' })).to.equal(false);
  });

  it('diffParamNames 不统计被忽略的 Header', () => {
    const detected = [{ name: 'id', type: 'query' }];
    const existing = [
      { name: 'id', type: 'query' },
      { name: 'Authorization', type: 'header' },
      { name: 'userName', type: 'header' },
    ];
    const diff = diffParamNames(detected, existing);
    expect(diff.added).to.deep.equal([]);
    expect(diff.removed).to.deep.equal([]);
  });

  it('diffParamNames 识别真实业务参数变更', () => {
    const detected = [
      { name: 'id', type: 'query' },
      { name: 'noticeRuleId', type: 'query' },
    ];
    const existing = [{ name: 'id', type: 'query' }];
    const diff = diffParamNames(detected, existing);
    expect(diff.added).to.deep.equal(['noticeRuleId']);
    expect(diff.removed).to.deep.equal([]);
  });
});
