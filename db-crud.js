module.exports = function(RED) {
    var sqlEngine = require('./lib/sql-engine');
    var resultMapper = require('./lib/result-mapper');

    /**
     * 自动生成 CRUD SQL 模板
     * 类似 MyBatis 的 BaseMapper
     */
    var CRUD_TEMPLATES = {
        // 查询
        selectById: function(tableName, idColumn) {
            return 'SELECT * FROM ' + tableName + ' WHERE ' + idColumn + ' = #{' + idColumn + '}';
        },
        selectOne: function(tableName, rawParams, expandedParams) {
            var where = buildWhereClause(rawParams, expandedParams);
            return 'SELECT * FROM ' + tableName + where + ' LIMIT 1';
        },
        selectList: function(tableName, rawParams, expandedParams) {
            var where = buildWhereClause(rawParams, expandedParams);
            return 'SELECT * FROM ' + tableName + where;
        },
        selectCount: function(tableName, rawParams, expandedParams) {
            var where = buildWhereClause(rawParams, expandedParams);
            return 'SELECT COUNT(*) as count FROM ' + tableName + where;
        },
        selectByIds: function(tableName, idColumn) {
            return 'SELECT * FROM ' + tableName + ' WHERE ' + idColumn + ' IN <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>';
        },
        // 插入
        insert: function(tableName, columns) {
            var cols = columns.join(', ');
            var placeholders = columns.map(function() { return '?'; }).join(', ');
            return 'INSERT INTO ' + tableName + ' (' + cols + ') VALUES (' + placeholders + ')';
        },
        insertSelective: function(tableName) {
            return 'INSERT INTO ' + tableName + ' <trim prefix="(" suffix=")" suffixOverrides=","><foreach collection="_parameter" item="val" index="key">${key},</foreach></trim> VALUES <trim prefix="(" suffix=")" suffixOverrides=","><foreach collection="_parameter" item="val" index="key">#{val},</foreach></trim>';
        },
        insertBatch: function(tableName, columns) {
            // columns: ['name', 'age']
            // This returns a template that will be fully built at runtime
            return 'INSERT INTO ' + tableName + ' (' + columns.join(', ') + ') VALUES ';
        },
        // 更新
        updateById: function(tableName, idColumn, columns) {
            var setClause = columns.map(function(col) {
                return col + ' = #{' + col + '}';
            }).join(', ');
            return 'UPDATE ' + tableName + ' SET ' + setClause + ' WHERE ' + idColumn + ' = #{' + idColumn + '}';
        },

        // 删除
        deleteById: function(tableName, idColumn) {
            return 'DELETE FROM ' + tableName + ' WHERE ' + idColumn + ' = #{' + idColumn + '}';
        },
        deleteByIds: function(tableName, idColumn) {
            return 'DELETE FROM ' + tableName + ' WHERE ' + idColumn + ' IN <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>';
        },
        // 分页
        selectPage: function(tableName, rawParams, expandedParams) {
            var where = buildWhereClause(rawParams, expandedParams);
            return 'SELECT * FROM ' + tableName + where + ' LIMIT ${pageSize} OFFSET ${offset}';
        }
    };

    var OPERATORS = {
        '$eq': '=',
        '$ne': '!=',
        '$gt': '>',
        '$gte': '>=',
        '$lt': '<',
        '$lte': '<=',
        '$like': 'LIKE'
    };

    function flattenParams(params) {
        var expanded = {};
        if (!params || typeof params !== 'object') return expanded;
        Object.keys(params).forEach(function(key) {
            var val = params[key];
            if (val === undefined || val === null) return;
            if (Array.isArray(val)) {
                val.forEach(function(v, i) {
                    expanded[key + '_in_' + i] = v;
                });
            } else if (typeof val === 'object') {
                Object.keys(val).forEach(function(op) {
                    var opVal = val[op];
                    if (opVal === undefined || opVal === null) return;
                    if (op === '$between') {
                        if (Array.isArray(opVal) && opVal.length >= 2) {
                            expanded[key + '_between_0'] = opVal[0];
                            expanded[key + '_between_1'] = opVal[1];
                        }
                    } else if (OPERATORS[op]) {
                        expanded[key + '_' + op.substring(1)] = opVal;
                    }
                });
            } else {
                expanded[key] = val;
            }
        });
        return expanded;
    }

    function sanitizeIdentifier(name) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            throw new Error('Invalid identifier: "' + name + '". Only letters, digits, and underscores are allowed, and must not start with a digit.');
        }
        return name;
    }

    function sanitizeParamsKeys(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
        var result = {};
        Object.keys(obj).forEach(function(key) {
            var safeKey = sanitizeIdentifier(key);
            result[safeKey] = obj[key];
        });
        return result;
    }

    /**
     * 根据参数动态构建 WHERE 子句
     * 数组值自动转为 IN 条件
     * @param {Object} params - 原始参数对象（可能包含数组值）
     * @param {Object} expandedParams - 展开后的参数对象（数组已展开为 _in_N）
     */
    function buildWhereClause(params, expandedParams) {
        if (!params || typeof params !== 'object' || Array.isArray(params)) {
            return '';
        }
        var conditions = [];
        Object.keys(params).forEach(function(key) {
            if (key === '_parameter') return;
            var val = params[key];
            if (val === undefined || val === null) return;
            if (Array.isArray(val)) {
                if (val.length === 0) return;
                var placeholders = val.map(function(v, i) {
                    return '#{' + key + '_in_' + i + '}';
                }).join(', ');
                conditions.push(sanitizeIdentifier(key) + ' IN (' + placeholders + ')');
            } else if (typeof val === 'object') {
                Object.keys(val).forEach(function(op) {
                    var opVal = val[op];
                    if (opVal === undefined || opVal === null) return;
                    if (op === '$between') {
                        if (Array.isArray(opVal) && opVal.length >= 2) {
                            conditions.push(sanitizeIdentifier(key) + ' >= #{' + key + '_between_0} AND ' + sanitizeIdentifier(key) + ' <= #{' + key + '_between_1}');
                        }
                    } else if (OPERATORS[op]) {
                        conditions.push(sanitizeIdentifier(key) + ' ' + OPERATORS[op] + ' #{' + key + '_' + op.substring(1) + '}');
                    }
                });
            } else {
                conditions.push(sanitizeIdentifier(key) + ' = #{' + key + '}');
            }
        });
        if (conditions.length === 0) return '';
        return ' WHERE ' + conditions.join(' AND ');
    }

    function DbCrudNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.on('input', async function(msg) {
            try {
                var dbConfig = RED.nodes.getNode(config.dbConfig);
                if (!dbConfig) {
                    throw new Error('Database config not found');
                }

                var operation = config.operation || msg.operation || 'selectList';
                var tableName = config.tableName || msg.tableName;
                var idColumn = config.idColumn || msg.idColumn || 'id';

                if (!tableName) {
                    throw new Error('Table name is required. Please configure it in the node or pass msg.tableName');
                }

                tableName = sanitizeIdentifier(tableName);
                idColumn = sanitizeIdentifier(idColumn);

                var sqlTemplate = '';
                var params = {};
                var isQuery = true;

                // 参数键名转换（camelCase -> snake_case）
                function getParams() {
                    var raw = msg.params || msg.payload || {};
                    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                        raw = {};
                    }
                    var data = {};
                    if (config.paramMap === 'snakeCase') {
                        data = resultMapper.snakeize(raw);
                    } else {
                        data = raw;
                    }
                    data = sanitizeParamsKeys(data);
                    return { raw: data, expanded: flattenParams(data) };
                }

                // 根据操作类型生成 SQL
                switch(operation) {
                    case 'selectById':
                        sqlTemplate = CRUD_TEMPLATES.selectById(tableName, idColumn);
                        params = getParams().expanded;
                        break;

                    case 'selectOne':
                        var selectOneParams = getParams();
                        params = selectOneParams.expanded;
                        sqlTemplate = CRUD_TEMPLATES.selectOne(tableName, selectOneParams.raw, selectOneParams.expanded);
                        break;

                    case 'selectList':
                        var selectListParams = getParams();
                        params = selectListParams.expanded;
                        sqlTemplate = CRUD_TEMPLATES.selectList(tableName, selectListParams.raw, selectListParams.expanded);
                        break;

                    case 'selectCount':
                        var selectCountParams = getParams();
                        params = selectCountParams.expanded;
                        sqlTemplate = CRUD_TEMPLATES.selectCount(tableName, selectCountParams.raw, selectCountParams.expanded);
                        break;

                    case 'selectByIds':
                        sqlTemplate = CRUD_TEMPLATES.selectByIds(tableName, idColumn);
                        var idsData = msg.hasOwnProperty('params') ? msg.params : msg.payload;
                        if (!idsData || (!Array.isArray(idsData) && !idsData.ids)) {
                            throw new Error('selectByIds requires an array or {ids: [...]} in msg.params/payload');
                        }
                        if (!Array.isArray(idsData)) {
                            idsData = idsData.ids;
                        }
                        if (!Array.isArray(idsData) || idsData.length === 0) {
                            throw new Error('selectByIds requires a non-empty array of ids');
                        }
                        idsData = idsData.map(function(id) {
                            return id === undefined ? null : id;
                        });
                        params = { ids: idsData };
                        break;

                    case 'selectPage':
                        var raw = msg.params || msg.payload || {};
                        var pageNum = Math.max(1, parseInt(raw.pageNum) || parseInt(raw.page) || 1);
                        var pageSize = Math.max(1, parseInt(raw.pageSize) || parseInt(raw.size) || 10);

                        // 分页参数不参与 WHERE 条件，先剔除
                        var filterRaw = Object.assign({}, raw);
                        ['pageNum', 'page', 'pageSize', 'size'].forEach(function(k) {
                            delete filterRaw[k];
                        });

                        // 仅对筛选条件做 paramMap 转换
                        var filterParams = filterRaw;
                        if (config.paramMap === 'snakeCase' && filterParams && typeof filterParams === 'object' && !Array.isArray(filterParams)) {
                            filterParams = resultMapper.snakeize(filterParams);
                        }
                        filterParams = sanitizeParamsKeys(filterParams);

                        var expandedParams = flattenParams(filterParams);

                        var where = buildWhereClause(filterParams, expandedParams);

                        // 先查询总记录数
                        var countSqlTemplate = 'SELECT COUNT(*) as count FROM ' + tableName + where;
                        var countParsed = sqlEngine.parse(countSqlTemplate, expandedParams);
                        var countRows = await dbConfig.query(countParsed.sql, countParsed.values);
                        var total = countRows[0] ? (countRows[0].count || 0) : 0;

                        // 再查询当前页数据
                        var pageParams = Object.assign({}, expandedParams, {
                            pageSize: pageSize,
                            offset: (pageNum - 1) * pageSize
                        });
                        var pageSqlTemplate = 'SELECT * FROM ' + tableName + where + ' LIMIT ${pageSize} OFFSET ${offset}';
                        var pageParsed = sqlEngine.parse(pageSqlTemplate, pageParams);
                        var rows = await dbConfig.query(pageParsed.sql, pageParsed.values);

                        if (config.resultMap === 'camelCase') {
                            rows = resultMapper.camelize(rows);
                        }

                        msg.payload = {
                            list: rows,
                            total: total,
                            pageNum: pageNum,
                            pageSize: pageSize,
                            pages: Math.ceil(total / pageSize)
                        };
                        node.send(msg);
                        return;

                    case 'insert':
                        var insertData = getParams().expanded;
                        var columns = Object.keys(insertData);
                        if (columns.length === 0) {
                            throw new Error('insert requires at least one field in msg.params/payload');
                        }
                        columns = columns.map(sanitizeIdentifier);
                        sqlTemplate = 'INSERT INTO ' + tableName + ' (' + columns.join(', ') + ') VALUES (' +
                            columns.map(function(col) { return '#{' + col + '}'; }).join(', ') + ')';
                        params = insertData;
                        isQuery = false;
                        break;

                    case 'insertSelective':
                        sqlTemplate = CRUD_TEMPLATES.insertSelective(tableName);
                        var isp = getParams();
                        params = isp.expanded;
                        params._parameter = isp.raw;
                        isQuery = false;
                        break;

                    case 'insertBatch':
                        var batchData = msg.hasOwnProperty('params') ? msg.params : msg.payload;
                        if (!Array.isArray(batchData) || batchData.length === 0) {
                            throw new Error('insertBatch requires an array of objects in msg.params');
                        }
                        // Apply paramMap to each item
                        if (config.paramMap === 'snakeCase') {
                            batchData = batchData.map(function(item) {
                                return resultMapper.snakeize(item);
                            });
                        }
                        if (!batchData[0] || typeof batchData[0] !== 'object' || Array.isArray(batchData[0])) {
                            throw new Error('insertBatch requires an array of objects');
                        }
                        var batchColumns = Object.keys(batchData[0]).map(sanitizeIdentifier);
                        var valueClauses = [];
                        var flatValues = [];
                        batchData.forEach(function(row) {
                            var placeholders = batchColumns.map(function() { return '?'; });
                            valueClauses.push('(' + placeholders.join(', ') + ')');
                            batchColumns.forEach(function(col) {
                                var val = row[col];
                                if (val === undefined || val !== val) { flatValues.push(null); }
                                else if (val !== null && typeof val === 'object') { flatValues.push(JSON.stringify(val)); }
                                else { flatValues.push(val); }
                            });
                        });
                        sqlTemplate = 'INSERT INTO ' + tableName + ' (' + batchColumns.join(', ') + ') VALUES ' + valueClauses.join(', ');
                        params = flatValues;
                        isQuery = false;
                        break;

                    case 'updateById':
                        var updateData = getParams().expanded;
                        if (updateData[idColumn] === undefined) {
                            throw new Error('updateById requires "' + idColumn + '" field in msg.params/payload');
                        }
                        var updateCols = Object.keys(updateData).filter(function(k) { return k !== idColumn; });
                        if (updateCols.length === 0) {
                            throw new Error('No fields to update (excluding id column)');
                        }
                        sqlTemplate = CRUD_TEMPLATES.updateById(tableName, idColumn, updateCols);
                        params = updateData;
                        isQuery = false;
                        break;

                    case 'updateSelectiveById':
                        var updateSelData = getParams().expanded;
                        if (updateSelData[idColumn] === undefined) {
                            throw new Error('updateSelectiveById requires "' + idColumn + '" field in msg.params/payload');
                        }
                        var setCols = Object.keys(updateSelData).filter(function(k) {
                            return k !== idColumn && updateSelData[k] != null;
                        });
                        if (setCols.length === 0) {
                            throw new Error('No non-null fields to update (excluding id column)');
                        }
                        var setClause = setCols.map(function(col) {
                            return col + ' = #{' + col + '}';
                        }).join(', ');
                        sqlTemplate = 'UPDATE ' + tableName + ' SET ' + setClause + ' WHERE ' + idColumn + ' = #{' + idColumn + '}';
                        params = updateSelData;
                        isQuery = false;
                        break;

                    case 'deleteById':
                        sqlTemplate = CRUD_TEMPLATES.deleteById(tableName, idColumn);
                        params = getParams().expanded;
                        isQuery = false;
                        break;

                    case 'deleteByIds':
                        sqlTemplate = CRUD_TEMPLATES.deleteByIds(tableName, idColumn);
                        var delIdsData = msg.hasOwnProperty('params') ? msg.params : msg.payload;
                        if (!delIdsData || (!Array.isArray(delIdsData) && !delIdsData.ids)) {
                            throw new Error('deleteByIds requires an array or {ids: [...]} in msg.params/payload');
                        }
                        if (!Array.isArray(delIdsData)) {
                            delIdsData = delIdsData.ids;
                        }
                        if (!Array.isArray(delIdsData) || delIdsData.length === 0) {
                            throw new Error('deleteByIds requires a non-empty array of ids');
                        }
                        delIdsData = delIdsData.map(function(id) {
                            return id === undefined ? null : id;
                        });
                        params = { ids: delIdsData };
                        isQuery = false;
                        break;

                    case 'upsertBatch':
                        var upsertData = msg.params || msg.payload;
                        if (!Array.isArray(upsertData) || upsertData.length === 0) {
                            throw new Error('upsertBatch requires an array of objects in msg.params');
                        }
                        if (config.paramMap === 'snakeCase') {
                            upsertData = upsertData.map(function(item) {
                                return resultMapper.snakeize(item);
                            });
                        }
                        if (!upsertData[0] || typeof upsertData[0] !== 'object' || Array.isArray(upsertData[0])) {
                            throw new Error('upsertBatch requires an array of objects');
                        }
                        var upsertColumns = Object.keys(upsertData[0]).map(sanitizeIdentifier);
                        var upsertValueClauses = [];
                        var upsertFlatValues = [];
                        upsertData.forEach(function(row) {
                            var placeholders = upsertColumns.map(function() { return '?'; });
                            upsertValueClauses.push('(' + placeholders.join(', ') + ')');
                            upsertColumns.forEach(function(col) {
                                var val = row[col];
                                if (val === undefined || val !== val) { upsertFlatValues.push(null); }
                                else if (val !== null && typeof val === 'object') { upsertFlatValues.push(JSON.stringify(val)); }
                                else { upsertFlatValues.push(val); }
                            });
                        });
                        var driver = dbConfig.driver || 'mysql';
                        var upsertUpdateClause;
                        if (driver === 'sqlite') {
                            upsertUpdateClause = upsertColumns.map(function(col) {
                                return col + ' = excluded.' + col;
                            }).join(', ');
                            sqlTemplate = 'INSERT INTO ' + tableName + ' (' + upsertColumns.join(', ') + ') VALUES ' + upsertValueClauses.join(', ') + ' ON CONFLICT(' + idColumn + ') DO UPDATE SET ' + upsertUpdateClause;
                        } else {
                            upsertUpdateClause = upsertColumns.map(function(col) {
                                return col + ' = VALUES(' + col + ')';
                            }).join(', ');
                            sqlTemplate = 'INSERT INTO ' + tableName + ' (' + upsertColumns.join(', ') + ') VALUES ' + upsertValueClauses.join(', ') + ' ON DUPLICATE KEY UPDATE ' + upsertUpdateClause;
                        }
                        params = upsertFlatValues;
                        isQuery = false;
                        break;

                    case 'deleteAndInsertBatch':
                        var batchData = msg.hasOwnProperty('params') ? msg.params : msg.payload;
                        if (!Array.isArray(batchData) || batchData.length === 0) {
                            throw new Error('deleteAndInsertBatch requires an array of objects in msg.params');
                        }
                        if (config.paramMap === 'snakeCase') {
                            batchData = batchData.map(function(item) {
                                return resultMapper.snakeize(item);
                            });
                        }
                        if (!batchData[0] || typeof batchData[0] !== 'object' || Array.isArray(batchData[0])) {
                            throw new Error('deleteAndInsertBatch requires an array of objects');
                        }
                        var batchColumns = Object.keys(batchData[0]).map(sanitizeIdentifier);
                        var valueClauses = [];
                        var flatValues = [];
                        batchData.forEach(function(row) {
                            var placeholders = batchColumns.map(function() { return '?'; });
                            valueClauses.push('(' + placeholders.join(', ') + ')');
                            batchColumns.forEach(function(col) {
                                var val = row[col];
                                if (val === undefined || val !== val) { flatValues.push(null); }
                                else if (val !== null && typeof val === 'object') { flatValues.push(JSON.stringify(val)); }
                                else { flatValues.push(val); }
                            });
                        });
                        var insertSql = 'INSERT INTO ' + tableName + ' (' + batchColumns.join(', ') + ') VALUES ' + valueClauses.join(', ');

                        var result = await dbConfig.withTransaction(async function(conn) {
                            await conn.execute('DELETE FROM ' + tableName);
                            var [insertResult] = await conn.execute(insertSql, flatValues);
                            return {
                                affectedRows: insertResult.affectedRows || 0,
                                insertId: insertResult.insertId,
                                deletedAll: true
                            };
                        });
                        msg.payload = result;
                        node.send(msg);
                        return;

                    default:
                        throw new Error('Unknown operation: ' + operation);
                }

                // 解析并执行 SQL
                var sql, values;
                if (operation === 'insertBatch' || operation === 'deleteAndInsertBatch' || operation === 'upsertBatch') {
                    // insertBatch / deleteAndInsertBatch / upsertBatch 已生成纯 ? 占位符 SQL，直接执行无需解析
                    sql = sqlTemplate;
                    values = params;
                } else {
                    var parsed = sqlEngine.parse(sqlTemplate, params);
                    sql = parsed.sql;
                    values = parsed.values;
                }
                node.log('SQL: ' + sql);
                node.log('Params count: ' + values.length);
                node.log('Params: ' + JSON.stringify(values));

                try {
                    if (isQuery) {
                        var rows = await dbConfig.query(sql, values);
                        if (config.resultMap === 'camelCase') {
                            rows = resultMapper.camelize(rows);
                        }
                        msg.payload = rows;
                    } else {
                        var result = await dbConfig.execute(sql, values);
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
                node.error('CRUD error: ' + err.message, msg);
            }
        });
    }

    RED.nodes.registerType('tangbao-db-crud', DbCrudNode);
};
