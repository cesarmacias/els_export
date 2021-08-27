/* eslint-disable no-mixed-spaces-and-tabs */
"use strict";

const { Client } = require("es7");
const fs = require("fs");
const argv = require("minimist")(process.argv.slice(2));
/*
    FUNCTION GET VALUE FROM OBJECT USING DOT STRING FROMAT
*/
function dotObject(obj, is, value) {
	if (typeof is == "string") return dotObject(obj, is.split("."), value); 
	else if (is.length == 1 && value !== undefined) return (obj[is[0]] = value);
	else if (is.length == 0) return obj;
	else if (is[0] in obj) return dotObject(obj[is[0]], is.slice(1), value);
	else return "";
}
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

		for (i = 0; i < l; i += 1) {
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
		if (isObject(objReplace)) {
			for (const key in objReplace) {
				dsl =
          typeof key == "string" ?
          	dsl.replace("%{" + key + "}", objReplace[key]) :
          	dsl.replace("\"%{" + key + "}\"", objReplace[key]);
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
          isObject(body.aggregations) &&
          config.query.aggs in body.aggregations
				) {
					let obj = body.aggregations[config.query.aggs];
					array = "buckets" in obj ? obj.buckets : [];
					let after = "after_key" in obj ? obj.after_key : false;
					if (isObject(after)) {
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
				if (isObject(item)) {
					let resp = {};
					if ("_source" in item && "_index" && item) {
						resp = item["_source"];
					} else {
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
							} else if ("doc_count" in item[key] && Object.keys(item[key]).length > 1) {
								resp[key] = {};
								for (let k in item[key]) {
									if(isObject(item[key][k]) && "value" in item[key][k]) {
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
					let data =
            config.export.attr && Object.keys(config.export.attr).length > 0 ?
            	{ ...Object.expand(resp), ...Object.expand(config.export.attr) } :
            	Object.expand(resp);
					if (
						"format" in config.export &&
            config.export.format == "csv" &&
            "schema" in config.export &&
            config.export.schema.length > 0
					) {
						let csv;
						config.export.schema.forEach((key, i) => {
							csv =
                i == 0 ?
                	dotObject(data, key) :
                	csv + "," + dotObject(data, key);
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
			if (fs.existsSync(config.query.file)) {
				const strDsl = fs.readFileSync(config.query.file, "utf8");
				let delay, timeFrom;
				let maxIte = 1;
				let TimeRange = {};
				let timeTo = 0;
				if ("time" in config.query && isObject(config.query.time)) {
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
						timeTo = timeFrom + 24 * 60 * 60;
					} else if (
						"dateFrom" in config.query.time &&
            config.query.time.dateFrom.split("-").length == 3 &&
            "toDays" in config.query.time &&
            config.query.time.toDays > 0
					) {
						maxIte = config.query.time.toDays;
						let arrDate = config.query.time.dateFrom.split("-");
						timeFrom = new Date(+arrDate[0], +arrDate[1] - 1, +arrDate[2]).getTime() / 1000;
						timeTo = timeFrom + 24 * 60 * 60;
					} else if ("interval" in config.query.time && config.query.time.interval > 0) {
						delay = opt_delay && opt_delay > 0 ? opt_delay * 60 : 0;
						delay =
              delay == 0 &&
              "delay" in config.query.time &&
              config.query.time.delay > 0 ?
              	config.query.time.delay * 60 :
              	delay;
						timeTo = Math.round(Date.now() / 1000 - delay);
						timeFrom = Math.round(timeTo - config.query.time.interval * 60);
					} else {
						throw "Not correct config for timeRange";
					}
					TimeRange = { _from: timeFrom, _to: timeTo };
				}
				for (let i = 0; i < maxIte; i++) {
					const replace =
            "vars" in config.query && isObject(config.query.vars) ?
            	{ ...config.query.vars, ...TimeRange } :
            	TimeRange;
					await DslQuery(config, replace, client, strDsl, timeFrom);
					timeFrom = timeTo;
					timeTo = timeFrom + 24 * 60 * 60;
					TimeRange = { _from: timeFrom, _to: timeTo };
				}
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
