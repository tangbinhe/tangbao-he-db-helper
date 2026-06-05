module.exports = function(RED) {
    var sqlEngine = require('./lib/sql-engine');

    function DbExecuteNode(config) {
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

                // Remove string literals before removing comments to avoid false positives
                var cleanSql = parsed.sql.replace(/'(?:''|\\'|[^'])*'/g, '').replace(/"(?:""|\\"|[^"])*"/g, '');
                cleanSql = cleanSql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
                var isQuery = /^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN)\s/i.test(cleanSql);
                try {
                    if (isQuery) {
                        var rows = await dbConfig.query(parsed.sql, parsed.values);
                        msg.payload = rows;
                    } else {
                        var result = await dbConfig.execute(parsed.sql, parsed.values);
                        msg.payload = {
                            affectedRows: result.affectedRows || 0,
                            insertId: result.insertId,
                            changedRows: result.changedRows
                        };
                    }
                    node.send(msg);
                } catch (dbErr) {
                    node.error('Database error: ' + dbErr.message, msg);
                }
            } catch(err) {
                node.error('Execute error: ' + err.message, msg);
            }
        });
    }

    RED.nodes.registerType('tangbao-db-execute', DbExecuteNode);
};