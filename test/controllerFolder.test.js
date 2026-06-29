const { expect } = require('chai');
const {
  extractControllerFolderMeta,
  resolveEndpointFolders,
  getDefaultControllerFolderName,
} = require('../dist/utils/java/controllerFolder');

describe('controller folder resolution', () => {
  it('should read @Api tags as folder name', () => {
    const content = `
      @RestController
      @RequestMapping("/api/drama")
      @Api(tags = "剧集业务线")
      public class DramaProjectController {
      }
    `;
    const meta = extractControllerFolderMeta(content, 'DramaProjectController.java');
    expect(meta.controllerClassName).to.equal('DramaProjectController');
    expect(meta.controllerTag).to.equal('剧集业务线');
  });

  it('should fallback to controller class name when no annotation', () => {
    const meta = extractControllerFolderMeta(
      '@RestController\npublic class FooController {}',
      'FooController.java',
    );
    expect(meta.controllerClassName).to.equal('FooController');
    expect(meta.controllerTag).to.be.undefined;
    expect(getDefaultControllerFolderName({ controllerClassName: 'FooController' })).to.equal('FooController');
  });

  it('should place new api into existing controller folder', () => {
    const apis = [
      {
        method: 'get',
        path: '/api/drama/newApi',
        controller: 'DramaProjectController.java',
        controllerClassName: 'DramaProjectController',
        controllerTag: '剧集业务线',
      },
    ];
    const existingApis = [
      {
        method: 'get',
        path: '/api/drama/getProjectInfo',
        folderName: '大陆剧集（旧目录）',
      },
    ];
    const allScannedApis = [
      {
        method: 'get',
        path: '/api/drama/getProjectInfo',
        controller: 'DramaProjectController.java',
      },
      ...apis,
    ];

    resolveEndpointFolders(apis, existingApis, allScannedApis);

    expect(apis[0].folderName).to.equal('大陆剧集（旧目录）');
    expect(apis[0].isNewEndpoint).to.equal(true);
  });

  it('should keep existing api folder unchanged', () => {
    const apis = [
      {
        method: 'get',
        path: '/api/drama/getProjectInfo',
        controller: 'DramaProjectController.java',
        controllerTag: '剧集业务线',
      },
    ];
    const existingApis = [
      {
        method: 'get',
        path: '/api/drama/getProjectInfo',
        folderName: 'Apifox已有目录',
      },
    ];

    resolveEndpointFolders(apis, existingApis);

    expect(apis[0].folderName).to.equal('Apifox已有目录');
    expect(apis[0].isNewEndpoint).to.equal(false);
  });

  it('should use controller annotation when controller has no existing folder', () => {
    const apis = [
      {
        method: 'get',
        path: '/api/foo/bar',
        controller: 'FooController.java',
        controllerClassName: 'FooController',
        controllerTag: 'Foo分组',
      },
    ];

    resolveEndpointFolders(apis, []);

    expect(apis[0].folderName).to.equal('Foo分组');
    expect(apis[0].isNewEndpoint).to.equal(true);
  });
});
