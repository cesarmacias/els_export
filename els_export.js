#!/usr/bin/env node
/* eslint-disable no-mixed-spaces-and-tabs */
"use strict";

const { Client } = require("es7");
const fs = require("fs");
const argv = require("minimist")(process.argv.slice(2));
const merge = require("deepmerge");
const func = require("./tools.js");

/*
    FUNCTION MAKE THE SEARCH QUERY AGGREGATION AND INSERT OR PRINT THE RESPONSE IN EVENT FORMAT
 */
async function DslQuery(config, objReplace, esClient, strDsl, timeFrom) {
  try {
    let dsl = strDsl;
    if (func.isObject(objReplace)) {
      for (const key in objReplace) {
        dsl =
          typeof key == "string"
            ? dsl.replace("%{" + key + "}", objReplace[key])
            : dsl.replace('"%{' + key + '}"', objReplace[key]);
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
      let array = [];
      if (config.query.type === "composite") {
        if (
          "aggregations" in body &&
          func.isObject(body.aggregations) &&
          config.query.aggs in body.aggregations
        ) {
          let obj = body.aggregations[config.query.aggs];
          array = "buckets" in obj ? obj.buckets : [];
          let after = "after_key" in obj ? obj.after_key : false;
          if (func.isObject(after)) {
            search.body["aggs"][config.query.aggs].composite.after = after;
          } else {
            flag = false;
          }
        } else {
          flag = false;
        }
      } else if (config.query.type === "search") {
        if (
          "hits" in body &&
          "hits" in body.hits &&
          body.hits.hits.length > 0
        ) {
          array = body.hits.hits;
          let last = array[array.length - 1];
          if ("sort" in last && Array.isArray(last.sort)) {
            search.body.search_after = last.sort;
          } else {
            flag = false;
          }
        } else {
          flag = false;
        }
      }
      for await (const item of array) {
        if (func.isObject(item)) {
          let resp = {};
          if ("_source" in item && "_index" && item) {
            resp = item["_source"];
          } else {
            for (let key in item) {
              if (key === "key" && func.isObject(item.key)) {
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
                let array = item[key]["buckets"];
                if (array.length == 1) {
                  resp[key] = array[0]["doc_count"];
                } else if (array.length > 1) {
                  resp[key] = {};
                  for (let ob of array) {
                    if (func.isObject(ob) && "doc_count" in ob && "key" in ob) {
                      resp[key][ob.key] = ob.doc_count;
                    }
                  }
                }
              } else if ("values" in item[key]) {
                resp[key] = item[key].values;
              } else if (
                "doc_count" in item[key] &&
                Object.keys(item[key]).length > 1
              ) {
                resp[key] = {};
                for (let k in item[key]) {
                  if (func.isObject(item[key][k]) && "value" in item[key][k]) {
                    resp[key][k] = item[key][k].value;
                  } else {
                    resp[key][k] = item[key][k];
                  }
                }
              } else if ("doc_count" in item[key]) {
                resp[key] = item[key]["doc_count"];
              } else {
                resp[key] = item[key];
              }
            }
          }
          if (
            "addTime" in config.export &&
            config.export.addTime &&
            timeFrom > 0
          ) {
            resp.time = timeFrom;
          }
          let data = merge(
            func.ObjExpand(resp),
            func.ObjExpand(config.export.attr) || {}
          );
          if (
            "format" in config.export &&
            config.export.format == "csv" &&
            "schema" in config.export &&
            config.export.schema.length > 0
          ) {
            let delimiter = config.export.delimiter || ",";
            let csv;
            config.export.schema.forEach((key, i) => {
              csv =
                i == 0
                  ? func.dotObject(data, key)
                  : csv + delimiter + func.dotObject(data, key);
            });
            console.log(csv);
          } else {
            console.log(JSON.stringify(data));
          }
        }
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
    const config = await func.ReadConfig(confFile);
    const client = new Client({
      nodes: config.elastic.nodes,
      auth: {
        username: config.elastic.username,
        password: config.elastic.password,
      },
      maxRetries: config.elastic.maxRetries,
      requestTimeout: config.elastic.requestTimeout,
    });
    if (fs.existsSync(config.query.file)) {
      const strDsl = fs.readFileSync(config.query.file, "utf8");
      let delay, timeFrom;
      let maxIte = 1;
      let part = 0;
      let delta = 24 * 60 * 60;
      let TimeRange = {};
      let timeTo = 0;
      if ("time" in config.query && func.isObject(config.query.time)) {
        if ("lastDay" in config.query.time && config.query.time.lastDay) {
          let dateFrom = ((d) => new Date(d.setDate(d.getDate() - 1)))(
            new Date()
          );
          timeFrom =
            new Date(
              dateFrom.getFullYear(),
              dateFrom.getMonth(),
              dateFrom.getDate()
            ).getTime() / 1000;
          timeTo = timeFrom + delta;
        } else if (
          "dateFrom" in config.query.time &&
          config.query.time.dateFrom.split("-").length == 3 &&
          "toDays" in config.query.time &&
          config.query.time.toDays > 0
        ) {
          maxIte = config.query.time.toDays;
          let arrDate = config.query.time.dateFrom.split("-");
          timeFrom =
            new Date(+arrDate[0], +arrDate[1] - 1, +arrDate[2]).getTime() /
            1000;
          if (
            "interval" in config.query.time &&
            config.query.time.interval > 0
          ) {
            part = (24 * 60) / config.query.time.interval;
            maxIte = maxIte * part;
            delta = config.query.time.interval * 60;
          }
          timeTo = timeFrom + delta;
        } else if (
          "interval" in config.query.time &&
          config.query.time.interval > 0
        ) {
          delay = opt_delay && opt_delay > 0 ? opt_delay * 60 : 0;
          delay =
            delay == 0 &&
            "delay" in config.query.time &&
            config.query.time.delay > 0
              ? config.query.time.delay * 60
              : delay;
          timeTo = Math.round(Date.now() / 1000 - delay);
          timeFrom = Math.round(timeTo - config.query.time.interval * 60);
        } else {
          throw new func.CustomError(
            "ERROR_CONFIG",
            "Not correct config for timeRange"
          );
        }
        TimeRange = { _from: timeFrom, _to: timeTo };
      }
      for (let i = 0; i < maxIte; i++) {
        const replace =
          "vars" in config.query && func.isObject(config.query.vars)
            ? { ...config.query.vars, ...TimeRange }
            : TimeRange;
        await DslQuery(config, replace, client, strDsl, timeFrom);
        timeFrom = timeTo;
        timeTo = timeFrom + delta;
        TimeRange = { _from: timeFrom, _to: timeTo };
      }
    } else {
      throw new func.CustomError(
        "ERROR_CONFIG",
        "query DSL file not exists: " + config.query.file
      );
    }
  } catch (error) {
    console.error(error.name, error.message);
  } finally {
    process.exit(0);
  }
}
/*
 STAR PROGRAM
 */
if ("config" in argv) {
  main(argv.config, argv.delay);
} else {
  console.error("ERROR_CONFIG", "Not ARG --config with config file path");
}
