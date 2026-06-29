const { expect } = require('chai');
const {
  extractControllerFolderMeta,
  resolveEndpointFolders,
  getDefaultControllerFolderName,
} = require('../dist/utils/java/controllerFolder');
const {
  buildOpenApiTagsForFolder,
  getFolderNameFromOpenApiTags,
} = require('../dist/utils/apifox/folderTags');

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

  it('should ignore annotations inside comments', () => {
    const content = `
      /*
       * @Api(tags = "旧目录")
       */
      @RestController
      @Api(tags = "新目录")
      public class FooController {}
    `;
    const meta = extractControllerFolderMeta(content, 'FooController.java');
    expect(meta.controllerTag).to.equal('新目录');
  });

  it('should ignore annotations inside line comments', () => {
    const content = `
      @RestController
      public class FooController {} // @Api(tags = "旧目录")
    `;
    const meta = extractControllerFolderMeta(content, 'FooController.java');
    expect(meta.controllerTag).to.be.undefined;
  });

  it('should read @Tag name regardless of argument order', () => {
    const content = `
      @Tag(description = "描述", name = "OpenAPI目录")
      public class FooController {}
    `;
    const meta = extractControllerFolderMeta(content, 'FooController.java');
    expect(meta.controllerTag).to.equal('OpenAPI目录');
  });

  it('should keep double slash inside annotation strings', () => {
    const content = `
      @Tag(description = "详见 http://wiki/api", name = "订单目录")
      public class FooController {}
    `;
    const meta = extractControllerFolderMeta(content, 'FooController.java');
    expect(meta.controllerTag).to.equal('订单目录');
  });

  it('should place new api into existing controller folder', () => {
    const apis = [
      {
        method: 'get',
        path: '/api/drama/newApi',
        controller: 'DramaProjectController.java',
        controllerKey: 'src/main/java/a/DramaProjectController.java',
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
        controllerKey: 'src/main/java/a/DramaProjectController.java',
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

  it('should not mix folders for controllers with the same file name', () => {
    const apis = [
      {
        method: 'get',
        path: '/api/b/newApi',
        controller: 'FooController.java',
        controllerKey: 'src/main/java/b/FooController.java',
        controllerClassName: 'FooController',
        controllerTag: 'B目录',
      },
    ];
    const existingApis = [
      {
        method: 'get',
        path: '/api/a/existingApi',
        folderName: 'A目录',
      },
    ];
    const allScannedApis = [
      {
        method: 'get',
        path: '/api/a/existingApi',
        controller: 'FooController.java',
        controllerKey: 'src/main/java/a/FooController.java',
      },
      ...apis,
    ];

    resolveEndpointFolders(apis, existingApis, allScannedApis);

    expect(apis[0].folderName).to.equal('B目录');
    expect(apis[0].isNewEndpoint).to.equal(true);
  });

  it('should map Apifox folder names through OpenAPI tags adapter', () => {
    expect(buildOpenApiTagsForFolder('剧集业务线')).to.deep.equal(['剧集业务线']);
    expect(buildOpenApiTagsForFolder('')).to.be.undefined;
    expect(getFolderNameFromOpenApiTags(['剧集业务线', '其他标签'])).to.equal('剧集业务线');
    expect(getFolderNameFromOpenApiTags([])).to.be.undefined;
  });
});
