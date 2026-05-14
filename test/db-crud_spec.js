var should = require('should');

// Simple load test for tangbao-db-crud node
describe('tangbao-db-crud node', function() {
    it('should require db-crud.js without error', function() {
        var dbCrud = require('../db-crud');
        should.exist(dbCrud);
    });
});