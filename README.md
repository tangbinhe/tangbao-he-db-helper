# tangbao-he-db-helper

MyBatis-style database helper for Node-RED with MySQL and SQLite support.

## Features

- **SQL Mapper**: Template engine with `#{param}`, `${param}`, `<if>`, `<foreach>`
- **Query Node**: Dedicated SELECT node for safe and simple query operations
- **CRUD Node**: Pre-built operations like `selectById`, `insert`, `updateById`, etc.
- **MySQL**: Connection pool, auto-reconnect, health check, multiple statements
- **SQLite**: File-based local database, zero-config, no network required
- **Result Mapping**: Auto snake_case to camelCase conversion
- **Transaction Support**: `withTransaction` for safe batch operations
- **Dynamic Parameters**: `msg.tableName`, `msg.params`, `msg.operation` for runtime flexibility
- **Array IN Support**: Array values in conditions are automatically converted to `IN (...)`
- **Error Resilience**: Database connection errors are caught and logged, never crash Node-RED

## Nodes

| Node | Type | Description |
|------|------|-------------|
| `tangbao-db-config` | Config | Database connection settings (MySQL or SQLite) |
| `tangbao-sql-mapper` | Config | Reusable SQL templates |
| `tangbao-db-query` | Flow | Execute SELECT queries with SQL templates |
| `tangbao-db-execute` | Flow | Execute INSERT/UPDATE/DELETE with SQL templates |
| `tangbao-db-crud` | Flow | Pre-built CRUD operations (selectById, insert, updateById, etc.) |

## Requirements

- Node.js >= 18.0
- Node-RED >= 4.0.0
- **For SQLite support**: `better-sqlite3` >= 12.0.0 (installed separately)

## Installation

```bash
cd ~/.node-red
npm install tangbao-he-db-helper
```

Or install from a local `.tgz` file:

```bash
cd ~/.node-red
npm install /path/to/tangbao-he-db-helper-*.tgz
```

**For SQLite support, also install:**

```bash
cd ~/.node-red
npm install better-sqlite3
```

Then restart Node-RED.

## Node Details

### tangbao-db-config

Database connection configuration node. Supports both MySQL and SQLite.

**Driver Selection:**

| Driver | Use Case | Required Extra Dependency |
|--------|----------|--------------------------|
| `MySQL` (default) | Remote/centralized database | `mysql2` (auto-installed) |
| `SQLite` | Local file database, embedded | `better-sqlite3` (manual install) |

When you select a driver in the configuration panel, the available fields automatically switch:

- **MySQL**: Host, Port, User, Password, Database, Charset, Timezone, Connection Pool Limit
- **SQLite**: Database File Path only (e.g., `/data/mydb.db` or `./mydb.db`)

**MySQL Settings:**
- Host, Port, Database
- User / Password (stored in Node-RED credentials, encrypted at rest)
- Charset (default: `UTF8_GENERAL_CI`)
- Timezone (default: `local`)
- Connection Pool Limit (default: `50`)

**SQLite Settings:**
- Database File Path: Absolute or relative path to the `.db` file. If the file does not exist, it will be created automatically.

### tangbao-sql-mapper

Config node for reusable SQL templates. Supports dynamic parameters and conditional logic.

**Template Syntax:**
- `#{param}` — Parameter placeholder (prepared statement, safe from SQL injection)
- `${param}` — Direct string replacement (use with caution)
- `<if test="condition">...</if>` — Conditional block
- `<foreach collection="list" item="item" open="(" separator="," close=")">#{item}</foreach>` — Loop

**Example:**
```sql
SELECT * FROM ${tableName}
<where>
  <if test="name != null">AND name = #{name}</if>
  <if test="age != null">AND age > #{age}</if>
</where>
```

### tangbao-db-query

Execute SELECT queries using SQL templates, SQL mapper, or raw SQL. Results are returned as an array in `msg.payload`.

**Inputs:**
- `msg.sql` — Dynamic SQL (priority over node config and SQL mapper)
- `msg.params` — SQL template parameters
- `msg.payload` — Fallback for params

**Outputs:**
- `msg.payload` — Query result array

**Example:**
```javascript
msg.sql = "SELECT * FROM user WHERE status = #{status} ORDER BY id DESC";
msg.params = { status: 1 };
```

### tangbao-db-execute

Execute SQL operations (INSERT/UPDATE/DELETE/SELECT) using SQL templates, SQL mapper, or raw SQL. Automatically detects query vs write operations based on SQL statement type.

**Inputs:**
- `msg.sql` — Dynamic SQL (priority over node config and SQL mapper)
- `msg.params` — SQL template parameters
- `msg.payload` — Fallback for params

**Outputs:**
- For SELECT queries: `msg.payload` — Result array
- For INSERT/UPDATE/DELETE: `msg.payload` — Object with `affectedRows`, `insertId`, `changedRows`

**Example:**
```javascript
msg.sql = "UPDATE user SET name = #{name} WHERE id = #{id}";
msg.params = { id: 1, name: "Alice" };
```

### tangbao-db-crud

Pre-built CRUD operations. No SQL writing needed.

**Operations:**

| Operation | Description | Params Example | SQLite Compatible |
|-----------|-------------|----------------|-------------------|
| `selectById` | Query by ID | `{id: 1}` | Yes |
| `selectOne` | Query single by conditions | `{name: "Alice"}` | Yes |
| `selectList` | Query list by conditions | `{status: 1}` | Yes |
| `selectCount` | Count by conditions | `{status: 1}` | Yes |
| `selectByIds` | Query by ID list | `[1, 2, 3]` | Yes |
| `selectPage` | Paginated query | `{status: 1, pageNum: 1, pageSize: 10}` | Yes |
| `insert` | Insert full fields | `{name: "Alice", age: 20}` | Yes |
| `insertSelective` | Insert non-null fields | `{name: "Alice"}` | Yes |
| `insertBatch` | Batch insert | `[{name: "A"}, {name: "B"}]` | Yes |
| `updateById` | Update full fields by ID | `{id: 1, name: "Bob", age: 21}` | Yes |
| `updateSelectiveById` | Update non-null fields by ID | `{id: 1, name: "Bob"}` | Yes |
| `deleteById` | Delete by ID | `{id: 1}` | Yes |
| `deleteByIds` | Delete by ID list | `[1, 2, 3]` | Yes |
| `deleteAndInsertBatch` | Clear table and batch insert | `[{name: "A"}, {name: "B"}]` | Yes |
| `upsertBatch` | Batch insert or update | `[{id: 1, name: "A"}]` | Yes (see note below) |

**SQLite Upsert Note:**
SQLite uses `ON CONFLICT(id) DO UPDATE SET col = excluded.col` instead of MySQL's `ON DUPLICATE KEY UPDATE col = VALUES(col)`. The CRUD node automatically selects the correct syntax based on your configured driver.

> **Important:** For `upsertBatch` to work with SQLite, the target table must have a **PRIMARY KEY** or **UNIQUE** constraint on the `idColumn`. Otherwise SQLite will raise a conflict resolution error.

**Array to IN:**

For `selectList`, `selectOne`, `selectCount`, and `selectPage`, array values are automatically converted to `IN` conditions:

```javascript
msg.params = { equip_type_id: [1212101, 1212102] };
// Generates: WHERE equip_type_id IN (?, ?)
```

**Range / Operator Query:**

You can use object-style operators for range queries in `selectList`, `selectOne`, `selectCount`, and `selectPage`:

| Operator | SQL Generated | Example Value |
|----------|---------------|---------------|
| `$eq` | `=` | `{ $eq: 'active' }` |
| `$ne` | `!=` | `{ $ne: 0 }` |
| `$gt` | `>` | `{ $gt: 1 }` |
| `$gte` | `>=` | `{ $gte: '2025-01-01' }` |
| `$lt` | `<` | `{ $lt: 100 }` |
| `$lte` | `<=` | `{ $lte: '2025-12-31' }` |
| `$like` | `LIKE` | `{ $like: '%error%' }` |
| `$between` | `>= AND <=` | `{ $between: ['2025-01-01', '2025-12-31'] }` |

```javascript
msg.params = {
  pageNum: 1,
  pageSize: 20,
  alarm_time: { $gte: '2025-12-07 00:00:00', $lte: '2026-06-05 23:59:59' },
  alarm_level: { $gt: 1 },
  alarm_desc: { $like: '%高温%' }
};
// Generates: WHERE alarm_time >= ? AND alarm_time <= ? AND alarm_level > ? AND alarm_desc LIKE ?
```

**selectPage Output:**

Returns a pagination object including total count:

```json
{
  "list": [...],
  "total": 100,
  "pageNum": 1,
  "pageSize": 10,
  "pages": 10
}
```

**Dynamic Usage:**

Use `msg.tableName`, `msg.params`, `msg.operation` to operate on different tables with the same node:

```javascript
// First message
msg.tableName = "user";
msg.params = { status: 1 };

// Second message
msg.tableName = "order";
msg.params = { status: 2 };
```

**Result Mapping (结果映射):**

在数据库表字段通常使用下划线命名（如 `user_name`），而前端/JavaScript 中更习惯驼峰命名（如 `userName`）。结果映射用于自动转换查询结果的字段名。

| 选项 | 说明 | 示例 |
|------|------|------|
| `camelCase` | 下划线转驼峰 | `user_name` → `userName` |
| `none` | 不转换，保持原样 | `user_name` → `user_name` |

```javascript
// 数据库返回: [{ user_name: "Alice", user_age: 20 }]
// 启用 camelCase 结果映射后，msg.payload:
[{ userName: "Alice", userAge: 20 }]
```

**Param Mapping (参数映射):**

参数映射用于在发送 SQL 之前，自动将传入参数的键名转换为数据库字段命名风格。这在你的前端传入驼峰命名参数，而数据库表使用下划线命名时非常有用。

| 选项 | 说明 | 示例 |
|------|------|------|
| `snakeCase` | 驼峰转下划线 | `{ userName: "Alice" }` → `{ user_name: "Alice" }` |
| `none` | 不转换，保持原样 | `{ userName: "Alice" }` → `{ userName: "Alice" }` |

```javascript
// 前端传入
msg.params = { userName: "Alice", userAge: 20 };

// 启用 snakeCase 参数映射后，实际生成的 SQL:
// INSERT INTO user (user_name, user_age) VALUES (?, ?)
```

**注意：** 结果映射与参数映射相互独立，可按需分别设置。例如：
- **前端 ↔ 数据库命名风格不一致**：参数映射设为 `snakeCase`，结果映射设为 `camelCase`，实现全自动转换。
- **前后端风格一致**：两者均设为 `none`，不做任何转换。

**Auto Table Loading (自动加载表名):**

在配置 `tangbao-db-crud` 节点时，只需先选择数据库配置（`tangbao-db-config`），表名下拉框会自动从该数据库加载所有表名供你选择，无需手动输入。如果数据库连接尚未部署或无法访问，也可以点击右侧"自定义输入"按钮直接手写表名。

## SQLite Usage Example

1. Install `better-sqlite3`:
   ```bash
   cd ~/.node-red
   npm install better-sqlite3
   ```

2. Restart Node-RED.

3. Create a `tangbao-db-config` node, select **SQLite** as the driver, and enter the database file path (e.g., `./data.db` or an absolute path like `/data/mydb.db`).

4. Use `tangbao-db-crud` or `tangbao-db-query` / `tangbao-db-execute` as usual. All CRUD operations work the same way.

### SQLite vs MySQL Quick Reference

| Feature | MySQL | SQLite |
|---------|-------|--------|
| Connection | TCP (host:port) | Local file |
| Auth | User / Password | None |
| Pooling | Yes (configurable) | No (single connection) |
| Auto-reconnect | Yes | N/A |
| `upsertBatch` | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO UPDATE` (requires PK/UNIQUE) |
| `deleteAndInsertBatch` | Transaction | Transaction |
| Table discovery | `information_schema` | `sqlite_master` |
| Multi-statement execute | Supported with params | Supported **without** params |

## Logging Configuration (日志配置)

本节点包使用 `node.log` / `node.error` 输出运行日志，其输出级别受 Node-RED 全局日志配置控制。

如需调整日志输出级别或关闭日志，请编辑 Node-RED 的 `settings.js` 文件：

```javascript
logging: {
    console: {
        level: "info",    // 可选: trace, debug, info, warn, error, fatal
        metrics: false,
        audit: false
    }
}
```

| 级别 | 效果 |
|------|------|
| `trace` / `debug` | 输出所有日志（包括 SQL 调试信息） |
| `info` | 默认级别，输出 SQL 执行信息和错误 |
| `warn` | 仅输出警告和错误，隐藏常规 SQL 日志 |
| `error` / `fatal` | 仅输出错误信息 |

**注意：** Node-RED 目前没有为单个节点包单独设置日志级别的机制，上述配置为全局生效。建议在开发环境使用 `info`，生产环境使用 `warn` 或 `error` 以减少日志噪音。

## Examples

See the `examples/` folder for sample flows:

- `CRUD Example.json` — CRUD operations demo
- `Execute Example.json` — Custom SQL execution demo
- `Query Example.json` — SELECT query demo

## License

MIT
