module.exports = function(RED) {
    "use strict";
    var reconnect = RED.settings.mysqlReconnectTime || 20000;
    var mysql;
    try { mysql = require('mysql2/promise'); } catch(e) {
        throw new Error('mysql2 is required but not installed. Please run: npm install mysql2');
    }

    function DbConfigNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.host = config.host || 'localhost';
        node.port = parseInt(config.port) || 3306;
        node.database = config.database || '';
        node.charset = (config.charset || 'UTF8_GENERAL_CI').toUpperCase();
        node.timezone = config.timezone || 'local';
        node.connectionLimit = parseInt(config.connectionLimit) || 50;

        node.user = (node.credentials && node.credentials.user) || '';
        node.password = (node.credentials && node.credentials.password) || '';

        node.pool = null;
        node.connected = false;
        node.connecting = false;

        var connectPromise = null;

        function checkVer() {
            if (!node.pool) return;
            node.pool.execute('SELECT version()').then(function() {
                // healthy
            }).catch(function(err) {
                node.error('MySQL health check failed: ' + err.message);
                if (node.pool) {
                    node.pool.end().catch(function() {});
                    node.pool = null;
                }
                node.connected = false;
                doConnect();
            });
        }

        function doConnect() {
            if (node.connecting && connectPromise) {
                return connectPromise;
            }
            node.connecting = true;
            if (node.tick) {
                clearTimeout(node.tick);
                node.tick = null;
            }
            if (!node.pool) {
                node.pool = mysql.createPool({
                    host: node.host,
                    port: node.port,
                    user: node.user,
                    password: node.password,
                    database: node.database,
                    charset: node.charset,
                    timezone: node.timezone,
                    connectionLimit: node.connectionLimit,
                    connectTimeout: 30000,
                    multipleStatements: true,
                    decimalNumbers: true,
                    insecureAuth: true,
                    queueLimit: 0,
                    waitForConnections: true
                });
            }
            connectPromise = node.pool.getConnection().then(function(conn) {
                node.connecting = false;
                node.connected = true;
                if (!node.check) { node.check = setInterval(checkVer, 290000); }
                conn.release();
            }).catch(function(err) {
                node.connecting = false;
                node.error('MySQL connection failed: ' + err.message);
                if (node.pool) {
                    node.pool.end().catch(function() {});
                    node.pool = null;
                }
                node.tick = setTimeout(doConnect, reconnect);
                return Promise.reject(err);
            });
            return connectPromise;
        }

        node.connect = function() {
            if (node.connected) return Promise.resolve();
            return doConnect().catch(function(err) {
                node.error('Connection failed: ' + err.message);
                return Promise.reject(err);
            });
        };

        node.query = async function(sql, params) {
            try {
                if (!node.connected) await node.connect();
                if (!node.pool) {
                    throw new Error('Database pool is not available');
                }
                var [rows] = await node.pool.execute(sql, params || []);
                return rows;
            } catch (err) {
                node.error('Query failed: ' + err.message);
                throw err;
            }
        };

        node.execute = async function(sql, params) {
            try {
                if (!node.connected) await node.connect();
                if (!node.pool) {
                    throw new Error('Database pool is not available');
                }
                // Remove string literals and comments before checking for multiple statements
                var cleaned = sql.replace(/'(?:''|\\'|[^'])*'/g, '').replace(/"(?:""|\\"|[^"])*"/g, '');
                cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
                if (/;\s*\S/.test(cleaned)) {
                    var [result] = await node.pool.query(sql, params || []);
                    return { affectedRows: result.affectedRows || 0, insertId: result.insertId, changedRows: result.changedRows };
                }
                var [result] = await node.pool.execute(sql, params || []);
                return { affectedRows: result.affectedRows || 0, insertId: result.insertId, changedRows: result.changedRows };
            } catch (err) {
                node.error('Execute failed: ' + err.message);
                throw err;
            }
        };

        node.getTables = async function() {
            if (!node.connected) await node.connect();
            if (!node.pool) {
                throw new Error('Database pool is not available');
            }
            var [rows] = await node.pool.execute(
                "SELECT table_name as name FROM information_schema.tables WHERE table_schema = ?",
                [node.database]
            );
            return rows.map(function(r) { return r.name || r.TABLE_NAME; });
        };

        node.withTransaction = async function(callback) {
            try {
                if (!node.connected) await node.connect();
                if (!node.pool) {
                    throw new Error('Database pool is not available');
                }
                var conn = await node.pool.getConnection();
                await conn.beginTransaction();
                try {
                    var result = await callback(conn);
                    await conn.commit();
                    return result;
                } catch (err) {
                    await conn.rollback();
                    throw err;
                } finally {
                    conn.release();
                }
            } catch (err) {
                node.error('Transaction failed: ' + err.message);
                throw err;
            }
        };

        node.on('close', function() {
            if (node.tick) { clearTimeout(node.tick); }
            if (node.check) { clearInterval(node.check); }
            node.connected = false;
            if (node.pool) {
                node.pool.end().catch(function() {});
            }
        });
    }

    // HTTP endpoint to list tables for a db-config node
    RED.httpAdmin.get('/tangbao-db-config/:id/tables', async function(req, res) {
        try {
            var node = RED.nodes.getNode(req.params.id);
            if (!node) {
                res.status(404).json({error: 'Config node not found in runtime. Please deploy your flows first.'});
                return;
            }
            var tables = await node.getTables();
            res.json(tables);
        } catch(err) {
            res.status(500).json({error: err.message});
        }
    });

    RED.nodes.registerType('tangbao-db-config', DbConfigNode, {
        credentials: {
            user: {type: "text"},
            password: {type: "password"}
        }
    });
};