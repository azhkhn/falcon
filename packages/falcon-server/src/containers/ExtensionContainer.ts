/* eslint-disable no-restricted-syntax, no-await-in-loop, no-underscore-dangle */
import Logger from '@deity/falcon-logger';
import {
  ApolloServerConfig,
  ApiDataSource,
  DataSources,
  Events,
  ExtensionInitializer,
  GraphQLContext,
  GraphQLResolver,
  GraphQLResolverMap,
  RemoteBackendConfig
} from '@deity/falcon-server-env';
import { GraphQLResolveInfo } from 'graphql';
import { mergeSchemas, makeExecutableSchema } from 'graphql-tools';
import deepMerge from 'deepmerge';
import path from 'path';
import fs from 'fs';
import { BaseContainer } from './BaseContainer';
import { getRootTypeFields } from '../graphqlUtils/schema';
import { BackendConfig, ExtensionGraphQLConfig, ExtensionEntryMap } from '../types';

export type GraphQLConfigDefaults = {
  schemas?: Array<string>;
  contextModifiers?: ApolloServerConfig['context'][];
  resolvers?: Array<GraphQLResolverMap>;
} & Partial<ApolloServerConfig>;

/**
 * Holds extensions and expose running hooks for for them.
 */
export class ExtensionContainer<T extends GraphQLContext = GraphQLContext> extends BaseContainer {
  public schemaFileName: string = 'schema.graphql';

  protected entries: Map<string, ExtensionGraphQLConfig> = new Map();

  /**
   * Instantiates extensions based on passed configuration and registers event handlers for them
   * @param extensions Key-value list of extension configurations
   */
  async registerExtensions(extensions: ExtensionEntryMap): Promise<void> {
    for (const extKey in extensions) {
      if (Object.prototype.hasOwnProperty.call(extensions, extKey)) {
        let extGqlConfig: ExtensionGraphQLConfig = {};
        const extension = extensions[extKey];
        const { config: extensionConfig = {} } = extension;

        const ExtensionInstanceFn = this.importModule<ExtensionInitializer>(extension.package);
        if (ExtensionInstanceFn) {
          extGqlConfig = deepMerge(extGqlConfig, ExtensionInstanceFn(extensionConfig) || {});
        }

        const schemaContent = this.importExtensionGraphQLSchema(extension.package);
        if (schemaContent) {
          extGqlConfig = deepMerge(extGqlConfig, this.getExtensionGraphQLConfig(schemaContent, extensionConfig.api));
        } else {
          Logger.warn(`"${extKey}" ("${extension.package}") extension does not contain ${this.schemaFileName} file.`);
        }

        Logger.debug(`${this.constructor.name}: "${extKey}" added to the list of extensions`);
        this.entries.set(extKey, extGqlConfig);

        await this.eventEmitter.emitAsync(Events.EXTENSION_REGISTERED, {
          name: extKey,
          instance: extGqlConfig
        });
      }
    }
  }

  /**
   * Initializes each registered extension (in sequence)
   * @returns Merged config
   */
  fetchBackendConfig: GraphQLResolver<BackendConfig, null, null, T> = async (obj, args, context, info) => {
    const configs: Array<RemoteBackendConfig> = [];

    // initialization of extensions cannot be done in parallel because of race condition
    for (const [apiName, api] of Object.entries(context.dataSources)) {
      if (typeof api.fetchBackendConfig !== 'function') {
        // Processing only supported APIs
        return;
      }
      Logger.debug(`Fetching "${apiName}" API backend config`);
      const apiConfig = await api.fetchBackendConfig(obj, args, context, info);
      if (apiConfig) {
        configs.push(apiConfig);
      }
    }

    return this.mergeBackendConfigs(configs);
  };

  /**
   * Merges backend configs
   * @param configs List of API config
   * @returns Merged config
   */
  mergeBackendConfigs(configs: Array<RemoteBackendConfig>): BackendConfig {
    return configs.reduce((prev, current) => {
      if (!current) {
        return prev;
      }

      const { locales: prevLocales } = prev;
      const { locales: currLocales } = current;

      const isPrevLocalesArr = Array.isArray(prevLocales);
      const isCurrLocalesArr = Array.isArray(currLocales);

      let mergedLocales: string[];

      // Merging "locales" values (leaving only those that exist on every API)
      if (isCurrLocalesArr && isPrevLocalesArr) {
        mergedLocales = currLocales.filter(loc => prevLocales.indexOf(loc) >= 0);
      } else {
        mergedLocales = isCurrLocalesArr && !isPrevLocalesArr ? currLocales : prevLocales;
      }

      return {
        locales: mergedLocales
      };
    }, {}) as BackendConfig;
  }

  /**
   * Creates a complete configuration for ApolloServer
   * @param defaultConfig default configuration that should be used
   * @returns resolved configuration
   */
  createGraphQLConfig(defaultConfig: GraphQLConfigDefaults = {}): ApolloServerConfig {
    const config = Object.assign(
      {
        schemas: [],
        // contextModifiers will be used as helpers - it will gather all the context functions and we'll invoke
        // all of them when context will be created. All the results will be merged to produce final context
        contextModifiers: defaultConfig.context ? [defaultConfig.context] : []
      },
      defaultConfig,
      {
        resolvers: defaultConfig.resolvers && !Array.isArray(defaultConfig.resolvers) ? [defaultConfig.resolvers] : []
      }
    );

    for (const [extName, extConfig] of this.entries) {
      this.mergeGraphQLConfig(config, extConfig, extName);
    }

    // define context handler that invokes all context handlers delivered by extensions
    const { contextModifiers } = config;
    config.context = (arg: any) => {
      let ctx = {};
      contextModifiers.forEach(modifier => {
        ctx = Object.assign(ctx, typeof modifier === 'function' ? modifier(arg, ctx) : modifier);
      });
      return ctx;
    };

    config.schema = mergeSchemas({
      schemas: [
        makeExecutableSchema({
          typeDefs: config.schemas,
          resolvers: config.resolvers
        })
      ],
      schemaDirectives: config.schemaDirectives,
      resolvers: config.resolvers
    });

    // remove processed fields
    delete config.contextModifiers;
    delete config.resolvers;
    delete config.schemas;

    return config;
  }

  protected mergeGraphQLConfig(dest: GraphQLConfigDefaults, source: ExtensionGraphQLConfig, extensionName: string) {
    Logger.debug(`${this.constructor.name}: merging "${extensionName}" extension GraphQL config`);

    Object.keys(source).forEach(name => {
      if (!name || typeof source[name] === 'undefined') {
        return;
      }
      const value = source[name];
      const valueArray = Array.isArray(value) ? value : [value];

      switch (name) {
        case 'schema':
        case 'schemas':
          valueArray.forEach(schemaItem => {
            if (typeof schemaItem !== 'string') {
              Logger.warn(
                `ExtensionContainer: "${extensionName}" extension contains non-string GraphQL Schema definition,` +
                  `please check its "${name}" configuration and make sure all items are represented as strings. ${schemaItem}`
              );
            }
          });

          dest.schemas.push(...valueArray);
          break;
        case 'resolvers':
          dest.resolvers.push(...valueArray);
          break;
        case 'context':
          dest.contextModifiers.push(value);
          break;
        case 'dataSources':
          Object.assign(dest.dataSources, value);
          break;
        default:
          // todo: consider overriding the properties that we don't have custom merge logic for yet instead of
          // skipping those
          // that would give a possibility to override any kind of ApolloServer setting but the downside is
          // that one extension could override setting returned by previous one
          Logger.warn(
            `ExtensionContainer: "${extensionName}" extension wants to use GraphQL "${name}" option which is not supported by Falcon extensions api yet - skipping that option`
          );
          break;
      }
    });
  }

  /**
   * Imports extension's GraphQL Schema (if present in the provided "package")
   * @returns Partial GraphQL Schema (if available)
   */
  protected importExtensionGraphQLSchema(basePath: string): string | undefined {
    const packagePath = path.join(basePath, this.schemaFileName);
    const subFolderPath = path.join(process.cwd(), packagePath);
    const readFile = (filePath: string) => fs.readFileSync(filePath, 'utf8');

    try {
      const packageResolvedPath: string = require.resolve(packagePath);
      Logger.debug(`${this.constructor.name}: Loading Schema from "${packageResolvedPath}"`);
      return readFile(packageResolvedPath);
    } catch {
      try {
        Logger.debug(`${this.constructor.name}: Loading Schema from "${subFolderPath}"`);
        return readFile(subFolderPath);
      } catch {
        return undefined;
      }
    }
  }

  /**
   * Performs partial auto-binding for DataSource methods based on the provided `typeDefs`
   * @param typeDefs Extension's GQL schema type definitions
   * @param dataSource DataSource initializer
   * @returns GraphQL configuration object
   */
  protected getExtensionGraphQLConfig(
    typeDefs: string | Array<string>,
    dataSourceName: string
  ): ExtensionGraphQLConfig | undefined {
    if (!typeDefs) {
      return;
    }

    const rootTypes = getRootTypeFields(typeDefs as any);
    const resolvers: GraphQLResolverMap = {};

    Object.keys(rootTypes).forEach((typeName: string) => {
      resolvers[typeName] = {};
      rootTypes[typeName].forEach((fieldName: string) => {
        Logger.debug(
          `${
            this.constructor.name
          }: binding "${typeName}.${fieldName} => ${dataSourceName}.${fieldName}(obj, args, context, info)" resolver`
        );
        resolvers[typeName][fieldName] = async (
          obj: any,
          args: any,
          context: GraphQLContext,
          info: GraphQLResolveInfo
        ) => {
          const dataSource = this.getApi(context.dataSources, dataSourceName);
          if (typeof (dataSource[fieldName] !== 'function')) {
            throw new Error(
              `${this.constructor.name}: ${dataSourceName}.${fieldName}() resolver method is not defined!`
            );
          }
          return dataSource[fieldName](obj, args, context, info);
        };
      });
    });

    return {
      schema: Array.isArray(typeDefs) ? typeDefs : [typeDefs],
      resolvers
    };
  }

  /**
   * Gets API instance from DataSource by assigned API name
   * @param context GraphQL Resolver context object
   * @param apiName Name of ApiDataSource (set via config)
   * @returns API DataSource instance if found
   */
  protected getApi(dataSources: DataSources, name: string): ApiDataSource<GraphQLContext> | null {
    return name in dataSources ? dataSources[name] : null;
  }
}
