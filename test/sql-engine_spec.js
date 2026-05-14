var should = require('should');
var sqlEngine = require('../lib/sql-engine');

describe('SQL Engine', function() {
    it('should parse #{param} placeholders', function() {
        var result = sqlEngine.parse('SELECT * FROM user WHERE id = #{id}', {id: 1});
        result.sql.should.eql('SELECT * FROM user WHERE id = ?');
        result.values.should.eql([1]);
    });

    it('should parse nested #{obj.field} placeholders', function() {
        var result = sqlEngine.parse('SELECT * FROM user WHERE name = #{user.name}', {user: {name: 'Alice'}});
        result.sql.should.eql('SELECT * FROM user WHERE name = ?');
        result.values.should.eql(['Alice']);
    });

    it('should handle ${param} direct replacement', function() {
        var result = sqlEngine.parse('SELECT * FROM ${tableName}', {tableName: 'user'});
        result.sql.should.eql('SELECT * FROM user');
        result.values.should.eql([]);
    });

    it('should handle <if> when condition is true', function() {
        var result = sqlEngine.parse('SELECT * FROM user <if test="name != null">WHERE name = #{name}</if>', {name: 'Alice'});
        result.sql.should.eql('SELECT * FROM user WHERE name = ?');
        result.values.should.eql(['Alice']);
    });

    it('should skip <if> when condition is false', function() {
        var result = sqlEngine.parse('SELECT * FROM user <if test="name != null">WHERE name = #{name}</if>', {});
        result.sql.should.eql('SELECT * FROM user');
        result.values.should.eql([]);
    });

    it('should handle <foreach> for IN clauses', function() {
        var result = sqlEngine.parse('SELECT * FROM user WHERE id IN <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>', {ids: [1, 2, 3]});
        result.sql.should.eql('SELECT * FROM user WHERE id IN (?,?,?)');
        result.values.should.eql([1, 2, 3]);
    });

    it('should skip <foreach> when collection is empty', function() {
        var result = sqlEngine.parse('SELECT * FROM user WHERE id IN <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>', {ids: []});
        result.sql.should.eql('SELECT * FROM user WHERE id IN');
        result.values.should.eql([]);
    });
});