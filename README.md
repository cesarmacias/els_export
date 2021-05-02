# els_export

- Export data fron Elastic using a DSL query to CSV, NDJSON format.
- Import data from NDJSON format to Elastic.

## els_esport.js

- search_after for query search
- composite as first level of aggs
- second level of aggs could be ignore, like time range and derivative aggs; useful to calculate bps from octets
- stdout as output
- configuration file is in JSON --config
    - query.file: path to file with query in DLS format
    - query.vars: object to variables to replace in DSL file
    - export.addTime: add field time with epoch timefrom
    - query.aggs: name of composite aggs in DSL file
    - query.exclude: name of second aggs to in¿gnore in results; useful to calculate max, avg, other bps from octets in time for maney devices/interfeces
    - query.time.interval: last N minutes to search
    - query.time.delay: N minutes to delay with last; useful last 1H (60), but start in minute 5 (delay) and not 0
    - query.time.lastDay: boolean if true search all previous day
    - query.time.dateFrom: date in format yyyy-MM-dd as start date to search in chunk of days
    - query.time.toDays: number of days to search (chunk) since dateFrom

## stdin2insert.js

- stdin as input
- configuration file is in JSON --config
