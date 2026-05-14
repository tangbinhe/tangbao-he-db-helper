module.exports = function(RED) {
    function SqlMapperNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.name = config.name;
        node.sqlTemplate = config.sqlTemplate || '';

        node.getSql = function() {
            return node.sqlTemplate;
        };
    }

    RED.nodes.registerType('tangbao-sql-mapper', SqlMapperNode);
};