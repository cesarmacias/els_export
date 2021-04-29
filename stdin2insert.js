/*jslint node: true */
"use strict";

const args = require("minimist")(process.argv.slice(2));
const fs = require("fs");
const { Client } = require("es7");
const split = require("split2");

async function run(confFile) {
  try {
    if (fs.existsSync(confFile)) {
      const strConf = fs.readFileSync(confFile, "utf8");
      const config = JSON.parse(strConf);
      if (
        "type" in config &&
        typeof config.type === "string" &&
        config.type in config &&
        typeof config[config.type] === "object"
      ) {
        if (config.type == "elastic") {
          const ConLimit =
            "conLimit" in config.elastic ? config.elastic.conLimit : undefined;
          const pipeline =
            "pipeline" in config.elastic &&
            typeof config.elastic.pipeline == "string"
              ? config.elastic.pipeline
              : undefined;
          const blukSize =
            "bulkSize" in config.elastic ? config.elastic.blukSize : undefined;
          const strdate = new Date().toLocaleString(undefined, {
            hour12: false,
          });
          const client = new Client({
            nodes: config.elastic.nodes,
            auth: {
              username: config.elastic.username,
              password: config.elastic.password,
            },
            maxRetries: config.elastic.maxRetries,
          });
          client.helpers.bulk({
            datasource: process.stdin.pipe(split()),
            onDocument(doc) {
              return {
                index: { _index: config.elastic.index },
              };
            },
            onDrop(doc) {
              let error = {
                type: doc.error.type,
                reason: doc.error.reason,
                operation: doc.operation,
                date: strdate,
                doc: doc.document,
              };
              console.error(JSON.stringify(error));
            },
            flushBytes: blukSize,
            concurrency: ConLimit,
            pipeline: pipeline,
          });
        }
      } else {
        throw "type in config is not defined";
      }
    } else {
      throw "config file not exists: " + confFile;
    }
  } catch (e) {
    console.error(e);
  }
}
/*
    Start Program
*/
if ("config" in args) {
  run(args.config);
}