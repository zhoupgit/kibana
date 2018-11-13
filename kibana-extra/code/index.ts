/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { EsClient, Esqueue } from '@code/esqueue';
import moment from 'moment';
import { resolve } from 'path';

import {
  LspIndexerFactory,
  RepositoryIndexInitializerFactory,
  tryMigrateIndices,
} from './server/indexer';
import { Server } from './server/kibana_types';
import { Log } from './server/log';
import { LspService } from './server/lsp/lsp_service';
import {
  CancellationSerivce,
  CloneWorker,
  DeleteWorker,
  IndexWorker,
  UpdateWorker,
} from './server/queue';
import { fileRoute } from './server/routes/file';
import { lspRoute, symbolByQnameRoute } from './server/routes/lsp';
import { monacoRoute } from './server/routes/monaco';
import { repositoryRoute } from './server/routes/repository';
import {
  documentSearchRoute,
  repositorySearchRoute,
  symbolSearchRoute,
} from './server/routes/search';
import { socketRoute } from './server/routes/socket';
import { userRoute } from './server/routes/user';
import { workspaceRoute } from './server/routes/workspace';
import { IndexScheduler, UpdateScheduler } from './server/scheduler';
import { DocumentSearchClient, RepositorySearchClient, SymbolSearchClient } from './server/search';
import { ServerOptions } from './server/server_options';
import { SocketService } from './server/socket_service';
import { ServerLoggerFactory } from './server/utils/server_logger_factory';

// tslint:disable-next-line no-default-export
export default (kibana: any) =>
  new kibana.Plugin({
    require: ['elasticsearch'],
    name: 'code',
    publicDir: resolve(__dirname, 'public'),
    uiExports: {
      app: {
        title: 'Code',
        description: 'Code Search Plugin',
        main: 'plugins/code/app',
      },
      styleSheetPaths: resolve(__dirname, 'public/styles.scss'),
    },

    config(Joi: any) {
      return Joi.object({
        enabled: Joi.boolean().default(true),
        queueIndex: Joi.string().default('.code-worker-queue'),
        // 1 hour by default.
        queueTimeout: Joi.number().default(moment.duration(1, 'hour').asMilliseconds()),
        // The frequency which update scheduler executes. 5 minutes by default.
        updateFrequencyMs: Joi.number().default(moment.duration(5, 'minute').asMilliseconds()),
        // The frequency which index scheduler executes. 1 day by default.
        indexFrequencyMs: Joi.number().default(moment.duration(1, 'day').asMilliseconds()),
        // The frequency which each repo tries to update. 1 hour by default.
        updateRepoFrequencyMs: Joi.number().default(moment.duration(1, 'hour').asMilliseconds()),
        // The frequency which each repo tries to index. 1 day by default.
        indexRepoFrequencyMs: Joi.number().default(moment.duration(1, 'day').asMilliseconds()),
        // timeout a request over 30s.
        lspRequestTimeoutMs: Joi.number().default(moment.duration(10, 'second').asMilliseconds()),
        repos: Joi.array().default([]),
        maxWorkspace: Joi.number().default(5), // max workspace folder for each language server
        isAdmin: Joi.boolean().default(true), // If we show the admin buttons
        disableScheduler: Joi.boolean().default(true), // Temp option to disable all schedulers.
        enableGlobalReference: Joi.boolean().default(false), // Global reference as optional feature for now
      }).default();
    },

    init: async (server: Server, options: any) => {
      const queueIndex = server.config().get('code.queueIndex');
      const queueTimeout = server.config().get('code.queueTimeout');
      const adminCluster = server.plugins.elasticsearch.getCluster('admin');
      const dataCluster = server.plugins.elasticsearch.getCluster('data');
      const log = new Log(server);
      const serverOptions = new ServerOptions(options, server.config());

      const socketService = new SocketService(log);

      // Initialize search clients
      const repoSearchClient = new RepositorySearchClient(dataCluster.getClient(), log);
      const documentSearchClient = new DocumentSearchClient(dataCluster.getClient(), log);
      const symbolSearchClient = new SymbolSearchClient(dataCluster.getClient(), log);

      const esClient: EsClient = adminCluster.getClient();

      // Initialize indexing factories.
      const lspService = new LspService(
        '127.0.0.1',
        serverOptions,
        esClient,
        new ServerLoggerFactory(server)
      );
      const lspIndexerFactory = new LspIndexerFactory(lspService, serverOptions, esClient, log);

      const repoIndexInitializerFactory = new RepositoryIndexInitializerFactory(esClient, log);

      // Initialize queue worker cancellation service.
      const cancellationService = new CancellationSerivce();

      // Execute index version checking and try to migrate index data if necessary.
      await tryMigrateIndices(esClient, log);

      // Initialize queue.
      const queue = new Esqueue(queueIndex, {
        client: esClient,
        timeout: queueTimeout,
        doctype: 'esqueue',
      });
      const indexWorker = new IndexWorker(
        queue,
        log,
        esClient,
        [lspIndexerFactory],
        cancellationService,
        socketService
      ).bind();
      const cloneWorker = new CloneWorker(queue, log, esClient, indexWorker, socketService).bind();
      const deleteWorker = new DeleteWorker(
        queue,
        log,
        esClient,
        cancellationService,
        lspService,
        socketService
      ).bind();
      const updateWorker = new UpdateWorker(queue, log, esClient).bind();

      // Initialize schedulers.
      const updateScheduler = new UpdateScheduler(updateWorker, serverOptions, esClient, log);
      const indexScheduler = new IndexScheduler(indexWorker, serverOptions, esClient, log);
      if (!serverOptions.disableScheduler) {
        updateScheduler.start();
        indexScheduler.start();
      }

      // Add server routes and initialize the plugin here
      repositoryRoute(
        server,
        serverOptions,
        cloneWorker,
        deleteWorker,
        indexWorker,
        repoIndexInitializerFactory
      );
      repositorySearchRoute(server, repoSearchClient);
      documentSearchRoute(server, documentSearchClient);
      symbolSearchRoute(server, symbolSearchClient);
      fileRoute(server, serverOptions);
      workspaceRoute(server, serverOptions, esClient);
      monacoRoute(server);
      symbolByQnameRoute(server, symbolSearchClient);
      socketRoute(server, socketService, log);
      userRoute(server, serverOptions);

      lspService.launchServers().then(() => {
        // register lsp route after language server launched
        lspRoute(server, lspService, serverOptions);
      });
    },
  });
