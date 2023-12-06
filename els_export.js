#!/usr/bin/env node
/* eslint-disable no-mixed-spaces-and-tabs */
"use strict";

const { Client } = require("@elastic/elasticsearch");
const fs = require("fs");
const argv = require("minimist")(process.argv.slice(2));
const _ = require("lodash");
const func = require("./tools.js");

/*
    FUNCTION MAKE THE SEARCH QUERY AGGREGATION AND INSERT OR PRINT THE RESPONSE IN EVENT FORMAT
 */
async function DslQuery(config, objReplace, esClient, strDsl, timeFrom) {
  try {
    let dsl = strDsl;

    if (typeof objReplace === "object" && objReplace !== null) {
      for (const key in objReplace) {
        const replaceKey = `%{${key}}`;
        dsl = dsl.split(replaceKey).join(objReplace[key]);
      }
    }

    const query = JSON.parse(dsl);
    const search = {
      index: config.query.index,
      body: query,
    };

    while (true) {
      const { body } = await esClient.search(search);
      let array = [];

      if (config.query.type === "composite") {
        const aggs = body.aggregations;
        if (aggs && typeof aggs === "object" && config.query.aggs in aggs) {
          const obj = aggs[config.query.aggs];
          array = obj.buckets || [];
          const after = obj.after_key || false;

          if (typeof after === "object" && after !== null) {
            search.body.aggs[config.query.aggs].composite.after = after;
          } else {
            break;
          }
        } else {
          break;
        }
      } else if (config.query.type === "search") {
        const hits = body.hits.hits;

        if (hits.length > 0) {
          array = hits;
          const last = array[array.length - 1];

          if (last.sort && Array.isArray(last.sort)) {
            search.body.search_after = last.sort;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      for await (const item of array) {
        if (typeof item === "object" && item !== null) {
          let resp = {};
          if ("_source" in item && "_index" in item) {
            resp = item["_source"];
          } else {
            for (const key in item) {
              if (
                key === "key" &&
                typeof item.key === "object" &&
                item.key !== null
              ) {
                Object.assign(resp, item.key);
              } else if (key === "doc_count") {
                resp.count = item[key];
              } else if (key === config.query.exclude) {
                continue;
              } else if ("value" in item[key]) {
                resp[key] =
                  item[key].value != null ? item[key].value : undefined;
              } else if ("buckets" in item[key]) {
                const bucketArray = item[key]["buckets"];
                if (Array.isArray(bucketArray)) {
                  if (bucketArray.length === 1) {
                    resp[key] = bucketArray[0]["doc_count"];
                  } else if (bucketArray.length > 1) {
                    resp[key] = {};
                    for (const ob of bucketArray) {
                      if (
                        typeof ob === "object" &&
                        ob !== null &&
                        "doc_count" in ob &&
                        "key" in ob
                      ) {
                        resp[key][ob.key] = ob.doc_count;
                      }
                    }
                  }
                } else {
                  resp[key] = {};
                  const ob = item[key]["buckets"];
                  for (const o in ob) {
                    if (
                      typeof ob[o] === "object" &&
                      ob[o] !== null &&
                      "doc_count" in ob[o]
                    ) {
                      resp[key][o] = { count: ob[o].doc_count };
                      for (const k in ob[o]) {
                        if (
                          typeof ob[o][k] === "object" &&
                          ob[o][k] !== null &&
                          "value" in ob[o][k]
                        ) {
                          resp[key][o][k] = ob[o][k].value;
                        }
                      }
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
                for (const k in item[key]) {
                  if (
                    typeof item[key][k] === "object" &&
                    item[key][k] !== null &&
                    "value" in item[key][k]
                  ) {
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

          const data = _.merge(
            func.ObjExpand(resp),
            func.ObjExpand(config.export.attr) || {}
          );

          if (
            "format" in config.export &&
            config.export.format === "csv" &&
            "schema" in config.export &&
            config.export.schema.length > 0
          ) {
            const delimiter = config.export.delimiter || ",";
            let csv = "";
            config.export.schema.forEach((key, i) => {
              csv += (i === 0 ? "" : delimiter) + func.dotObject(data, key);
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
    } else {
      console.error(e);
    }
  }
}

/*
    FUNCTION TO RED CONFIG FILE - PREPARE THE LOOP FOR SEARCH
 */
async function main(confFile, opt_delay) {
  try {
    const config = await func.ReadConfig(confFile);

    // Configuración de conexión a Elastic Cloud o Local
    let clientOptions = {};
    if (config.elastic.cloudId) {
      clientOptions.cloud = {
        id: config.elastic.cloudId,
      };
    } else {
      clientOptions.node = config.elastic.nodes;
    }
    clientOptions.auth = {
      username: config.elastic.username,
      password: config.elastic.password,
    };
    clientOptions.maxRetries = config.elastic.maxRetries;
    clientOptions.requestTimeout = config.elastic.requestTimeout;

    const client = new Client(clientOptions);

    if (!fs.existsSync(config.query.file)) {
      throw new func.CustomError(
        "ERROR_CONFIG",
        "query DSL file not exists: " + config.query.file
      );
    }

    const strDsl = fs.readFileSync(config.query.file, "utf8");
    let delay = 0;
    let timeFrom = 0;
    let timeTo = 0;
    let delta = 24 * 60 * 60;
    let maxIte = 1;
    let part = 0;
    let TimeRange = {};

    if (config.query.time && config.query.time.constructor === Object) {
      if (config.query.time.lastDay) {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 1);
        timeFrom = Math.floor(dateFrom.getTime() / 1000);
        timeTo = timeFrom + delta;
      } else if (
        config.query.time.dateFrom &&
        config.query.time.dateFrom.split("-").length === 3 &&
        config.query.time.toDays > 0
      ) {
        maxIte = config.query.time.toDays;
        const arrDate = config.query.time.dateFrom.split("-");
        timeFrom = Math.floor(
          new Date(+arrDate[0], +arrDate[1] - 1, +arrDate[2]).getTime() / 1000
        );
        if (config.query.time.interval > 0) {
          part = (24 * 60) / config.query.time.interval;
          maxIte *= part;
          delta = config.query.time.interval * 60;
        }
        timeTo = timeFrom + delta;
      } else if (config.query.time.interval > 0) {
        delay = opt_delay && opt_delay > 0 ? opt_delay * 60 : 0;
        delay =
          delay === 0 && config.query.time.delay > 0
            ? config.query.time.delay * 60
            : delay;
        timeTo = Math.round(Date.now() / 1000 - delay);
        timeFrom = timeTo - config.query.time.interval * 60;
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
        config.query.vars && config.query.vars.constructor === Object
          ? { ...config.query.vars, ...TimeRange }
          : TimeRange;
      await DslQuery(config, replace, client, strDsl, timeFrom);
      timeFrom = timeTo;
      timeTo = timeFrom + delta;
      TimeRange = { _from: timeFrom, _to: timeTo };
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
