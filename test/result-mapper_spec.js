var should = require('should');
var resultMapper = require('../lib/result-mapper');

describe('Result Mapper', function() {
    it('should convert snake_case to camelCase', function() {
        var rows = [
            {user_id: 1, user_name: 'Alice', created_at: '2024-01-01'}
        ];
        var result = resultMapper.camelize(rows);
        result.should.have.length(1);
        result[0].should.have.property('userId', 1);
        result[0].should.have.property('userName', 'Alice');
        result[0].should.have.property('createdAt', '2024-01-01');
    });

    it('should handle null/undefined rows', function() {
        should(resultMapper.camelize(null)).eql(null);
        should(resultMapper.camelize(undefined)).eql(undefined);
    });

    it('should map field names', function() {
        var row = resultMapper.camelize({order_id: 100, total_amount: 500});
        row.should.have.property('orderId', 100);
        row.should.have.property('totalAmount', 500);
    });

    it('should convert camelCase to snake_case', function() {
        var row = resultMapper.snakeize({equipTypeId: 1, userName: 'Alice', createdAt: '2024-01-01'});
        row.should.have.property('equip_type_id', 1);
        row.should.have.property('user_name', 'Alice');
        row.should.have.property('created_at', '2024-01-01');
    });

    it('should handle null/undefined for snakeize', function() {
        should(resultMapper.snakeize(null)).eql(null);
        should(resultMapper.snakeize(undefined)).eql(undefined);
    });
});