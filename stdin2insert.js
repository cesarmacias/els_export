/*jslint node: true */
"use strict";

const readline = require("readline");
const args = require("minimist")(process.argv.slice(2));
const fs = require("fs");
const throat = require("throat");
const { Client } = require("es7");

/*
    Function run - main program
*/
async function run(confFile) {
  try {
    if (fs.existsSync(confFile)) {
      const strConf = fs.readFileSync(confFile, "utf8");
      const config = JSON.parse(strConf);
      const ConLimit =
        "conLimit" in config.elastic ? config.elastic.conLimit : 50;
      const client = new Client({
        nodes: config.elastic.nodes,
        auth: {
          username: config.elastic.username,
          password: config.elastic.password,
        },
        maxRetries: config.elastic.maxRetries,
        requestTimeout: config.elastic.requestTimeout,
      });
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      let bulkBody = [];
      let cnt = 0;
      rl.on("line", async (line) => {
        cnt++;
        const obj = JSON.parse(line);
        bulkBody.push({ index: { _index: config.elastic.index } }, obj);
        if (cnt == config.elastic.bulkSize) {
          throat(ConLimit, async () => {
            const { body: bulkResponse } = await client.bulk({
              index: config.elastic.index,
              body: bulkBody,
            });
            if (bulkResponse.errors) {
              const erroredDocuments = [];
              bulkResponse.items.forEach((action, i) => {
                const operation = Object.keys(action)[0];
                if (action[operation].error) {
                  erroredDocuments.push({
                    status: action[operation].status,
                    error: action[operation].error,
                    operation: body[i * 2],
                    document: body[i * 2 + 1],
                  });
                }
              });
              console.error(erroredDocuments);
            }
          });
          cnt = 0;
          bulkBody = [];
        }
      });
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
    Start Program
*/
if ("config" in args) {
  run(args.config);
}