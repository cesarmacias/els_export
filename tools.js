"use strict";
const fs = require("fs");

class CustomError extends Error {
	constructor(ErrorName, ...params) {
		super(...params);
		Error.captureStackTrace(this, CustomError);
		this.name = ErrorName;
	}
}

function dotObject(obj, is, value) {
	if (typeof is === "string") {
		return dotObject(obj, is.split("."), value);
	} else if (is.length === 1 && value !== undefined) {
		obj[is[0]] = value;
		return obj;
	} else if (is.length === 0) {
		return obj;
	} else if (is[0] in obj) {
		return dotObject(obj[is[0]], is.slice(1), value);
	} else {
		return obj;
	}
}

function parseDotNotation(str, val, obj) {
	const keys = str.split(".");
	let currentObj = obj;
	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i];
		currentObj[key] = currentObj[key] || {};
		currentObj = currentObj[key];
	}
	currentObj[keys[keys.length - 1]] = val;
	delete obj[str];
}

function ObjExpand(obj) {
	for (const key in obj) {
		if (key.includes(".")) {
			parseDotNotation(key, obj[key], obj);
		}
	}
	return obj;
}

async function ReadConfig(file) {
	if (!fs.existsSync(file)) {
		throw new CustomError("ERROR_FILE", "File not exists");
	}

	try {
		const strConf = fs.readFileSync(file, "utf8");
		const config = JSON.parse(strConf);

		if ("env" in config && Array.isArray(config.env)) {
			for (const str of config.env) {
				const val_env = dotObject(config, str);
				const value = process.env[val_env];
				if (value) {
					dotObject(config, str, value);
				}
			}
		}

		return config;
	} catch (e) {
		throw new CustomError("ERROR_READ", e.message);
	}
}

module.exports = {
	ObjExpand,
	dotObject,
	CustomError,
	ReadConfig,
};
