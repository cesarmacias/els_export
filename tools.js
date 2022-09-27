/* eslint-disable no-mixed-spaces-and-tabs */
"use strict";
const fs = require("fs");

/*
    Custom Error Message
 */
class CustomError extends Error {
	constructor(ErrorName, ...params) {
		// Pasa los argumentos restantes (incluidos los específicos del proveedor) al constructor padre
		super(...params);
		// Mantiene un seguimiento adecuado de la pila para el lugar donde se lanzó nuestro error (solo disponible en V8)
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, CustomError);
		}
		this.name = ErrorName;
	}
}
/*
    FUNCTION GET OR SET VALUE FROM OBJECT USING DOT STRING FROMAT
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
function ObjExpand(obj) {
	for (const key in obj) {
		if (key.indexOf(".") !== -1) {
			parseDotNotation(key, obj[key], obj);
		}
	}
	return obj;
}
/*
    FUNCTION VALIDATE IF VAR IS OBJECT
 */
const isObject = function (a) {
	return !!a && a.constructor === Object;
};
/*
	FUNCTION READ CONFIG FILE AND PARSE ENV VARIABLES
*/
async function ReadConfig(file) {
	let config;
	if (fs.existsSync(file)) {
	  try {
		const strConf = fs.readFileSync(file, "utf8");
		config = JSON.parse(strConf);
	  } catch (e) {
		//console.log(e);
		throw new CustomError("ERROR_READ",e.message);
	  }
	  if ("env" in config && Array.isArray(config.env)) {
		for (let str of config.env) {
		  let val_env, value;
		  val_env = dotObject(config, str);
		  if (val_env) {
			value = process.env[val_env];
			if (value) dotObject(config, str, value);
		  }
		}
	  }
	  return config;
	} else {
	  throw new CustomError("ERROR_FILE","File not exists");
	}
  }

/*
Funciones a Exportar
 */
module.exports = {
	isObject,
	ObjExpand,
	dotObject,
	CustomError,
	ReadConfig
};