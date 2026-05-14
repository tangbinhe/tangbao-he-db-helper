# tangbao-he-db-helper

MyBatis-style database helper for Node-RED with MySQL 8.0 support.

## Features

- **SQL Mapper**: Template engine with `#{param}`, `${param}`, `<if>`, `<foreach>`
- **CRUD Node**: Pre-built operations like `selectById`, `insert`, `updateById`, etc.
- **MySQL**: Connection pool, auto-reconnect, health check, multiple statements
- **Result Mapping**: Auto snake_case to camelCase conversion
- **Transaction Support**: `withTransaction` for safe batch operations
- **Dynamic Parameters**: `msg.tableName`, `msg.params`, `msg.operation` for runtime flexibility

## Nodes

| Node | Type | Description |
|------|------|-------------|
| `tangbao-db-config` | Config | Database connection settings |
| `tangbao-sql-mapper` | Config | Reusable SQL templates |
| `tangbao-db-execute` | Flow | Execute INSERT/UPDATE/DELETE with SQL templates |
| `tangbao-db-crud` | Flow | Pre-built CRUD operations (selectById, insert, updateById, etc.) |

## Requirements

- Node.js >= 18.0
- Node-RED >= 4.0.0

## Installation

```bash
cd ~/.node-red
npm install tangbao-he-db-helper
```

Or install from a local `.tgz` file:

```bash
cd ~/.node-red
npm install /path/to/tangbao-he-db-helper-1.0.1.tgz
```

Then restart Node-RED.

## Node Details

### tangbao-db-config

Database connection configuration node. Supports MySQL connection pool with auto-reconnect and health check.

**Settings:**
- Host, Port, Database, User, Password
- Charset (default: `UTF8_GENERAL_CI`)
- Timezone (default: `local`)
- Connection Pool Limit (default: `50`)

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

### tangbao-db-execute

Execute INSERT/UPDATE/DELETE operations using SQL templates or raw SQL.

**Inputs:**
- `msg.sql` — Dynamic SQL (priority over node config)
- `msg.params` — SQL template parameters
- `msg.payload` — Fallback for params

**Example:**
```javascript
msg.sql = "UPDATE user SET name = #{name} WHERE id = #{id}";
msg.params = { id: 1, name: "Alice" };
```

### tangbao-db-crud

Pre-built CRUD operations. No SQL writing needed.

**Operations:**

| Operation | Description | Params Example |
|-----------|-------------|----------------|
| `selectById` | Query by ID | `{id: 1}` |
| `selectOne` | Query single by conditions | `{name: "Alice"}` |
| `selectList` | Query list by conditions | `{status: 1}` |
| `selectCount` | Count by conditions | `{status: 1}` |
| `selectByIds` | Query by ID list | `[1, 2, 3]` |
| `selectPage` | Paginated query | `{status: 1, pageNum: 1, pageSize: 10}` |
| `insert` | Insert full fields | `{name: "Alice", age: 20}` |
| `insertSelective` | Insert non-null fields | `{name: "Alice"}` |
| `insertBatch` | Batch insert | `[{name: "A"}, {name: "B"}]` |
| `updateById` | Update full fields by ID | `{id: 1, name: "Bob", age: 21}` |
| `updateSelectiveById` | Update non-null fields by ID | `{id: 1, name: "Bob"}` |
| `deleteById` | Delete by ID | `{id: 1}` |
| `deleteByIds` | Delete by ID list | `[1, 2, 3]` |
| `deleteAndInsertBatch` | Clear table and batch insert | `[{name: "A"}, {name: "B"}]` |

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

**Result Mapping:**
- `camelCase` — Convert `user_name` to `userName`
- `snakeCase` — Convert `userName` to `user_name`
- `none` — No conversion

## Examples

See `examples/CRUD Example.json` for a sample flow.

## License

MIT
