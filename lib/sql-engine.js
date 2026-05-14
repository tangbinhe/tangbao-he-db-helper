/**
 * SQL Template Engine
 * Similar to MyBatis dynamic SQL
 * Supports: #{param}, ${param}, <if>, <foreach>, <where>, <set>, <trim>
 */

function evaluateExpression(expr, params) {
    try {
        if (/require|import|eval|Function|constructor|process|globalThis|global|window|document/.test(expr)) {
            return false;
        }
        var keys = Object.getOwnPropertyNames(params || {});
        var values = keys.map(function(k) { return params[k]; });
        var func = new Function(keys, 'return (' + expr + ');');
        return func.apply(null, values);
    } catch(e) {
        return false;
    }
}

function getValue(obj, path) {
    if (!obj || !path) return undefined;
    var parts = path.split('.');
    var val = obj;
    for (var i = 0; i < parts.length; i++) {
        if (val == null) return undefined;
        val = val[parts[i]];
    }
    return val;
}

function processDynamicTags(template, params) {
    // Protect string literals that are NOT inside XML/HTML tags
    // to prevent JSON/XML-like content inside strings from being
    // incorrectly matched by dynamic tag regexes.
    var literals = [];
    function protectStrings(t) {
        var result = '';
        var inTag = false;
        var inQuote = null;
        var i = 0;
        while (i < t.length) {
            if (inTag) {
                if (t[i] === inQuote) {
                    inQuote = null;
                } else if (!inQuote && (t[i] === '"' || t[i] === "'")) {
                    inQuote = t[i];
                } else if (!inQuote && t[i] === '>') {
                    inTag = false;
                }
            } else {
                if (t[i] === '<' && i + 1 < t.length && /[a-zA-Z\/]/.test(t[i + 1])) {
                    inTag = true;
                } else if (t[i] === "'" || t[i] === '"') {
                    var quote = t[i];
                    var j = i + 1;
                    while (j < t.length) {
                        if (t[j] === '\\' && j + 1 < t.length) {
                            j += 2;
                            continue;
                        }
                        if (t[j] === quote) break;
                        j++;
                    }
                    if (j < t.length) {
                        var str = t.substring(i, j + 1);
                        literals.push(str);
                        result += '\x00LITERAL_' + (literals.length - 1) + '\x00';
                        i = j + 1;
                        continue;
                    }
                }
            }
            result += t[i];
            i++;
        }
        return result;
    }
    function restoreStrings(t) {
        for (var i = 0; i < literals.length; i++) {
            t = t.replace(new RegExp('\\x00LITERAL_' + i + '\\x00', 'g'), function() { return literals[i]; });
        }
        return t;
    }
    template = protectStrings(template);

    // Process <if> tags
    template = template.replace(/<if\s+test="([^"]+)">([\s\S]*?)<\/if>/g, function(match, testExpr, content) {
        var result = evaluateExpression(testExpr, params);
        return result ? content : '';
    });

    // Process <foreach> tags
    template = template.replace(/<foreach\s+collection="([^"]+)"(?:\s+item="([^"]*)")?(?:\s+index="([^"]*)")?(?:\s+open="([^"]*)")?(?:\s+separator="([^"]*)")?(?:\s+close="([^"]*)")?>([\s\S]*?)<\/foreach>/g, function(match, collection, item, indexName, open, separator, close, content) {
        var coll = getValue(params, collection);
        if (!coll) return '';
        item = item || 'item';
        indexName = indexName || 'index';
        open = open || '';
        separator = separator || '';
        close = close || '';

        var isArray = Array.isArray(coll);
        var keys = isArray ? null : Object.keys(coll);
        var length = isArray ? coll.length : (keys ? keys.length : 0);
        if (length === 0) return '';

        var parts = [];
        for (var i = 0; i < length; i++) {
            var val = isArray ? coll[i] : coll[keys[i]];
            var idx = isArray ? i : keys[i];

            params['_foreach_val_' + i] = val;

            var part = content;
            // Escape RegExp special chars in item/indexName to avoid malformed regex
            function escapeRe(str) {
                return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
            // Replace #{item}
            var itemKeyRe = new RegExp('#\\{' + escapeRe(item) + '\\}', 'g');
            part = part.replace(itemKeyRe, function() {
                return '#{_foreach_val_' + i + '}';
            });
            // Replace ${indexName} with actual key/index value
            if (indexName) {
                var indexRe = new RegExp('\\$\\{' + escapeRe(indexName) + '\\}', 'g');
                part = part.replace(indexRe, idx);
            }
            parts.push(part);
        }
        return open + parts.join(separator) + close;
    });

    // Process <where> tags
    template = template.replace(/<where>([\s\S]*?)<\/where>/g, function(match, content) {
        var trimmed = content.trim();
        trimmed = trimmed.replace(/^(AND|OR)\s+/i, '');
        return trimmed ? 'WHERE ' + trimmed : '';
    });

    // Process <set> tags
    template = template.replace(/<set>([\s\S]*?)<\/set>/g, function(match, content) {
        var trimmed = content.trim().replace(/,\s*$/, '');
        return trimmed ? 'SET ' + trimmed : '';
    });

    // Process <trim> tags
    template = template.replace(/<trim\s+prefix="([^"]*)"\s+suffix="([^"]*)"\s+suffixOverrides="([^"]*)">([\s\S]*?)<\/trim>/g, function(match, prefix, suffix, suffixOverrides, content) {
        var trimmed = content.trim();
        if (suffixOverrides) {
            var overrides = suffixOverrides.split('|');
            overrides.forEach(function(override) {
                var esc = override.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                var re = new RegExp(esc + '\\s*$');
                trimmed = trimmed.replace(re, '');
            });
        }
        return (prefix || '') + trimmed + (suffix || '');
    });

    return restoreStrings(template);
}

function parse(template, params) {
    params = params || {};
    // Create a shallow copy so that processDynamicTags and subsequent
    // placeholder resolution share the same object (e.g. _foreach_val_*).
    // Use getOwnPropertyNames to preserve non-enumerable properties like _parameter.
    var copy = {};
    Object.getOwnPropertyNames(params).forEach(function(k) {
        copy[k] = params[k];
    });
    params = copy;

    // 1. Process dynamic tags
    var sql = processDynamicTags(template, params);

    // 2. Process #{param} placeholders
    var values = [];
    sql = sql.replace(/#\{([^}]+)\}/g, function(match, key) {
        var val = getValue(params, key);
        values.push(val);
        return '?';
    });

    // 3. Process ${param} direct replacements
    sql = sql.replace(/\$\{([^}]+)\}/g, function(match, key) {
        var val = getValue(params, key);
        return val != null ? val : '';
    });

    return {
        sql: sql.trim(),
        values: values
    };
}

module.exports = {
    parse: parse,
    evaluateExpression: evaluateExpression
};