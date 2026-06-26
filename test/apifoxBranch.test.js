const { expect } = require('chai');
const {
  MAIN_BRANCH,
  branchToTargetBranchId,
  buildBranchListPayload,
  findBranchById,
  findBranchByName,
  formatBranchUserLabel,
  normalizePlanBranch,
  parseBranchId,
  parseBranchesConfig,
  resolveTargetBranch,
} = require('../dist/utils/apifox/apifoxBranch');

describe('apifoxBranch', () => {
  const sampleBranches = [
    { id: 1, name: 'master', isMain: true },
    { id: 2, name: 'dev', isMain: false },
  ];

  it('parseBranchesConfig 无配置时返回空数组', () => {
    expect(parseBranchesConfig(undefined)).to.deep.equal([]);
  });

  it('findBranchByName 支持名称匹配', () => {
    expect(findBranchByName(sampleBranches, 'dev').id).to.equal(2);
    expect(findBranchByName(sampleBranches, 'DEV').id).to.equal(2);
    expect(findBranchByName(sampleBranches, 'unknown')).to.be.undefined;
  });

  it('branchToTargetBranchId 主分支不传 ID', () => {
    expect(branchToTargetBranchId(MAIN_BRANCH)).to.be.undefined;
    expect(branchToTargetBranchId({ id: 123, name: 'dev' })).to.equal(123);
    expect(branchToTargetBranchId({ id: 1, name: 'master', isMain: true })).to.be.undefined;
  });

  it('resolveTargetBranch 优先使用同步计划分支名', async () => {
    const branch = await resolveTargetBranch({
      planBranch: { name: 'dev' },
      branches: sampleBranches,
      noBranchPrompt: true,
    });
    expect(branch.name).to.equal('dev');
    expect(branch.id).to.equal(2);
  });

  it('resolveTargetBranch 支持 CLI 分支名', async () => {
    const branch = await resolveTargetBranch({
      cliBranchName: 'master',
      branches: sampleBranches,
      noBranchPrompt: true,
    });
    expect(branch.name).to.equal('master');
  });

  it('buildBranchListPayload 输出默认分支名', () => {
    const payload = buildBranchListPayload(sampleBranches);
    expect(payload.defaultBranch).to.equal('master');
    expect(payload.branches).to.have.length(2);
    expect(payload.branches[0].name).to.equal('master');
  });

  it('normalizePlanBranch 与 formatBranchUserLabel', () => {
    const branch = normalizePlanBranch({ targetBranch: { name: 'master', isMain: true } });
    expect(branch.isMain).to.equal(true);
    expect(formatBranchUserLabel({ name: 'dev' })).to.equal('dev');
    expect(findBranchById(sampleBranches, 2).name).to.equal('dev');
    expect(parseBranchId('42')).to.equal(42);
    expect(parseBranchId('')).to.be.undefined;
  });
});
