import { kebabCase } from "lodash";
import { join } from "path";
import { nonEmpty } from "./helpers/misc";
import JSParser from "./parsers/JSParser";

import * as definedAnnotations from "./annotations";
import { readFileSync } from "fs";

const beautify = require("beautify");

/**
 * Build a Polymer property config
 *
 * @param name
 * @param config
 *
 * @returns String representation of property config object
 */
export function buildProperty([ name, config ]: [ string, PolymerPropertyConfig ]): string {
  let valueMap = "Boolean|Date|Number|String|Array|Object";

  return `${name}:{${
    Object
      .keys(config)
      .filter(key => !!config[ key ])
      .map(key => {
        let value = config[ key ];
        if (key === "type" && valueMap.indexOf(config[ key ]) === -1) {
          value = "Object";
        }
        return `${key}:${value}`;
      })
      .join(",")
    }}`;
}

export function buildPropertiesMap(properties: FieldConfigMap,
                                   methods: FieldConfigMap,
                                   isES6: boolean = false): Map<string, PolymerPropertyConfig> {
  let propertiesMap: Map<string, PolymerPropertyConfig> = new Map();
  properties.forEach((config, propName) => {
    if (config.static || config.private) {
      return;
    }

    let prop: PolymerPropertyConfig = {
      type: config.type
    };

    if (config.value) {
      if (config.isPrimitive) {
        prop.value = config.value;
      }
      else {
        prop.value = isES6 ? `() => ${config.value}` : `function() { return ${config.value}; }`;
      }
    }
    if (config.readonly) {
      prop.readOnly = config.readonly;
    }
    if (config.annotations) {
      config.annotations.forEach(({ name, params }) => {
        definedAnnotations[ name ]({ properties, methods, config, prop, params });
      });
    }

    propertiesMap.set(propName, prop);
  });
  return propertiesMap;
}

export function buildMethodsMap(methods: FieldConfigMap,
                                properties: FieldConfigMap,
                                propertiesMap: Map<string, PolymerPropertyConfig>,
                                observers: Array<string>): FieldConfigMap {
  let methodsMap: FieldConfigMap = new Map();
  methods.forEach((config, methodName) => {
    let method = Object.assign({}, config);
    if (config.annotations) {
      config.annotations.forEach(({ name, params }) => {
        definedAnnotations[ name ]({ properties, methods, config, method, propertiesMap, observers, params });
      });
    }

    methodsMap.set(methodName, method);
  });
  return methodsMap;
}

export default class Module extends JSParser {
  base: string;

  constructor(base: string, dts: string, js: string, options?: JSParserOptions) {
    super(dts, js, options);
    this.base = base;
  }

  /**
   * Generate a Polymer v1 component declaration
   *
   * @returns String representation of polymer component declaration
   */
  buildPolymerV1(): {
    methodsMap: FieldConfigMap;
    propertiesMap: Map<string, PolymerPropertyConfig>;
    extrasMap: Map<string, any>;
    moduleSrc: string;
  } {
    let observers: Array<string> = [];
    let behaviors: Array<string> = [];
    let styles: Array<{ type: "link"|"shared"|"inline", style: string }> = [];

    let { annotations, methods, properties } = this;

    let propertiesMap = buildPropertiesMap(properties, methods, this.isES6);
    let methodsMap = buildMethodsMap(methods, properties, propertiesMap, observers);

    let extrasMap = new Map<string, any>();

    annotations.forEach(({ name, params }) => {
      let annotation = definedAnnotations[ name ]({ propertiesMap, methodsMap, params, styles, behaviors });
      if (annotation !== undefined) {
        extrasMap.set(name, annotation);
      }
    });

    extrasMap.set("styles", styles);

    const v1ToV0Lifecycles = {
      constructor: "created",
      connectedCallback: "attached",
      disconnectedCallback: "detached",
      attributeChangedCallback: "attributeChanged"
    };

    let helperName = this.helperClassName ? ` = ${this.helperClassName}` : "";

    const filterEmpty = chunk => !!chunk;

    return {
      methodsMap,
      propertiesMap,
      extrasMap,
      moduleSrc: [
        `${this.isES6 ? "const" : "var"} ${this.className}${helperName} = Polymer({`,
        [
          `is:"${kebabCase(this.className)}"`,
          nonEmpty`properties:{${Array.from(propertiesMap).map(buildProperty)}}`,
          nonEmpty`observers:[${observers}]`,
          nonEmpty`behaviors:[${behaviors}]`,
          ...Array.from(methodsMap.values()).filter(config => !config.static).map(({ name, body }) => {
            if (name === "constructor") {
              body = body
                .replace(/(?:\n[\s]*)?super\(.*?\);/, "")
                .replace(/var _this = _super\.call\(this(?:.*?)\) \|\| this;/, "var _this = this;");
            }
            return `${v1ToV0Lifecycles[ name ] || name}:function${body}`;
          })
        ].filter(filterEmpty).join(","),
        `});`,
        ...Array.from(methodsMap.values()).filter(config => config.static).map(({ name, body }) => {
          return `${this.className}.${v1ToV0Lifecycles[ name ] || name} = function${body};`;
        })
      ].filter(filterEmpty).join("\n")
    };
  }

  toString(polymerVersion = 1) {
    let methodsMap: FieldConfigMap;
    let propertiesMap: Map<string, PolymerPropertyConfig>;
    let extrasMap: Map<string, any>;
    let moduleSrc: string;

    if (polymerVersion === 1) {
      // noinspection JSUnusedAssignment
      ({ extrasMap, methodsMap, propertiesMap, moduleSrc } = this.buildPolymerV1());
    }
    else if (polymerVersion === 2) {
      throw "Polymer 2 output is not yet implemented. For more info see https://github.com/Draccoz/twc/issues/16";
    }

    let styles = extrasMap.get("styles");
    let tpl = (({ template, type } = {}) => {
      switch (type) {
        case "link":
          return readFileSync(join(this.base, template)).toString();
        case "inline":
          return template;
        default:
          return "";
      }
    })(extrasMap.get("template"));

    return beautify([
      ...this.links.map(module => `<link rel="import" href="${module}">`),
      ...this.scripts.map(module => `<script src="${module}"></script>`),
      `<dom-module id="${kebabCase(this.className)}">${[
        nonEmpty`<template>${[
          ...styles.map(({ style, type }) => {
            switch (type) {
              case "link":
                return `<style\>${readFileSync(join(this.base, style))}</style>`;
              case "inline":
                if (!this.isES6) {
                  style = style.replace(/\\n/g, "\n").replace(/\\"/g, '"');
                }
                return `<style\>${style}</style>`;
              case "shared":
                return `<style include="${style}"></style>`;
            }
          }),
          this.isES6 ? tpl : tpl.replace(/\\n/g, "\n").replace(/\\"/g, '"')
        ].join("\n")}</template>`,
        `<script\>${beautify([
          "(function () {",
          this.jsSrc.slice(0, this.classBodyPosition.start),
          moduleSrc,
          this.jsSrc.slice(this.classBodyPosition.end + 1),
          "}());"
        ].join("\n"), { format: "js" })}</script>`
      ].join("\n")}</dom-module>`
    ].join("\n"), { format: "html" });
  }

  toBuffer(polymerVersion = 1) {
    return new Buffer(this.toString(polymerVersion));
  }
}
