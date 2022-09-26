# els_export

Export data from Elasticsearch from DSL query file to CSV or NDJSON, using a configuration file "--config".

## Can do

- search_after for query search pagination and big responses
- composite as the first level of aggregations (aggs)
- the second level of aggs could be ignored, like time range and derivative aggs
- in composite aggs when output format in NDJSON, the response is transformed to JSON using the name of aggs as field name; this output can be inserted again to Elasticsearch, useful for historic index

## Configuration

- "env", an array with fields names (dot parsing) in config file to be replaced with environment variables with the name of the value field
- "query.vars", an object that has "variables/fields" in the DSL file to be replaced
- "query.aggs", name of first level aggs composite
- "query.exclude", name of second level aggs to ignore, like time range and derivative
- "query.type", search o composite, the type of query in DSL file
- "query.time", object with time range configuration for DSL file with "%{_from}" and "%{_to} variables for range with format "epoch_second"
- "query.time.lastDay", bool to search using from/to with previous day information
- "query.time.dateFrom", date (yyyy-mm-dd) to start the search from/to with 1 day as default interval and need "query.timetoDays" to specify number of days in the search
- "query.time.interval", the time in minutes to make subqueries in range from/to, useful when  need the max value per hour in last day from the counter and do a derivative from less time in second level aggs
- "query.time.delay", time in minutes to subtract in from/to, useful when the cron job is not at 0 minutes but needs the query from 0 minute
- "export.addTime", bool to add time field calculated "from" in epoch to all documents

# els_insert

Insert data from stdin in NDJSON format to Elasticsearch index

## Configuration

- "env", an array with fields name (dot parsing) in config file to be replaced with environment variables with the name of the value field