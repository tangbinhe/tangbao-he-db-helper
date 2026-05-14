/**
 * Result Mapper
 * Converts database results, e.g., snake_case -> camelCase
 */

function toCamelCase(str) {
    return str.replace(/_([a-zA-Z])/g, function(match, letter) {
        return letter.toUpperCase();
    });
}

function toSnakeCase(str) {
    return str
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '');
}

function camelizeRow(row) {
    if (!row || typeof row !== 'object' || row instanceof Date || Buffer.isBuffer(row)) return row;
    var result = {};
    Object.keys(row).forEach(function(key) {
        result[toCamelCase(key)] = row[key];
    });
    return result;
}

function snakeizeRow(row) {
    if (!row || typeof row !== 'object' || row instanceof Date || Buffer.isBuffer(row)) return row;
    var result = {};
    Object.keys(row).forEach(function(key) {
        result[toSnakeCase(key)] = row[key];
    });
    return result;
}

function camelize(rows) {
    if (rows == null) return rows;
    if (Array.isArray(rows)) {
        return rows.map(camelizeRow);
    }
    return camelizeRow(rows);
}

function snakeize(rows) {
    if (rows == null) return rows;
    if (Array.isArray(rows)) {
        return rows.map(snakeizeRow);
    }
    return snakeizeRow(rows);
}

module.exports = {
    toCamelCase: toCamelCase,
    toSnakeCase: toSnakeCase,
    camelize: camelize,
    snakeize: snakeize
};