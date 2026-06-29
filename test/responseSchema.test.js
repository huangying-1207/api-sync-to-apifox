const { expect } = require('chai');
const ApiFormatter = require('../dist/modules/formatter').default;
const { springBootParser } = require('../dist/core/scanner/springbootParser');

describe('Response schema generation', () => {
  it('should use code/msg/data for Response return type', () => {
    const formatter = new ApiFormatter();
    formatter.setDtoSchemas({
      Response: { code: 'String', msg: 'String', data: 'Object' },
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

  it('should infer data type from Response.builder().data(service.method())', () => {
    const methodContent = `
      public Response getAllFlowNode(Integer serviceType, Long projectId) {
        return Response.builder().code(Constants.CODE_SUC).data(businessProjectFlowI18nService.getAllFlowNode(serviceType, projectId)).build();
      }
    `;

    springBootParser.methodReturnTypes = {
      getAllFlowNode: ['Map<Integer, MainNodeDto>'],
    };

    const api = { path: '/api/drama/getAllFlowNode', method: 'get', returnType: 'Response', parameters: [] };
    springBootParser.applyResponseDataType(api, methodContent);

    expect(api.responseDataType).to.equal('Map<Integer, MainNodeDto>');
    expect(api.baseType).to.equal('MainNodeDto');
  });
});
