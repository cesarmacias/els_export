/*jslint node: true */
"use strict";

const { Client } = require("es7");
const fs = require("fs");
const argv = require("minimist")(process.argv.slice(2));
/*
    FUNCTION GET VALUE FROM OBJECT USING DOT STRING FROMAT
*/
const getValue = (object, keys) =>
  keys.split(".").reduce((o, k) => (o || {})[k], object);
/*
    FUNCTION OBJECT TO EXPAND DOT ANNOTATION TO MULTI-LEVEL OBJECT
 */
(function () {
  function parseDotNotation(str, val, obj) {
    let currentObj = obj,
      keys = str.split("."),
      i,
      l = Math.max(1, keys.length - 1),
      key;

    for (i = 0; i < l; ++i) {
      key = keys[i];
      currentObj[key] = currentObj[key] || {};
      currentObj = currentObj[key];
    }

    currentObj[keys[i]] = val;
    delete obj[str];
  }
  Object.expand = function (obj) {
    for (const key in obj) {
      if (key.indexOf(".") !== -1) {
        parseDotNotation(key, obj[key], obj);
      }
    }
    return obj;
  };
})();
/*
    FUNCTION VALIDATE IF VAR IS OBJECT
 */
const isObject = function (a) {
  return !!a && a.constructor === Object;
};
/*
    FUNCTION MAKE THE SEARCH QUERY AGGREGATION AND INSERT OR PRINT THE RESPONSE IN EVENT FORMAT
 */
async function DslQuery(config, objReplace, esClient, strDsl, timeFrom) {
  try {
    let dsl = strDsl;
    if (isSObject(objReplace)) {
      for (const key in objReplace) {
        dsl = dsl.replace('"%{' + key + '}"', objReplace[key]);
      }
    }
    const query = JSON.parse(dsl);
    const search = {
      index: config.query.index,
      body: query,
    };
    let flag = true;
    while (flag) {
      const { body } = await esClient.search(search);
      if (config.query.type === "composite") {
        if (
          "aggregations" in body &&
          isObject(body.aggregations) &&
          config.query.aggs in body.aggregations
        ) {
          let obj = body.aggregations[config.query.aggs];
          let array = "buckets" in obj ? obj.buckets : [];
          let after = "after_key" in obj ? obj.after_key : false;
          if (isObject(after)) {
            search.body["aggs"][config.query.aggs].composite.after = after;
          } else {
            flag = false;
          }
          for await (const item of array) {
            if (isObject(item)) {
              let resp = {};
              for (let key in item) {
                if (key === "key" && isObject(item.key)) {
                  for (let field in item.key) {
                    resp[field] = item.key[field];
                  }
                } else if (key === "doc_count") {
                  resp.count = item[key];
                } else if (key === config.query.exclude) {
                  continue;
                } else if ("value" in item[key]) {
                  resp[key] =
                    item[key].value != null ? item[key].value : undefined;
                } else if ("buckets" in item[key]) {
                  if (item[key]["buckets"][0]["doc_count"])
                    resp[key] = item[key]["buckets"][0]["doc_count"];
                } else if ("values" in item[key]) {
                  resp[key] = item[key].values;
                } else if ("doc_count" in item[key]) {
                  resp[key] = item[key]["doc_count"];
                } else {
                  resp[key] = item[key];
                }
              }
              if (
                "addTime" in config.export &&
                config.export.addTime &&
                timeFrom > 0
              ) {
                resp.time = timeFrom;
              }
              let data =
                config.export.attr && Object.keys(config.export.attr).length > 0
                  ? { ...Object.expand(resp), ...config.export.attr }
                  : Object.expand(resp);
              if (
                "format" in config.export &&
                config.export.format == "csv" &&
                "schema" in config.export &&
                config.export.schema.length > 0
              ) {
                let csv;
                config.export.schema.forEach(key, (i) => {
                  csv =
                    i == 0
                      ? getValue(data, key)
                      : csv + "," + getValue(data, key);
                });
              } else {
                console.log(JSON.stringify(data));
              }
            }
          }
        }
      } else {
        
      }
    }
  } catch (e) {
    if ("name" in e && "meta" in e) {
      console.error(e);
      console.error(JSON.stringify(e));
    } else console.error(e);
  }
}
/*
    FUNCTION TO RED CONFIG FILE - PREPARE THE LOOP FOR SEARCH
 */
async function main(confFile, opt_delay) {
  try {
    if (fs.existsSync(confFile)) {
      const strConf = fs.readFileSync(confFile, "utf8");
      const config = JSON.parse(strConf);
      const client = new Client({
        nodes: config.elastic.nodes,
        auth: {
          username: config.elastic.username,
          password: config.elastic.password,
        },
        maxRetries: config.elastic.maxRetries,
        requestTimeout: config.elastic.requestTimeout,
      });
      let delay = 0;
      if (opt_delay && opt_delay > 0) {
        delay = opt_delay * 60;
      } else if ("delay" in config && config.delay > 0) {
        delay = config.delay * 60;
      }
      if (fs.existsSync(config.queryfile)) {
        let delay, timeTo, TimeRange;
        let timeFrom = 0;
        if ("time" in config.query && "interval" in config.query.time) {
          delay = opt_delay && opt_delay > 0 ? opt_delay * 60 : 0;
          delay =
            delay == 0 &&
            "delay" in config.query.time &&
            config.query.time.delay > 0
              ? config.query.time.delay * 60
              : 0;
          timeTo = Math.round(Date.now() / 1000 - delay);
          timeFrom = Math.round(timeTo - config.query.time.interval * 60);
          TimeRange = { _from: timeFrom, _to: timeTo };
        }
        const strDsl = fs.readFileSync(config.query.file, "utf8");
        const replace =
          "vars" in config.query && isObject(config.query.vars)
            ? { ...config.query.vars, ...TimeRange }
            : TimeRange;
        await DslQuery(config, replace, client, strDsl, timeFrom);
      } else {
        throw "query DSL file not exists: " + config.query.file;
      }
    } else {
      throw "config file not exists: " + confFile;
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
/*
 STAR PROGRAM
 */
if ("config" in argv) {
  main(argv.config, argv.delay).catch((e) => {
    console.error(e);
  });
} else {
  console.error("Not ARG --config with config file path");
}
