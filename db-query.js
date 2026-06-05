module.exports = function(RED) {
    var sqlEngine = require('./lib/sql-engine');

    function DbQueryNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.on('input', async function(msg) {
            try {
                var dbConfig = RED.nodes.getNode(config.dbConfig);
                if (!dbConfig) {
                    throw new Error('Database config not found');
                }

                var sql = msg.hasOwnProperty('sql') ? msg.sql : (config.sql || '');
                if (!sql && config.mapper) {
                    var mapper = RED.nodes.getNode(config.mapper);
                    if (mapper) sql = mapper.getSql();
                }

                if (!sql || !sql.trim()) {
                    throw new Error('SQL is empty. Please configure SQL, select a SQL mapper, or pass msg.sql.');
                }

                var params = msg.hasOwnProperty('params') ? msg.params : (msg.payload || {});
                if (typeof params !== 'object' || Array.isArray(params) || params === null) {
                    params = {};
                }

                var parsed = sqlEngine.parse(sql, params);
                node.log('SQL: ' + parsed.sql);
                node.log('Params: ' + JSON.stringify(parsed.values));

                try {
                    var rows = await dbConfig.query(parsed.sql, parsed.values);
                    msg.payload = rows;
                    node.send(msg);
                } catch (dbErr) {
                    node.error('Database error: ' + dbErr.message, msg);
                }
            } catch(err) {
                node.error('Query error: ' + err.message, msg);
            }
        });
    }

    RED.nodes.registerType('tangbao-db-query', DbQueryNode);
};
