module.exports = function(RED) {
    "use strict";
    var reconnect = RED.settings.mysqlReconnectTime || 20000;
    var mysql;
    try { mysql = require('mysql2/promise'); } catch(e) {
        throw new Error('mysql2 is required but not installed. Please run: npm install mysql2');
    }
    var sqlite3;
    try { sqlite3 = require('better-sqlite3'); } catch(e) {
        // optional, will error at runtime if sqlite driver is selected but not installed
    }

    /**
     * MySQL 驱动实现
     */
    function MysqlDriver(node, config) {
        this.node = node;
        this.host = config.host || 'localhost';
        this.port = parseInt(config.port) || 3306;
        this.database = config.database || '';
        this.charset = (config.charset || 'UTF8_GENERAL_CI').toUpperCase();
        this.timezone = config.timezone || 'local';
        this.connectionLimit = parseInt(config.connectionLimit) || 50;
        this.user = (node.credentials && node.credentials.user) || '';
        this.password = (node.credentials && node.credentials.password) || '';

        this.pool = null;
        this.connected = false;
        this.connecting = false;
        this.tick = null;
        this.check = null;
        this.connectPromise = null;
    }

    MysqlDriver.prototype.checkVer = function() {
        var self = this;
        if (!self.pool) return;
        self.pool.execute('SELECT version()').then(function() {
            // healthy
        }).catch(function(err) {
            self.node.error('MySQL health check failed: ' + err.message);
            if (self.pool) {
                self.pool.end().catch(function() {});
                self.pool = null;
            }
            self.connected = false;
            self.doConnect().catch(function() {});
        });
    };

    MysqlDriver.prototype.doConnect = function() {
        var self = this;
        if (self.connecting && self.connectPromise) {
            return self.connectPromise;
        }
        self.connecting = true;
        if (self.tick) {
            clearTimeout(self.tick);
            self.tick = null;
        }
        if (!self.pool) {
            self.pool = mysql.createPool({
                host: self.host,
                port: self.port,
                user: self.user,
                password: self.password,
                database: self.database,
                charset: self.charset,
                timezone: self.timezone,
                connectionLimit: self.connectionLimit,
                connectTimeout: 30000,
                multipleStatements: true,
                decimalNumbers: true,
                insecureAuth: true,
                queueLimit: 0,
                waitForConnections: true
            });
            self.pool.on('error', function(err) {
                self.node.error('MySQL pool error: ' + err.message);
            });
        }
        self.connectPromise = self.pool.getConnection().then(function(conn) {
            self.connecting = false;
            self.connected = true;
            if (!self.check) { self.check = setInterval(function() { self.checkVer(); }, 290000); }
            conn.release();
        }).catch(function(err) {
            self.connecting = false;
            self.node.error('MySQL connection failed: ' + err.message);
            if (self.pool) {
                self.pool.end().catch(function() {});
                self.pool = null;
            }
            self.tick = setTimeout(function() { self.doConnect(); }, reconnect);
        });
        return self.connectPromise;
    };

    MysqlDriver.prototype.connect = function() {
        if (this.connected) return Promise.resolve();
        return this.doConnect();
    };

    MysqlDriver.prototype.query = async function(sql, params) {
        try {
            if (!this.connected) await this.connect();
            if (!this.pool) {
                throw new Error('Database pool is not available');
            }
            var [rows] = await this.pool.execute(sql, params || []);
            return rows;
        } catch (err) {
            this.node.error('Query failed: ' + err.message);
            throw err;
        }
    };

    MysqlDriver.prototype.execute = async function(sql, params) {
        try {
            if (!this.connected) await this.connect();
            if (!this.pool) {
                throw new Error('Database pool is not available');
            }
            var cleaned = sql.replace(/'(?:''|\\'|[^'])*'/g, '').replace(/"(?:""|\\"|[^"])*"/g, '');
            cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
            if (/;\s*\S/.test(cleaned)) {
                var [result] = await this.pool.query(sql, params || []);
                return { affectedRows: result.affectedRows || 0, insertId: result.insertId, changedRows: result.changedRows };
            }
            var [result] = await this.pool.execute(sql, params || []);
            return { affectedRows: result.affectedRows || 0, insertId: result.insertId, changedRows: result.changedRows };
        } catch (err) {
            this.node.error('Execute failed: ' + err.message);
            throw err;
        }
    };

    MysqlDriver.prototype.getTables = async function() {
        if (!this.connected) await this.connect();
        if (!this.pool) {
            throw new Error('Database pool is not available');
        }
        var [rows] = await this.pool.execute(
            "SELECT table_name as name FROM information_schema.tables WHERE table_schema = ?",
            [this.database]
        );
        return rows.map(function(r) { return r.name || r.TABLE_NAME; });
    };

    MysqlDriver.prototype.withTransaction = async function(callback) {
        try {
            if (!this.connected) await this.connect();
            if (!this.pool) {
                throw new Error('Database pool is not available');
            }
            var conn = await this.pool.getConnection();
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
            this.node.error('Transaction failed: ' + err.message);
            throw err;
        }
    };

    MysqlDriver.prototype.close = function() {
        if (this.tick) { clearTimeout(this.tick); }
        if (this.check) { clearInterval(this.check); }
        this.connected = false;
        if (this.pool) {
            this.pool.end().catch(function() {});
        }
    };

    /**
     * 安全拆分 SQL 语句（排除字符串和注释内的分号）
     */
    function splitSqlStatements(sql) {
        var statements = [];
        var current = '';
        var inString = false;
        var stringChar = null;
        var inComment = false;
        var commentType = null; // 'line' or 'block'
        var i = 0;
        while (i < sql.length) {
            var ch = sql[i];
            var next = sql[i + 1];
            if (inComment) {
                if (commentType === 'line' && ch === '\n') {
                    inComment = false;
                    commentType = null;
                } else if (commentType === 'block' && ch === '*' && next === '/') {
                    inComment = false;
                    commentType = null;
                    i++;
                }
                current += ch;
            } else if (inString) {
                if (ch === '\\' && i + 1 < sql.length) {
                    current += ch + sql[i + 1];
                    i++;
                } else if (ch === stringChar) {
                    inString = false;
                    stringChar = null;
                    current += ch;
                } else {
                    current += ch;
                }
            } else {
                if (ch === '-' && next === '-') {
                    inComment = true;
                    commentType = 'line';
                    current += ch;
                } else if (ch === '/' && next === '*') {
                    inComment = true;
                    commentType = 'block';
                    current += ch;
                } else if (ch === "'" || ch === '"') {
                    inString = true;
                    stringChar = ch;
                    current += ch;
                } else if (ch === ';') {
                    statements.push(current.trim());
                    current = '';
                } else {
                    current += ch;
                }
            }
            i++;
        }
        if (current.trim()) {
            statements.push(current.trim());
        }
        return statements;
    }

    /**
     * 统计 SQL 中 ? 占位符数量（排除字符串/注释内）
     */
    function countPlaceholders(sql) {
        var count = 0;
        var inString = false;
        var stringChar = null;
        var inComment = false;
        var commentType = null;
        var i = 0;
        while (i < sql.length) {
            var ch = sql[i];
            var next = sql[i + 1];
            if (inComment) {
                if (commentType === 'line' && ch === '\n') {
                    inComment = false;
                    commentType = null;
                } else if (commentType === 'block' && ch === '*' && next === '/') {
                    inComment = false;
                    commentType = null;
                    i++;
                }
            } else if (inString) {
                if (ch === '\\' && i + 1 < sql.length) {
                    i++;
                } else if (ch === stringChar) {
                    inString = false;
                    stringChar = null;
                }
            } else {
                if (ch === '-' && next === '-') {
                    inComment = true;
                    commentType = 'line';
                } else if (ch === '/' && next === '*') {
                    inComment = true;
                    commentType = 'block';
                } else if (ch === "'" || ch === '"') {
                    inString = true;
                    stringChar = ch;
                } else if (ch === '?') {
                    count++;
                }
            }
            i++;
        }
        return count;
    }

    /**
     * SQLite 驱动实现
     */
    function SqliteDriver(node, config) {
        this.node = node;
        this.database = config.database || '';
        this.db = null;
        this.connected = false;
    }

    SqliteDriver.prototype.connect = function() {
        var self = this;
        if (self.connected) return Promise.resolve();
        if (!sqlite3) {
            throw new Error('better-sqlite3 is not installed. Please run: npm install better-sqlite3');
        }
        try {
            self.db = new sqlite3(self.database);
            self.connected = true;
            return Promise.resolve();
        } catch (err) {
            self.node.error('SQLite open failed: ' + err.message);
            throw err;
        }
    };

    SqliteDriver.prototype.query = async function(sql, params) {
        try {
            if (!this.connected) await this.connect();
            if (!this.db) {
                throw new Error('SQLite database is not available');
            }
            var stmt = this.db.prepare(sql);
            var rows = stmt.all(params || []);
            return rows || [];
        } catch (err) {
            this.node.error('SQLite query failed: ' + err.message);
            throw err;
        }
    };

    SqliteDriver.prototype.execute = async function(sql, params) {
        try {
            if (!this.connected) await this.connect();
            if (!this.db) {
                throw new Error('SQLite database is not available');
            }
            params = params || [];
            // 安全拆分多语句：排除字符串/注释内的分号
            var statements = splitSqlStatements(sql);
            if (statements.length === 0) {
                throw new Error('No valid SQL statement found');
            }
            var totalAffected = 0;
            var lastInsertId = null;
            var paramIdx = 0;
            for (var i = 0; i < statements.length; i++) {
                var stmtSql = statements[i].trim();
                if (!stmtSql) continue;
                // 统计该语句中的 ? 占位符数量（排除字符串内的）
                var placeholderCount = countPlaceholders(stmtSql);
                var stmtParams = params.slice(paramIdx, paramIdx + placeholderCount);
                paramIdx += placeholderCount;
                if (placeholderCount === 0) {
                    this.db.exec(stmtSql);
                } else {
                    var stmt = this.db.prepare(stmtSql);
                    var info = stmt.run(stmtParams);
                    totalAffected += info.changes || 0;
                    if (info.lastInsertRowid != null) {
                        lastInsertId = info.lastInsertRowid;
                    }
                }
            }
            return { affectedRows: totalAffected, insertId: lastInsertId };
        } catch (err) {
            this.node.error('SQLite execute failed: ' + err.message);
            throw err;
        }
    };

    SqliteDriver.prototype.getTables = async function() {
        if (!this.connected) await this.connect();
        if (!this.db) {
            throw new Error('SQLite database is not available');
        }
        var rows = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        return rows.map(function(r) { return r.name; });
    };

    SqliteDriver.prototype.withTransaction = async function(callback) {
        try {
            if (!this.connected) await this.connect();
            if (!this.db) {
                throw new Error('SQLite database is not available');
            }
            var self = this;
            self.db.exec('BEGIN');
            try {
                var conn = {
                    execute: function(sql, params) {
                        var stmt = self.db.prepare(sql);
                        var info = stmt.run(params || []);
                        return Promise.resolve([{ affectedRows: info.changes || 0, insertId: info.lastInsertRowid }]);
                    }
                };
                var result = await callback(conn);
                self.db.exec('COMMIT');
                return result;
            } catch (err) {
                try { self.db.exec('ROLLBACK'); } catch(e) {}
                throw err;
            }
        } catch (err) {
            this.node.error('Transaction failed: ' + err.message);
            throw err;
        }
    };

    SqliteDriver.prototype.close = function() {
        this.connected = false;
        if (this.db) {
            try { this.db.close(); } catch(e) {}
            this.db = null;
        }
    };


    function DbConfigNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.driver = config.driver || 'mysql';
        node.database = config.database || '';

        // 根据 driver 创建对应驱动实例
        if (node.driver === 'sqlite') {
            node.driverImpl = new SqliteDriver(node, config);
        } else {
            node.driverImpl = new MysqlDriver(node, config);
        }

        // 代理方法：统一对外暴露 query / execute / getTables / withTransaction
        node.connect = function() {
            return node.driverImpl.connect();
        };
        node.query = function(sql, params) {
            return node.driverImpl.query(sql, params);
        };
        node.execute = function(sql, params) {
            return node.driverImpl.execute(sql, params);
        };
        node.getTables = function() {
            return node.driverImpl.getTables();
        };
        node.withTransaction = function(callback) {
            return node.driverImpl.withTransaction(callback);
        };

        node.on('close', function() {
            node.driverImpl.close();
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