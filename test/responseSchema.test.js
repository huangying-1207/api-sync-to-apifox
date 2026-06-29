const { expect } = require('chai');
const ApiFormatter = require('../dist/modules/formatter').default;
const { springBootParser } = require('../dist/core/scanner/springbootParser');

describe('Response schema generation', () => {
  it('should use wrapper DTO fields from scanned class', () => {
    const formatter = new ApiFormatter();
    formatter.setDtoSchemas({
      Response: { code: 'String', msg: 'String', data: 'T' },
      MainNodeDto: {
        name: 'String',
        businessType: 'Integer',
        mainFlowList: 'List<NodeDto>',
        childFlowList: 'List<NodeDto>',
      },
    });

    const schema = formatter.generateResponseSchema('Response', {
      path: '/api/drama/getAllFlowNode',
      method: 'get',
      responseWrapperType: 'Response',
      responsePayloadField: 'data',
      responseDataType: 'Map<Integer, MainNodeDto>',
      baseType: 'MainNodeDto',
    });

    expect(schema.properties).to.have.keys('code', 'msg', 'data');
    expect(schema.properties).to.not.have.property('message');
    expect(schema.properties.code.type).to.equal('string');
    expect(schema.properties.msg.type).to.equal('string');
    expect(schema.properties.data.additionalProperties.properties).to.include.keys(
      'mainFlowList',
      'childFlowList',
      'name',
      'businessType',
    );
  });

  it('should support custom wrapper field names like Result.result', () => {
    const formatter = new ApiFormatter();
    formatter.setDtoSchemas({
      Result: { status: 'Integer', message: 'String', result: 'T' },
      UserDto: { id: 'Long', name: 'String' },
    });

    const schema = formatter.generateResponseSchema('Result', {
      path: '/api/users',
      method: 'get',
      responseWrapperType: 'Result',
      responsePayloadField: 'result',
      responseDataType: 'List<UserDto>',
    });

    expect(schema.properties).to.have.keys('status', 'message', 'result');
    expect(schema.properties.result.type).to.equal('array');
    expect(schema.properties.result.items.properties).to.include.keys('id', 'name');
  });

  it('should infer payload field and type from builder chain', () => {
    const methodContent = `
      public Response getAllFlowNode(Integer serviceType, Long projectId) {
        return Response.builder().code(Constants.CODE_SUC).data(businessProjectFlowI18nService.getAllFlowNode(serviceType, projectId)).build();
      }
    `;

    springBootParser.methodReturnTypes = {
      getAllFlowNode: ['Map<Integer, MainNodeDto>'],
    };

    const dtoSchemas = { Response: { code: 'String', msg: 'String', data: 'T' } };
    const api = { path: '/api/drama/getAllFlowNode', method: 'get', returnType: 'Response', parameters: [] };
    springBootParser.applyWrapperResponseInfo(api, methodContent, dtoSchemas);

    expect(api.responseWrapperType).to.equal('Response');
    expect(api.responsePayloadField).to.equal('data');
    expect(api.responseDataType).to.equal('Map<Integer, MainNodeDto>');
    expect(api.baseType).to.equal('MainNodeDto');
  });

  it('should infer Result.result from custom builder', () => {
    const methodContent = `
      public Result listUsers() {
        return Result.builder().status(200).result(userService.list()).build();
      }
    `;

    springBootParser.methodReturnTypes = {
      list: ['List<UserDto>'],
    };

    const dtoSchemas = { Result: { status: 'Integer', message: 'String', result: 'T' } };
    const api = { path: '/api/users', method: 'get', returnType: 'Result', parameters: [] };
    springBootParser.applyWrapperResponseInfo(api, methodContent, dtoSchemas);

    expect(api.responseWrapperType).to.equal('Result');
    expect(api.responsePayloadField).to.equal('result');
    expect(api.responseDataType).to.equal('List<UserDto>');
  });
});
